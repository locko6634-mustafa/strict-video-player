/**
 * StrictVideo SCORM 1.2 / 2004 LMS Client & Heartbeat Entegrasyonu
 * Referans kamu sistemi (SPK / SPL) standart SCORM API fonksiyonları ile birebir uyumludur.
 */

export class ScormLmsClient {
  constructor(videoElement, securityController, options = {}) {
    this.video = videoElement;
    this.security = securityController;
    this.onStatusUpdate = options.onStatusUpdate || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onViolation = options.onViolation || (() => {});

    // SCORM Durum Alanları
    this.sessionId = null;
    this.token = null;
    this.sequence = 0;
    this.heartbeatTimer = null;
    this.verifiedSeconds = 0;
    this.totalDuration = 120;
    this.isCompleted = false;
    this.activeProof = null;
    this.lastErrorCode = '0'; // 0 = No error (SCORM standard)

    // SCORM CMI Veri Modeli
    this.cmi = {
      'cmi.core.lesson_status': 'incomplete',
      'cmi.core.session_time': '00:00:00',
      'cmi.core.lesson_location': '0',
      'cmi.suspend_data': ''
    };

    this.LMSInitialize();
  }

  // --- 1. SCORM STANDART METODU: LMSInitialize / Initialize ---
  async LMSInitialize() {
    try {
      const res = await fetch('/api/v1/scorm/initialize', { method: 'POST' });
      if (!res.ok) throw new Error('SCORM oturumu başlatılamadı');
      const data = await res.json();

      this.sessionId = data.sessionId;
      this.token = data.token;
      this.activeProof = data.initialProof || null;
      this.totalDuration = data.totalDuration || 120;
      this.lastErrorCode = '0';

      // Videoyu oturum ve token parametresi ile bağla (Challenged Range Streaming)
      if (this.video && this.video.src && !this.video.src.includes('sessionId=')) {
        const separator = this.video.src.includes('?') ? '&' : '?';
        this.video.src = `${this.video.src}${separator}sessionId=${this.sessionId}&token=${this.token}`;
      }

      this.onLog('info', `[SCORM LMSInitialize]: Oturum açıldı (ID: ${this.sessionId.slice(0, 8)}...).`);
      this.startTrackingLoop(data.heartbeatInterval || 3);
      return 'true';
    } catch (err) {
      this.lastErrorCode = '101'; // General Exception
      this.onLog('danger', `[SCORM LMSInitialize Hatası]: ${err.message}`);
      return 'false';
    }
  }

  // Geriye dönük uyumluluk takma adı
  init() {
    return this.LMSInitialize();
  }

  // --- 2. SCORM STANDART METODU: LMSSetValue / SetValue ---
  LMSSetValue(element, value) {
    if (Object.prototype.hasOwnProperty.call(this.cmi, element)) {
      this.cmi[element] = String(value);
      return 'true';
    }
    this.cmi[element] = String(value);
    return 'true';
  }

  // --- 3. SCORM STANDART METODU: LMSGetValue / GetValue ---
  LMSGetValue(element) {
    if (element === 'cmi.core.session_time') {
      return this.formatScormTime(this.verifiedSeconds);
    }
    if (element === 'cmi.core.lesson_status') {
      return this.isCompleted ? 'completed' : 'incomplete';
    }
    if (element === 'cmi.core.lesson_location') {
      return String(this.video ? this.video.currentTime : 0);
    }
    return this.cmi[element] || '';
  }

  // --- 4. SCORM STANDART METODU: LMSCommit / Commit ---
  async LMSCommit(overridePayload = null) {
    if (!this.sessionId || !this.token) {
      this.lastErrorCode = '301'; // Not Initialized
      return 'false';
    }

    const isPlaying = this.video ? !this.video.paused : false;
    const isFocused = this.security ? this.security.isPageFocused : true;

    if (!isPlaying && !overridePayload) {
      return 'true';
    }

    this.sequence++;
    const currentPosition = this.video ? this.video.currentTime : 0;
    this.LMSSetValue('cmi.core.lesson_location', currentPosition);

    const payload = overridePayload || {
      sessionId: this.sessionId,
      token: this.token,
      sequence: this.sequence,
      currentPosition,
      isFocused,
      segmentProof: this.activeProof
    };

    try {
      const res = await fetch('/api/v1/scorm/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        this.lastErrorCode = String(res.status);
        this.onLog('danger', `[SCORM Alarmı (${res.status})]: ${data.error}`);
        this.onViolation(data);
        return 'false';
      }

      this.verifiedSeconds = data.verifiedSeconds;
      this.isCompleted = data.isCompleted;
      if (data.nextProof) {
        this.activeProof = data.nextProof;
      }

      this.LMSSetValue('cmi.core.session_time', this.formatScormTime(this.verifiedSeconds));
      if (this.isCompleted) {
        this.LMSSetValue('cmi.core.lesson_status', 'completed');
      }

      this.onStatusUpdate({
        verifiedSeconds: this.verifiedSeconds,
        totalDuration: this.totalDuration,
        percentage: data.percentage,
        isCompleted: this.isCompleted
      });

      if (isFocused && isPlaying) {
        this.onLog('info', `[SCORM Commit]: Süre Onaylandı (${this.verifiedSeconds}s / ${this.totalDuration}s — %${data.percentage})`);
      }

      return 'true';
    } catch (err) {
      this.lastErrorCode = '101';
      this.onLog('warning', `[Ağ Uyarısı]: SCORM Commit gönderilemedi (${err.message})`);
      return 'false';
    }
  }

  // Geriye dönük uyumluluk takma adı
  sendHeartbeat(overridePayload = null) {
    return this.LMSCommit(overridePayload);
  }

  // --- 5. SCORM STANDART METODU: LMSFinish / Terminate ---
  async LMSFinish(studentName = 'Mustafa Ayverdi') {
    if (!this.sessionId || !this.token) {
      this.lastErrorCode = '301';
      throw new Error('Aktif SCORM oturumu bulunamadı.');
    }

    const res = await fetch('/api/v1/scorm/finish', {
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
      this.lastErrorCode = String(res.status);
      throw new Error(data.message || data.error || 'Sertifika talebi reddedildi.');
    }

    this.cmi['cmi.core.lesson_status'] = 'completed';
    return data.certificate;
  }

  // Geriye dönük uyumluluk takma adı
  claimCertificate(studentName = 'Mustafa Ayverdi') {
    return this.LMSFinish(studentName);
  }

  // --- 6. SCORM STANDART METODU: LMSGetLastError ---
  LMSGetLastError() {
    return this.lastErrorCode;
  }

  // --- İZLEME DÖNGÜSÜ ---
  startTrackingLoop(intervalSeconds = 3) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      this.LMSCommit();
    }, intervalSeconds * 1000);
  }

  // Geriye dönük uyumluluk takma adı
  startHeartbeatLoop(intervalSeconds = 3) {
    return this.startTrackingLoop(intervalSeconds);
  }

  // Siber Test: Hızlı Spam Gönderimi
  async testSpamHeartbeats(count = 5) {
    this.onLog('warning', `[Siber Test]: ${count} adet ardışık hızlı SCORM paketi (spam) gönderiliyor...`);
    for (let i = 0; i < count; i++) {
      this.sequence++;
      const payload = {
        sessionId: this.sessionId,
        token: this.token,
        sequence: this.sequence,
        currentPosition: this.video ? this.video.currentTime : 0,
        isFocused: true,
        segmentProof: this.activeProof
      };
      fetch('/api/v1/scorm/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json()).then(data => {
        if (data.error) {
          this.onLog('danger', `[SCORM Backend Yanıtı]: ${data.error}`);
        }
      });
    }
  }

  formatScormTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }
}

// Geriye dönük uyumluluk sınıf takma adı
export const HeartbeatClient = ScormLmsClient;
