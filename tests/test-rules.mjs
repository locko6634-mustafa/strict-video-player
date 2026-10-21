import test from 'node:test';
import assert from 'node:assert/strict';

// Mock browser globals for Node test environment
const windowListeners = {};
const docListeners = {};

globalThis.document = {
  hasFocus: () => true,
  hidden: false,
  addEventListener: (event, fn) => {
    if (!docListeners[event]) docListeners[event] = [];
    docListeners[event].push(fn);
  }
};

globalThis.window = {
  addEventListener: (event, fn) => {
    if (!windowListeners[event]) windowListeners[event] = [];
    windowListeners[event].push(fn);
  },
  outerWidth: 1920,
  innerWidth: 1920,
  outerHeight: 1080,
  innerHeight: 1080
};

import { SecurityController } from '../js/security.js';

// DOM mock / minimal test harness for security logic
class MockVideo {
  constructor() {
    this._currentTime = 0;
    this._playbackRate = 1.0;
    this.paused = true;
    this.listeners = {};
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(val) {
    this._currentTime = val;
    this.emit('seeking');
  }

  get playbackRate() {
    return this._playbackRate;
  }

  set playbackRate(val) {
    this._playbackRate = val;
    this.emit('ratechange');
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  emit(event) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => fn());
    }
  }

  pause() {
    this.paused = true;
    this.emit('pause');
  }

  play() {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
}

test('SecurityController - İleri Sarma Koruması', () => {
  const video = new MockVideo();
  const alerts = [];
  const logs = [];

  const security = new SecurityController(video, {
    onSecurityAlert: (alert) => alerts.push(alert),
    onLog: (type, msg) => logs.push({ type, msg })
  });

  // Normal oynatma: 0 -> 2 saniye
  video._currentTime = 1.0;
  video.emit('timeupdate');
  video._currentTime = 2.0;
  video.emit('timeupdate');

  assert.equal(security.lastSafeTime, 2.0, 'Son güvenli zaman 2.0 olmalıdır');

  // Yetkisiz ileri sarma denemesi (50. saniyeye atlama)
  video.currentTime = 50.0;

  assert.equal(video.currentTime, 2.0, 'İleri sarma engellenmeli ve son güvenli zamana geri dönmelidir');
  assert.ok(alerts.some(a => a.title.includes('İleri Sarma')), 'İleri sarma uyarısı fırlatılmalıdır');
  assert.ok(logs.some(l => l.type === 'danger' && l.msg.includes('İleri sarma engellendi')), 'İhlal günlüğe kaydedilmelidir');

  security.destroy();
});

test('SecurityController - Geriye Sarma Serbestliği', () => {
  const video = new MockVideo();
  const logs = [];

  const security = new SecurityController(video, {
    onLog: (type, msg) => logs.push({ type, msg })
  });

  // Normal oynatma ile 5.0 saniyeye ilerle
  for (let t = 0.5; t <= 5.0; t += 0.5) {
    video._currentTime = t;
    video.emit('timeupdate');
  }
  assert.equal(security.lastSafeTime, 5.0);

  // Geri sarma (5.0 -> 2.0)
  video.currentTime = 2.0;

  assert.equal(video.currentTime, 2.0, 'Geriye sarmaya izin verilmelidir');
  assert.equal(security.lastSafeTime, 2.0, 'Son güvenli nokta geriye sarılan nokta olmalıdır');
  assert.ok(logs.some(l => l.type === 'info' && l.msg.includes('Geriye sarıldı: 00:02')));

  security.destroy();
});

test('SecurityController - Hız Manipülasyonu Koruması (playbackRate)', () => {
  const video = new MockVideo();
  const alerts = [];

  const security = new SecurityController(video, {
    onSecurityAlert: (alert) => alerts.push(alert)
  });

  // Hızı 2.5x yapmaya çalış
  video.playbackRate = 2.5;

  assert.equal(video.playbackRate, 1.0, 'Hız 1.0x olarak kilitli kalmalıdır');
  assert.ok(alerts.some(a => a.title.includes('Hız Değiştirme Engellendi')), 'Hız kilidi uyarısı fırlatılmalıdır');

  security.destroy();
});

test('SecurityController - Odak Kaybında Videoyu Durdurma', () => {
  const video = new MockVideo();
  video.paused = false; // Video oynatılıyor
  const alerts = [];
  const logs = [];

  const security = new SecurityController(video, {
    onSecurityAlert: (alert) => alerts.push(alert),
    onLog: (type, msg) => logs.push({ type, msg })
  });

  // Window blur simülasyonu
  security.handleFocusLost('Başka programa geçildi');

  assert.equal(video.paused, true, 'Odak kaybında video anında duraklatılmalıdır');
  assert.equal(security.isPageFocused, false, 'isPageFocused durumu false olmalıdır');
  assert.ok(alerts.some(a => a.title.includes('Odak Kayboldu')), 'Odak kaybı uyarısı tetiklenmelidir');

  security.destroy();
});

test('SecurityController - Referans İsimlendirmeleri (onWindowBlur, onVisibilityChange, clampToLastSafeTime)', () => {
  const video = new MockVideo();
  video.paused = false;
  const alerts = [];

  const security = new SecurityController(video, {
    onSecurityAlert: (alert) => alerts.push(alert)
  });

  // onWindowBlur kontrolü
  security.onWindowBlur('Referans sistem blur testi');
  assert.equal(video.paused, true);
  assert.equal(security.isPageFocused, false);

  // onWindowFocus kontrolü
  security.onWindowFocus('Referans sistem focus testi');
  assert.equal(security.isPageFocused, true);

  // clampToLastSafeTime kontrolü
  security.lastSafeTime = 10;
  video._currentTime = 45;
  security.clampToLastSafeTime(45);
  assert.equal(video.currentTime, 10, 'Video son güvenli zamana geri dönmelidir');
  assert.ok(alerts.some(a => a.title.includes('İleri Sarma')), 'İleri sarma engellendi uyarısı verilmelidir');

  security.destroy();
});

test('Backend SCORM - Kriptografik HMAC ve Segment Doğrulaması', async () => {
  const {
    generateSessionHmac,
    verifySessionHmac,
    generateSegmentProof,
    verifySegmentProof,
    cleanupExpiredSessions,
    sessions
  } = await import('../backend/server.js');

  const testSessionId = 'test-session-12345';
  const token = generateSessionHmac(testSessionId);

  // Token doğrulama
  assert.equal(verifySessionHmac(testSessionId, token), true);
  assert.equal(verifySessionHmac(testSessionId, 'invalid-token'), false);

  // Segment proof doğrulama
  const proof0 = generateSegmentProof(testSessionId, 0);
  const sessionObj = {
    sessionId: testSessionId,
    lastMediaPosition: 0
  };

  // Geçerli proof ile doğrulama
  const validProofResult = verifySegmentProof(sessionObj, 5, proof0);
  assert.equal(validProofResult, true, 'Geçerli segment proof doğrulanmalıdır');

  // Buffer payı dahilinde doğrulama
  sessionObj.lastMediaPosition = 20;
  assert.equal(verifySegmentProof(sessionObj, 25, null), true, 'Buffer toleransı içindeki pozisyon geçerli olmalıdır');

  // Ghost stream tespiti (medya çekilmeden ileri pozisyon)
  sessionObj.lastMediaPosition = 0;
  assert.equal(verifySegmentProof(sessionObj, 30, 'fake-proof'), false, 'Medya çekilmeden gönderilen proof reddedilmelidir');

  // TTL ve Garbage Collection temizliği
  const expiredSessionId = 'expired-session-999';
  sessions.set(expiredSessionId, {
    sessionId: expiredSessionId,
    lastActivityAt: Date.now() - (20 * 60 * 1000) // 20 dk önce (TTL 15 dk)
  });
  const activeSessionId = 'active-session-111';
  sessions.set(activeSessionId, {
    sessionId: activeSessionId,
    lastActivityAt: Date.now()
  });

  const purgedCount = cleanupExpiredSessions();
  assert.ok(purgedCount >= 1, 'Süresi dolan oturum temizlenmelidir');
  assert.equal(sessions.has(expiredSessionId), false, 'Süresi dolan oturum Map içinde kalmamalıdır');
  assert.equal(sessions.has(activeSessionId), true, 'Aktif oturum korunmalıdır');

  sessions.delete(activeSessionId);
});
