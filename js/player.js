/**
 * StrictVideo Player UI & Interaction Controller
 * Minimalist, secure video controls strictly enforcing playback restrictions.
 * Aligned with Video.js & SPK / SPL LMS reference implementations.
 */

export class StrictVideoPlayer {
  constructor(videoElement, containerElement, securityController, options = {}) {
    this.video = videoElement;
    this.container = containerElement;
    this.security = securityController;
    this.options = options;

    // Elements
    this.btnPlayPause = containerElement.querySelector('#btn-play-pause');
    this.btnRewind = containerElement.querySelector('#btn-rewind');
    this.btnVolume = containerElement.querySelector('#btn-volume');
    this.volumeSlider = containerElement.querySelector('#volume-slider');
    this.btnFullscreen = containerElement.querySelector('#btn-fullscreen');
    this.progressRail = containerElement.querySelector('#progress-rail');
    this.progressFill = containerElement.querySelector('#progress-fill');
    this.progressWatched = containerElement.querySelector('#progress-watched');
    this.timeDisplay = containerElement.querySelector('#time-display');
    this.overlay = containerElement.querySelector('#video-overlay');
    this.overlayTitle = containerElement.querySelector('#overlay-title');
    this.overlayDesc = containerElement.querySelector('#overlay-desc');
    this.overlayBtn = containerElement.querySelector('#overlay-btn');

    this.onStateChange = options.onStateChange || (() => {});
    this.onLog = options.onLog || (() => {});

    this.init();
  }

  init() {
    this.bindEvents();
    this.updatePlaybackDisplay();
  }

  bindEvents() {
    const video = this.video;

    // Play / Pause toggle
    this.btnPlayPause.addEventListener('click', () => this.togglePlayback());
    this.overlayBtn.addEventListener('click', () => {
      this.hideOverlay();
      this.play();
    });

    // Rewind 5 seconds (backward seeking is safe)
    if (this.btnRewind) {
      this.btnRewind.addEventListener('click', () => {
        const target = Math.max(0, video.currentTime - 5);
        video.currentTime = target;
        this.security.lastSafeTime = target;
        this.onLog('info', `5 saniye geri sarıldı (${this.formatTime(target)}).`);
      });
    }

    // Safe Progress bar interaction
    if (this.progressRail) {
      this.progressRail.addEventListener('click', (e) => this.onProgressSeekAttempt(e));
    }

    // Volume control
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', (e) => {
        video.volume = parseFloat(e.target.value);
        video.muted = (video.volume === 0);
        this.updateVolumeIcon();
      });
    }

    if (this.btnVolume) {
      this.btnVolume.addEventListener('click', () => {
        video.muted = !video.muted;
        if (this.volumeSlider) {
          this.volumeSlider.value = video.muted ? 0 : video.volume;
        }
        this.updateVolumeIcon();
      });
    }

    // Fullscreen
    if (this.btnFullscreen) {
      this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }

    // Video native events
    video.addEventListener('play', () => {
      this.btnPlayPause.innerHTML = '❚❚';
      this.btnPlayPause.title = 'Duraklat';
      this.hideOverlay();
      this.onStateChange('playing');
    });

    video.addEventListener('pause', () => {
      this.btnPlayPause.innerHTML = '▶';
      this.btnPlayPause.title = 'Oynat';
      this.onStateChange('paused');
    });

    video.addEventListener('timeupdate', () => {
      this.updateProgress();
      this.updatePlaybackDisplay();
    });

    video.addEventListener('loadedmetadata', () => {
      this.updatePlaybackDisplay();
    });

    video.addEventListener('ended', () => {
      this.onLog('success', 'Video başarıyla tamamlandı.');
      this.showOverlay('Tebrikler!', 'Tüm kurallara uygun olarak videoyu eksiksiz tamamladınız.', 'Tekrar İzle');
    });

    // Klavye boşluk tuşu ile oynat/duraklat
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this.togglePlayback();
      }
    });
  }

  // --- OYNATMA KONTROLÜ (REFERANS: togglePlayback / togglePlayPause) ---
  togglePlayback() {
    if (!this.security.isPageFocused) {
      this.security.handleSecurityViolation('Odaklanma Gerekli', 'Videoyu oynatabilmek için sayfa üzerinde olmalısınız.');
      return;
    }

    if (this.video.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  // Geriye dönük uyumluluk takma adı
  togglePlayPause() { return this.togglePlayback(); }

  play() {
    if (!this.security.isPageFocused) {
      this.onLog('warning', 'Sayfa odakta değilken oynatılamaz.');
      return;
    }

    this.video.play().catch((err) => {
      console.warn('Oynatma başlatılamadı:', err);
    });
  }

  pause() {
    this.video.pause();
  }

  // --- İLERLEME ÇUBUĞU DENETİMİ (REFERANS: onProgressSeekAttempt) ---
  onProgressSeekAttempt(e) {
    const rect = this.progressRail.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const duration = this.video.duration || 120;
    const targetTime = ratio * duration;

    // Sadece mevcut zamandan geriye sarmaya izin ver
    if (targetTime > this.video.currentTime + 0.5) {
      this.onLog('danger', `İleri tıklama engellendi! Hedef: ${this.formatTime(targetTime)}`);
      this.security.handleSecurityViolation(
        'İleri Sarma Koruması!',
        `Video ileri sarılamaz. İzlemek istediğiniz bölümü sırayla tamamlamalısınız.`
      );
      return;
    }

    // Geri sarma serbesttir
    this.video.currentTime = targetTime;
    this.security.lastSafeTime = targetTime;
    this.onLog('info', `Geriye sarıldı: ${this.formatTime(targetTime)}`);
  }

  // Geriye dönük uyumluluk takma adı
  handleProgressClick(e) { return this.onProgressSeekAttempt(e); }

  updateProgress() {
    const current = this.video.currentTime || 0;
    const duration = this.video.duration || 120;
    const pct = (current / duration) * 100;
    const watchedPct = (this.security.maxWatchedTime / duration) * 100;

    if (this.progressFill) {
      this.progressFill.style.width = `${pct}%`;
    }
    if (this.progressWatched) {
      this.progressWatched.style.width = `${Math.max(pct, watchedPct)}%`;
    }
  }

  // --- ZAMAN GÖSTERGESİ (REFERANS: updatePlaybackDisplay) ---
  updatePlaybackDisplay() {
    const current = this.formatTime(this.video.currentTime || 0);
    const total = this.formatTime(this.video.duration || 120);
    if (this.timeDisplay) {
      this.timeDisplay.textContent = `${current} / ${total}`;
    }
  }

  // Geriye dönük uyumluluk takma adı
  updateTimeDisplay() { return this.updatePlaybackDisplay(); }

  updateVolumeIcon() {
    if (!this.btnVolume) return;
    if (this.video.muted || this.video.volume === 0) {
      this.btnVolume.innerHTML = '🔇';
      this.btnVolume.title = 'Sesi Aç';
    } else if (this.video.volume < 0.5) {
      this.btnVolume.innerHTML = '🔉';
      this.btnVolume.title = 'Sesi Kapat';
    } else {
      this.btnVolume.innerHTML = '🔊';
      this.btnVolume.title = 'Sesi Kapat';
    }
  }

  toggleFullscreen() {
    const target = this.container;
    if (!document.fullscreenElement) {
      target.requestFullscreen().catch((err) => {
        console.warn('Tam ekran hatası:', err);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  showOverlay(title, description, buttonText = 'Devam Et') {
    if (!this.overlay) return;
    this.overlayTitle.textContent = title;
    this.overlayDesc.textContent = description;
    this.overlayBtn.textContent = buttonText;
    this.overlay.classList.add('active');
  }

  hideOverlay() {
    if (!this.overlay) return;
    this.overlay.classList.remove('active');
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

// Geriye dönük uyumluluk sınıf takma adı
export const SafeVideoPlayer = StrictVideoPlayer;
