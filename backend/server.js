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

// Oturum Yönetimi (Memory Store)
const sessions = new Map();

// HMAC İmzalama Fonksiyonları
function signSession(sessionId) {
  return crypto.createHmac('sha256', SECRET_KEY).update(sessionId).digest('hex');
}

function verifySessionToken(sessionId, token) {
  const expected = signSession(sessionId);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// MIME Türleri
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};

// JSON Yanıt Yardımcısı
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// HTTP Sunucusu
const server = http.createServer((req, res) => {
  // CORS Ön Uçuş
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // --- API ROTALARI ---

  // 1. POST /api/v1/session/start
  if (req.method === 'POST' && pathname === '/api/v1/session/start') {
    const sessionId = crypto.randomUUID();
    const token = signSession(sessionId);
    const now = Date.now();

    const sessionData = {
      sessionId,
      token,
      createdAt: now,
      lastHeartbeatAt: now,
      lastVerifiedPosition: 0,
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
      totalDuration: VIDEO_TOTAL_DURATION,
      heartbeatInterval: 3,
      message: 'Güvenli izleme oturumu başlatıldı. SCORM/Heartbeat takibi devrede.'
    });
  }

  // 2. POST /api/v1/session/heartbeat
  if (req.method === 'POST' && pathname === '/api/v1/session/heartbeat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { sessionId, token, sequence, currentPosition, isFocused } = payload;

        if (!sessionId || !token || !sessions.has(sessionId)) {
          return sendJson(res, 401, { error: 'Geçersiz veya süresi dolmuş oturum.' });
        }

        const session = sessions.get(sessionId);

        // Kriptografik Token Doğrulaması
        if (!verifySessionToken(sessionId, token)) {
          return sendJson(res, 403, { error: 'Token imza doğrulaması başarısız (HMAC Hatası)!' });
        }

        const now = Date.now();
        const timeDiffMs = now - session.lastHeartbeatAt;
        const timeDiffSec = timeDiffMs / 1000;

        // Siber Güvenlik Kontrolü 1: Sequence / Replay Attack Denetimi
        if (sequence <= session.sequence) {
          session.violations.push({ type: 'REPLAY_ATTACK', time: now, sequence });
          return sendJson(res, 400, {
            error: 'Sıra numarası hatası (Replay Attack şüphesi)!',
            expectedSequence: session.sequence + 1,
            received: sequence
          });
        }

        // Siber Güvenlik Kontrolü 2: Hızlandırma & Bombardıman Denetimi (Delta Kontrolü)
        // Beklenen aralık: ~3 saniye (minimum 2.0 saniye kabul edilir)
        if (timeDiffSec < 2.0) {
          session.violations.push({ type: 'FAST_HEARTBEAT_SPAM', time: now, timeDiffSec });
          return sendJson(res, 429, {
            error: 'Sinyal anomalisi: Çok hızlı sinyal gönderimi! Hızlandırma tespit edildi.',
            timeElapsed: timeDiffSec.toFixed(2),
            minAllowed: 2.0
          });
        }

        // Siber Güvenlik Kontrolü 3: İleri Sarma Denetimi
        // Bildirilen pozisyon, son güvenli pozisyondan geçen gerçek süreden fazla ilerlemiş olamaz
        const positionJump = currentPosition - session.lastVerifiedPosition;
        if (positionJump > timeDiffSec + 0.8) {
          session.violations.push({ type: 'FORWARD_SEEK_JUMP', time: now, jump: positionJump });
          return sendJson(res, 400, {
            error: 'İleri sarma hilesi algılandı! Video pozisyonu gerçek zamandan daha hızlı ilerledi.',
            jump: positionJump.toFixed(2),
            allowedMax: (timeDiffSec + 0.8).toFixed(2)
          });
        }

        // Odak Denetimi: Sayfa odak dışındaysa süreye eklenmez
        if (isFocused) {
          // Güvenli süre artırımı (maksimum geçen süre kadar)
          const validIncrement = Math.min(timeDiffSec, 3.5);
          session.accumulatedSeconds += validIncrement;
        }

        session.sequence = sequence;
        session.lastHeartbeatAt = now;
        session.lastVerifiedPosition = currentPosition;

        if (session.accumulatedSeconds >= session.totalDuration) {
          session.isCompleted = true;
        }

        return sendJson(res, 200, {
          success: true,
          verifiedSeconds: Math.min(session.totalDuration, Math.round(session.accumulatedSeconds)),
          totalDuration: session.totalDuration,
          percentage: Math.min(100, Math.round((session.accumulatedSeconds / session.totalDuration) * 100)),
          isCompleted: session.isCompleted,
          isFocused,
          serverTime: new Date(now).toISOString()
        });
      } catch (err) {
        return sendJson(res, 400, { error: 'Geçersiz JSON yükü', details: err.message });
      }
    });
    return;
  }

  // 3. GET /api/v1/session/status
  if (req.method === 'GET' && pathname === '/api/v1/session/status') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !sessions.has(sessionId)) {
      return sendJson(res, 404, { error: 'Oturum bulunamadı.' });
    }

    const session = sessions.get(sessionId);
    return sendJson(res, 200, {
      sessionId: session.sessionId,
      verifiedSeconds: Math.min(session.totalDuration, Math.round(session.accumulatedSeconds)),
      totalDuration: session.totalDuration,
      isCompleted: session.isCompleted,
      violationsCount: session.violations.length,
      violations: session.violations
    });
  }

  // 4. POST /api/v1/session/claim-certificate
  if (req.method === 'POST' && pathname === '/api/v1/session/claim-certificate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { sessionId, token, studentName } = payload;

        if (!sessionId || !token || !sessions.has(sessionId)) {
          return sendJson(res, 401, { error: 'Geçersiz oturum.' });
        }

        const session = sessions.get(sessionId);
        if (!verifySessionToken(sessionId, token)) {
          return sendJson(res, 403, { error: 'Token imza doğrulaması başarısız!' });
        }

        // Asıl Kilit Nokta: Sunucu Onayı (Server-Side Verification)
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
    return;
  }

  // --- STATİK DOSYA SUNUMU ---
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

    // Video için HTTP Range Requests Desteği
    if (ext === '.mp4' && req.headers.range) {
      const range = req.headers.range;
      const totalSize = stats.size;
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType
      });

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[StrictVideo Server] Çalışıyor: http://${HOST}:${PORT}`);
  console.log(`[StrictVideo Server] Backend SCORM/Heartbeat motoru ve HMAC doğrulaması aktif.`);
});
