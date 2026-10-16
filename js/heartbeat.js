/**
 * StrictVideo Backend Heartbeat (SCORM Client) Entegrasyonu
 * Sunucu tarafında doğrulanmış izleme süresini yönetir.
 */

export class HeartbeatClient {
  constructor(videoElement, securityController, options = {}) {
    this.video = videoElement;
    this.security = securityController;
    this.onStatusUpdate = options.onStatusUpdate || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onViolation = options.onViolation || (() => {});

    this.sessionId = null;
    this.token = null;
    this.sequence = 0;
    this.heartbeatTimer = null;
    this.verifiedSeconds = 0;
    this.totalDuration = 120;
    this.isCompleted = false;

    this.init();
  }

  async init() {
    try {
      const res = await fetch('/api/v1/session/start', { method: 'POST' });
      if (!res.ok) throw new Error('Oturum başlatılamadı');
      const data = await res.json();

      this.sessionId = data.sessionId;
      this.token = data.token;
      this.totalDuration = data.totalDuration || 120;

      this.onLog('info', `[Backend]: Güvenli izleme oturumu açıldı (ID: ${this.sessionId.slice(0, 8)}...).`);
      this.startHeartbeatLoop(data.heartbeatInterval || 3);
    } catch (err) {
      this.onLog('danger', `[Backend Bağlantı Hatası]: ${err.message}`);
    }
  }

  startHeartbeatLoop(intervalSeconds = 3) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, intervalSeconds * 1000);
  }

  async sendHeartbeat(overridePayload = null) {
    if (!this.sessionId || !this.token) return;

    // Sadece video oynatılırken ve sayfa odaktayken (veya test override varsa)
    const isPlaying = !this.video.paused;
    const isFocused = this.security.isPageFocused;

    // Video duruyorsa ve odaktaysa normalde izleme süresi artmaz, ancak oturumu canlı tutmak için sinyal gönderilir
    if (!isPlaying && !overridePayload) {
      return;
    }

    this.sequence++;
    const payload = overridePayload || {
      sessionId: this.sessionId,
      token: this.token,
      sequence: this.sequence,
      currentPosition: this.video.currentTime,
      isFocused: isFocused
    };

    try {
      const res = await fetch('/api/v1/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        // Sunucu bir hile veya kural ihlali algıladı
        this.onLog('danger', `[Sunucu Güvenlik Alarmı (${res.status})]: ${data.error}`);
        this.onViolation(data);
        return;
      }

      this.verifiedSeconds = data.verifiedSeconds;
      this.isCompleted = data.isCompleted;

      this.onStatusUpdate({
        verifiedSeconds: this.verifiedSeconds,
        totalDuration: this.totalDuration,
        percentage: data.percentage,
        isCompleted: this.isCompleted
      });

      if (isFocused && isPlaying) {
        this.onLog('info', `[Sunucu Sinyali]: Onaylandı (${this.verifiedSeconds}s / ${this.totalDuration}s — %${data.percentage})`);
      }
    } catch (err) {
      this.onLog('warning', `[Ağ Uyarısı]: Sinyal gönderilemedi (${err.message})`);
    }
  }

  // Tersine Mühendislik Testi 1: Hızlı Spam Gönderimi
  async testSpamHeartbeats(count = 5) {
    this.onLog('warning', `[Siber Test]: ${count} adet ardışık hızlı sinyal (spam) gönderiliyor...`);
    for (let i = 0; i < count; i++) {
      this.sequence++;
      const payload = {
        sessionId: this.sessionId,
        token: this.token,
        sequence: this.sequence,
        currentPosition: this.video.currentTime,
        isFocused: true
      };
      // Gecikmesiz hızlı istekler
      fetch('/api/v1/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json()).then(data => {
        if (data.error) {
          this.onLog('danger', `[Backend Yanıtı]: ${data.error}`);
        }
      });
    }
  }

  // Sertifika Talep Et
  async claimCertificate(studentName = 'Mustafa Ayverdi') {
    if (!this.sessionId || !this.token) {
      throw new Error('Aktif oturum bulunamadı.');
    }

    const res = await fetch('/api/v1/session/claim-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        token: this.token,
        studentName
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Sertifika talebi reddedildi.');
    }
    return data.certificate;
  }

  destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }
}
