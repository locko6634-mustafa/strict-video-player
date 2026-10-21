import { SecurityController } from './security.js';
import { StrictVideoPlayer, SafeVideoPlayer } from './player.js';
import { ScormLmsClient, HeartbeatClient } from './heartbeat.js';

document.addEventListener('DOMContentLoaded', () => {
  const videoElement = document.getElementById('secure-video');
  const stageElement = document.getElementById('video-stage');
  const alertBanner = document.getElementById('alert-banner');
  const alertMessage = document.getElementById('alert-message');
  const alertCloseBtn = document.getElementById('alert-close-btn');
  const badgeFocus = document.getElementById('badge-focus');
  const badgeStatus = document.getElementById('badge-status');
  const badgeServerVerified = document.getElementById('badge-server-verified');
  const logList = document.getElementById('log-list');
  const btnClearLog = document.getElementById('btn-clear-log');

  // Sertifika ve Pentest Öğeleri
  const btnClaimCert = document.getElementById('btn-claim-cert');
  const certModal = document.getElementById('cert-modal');
  const certCloseBtn = document.getElementById('cert-close-btn');
  const certDetails = document.getElementById('cert-details');

  const btnTestForward = document.getElementById('btn-test-forward');
  const btnTestSpam = document.getElementById('btn-test-spam');
  const btnTestFakeCert = document.getElementById('btn-test-fake-cert');
  const btnTestBlur = document.getElementById('btn-test-blur');

  let bannerTimeout = null;

  function appendLog(type, message) {
    if (!logList) return;

    const li = document.createElement('li');
    li.className = `log-entry ${type}`;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${timeStr}]`;

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    li.appendChild(timeSpan);
    li.appendChild(textSpan);

    logList.insertBefore(li, logList.firstChild);

    while (logList.children.length > 80) {
      logList.removeChild(logList.lastChild);
    }
  }

  function showAlert(title, desc) {
    if (!alertBanner || !alertMessage) return;

    alertMessage.innerHTML = `<strong>${title}</strong> — ${desc}`;
    alertBanner.classList.add('show');

    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
      alertBanner.classList.remove('show');
    }, 6000);
  }

  if (alertCloseBtn) {
    alertCloseBtn.addEventListener('click', () => {
      alertBanner.classList.remove('show');
    });
  }

  if (btnClearLog) {
    btnClearLog.addEventListener('click', () => {
      logList.innerHTML = '';
      appendLog('info', 'Günlük temizlendi.');
    });
  }

  // 1. Güvenlik Kontrolcüsü Başlat (SPK / SPL Standart Video Güvenlik Katmanı)
  const security = new SecurityController(videoElement, {
    onSecurityAlert: ({ title, description }) => {
      showAlert(title, description);
      player.showOverlay(title, description, 'Anladım, Sayfaya Dön');
    },
    onFocusChange: (isFocused) => {
      if (badgeFocus) {
        if (isFocused) {
          badgeFocus.classList.add('active');
          badgeFocus.classList.remove('alert');
          badgeFocus.querySelector('.badge-text').textContent = 'Pencere Odakta';
        } else {
          badgeFocus.classList.remove('active');
          badgeFocus.classList.add('alert');
          badgeFocus.querySelector('.badge-text').textContent = 'Odak Dışı (Durduruldu)';
        }
      }
    },
    onLog: (type, msg) => appendLog(type, msg)
  });

  // 2. Güvenli Oynatıcı Kontrolcüsü Başlat (Video.js Uyumlu Oynatıcı)
  const player = new StrictVideoPlayer(videoElement, stageElement, security, {
    onStateChange: (state) => {
      if (badgeStatus) {
        if (state === 'playing') {
          badgeStatus.classList.add('active');
          badgeStatus.querySelector('.badge-text').textContent = 'Oynatılıyor';
        } else {
          badgeStatus.classList.remove('active');
          badgeStatus.querySelector('.badge-text').textContent = 'Duraklatıldı';
        }
      }
    },
    onLog: (type, msg) => appendLog(type, msg)
  });

  // 3. Backend SCORM 1.2 / 2004 LMS İstemcisi Başlat (LMSInitialize / LMSCommit)
  const scormClient = new ScormLmsClient(videoElement, security, {
    onStatusUpdate: ({ verifiedSeconds, totalDuration, percentage, isCompleted }) => {
      if (badgeServerVerified) {
        badgeServerVerified.querySelector('.badge-text').textContent = `Sunucu Onaylı: ${verifiedSeconds}s / ${totalDuration}s (%${percentage})`;
        if (isCompleted) {
          badgeServerVerified.classList.add('active');
          badgeServerVerified.classList.remove('alert');
        }
      }

      if (isCompleted && btnClaimCert) {
        btnClaimCert.classList.add('ready');
        btnClaimCert.disabled = false;
        btnClaimCert.innerHTML = '🎓 Resmi Sertifikayı Al (%100 Tamamlandı)';
      }
    },
    onLog: (type, msg) => appendLog(type, msg),
    onViolation: (data) => {
      showAlert('SCORM Kural İhlali Tespit Edildi!', data.error);
    }
  });

  // 4. Sertifika Talep Butonu (LMSFinish)
  if (btnClaimCert) {
    btnClaimCert.addEventListener('click', async () => {
      try {
        appendLog('info', 'Sunucudan resmi sertifika talep ediliyor (LMSFinish)...');
        const cert = await scormClient.LMSFinish('Mustafa Ayverdi (Öğrenci / Güvenlik Araştırmacısı)');

        // Sertifika Modalı Göster
        if (certModal && certDetails) {
          certDetails.innerHTML = `
            <div class="cert-card">
              <div class="cert-badge">🏅 RESMİ DOĞRULANMIŞ SERTİFİKA</div>
              <h2 class="cert-title">${cert.title}</h2>
              <p class="cert-recipient">Sayın <strong>${cert.recipient}</strong></p>
              <p class="cert-desc">2 dakikalık finansal eğitim içeriğini hiçbir ileri sarma veya odak kaybı olmadan <strong>${cert.verifiedDuration}</strong> boyunca kesintisiz tamamlamıştır.</p>
              <div class="cert-meta">
                <div><strong>Sertifika No:</strong> <code>${cert.certId}</code></div>
                <div><strong>Veriliş Tarihi:</strong> ${new Date(cert.issuedAt).toLocaleString('tr-TR')}</div>
                <div><strong>Kriptografik İmza:</strong> <code class="cert-hash">${cert.digitalSignature.slice(0, 32)}...</code></div>
              </div>
            </div>
          `;
          certModal.classList.add('show');
        }
        appendLog('success', `[Sertifika Onaylandı]: ${cert.certId}`);
      } catch (err) {
        showAlert('Sertifika Reddedildi!', err.message);
        appendLog('danger', `[Sertifika Talebi Reddi]: ${err.message}`);
      }
    });
  }

  if (certCloseBtn) {
    certCloseBtn.addEventListener('click', () => {
      certModal.classList.remove('show');
    });
  }

  // 5. Siber Güvenlik / Pentest Test Butonları
  if (btnTestForward) {
    btnTestForward.addEventListener('click', () => {
      appendLog('warning', '[Pentest]: Doğrudan video.currentTime = 110s atanıyor...');
      videoElement.currentTime = 110;
    });
  }

  if (btnTestSpam) {
    btnTestSpam.addEventListener('click', () => {
      scormClient.testSpamHeartbeats(8);
    });
  }

  if (btnTestFakeCert) {
    btnTestFakeCert.addEventListener('click', async () => {
      appendLog('warning', '[Pentest]: Erken sertifika talep isteği (LMSFinish) gönderiliyor...');
      try {
        await scormClient.LMSFinish('Hile Girişimi');
      } catch (err) {
        showAlert('Backend Saldırıyı Engelledi!', err.message);
        appendLog('danger', `[Beklenen Engel]: ${err.message}`);
      }
    });
  }

  if (btnTestBlur) {
    btnTestBlur.addEventListener('click', () => {
      appendLog('warning', '[Pentest]: Pencere blur (odak kaybı) simüle ediliyor...');
      window.dispatchEvent(new Event('blur'));
    });
  }

  appendLog('success', 'Katı kurallı video sistemi ve SCORM 1.2 / 2004 motoru hazır.');
});
