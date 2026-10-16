/**
 * StrictVideo Security Controller
 * Manages all anti-tampering, focus tracking, and playback enforcement rules.
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
    this.lockPlaybackRate();
    this.bindFocusEvents();
    this.bindKeyboardInterception();
    this.bindContextMenuInterception();
    this.bindSeekingInterception();
    this.startDevToolsDetection();

    this.onLog('info', 'Güvenlik modülü aktif: Odak, hız, ileri sarma ve F12 koruması devrede.');
    this.updateFocusStatus(document.hasFocus() && !document.hidden);
  }

  /**
   * 1. Hız Kilidi (1.0x Sabitleme)
   * Prototype ve element seviyesinde playbackRate değişimini engeller.
   */
  lockPlaybackRate() {
    const video = this.video;

    // Default rate
    video.playbackRate = 1.0;
    video.defaultPlaybackRate = 1.0;

    // ratechange olayını dinle ve anında 1.0x'e zorla
    video.addEventListener('ratechange', () => {
      if (video.playbackRate !== 1.0) {
        this.onLog('danger', `Hızlandırma/yavaşlatma girişimi engellendi (${video.playbackRate}x -> 1.0x).`);
        video.playbackRate = 1.0;
        this.triggerViolation('Hız Değiştirme Engellendi', 'Video hızı 1.0x olarak kilitlenmiştir.');
      }
    });

    // Object.defineProperty ile doğrudan koddan değiştirilmesini zorlaştır
    try {
      let currentRate = 1.0;
      Object.defineProperty(video, 'playbackRate', {
        get: () => 1.0,
        set: (val) => {
          if (val !== 1.0) {
            this.onLog('danger', `playbackRate manipülasyonu engellendi (${val}x).`);
            this.triggerViolation('Hız Değiştirme Engellendi', 'Video hızı değiştirilemez.');
          }
          currentRate = 1.0;
        },
        configurable: true
      });
    } catch (e) {
      console.warn('PlaybackRate property kilidi uygulanamadı:', e);
    }
  }

  /**
   * 2. Odak ve Sekme Takibi
   * Başka sekmeye geçildiğinde veya sayfadan odak ayrıldığında anında durdurur.
   */
  bindFocusEvents() {
    // Sekme görünürlüğü
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.handleFocusLost('Başka bir sekmeye geçildi veya pencere simge durumuna küçültüldü.');
      } else {
        this.handleFocusGained('Sekmeye geri dönüldü.');
      }
    });

    // Pencere odak kaybı (başka bir programa tıklandığında)
    window.addEventListener('blur', () => {
      this.handleFocusLost('Sayfa dışına tıklandı veya başka bir programa odaklanıldı.');
    });

    // Pencereye geri odaklanma
    window.addEventListener('focus', () => {
      this.handleFocusGained('Sayfaya tekrar odaklanıldı.');
    });

    // Mouse pencereden tamamen çıkınca opsiyonel denetim
    document.addEventListener('mouseleave', () => {
      // Sadece pencere odakta değilse durdur
      if (!document.hasFocus()) {
        this.handleFocusLost('İmleç ve odak sayfa dışına çıktı.');
      }
    });
  }

  handleFocusLost(reason) {
    this.isPageFocused = false;
    this.updateFocusStatus(false);

    if (!this.video.paused) {
      this.video.pause();
      this.onLog('danger', `Odak Kayboldu: ${reason} (Video durduruldu)`);
      this.triggerViolation('Odak Kayboldu!', `${reason} Devam etmek için sayfaya dönüp Oynat butonuna tıklayın.`);
    } else {
      this.onLog('warning', `Odak Kayboldu: ${reason}`);
    }
  }

  handleFocusGained(message) {
    this.isPageFocused = true;
    this.updateFocusStatus(true);
    this.onLog('info', `Odak Sağlandı: ${message}`);
  }

  updateFocusStatus(focused) {
    this.onFocusChange(focused);
  }

  /**
   * 3. F12 ve Geliştirici Kısayolları Engelleme
   */
  bindKeyboardInterception() {
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
        this.triggerViolation('Yetkisiz Kısayol!', `${shortcutName} kullanımı engellendi. Güvenlik gereği video duraklatıldı.`);
        return false;
      }

      // Klavye ile ileri sarma tuşlarını engelle
      if (isForwardSeekKey) {
        e.preventDefault();
        e.stopPropagation();
        this.onLog('warning', `Klavye ile ileri sarma engellendi (${e.key}).`);
        this.triggerViolation('İleri Sarma Engellendi', 'Klavye kısayolları ile videoyu ileri saramazsınız.');
        return false;
      }
    }, true);
  }

  /**
   * 4. Sağ Tık (Context Menu) Engelleme
   * Kullanıcının 'İncele', 'Video olarak kaydet' veya tarayıcının varsayılan menüsünü açmasını engeller.
   */
  bindContextMenuInterception() {
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onLog('warning', 'Sağ tık (Bağlam Menüsü) engellendi.');
      this.triggerViolation('Sağ Tık Engellendi', 'Güvenlik ilkeleri gereği sağ tık menüsü devre dışıdır.');
      return false;
    });
  }

  /**
   * 5. İleri Sarma Engelleme (Playback Integrity)
   * Videonun henüz izlenmemiş bir noktaya veya anlık zamandan ileriye atlanmasını engeller.
   */
  bindSeekingInterception() {
    const video = this.video;
    let isClamping = false;

    // timeupdate sırasında zamanı ve güvenli izleme noktasını güncelle
    video.addEventListener('timeupdate', () => {
      const current = video.currentTime;

      // Normal oynatma akışındaysa safeTime'ı ilerlet
      if (!isClamping && current >= this.lastSafeTime && current - this.lastSafeTime <= 1.0) {
        this.lastSafeTime = current;
        if (current > this.maxWatchedTime) {
          this.maxWatchedTime = current;
        }
      }
    });

    // Seeking olayını denetle
    video.addEventListener('seeking', () => {
      if (isClamping) {
        isClamping = false;
        return;
      }

      const targetTime = video.currentTime;

      // Eğer ileriye doğru sıçranmaya çalışılıyorsa:
      if (targetTime > this.lastSafeTime + 0.35) {
        // İleri sarmayı engelle ve son güvenli zamana geri çek
        this.onLog('danger', `İleri sarma engellendi (${this.formatTime(this.lastSafeTime)} -> ${this.formatTime(targetTime)}).`);
        isClamping = true;
        video.currentTime = this.lastSafeTime;
        this.triggerViolation('İleri Sarma Engellendi!', 'Bu video ileri sarılamaz. Kesintisiz izlenmesi gerekmektedir.');
      } else {
        // Geri sarmaya izin verildiğinde lastSafeTime geriye çekilir
        this.lastSafeTime = targetTime;
        this.onLog('info', `Geriye sarıldı: ${this.formatTime(targetTime)}`);
      }
    });
  }

  /**
   * 6. DevTools Açılma Tespiti
   * Pencere boyutu farkı ve debugger zamanlama kontrolleri ile geliştirici araçlarını izler.
   */
  startDevToolsDetection() {
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
          this.triggerViolation('Geliştirici Araçları Algılandı!', 'Geliştirici araçları açıkken video oynatılamaz. Lütfen pencereyi kapatın.');
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

  triggerViolation(title, description) {
    this.onSecurityAlert({ title, description });
  }

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
