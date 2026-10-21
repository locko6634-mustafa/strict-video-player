import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 8095;
const HOST = process.env.HOST || '0.0.0.0';
const SECRET_KEY = process.env.SECRET_KEY || 'strict-video-hmac-secret-key-2026';
const VIDEO_TOTAL_DURATION = 120; // 2 dakika = 120 saniye
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 dakika oturum yaşam döngüsü (TTL)

// Oturum Yönetimi (Memory Store with TTL)
const sessions = new Map();

// --- 1. OTURUM TEMİZLEME VE YAŞAM DÖNGÜSÜ (TTL CLEANUP) ---
export function cleanupExpiredSessions() {
  const now = Date.now();
  let purged = 0;
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      purged++;
    }
  }
  return purged;
}

const cleanupTimer = setInterval(cleanupExpiredSessions, 60000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

// --- 2. KRİPTOGRAFİK VE İMZA FONKSİYONLARI ---
export function generateSessionHmac(sessionId) {
  return crypto.createHmac('sha256', SECRET_KEY).update(sessionId).digest('hex');
}
export const signSession = generateSessionHmac; // Geriye dönük uyumluluk takma adı

export function verifySessionHmac(sessionId, token) {
  if (!sessionId || !token) return false;
  const expected = generateSessionHmac(sessionId);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
export const verifySessionToken = verifySessionHmac; // Geriye dönük uyumluluk takma adı

// --- 3. VİDEO SEGMENT & MEDYA AKIŞ DOĞRULAMASI (CHALLENGED STREAMING PROOF) ---
export function generateSegmentProof(sessionId, segmentIndex) {
  return crypto.createHmac('sha256', SECRET_KEY)
    .update(`SEGMENT:${sessionId}:${segmentIndex}`)
    .digest('hex');
}

export function verifySegmentProof(session, position, providedProof) {
  const segmentIndex = Math.floor(position / 8);
  const expectedProof = generateSegmentProof(session.sessionId, segmentIndex);

  // İstemci geçerli segment kanıtı iletmişse
  if (providedProof && providedProof === expectedProof) {
    session.lastMediaPosition = Math.max(session.lastMediaPosition || 0, (segmentIndex + 1) * 8);
    return true;
  }

  // İstemci segment veya Range çekerek lastMediaPosition'ı ilerletmişse
  // position <= lastMediaPosition + 12s buffer toleransı dahilindedir
  if ((session.lastMediaPosition || 0) + 12 >= position) {
    return true;
  }

  return false;
}

// MIME Türleri (HLS .m3u8 ve .ts desteği eklendi)
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.ico': 'image/x-icon'
};

// JSON Yanıt Yardımcısı
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Segment-Proof, X-Session-Id',
    'Access-Control-Expose-Headers': 'X-Segment-Proof, X-Session-Id'
  });
  res.end(JSON.stringify(data));
}

// --- 4. SCORM STANDARDI VE REFERANS SİSTEM HANDLER FONKSİYONLARI ---

/**
 * LMSInitialize / Initialize
 * Referans Sistem: SCORM 1.2 LMSInitialize("") — Oturumu başlatır.
 */
function lmsInitialize(req, res) {
  const sessionId = crypto.randomUUID();
  const token = generateSessionHmac(sessionId);
  const now = Date.now();

  const sessionData = {
    sessionId,
    token,
    createdAt: now,
    lastActivityAt: now,
    lastHeartbeatAt: now,
    lastVerifiedPosition: 0,
    lastMediaPosition: 8, // Başlangıç buffer payı
    sequence: 0,
    accumulatedSeconds: 0,
    totalDuration: VIDEO_TOTAL_DURATION,
    isCompleted: false,
    violations: []
  };

  sessions.set(sessionId, sessionData);

  return sendJson(res, 200, {
    success: true,
    sessionId,
    token,
    initialProof: generateSegmentProof(sessionId, 0),
    totalDuration: VIDEO_TOTAL_DURATION,
    heartbeatInterval: 3,
    scormVersion: 'SCORM 1.2 / 2004 Conformance Engine',
    message: 'LMSInitialize: SCORM izleme oturumu başarıyla açıldı.'
  });
}

/**
 * LMSCommit / Commit
 * Referans Sistem: SCORM 1.2 LMSCommit("") — Süre ve ilerleme verilerini sunucuya kaydeder.
 */
function lmsCommit(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const { sessionId, token, sequence, currentPosition, isFocused, segmentProof } = payload;

      if (!sessionId || !token || !sessions.has(sessionId)) {
        return sendJson(res, 401, { error: 'Geçersiz veya süresi dolmuş SCORM oturumu.' });
      }

      const session = sessions.get(sessionId);
      const now = Date.now();
      session.lastActivityAt = now;

      // 1. Kriptografik Token Doğrulaması (HMAC)
      if (!verifySessionHmac(sessionId, token)) {
        return sendJson(res, 403, { error: 'Token imza doğrulaması başarısız (HMAC Hatası)!' });
      }

      const timeDiffMs = now - session.lastHeartbeatAt;
      const timeDiffSec = timeDiffMs / 1000;

      // 2. Siber Güvenlik Kontrolü: Sequence / Replay Attack Denetimi
      if (sequence <= session.sequence) {
        session.violations.push({ type: 'REPLAY_ATTACK', time: now, sequence });
        return sendJson(res, 400, {
          error: 'Sıra numarası hatası (Replay Attack şüphesi)!',
          expectedSequence: session.sequence + 1,
          received: sequence
        });
      }

      // 3. Siber Güvenlik Kontrolü: Hızlandırma & Bombardıman Denetimi (Delta Kontrolü)
      if (timeDiffSec < 2.0) {
        session.violations.push({ type: 'FAST_HEARTBEAT_SPAM', time: now, timeDiffSec });
        return sendJson(res, 429, {
          error: 'Sinyal anomalisi: Çok hızlı sinyal gönderimi! Hızlandırma tespit edildi.',
          timeElapsed: timeDiffSec.toFixed(2),
          minAllowed: 2.0
        });
      }

      // 4. Siber Güvenlik Kontrolü: İleri Sarma Denetimi
      const positionJump = currentPosition - session.lastVerifiedPosition;
      if (positionJump > timeDiffSec + 0.8) {
        session.violations.push({ type: 'FORWARD_SEEK_JUMP', time: now, jump: positionJump });
        return sendJson(res, 400, {
          error: 'İleri sarma hilesi algılandı! Video pozisyonu gerçek zamandan daha hızlı ilerledi.',
          jump: positionJump.toFixed(2),
          allowedMax: (timeDiffSec + 0.8).toFixed(2)
        });
      }

      // 5. İyileştirme: Medya Akış Doğrulaması (Ghost Playback Koruması)
      if (!verifySegmentProof(session, currentPosition, segmentProof)) {
        session.violations.push({ type: 'GHOST_STREAM_SPOOF', time: now, position: currentPosition });
        return sendJson(res, 403, {
          error: 'Medya akış doğrulaması başarısız! Video segmenti indirilmeden SCORM commit yapılamaz (Ghost Playback Engellendi).',
          currentPosition,
          lastMediaPosition: session.lastMediaPosition || 0
        });
      }

      // 6. Odak Denetimi: Sayfa odak dışındaysa süreye eklenmez
      if (isFocused) {
        const validIncrement = Math.min(timeDiffSec, 3.5);
        session.accumulatedSeconds += validIncrement;
      }

      session.sequence = sequence;
      session.lastHeartbeatAt = now;
      session.lastVerifiedPosition = currentPosition;

      if (session.accumulatedSeconds >= session.totalDuration) {
        session.isCompleted = true;
      }

      const activeSegmentIndex = Math.floor(currentPosition / 8);
      const nextExpectedProof = generateSegmentProof(session.sessionId, activeSegmentIndex);

      return sendJson(res, 200, {
        success: true,
        verifiedSeconds: Math.min(session.totalDuration, Math.round(session.accumulatedSeconds)),
        totalDuration: session.totalDuration,
        percentage: Math.min(100, Math.round((session.accumulatedSeconds / session.totalDuration) * 100)),
        isCompleted: session.isCompleted,
        isFocused,
        nextProof: nextExpectedProof,
        serverTime: new Date(now).toISOString()
      });
    } catch (err) {
      return sendJson(res, 400, { error: 'Geçersiz JSON yükü', details: err.message });
    }
  });
}

/**
 * LMSGetValue / GetValue
 * Referans Sistem: SCORM 1.2 LMSGetValue("cmi.core.session_time") — Mevcut oturum durumunu okur.
 */
function lmsGetValue(req, res, url) {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId || !sessions.has(sessionId)) {
    return sendJson(res, 404, { error: 'SCORM oturumu bulunamadı.' });
  }

  const session = sessions.get(sessionId);
  session.lastActivityAt = Date.now();

  return sendJson(res, 200, {
    sessionId: session.sessionId,
    verifiedSeconds: Math.min(session.totalDuration, Math.round(session.accumulatedSeconds)),
    totalDuration: session.totalDuration,
    isCompleted: session.isCompleted,
    violationsCount: session.violations.length,
    violations: session.violations
  });
}

/**
 * LMSFinish / Finish
 * Referans Sistem: SCORM 1.2 LMSFinish("") — Eğitimi sonlandırır ve sertifika onayını kontrol eder.
 */
function lmsFinish(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const { sessionId, token, studentName } = payload;

      if (!sessionId || !token || !sessions.has(sessionId)) {
        return sendJson(res, 401, { error: 'Geçersiz veya süresi dolmuş SCORM oturumu.' });
      }

      const session = sessions.get(sessionId);
      session.lastActivityAt = Date.now();

      if (!verifySessionHmac(sessionId, token)) {
        return sendJson(res, 403, { error: 'Token imza doğrulaması başarısız!' });
      }

      // Kilit Nokta: Sunucu Onayı (Server-Side SCORM Integrity Verification)
      if (!session.isCompleted || session.accumulatedSeconds < session.totalDuration) {
        const missing = session.totalDuration - Math.floor(session.accumulatedSeconds);
        return sendJson(res, 403, {
          error: 'SUNUCU REDDİ: Yetersiz izleme süresi! Sertifika verilemez.',
          requiredSeconds: session.totalDuration,
          actualVerifiedSeconds: Math.floor(session.accumulatedSeconds),
          missingSeconds: missing,
          message: `Bu sertifikayı almak için videoyu en az ${missing} saniye daha kesintisiz izlemelisiniz.`
        });
      }

      // Başarılı Sertifika Oluşturma (Kriptografik İmzalı)
      const certId = `CERT-FOY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const issueDate = new Date().toISOString();
      const signaturePayload = `${certId}|${studentName || 'Katılımcı'}|${session.totalDuration}|${issueDate}`;
      const signature = crypto.createHmac('sha256', SECRET_KEY).update(signaturePayload).digest('hex');

      return sendJson(res, 200, {
        success: true,
        certificate: {
          certId,
          title: 'Finansal Okuryazarlık ve Güvenlik Bütünlüğü Sertifikası',
          recipient: studentName || 'Sayın Katılımcı',
          verifiedDuration: `${session.totalDuration} Saniye (%100 Kesintisiz İzleme)`,
          status: 'VERIFIED_BY_SERVER',
          issuedAt: issueDate,
          digitalSignature: signature
        }
      });
    } catch (err) {
      return sendJson(res, 400, { error: 'Geçersiz JSON yükü' });
    }
  });
}

// --- 5. HTTP SUNUCUSU VE ROTA YÖNLENDİRMESİ ---
const server = http.createServer((req, res) => {
  // CORS Ön Uçuş
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Segment-Proof, X-Session-Id',
      'Access-Control-Expose-Headers': 'X-Segment-Proof, X-Session-Id'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // --- API ROTALARI (Referans SCORM ve Standart Uç Noktalar) ---

  // 1. LMSInitialize / Session Start
  if (req.method === 'POST' && (pathname === '/api/v1/scorm/initialize' || pathname === '/api/v1/session/start')) {
    return lmsInitialize(req, res);
  }

  // 2. LMSCommit / Session Heartbeat
  if (req.method === 'POST' && (pathname === '/api/v1/scorm/commit' || pathname === '/api/v1/session/heartbeat')) {
    return lmsCommit(req, res);
  }

  // 3. LMSGetValue / Session Status
  if (req.method === 'GET' && (pathname === '/api/v1/scorm/getvalue' || pathname === '/api/v1/session/status')) {
    return lmsGetValue(req, res, url);
  }

  // 4. LMSFinish / Claim Certificate
  if (req.method === 'POST' && (pathname === '/api/v1/scorm/finish' || pathname === '/api/v1/session/claim-certificate')) {
    return lmsFinish(req, res);
  }

  // 5. Media Segment Proof Provider
  if (req.method === 'GET' && pathname === '/api/v1/media/proof') {
    const sessionId = url.searchParams.get('sessionId');
    const token = url.searchParams.get('token');
    const position = parseFloat(url.searchParams.get('position') || '0');

    if (!sessionId || !token || !sessions.has(sessionId) || !verifySessionHmac(sessionId, token)) {
      return sendJson(res, 403, { error: 'Geçersiz oturum.' });
    }

    const session = sessions.get(sessionId);
    session.lastActivityAt = Date.now();
    const segmentIndex = Math.floor(position / 8);
    const proof = generateSegmentProof(sessionId, segmentIndex);
    session.lastMediaPosition = Math.max(session.lastMediaPosition || 0, (segmentIndex + 1) * 8);

    return sendJson(res, 200, {
      success: true,
      segmentIndex,
      proof
    });
  }

  // --- STATİK DOSYA VE MEDYA AKIŞI (HLS + MP4 RANGE REQUESTS) ---
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(ROOT_DIR, reqPath);

  // Dizin dışına çıkış güvenliği
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end('Erişim Engellendi');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Dosya Bulunamadı');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Oturum parametreleri verilmişse medya konumunu kaydet
    const sessionId = url.searchParams.get('sessionId');
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      session.lastActivityAt = Date.now();

      // HLS Segmenti istendiyse segment indeksini hesapla
      const tsMatch = pathname.match(/playlist(\d+)\.ts/);
      if (tsMatch) {
        const segIdx = parseInt(tsMatch[1], 10);
        session.lastMediaPosition = Math.max(session.lastMediaPosition || 0, (segIdx + 1) * 8);
        res.setHeader('X-Segment-Proof', generateSegmentProof(sessionId, segIdx));
      }
    }

    // Video için HTTP Range Requests Desteği
    if (ext === '.mp4' && req.headers.range) {
      const range = req.headers.range;
      const totalSize = stats.size;
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      const chunksize = (end - start) + 1;

      // Oturum varsa ve start pozisyonu varsa izleme pozisyonunu güncelle
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        const approxSeconds = (start / totalSize) * VIDEO_TOTAL_DURATION;
        session.lastMediaPosition = Math.max(session.lastMediaPosition || 0, approxSeconds + 8);
        const segIdx = Math.floor(approxSeconds / 8);
        res.setHeader('X-Segment-Proof', generateSegmentProof(sessionId, segIdx));
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Segment-Proof'
      });

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Segment-Proof'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

export { server, sessions };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => {
    console.log(`[StrictVideo SCORM Engine] Çalışıyor: http://${HOST}:${PORT}`);
    console.log(`[StrictVideo SCORM Engine] SCORM 1.2 / 2004 Conformance & HMAC Doğrulaması devrede.`);
    console.log(`[StrictVideo SCORM Engine] HLS & Challenged Streaming Proof koruması aktif.`);
  });
}
