/**
 * StrictVideo Security Controller
 * Manages all anti-tampering, focus tracking, and playback enforcement rules.
 * Aligned with SPK / SPL SCORM LMS & Video.js reference implementations.
 */

export class SecurityController {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.onSecurityAlert = options.onSecurityAlert || (() => {});
    this.onFocusChange = options.onFocusChange || (() => {});
    this.onLog = options.onLog || (() => {});

    // State trackers
    this.isPageFocused = document.hasFocus() && !document.hidden;
    this.lastSafeTime = 0;
    this.maxWatchedTime = 0;
    this.devToolsOpen = false;
    this.heartbeatInterval = null;

    this.init();
  }

  init() {
    this.enforceNormalPlaybackRate();
    this.setupVisibilityTracking();
    this.preventRestrictedKeyShortcuts();
    this.preventContextMenu();
    this.setupSeekingControl();
    this.monitorDevToolsStatus();

    this.onLog('info', 'Güvenlik modülü aktif: Odak, hız, ileri sarma ve F12 koruması devrede.');
    this.updateFocusStatus(document.hasFocus() && !document.hidden);
  }

  // --- 1. HIZ KONTROLÜ (REFERANS: enforceNormalPlaybackRate & onRateChange) ---
  enforceNormalPlaybackRate() {
    const video = this.video;

    video.playbackRate = 1.0;
    video.defaultPlaybackRate = 1.0;

    video.addEventListener('ratechange', () => this.onRateChange());

    try {
      Object.defineProperty(video, 'playbackRate', {
        get: () => 1.0,
        set: (val) => {
          if (val !== 1.0) {
            this.onLog('danger', `playbackRate manipülasyonu engellendi (${val}x).`);
            this.handleSecurityViolation('Hız Değiştirme Engellendi', 'Video hızı değiştirilemez.');
          }
        },
        configurable: true
      });
    } catch (e) {
      console.warn('PlaybackRate property kilidi uygulanamadı:', e);
    }
  }

  onRateChange() {
    const video = this.video;
    if (video.playbackRate !== 1.0) {
      this.onLog('danger', `Hızlandırma/yavaşlatma girişimi engellendi (${video.playbackRate}x -> 1.0x).`);
      video.playbackRate = 1.0;
      this.handleSecurityViolation('Hız Değiştirme Engellendi', 'Video hızı 1.0x olarak kilitlenmiştir.');
    }
  }

  // Geriye dönük uyumluluk takma adı
  lockPlaybackRate() {
    return this.enforceNormalPlaybackRate();
  }

  // --- 2. ODAK VE GÖRÜNÜRLÜK TAKİBİ (REFERANS: setupVisibilityTracking) ---
  setupVisibilityTracking() {
    // Sekme görünürlüğü
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());

    // Pencere odak kaybı
    window.addEventListener('blur', () => {
      this.onWindowBlur('Sayfa dışına tıklandı veya başka bir programa odaklanıldı.');
    });

    // Pencereye geri odaklanma
    window.addEventListener('focus', () => {
      this.onWindowFocus('Sayfaya tekrar odaklanıldı.');
    });

    // Mouse pencereden tamamen çıkınca
    document.addEventListener('mouseleave', () => {
      if (!document.hasFocus()) {
        this.onWindowBlur('İmleç ve odak sayfa dışına çıktı.');
      }
    });
  }

  onVisibilityChange() {
    if (document.hidden) {
      this.onWindowBlur('Başka bir sekmeye geçildi veya pencere simge durumuna küçültüldü.');
    } else {
      this.onWindowFocus('Sekmeye geri dönüldü.');
    }
  }

  onWindowBlur(reason) {
    this.isPageFocused = false;
    this.updateFocusStatus(false);

    if (!this.video.paused) {
      this.video.pause();
      this.onLog('danger', `Odak Kayboldu: ${reason} (Video durduruldu)`);
      this.handleSecurityViolation('Odak Kayboldu!', `${reason} Devam etmek için sayfaya dönüp Oynat butonuna tıklayın.`);
    } else {
      this.onLog('warning', `Odak Kayboldu: ${reason}`);
    }
  }

  onWindowFocus(message) {
    this.isPageFocused = true;
    this.updateFocusStatus(true);
    this.onLog('info', `Odak Sağlandı: ${message}`);
  }

  // Geriye dönük uyumluluk takma adları
  bindFocusEvents() { return this.setupVisibilityTracking(); }
  handleFocusLost(reason) { return this.onWindowBlur(reason); }
  handleFocusGained(message) { return this.onWindowFocus(message); }

  updateFocusStatus(focused) {
    this.onFocusChange(focused);
  }

  // --- 3. KLAVYE KISAYOLLARI ENGELLEME (REFERANS: preventRestrictedKeyShortcuts) ---
  preventRestrictedKeyShortcuts() {
    window.addEventListener('keydown', (e) => {
      const isF12 = e.key === 'F12' || e.keyCode === 123;
      const isDevToolsCombo = (e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(e.key);
      const isViewSource = (e.ctrlKey || e.metaKey) && ['U', 'u'].includes(e.key);
      const isSavePage = (e.ctrlKey || e.metaKey) && ['S', 's'].includes(e.key);
      const isForwardSeekKey = ['ArrowRight', 'PageUp', 'End', 'l', 'L'].includes(e.key);

      if (isF12 || isDevToolsCombo || isViewSource || isSavePage) {
        e.preventDefault();
        e.stopPropagation();

        if (!this.video.paused) {
          this.video.pause();
        }

        const shortcutName = isF12 ? 'F12 Tuşu' : isDevToolsCombo ? 'Geliştirici Araçları Kısayolu' : isViewSource ? 'Kaynak Görüntüleme Kısayolu' : 'Kaydetme Kısayolu';
        this.onLog('danger', `${shortcutName} engellendi! (Oynatma durduruldu)`);
        this.handleSecurityViolation('Yetkisiz Kısayol!', `${shortcutName} kullanımı engellendi. Güvenlik gereği video duraklatıldı.`);
        return false;
      }

      if (isForwardSeekKey) {
        e.preventDefault();
        e.stopPropagation();
        this.onLog('warning', `Klavye ile ileri sarma engellendi (${e.key}).`);
        this.handleSecurityViolation('İleri Sarma Engellendi', 'Klavye kısayolları ile videoyu ileri saramazsınız.');
        return false;
      }
    }, true);
  }

  // Geriye dönük uyumluluk takma adı
  bindKeyboardInterception() { return this.preventRestrictedKeyShortcuts(); }

  // --- 4. SAĞ TIK BAĞLAM MENÜSÜ ENGELLEME (REFERANS: preventContextMenu) ---
  preventContextMenu() {
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onLog('warning', 'Sağ tık (Bağlam Menüsü) engellendi.');
      this.handleSecurityViolation('Sağ Tık Engellendi', 'Güvenlik ilkeleri gereği sağ tık menüsü devre dışıdır.');
      return false;
    });
  }

  // Geriye dönük uyumluluk takma adı
  bindContextMenuInterception() { return this.preventContextMenu(); }

  // --- 5. İLERİ SARMA VE OYNATMA BÜTÜNLÜĞÜ (REFERANS: setupSeekingControl & onSeeking) ---
  setupSeekingControl() {
    const video = this.video;
    this.isClamping = false;

    video.addEventListener('timeupdate', () => this.onTimeUpdate());
    video.addEventListener('seeking', () => this.onSeeking());
  }

  onTimeUpdate() {
    const current = this.video.currentTime;
    if (!this.isClamping && current >= this.lastSafeTime && current - this.lastSafeTime <= 1.0) {
      this.lastSafeTime = current;
      if (current > this.maxWatchedTime) {
        this.maxWatchedTime = current;
      }
    }
  }

  onSeeking() {
    if (this.isClamping) {
      this.isClamping = false;
      return;
    }

    const targetTime = this.video.currentTime;

    if (targetTime > this.lastSafeTime + 0.35) {
      this.clampToLastSafeTime(targetTime);
    } else {
      this.lastSafeTime = targetTime;
      this.onLog('info', `Geriye sarıldı: ${this.formatTime(targetTime)}`);
    }
  }

  clampToLastSafeTime(targetTime) {
    this.onLog('danger', `İleri sarma engellendi (${this.formatTime(this.lastSafeTime)} -> ${this.formatTime(targetTime)}).`);
    this.isClamping = true;
    this.video.currentTime = this.lastSafeTime;
    this.handleSecurityViolation('İleri Sarma Engellendi!', 'Bu video ileri sarılamaz. Kesintisiz izlenmesi gerekmektedir.');
  }

  // Geriye dönük uyumluluk takma adı
  bindSeekingInterception() { return this.setupSeekingControl(); }

  // --- 6. GELİŞTİRİCİ ARAÇLARI DENETİMİ (REFERANS: monitorDevToolsStatus) ---
  monitorDevToolsStatus() {
    const checkDevTools = () => {
      const widthDiff = window.outerWidth - window.innerWidth > 160;
      const heightDiff = window.outerHeight - window.innerHeight > 160;

      if (widthDiff || heightDiff) {
        if (!this.devToolsOpen) {
          this.devToolsOpen = true;
          if (!this.video.paused) {
            this.video.pause();
          }
          this.onLog('danger', 'Geliştirici Araçları (DevTools) açık algılandı! Video durduruldu.');
          this.handleSecurityViolation('Geliştirici Araçları Algılandı!', 'Geliştirici araçları açıkken video oynatılamaz. Lütfen pencereyi kapatın.');
        }
      } else {
        if (this.devToolsOpen) {
          this.devToolsOpen = false;
          this.onLog('info', 'Geliştirici Araçları kapandı.');
        }
      }
    };

    window.addEventListener('resize', checkDevTools);
    this.heartbeatInterval = setInterval(checkDevTools, 1000);
    if (this.heartbeatInterval && typeof this.heartbeatInterval.unref === 'function') {
      this.heartbeatInterval.unref();
    }
  }

  // Geriye dönük uyumluluk takma adı
  startDevToolsDetection() { return this.monitorDevToolsStatus(); }

  handleSecurityViolation(title, description) {
    this.onSecurityAlert({ title, description });
  }

  // Geriye dönük uyumluluk takma adı
  triggerViolation(title, description) { return this.handleSecurityViolation(title, description); }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}
