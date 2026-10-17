# AGENT.md — StrictVideo Proje Rehberi ve Mimari Talimatları

Bu dosya, bu depoda çalışacak yapay zeka ajanları ve geliştiriciler için projenin amacını, güvenlik mimarisini, çalışma prensiplerini ve operasyonel kurallarını tanımlar.

---

## 1. Projenin Amacı ve Varoluş Nedeni

**StrictVideo**, finansal okuryazarlık (`finansalokuryazarlik.gov.tr` / SPK & SPL SCORM altyapısı), kurumsal İSG eğitimleri ve resmi sertifikasyon platformlarında kullanılan **katı video izleme ve dikkat bütünlüğü güvenliğini** birebir modelleyen bir laboratuvar projesidir.

### Temel Hedefler:
1. **Siber Güvenlik & Tersine Mühendislik Laboratuvarı:** Kullanıcının siber güvenlik ve tersine mühendislik eğitimleri için önce sektör standardında sağlam, çok katmanlı (istemci + sunucu) bir koruma mekanizması kurmak; ardından bu mekanizmanın nasıl manipüle edilebileceğini, atlatılabileceğini veya kırılabileceğini test etmek.
2. **Çift Katmanlı Bütünlük Doğrulaması:** Yalnızca tarayıcı arayüzündeki (frontend) kozmetik engellere güvenmeyip, izleme süresini sunucu tarafında (backend) zaman damgalı ve HMAC imzalı sinyallerle doğrulamak.
3. **Milisaniyelik Dikkat Denetimi:** Kullanıcının başka sekmeye geçmesi, başka programa odaklanması veya pencereler arası geçiş yapması durumunda video oynatımını ve süre birikimini anında durdurmak.

---

## 2. Sistem Mimarisi ve Koruma Katmanları

### A) İstemci (Frontend) Katmanı — Vanilla JS / HTML5
- **Konum:** Kök dizin (`index.html`, `css/style.css`, `js/`)
- **İleri Sarma Yasağı (`js/security.js`):** Timeline üzerinden ileri tıklama, klavye kısayolları (`Sağ Ok`, `PageUp`, `End`, `L`) engellenmiştir. `video.currentTime` manipülasyonunda oynatıcı son güvenli saniyeye (`lastSafeTime`) geri fırlar.
- **Hız Sabitleme (`1.0x` Kilitli):** Tarayıcı eklentileri veya konsol müdahaleleri `ratechange` ve `Object.defineProperty` ile anında `1.0x`'e zorlanır.
- **Odak ve Sekme Takibi:** `window.blur`, `document.visibilitychange` ve pencere dışına çıkış anında algılanarak video salisesinde durdurulur (`player.pause()`).
- **Geliştirici Koruması:** `F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U`, `Ctrl+S` ve sağ tık (bağlam menüsü) engellenmiştir.
- **Siber Güvenlik & Pentest Paneli:** Arayüzün altında saldırı simülasyonları için 4 adet hazır test butonu bulunur:
  1. *Sahte İleri Sarma* (`video.currentTime = 110s`)
  2. *Heartbeat Bombardımanı* (Spam hızlı sinyaller)
  3. *Erken Sertifika Talebi* (Süre dolmadan 403 testi)
  4. *Sekme/Odak Kaybı Simülasyonu* (`window.blur`)

### B) Sunucu (Backend) Katmanı — Saf Node.js 22 (ESM)
- **Konum:** `backend/server.js` (Harici npm paketi gerektirmez; `node:http`, `node:crypto` ile çalışır).
- **HMAC-SHA256 Oturum İmzası:** `/api/v1/session/start` ile kriptografik oturum açılır.
- **Replay Attack Koruması:** Her sinyalde artan `sequence` numarası zorunludur; eski sinyaller işlenmez.
- **Delta Zaman ve Hızlandırma Koruması:** Sinyaller 3 saniye aralıkla beklenir. 2 saniyenin altında gelen sinyaller `429 Sinyal Anomalisi` ile reddedilir.
- **Pozisyon Sıçrama Koruması:** Bildirilen `currentTime` geçen gerçek süreden fazla ise `400 Bad Request` ile reddedilir.
- **Sunucu Kilitli Sertifika:** `/api/v1/session/claim-certificate` çağrıldığında sunucu belleğindeki doğrulanmış süre tam 120 saniye değilse `403 Forbidden` cevabı döner ve eksik kalan saniyeler belirtilir.

---

## 3. Canlı Altyapı ve Dağıtım Bilgileri

- **Canlı URL:** [https://strict.n8n-mustafa.me](https://strict.n8n-mustafa.me)
- **Hedef Sunucu:** `mustafa-dev` (`212.64.193.15`, profil: `mustafa-dev`, kullanıcı: `locko-admin`)
- **Ters Proxy & SSL:** Traefik v3 (`edge_proxy` docker ağı, `mytlschallenge` Let's Encrypt TLS Challenge)
- **Konteynerleştirme:** Resmi `node:22-alpine` imajı ile Docker Compose (`docker-compose.yml`)
- **CI/CD Pipeline:** `.github/workflows/deploy.yml` üzerinden GitHub `Deploy` environment secret'ları (`SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `SERVER_PORT`) kullanılarak `main` dalına push yapıldığında sunucuya otomatik SSH deploy gerçekleştirilir.

---

## 4. Geliştirici ve Çalıştırma Komutları

```bash
# Yerel bağımsız geliştirme sunucusunu başlatma (Port 8095)
bash ./sunucu_baslat.sh 8095

# Birim ve güvenlik regresyon testlerini çalıştırma
node tests/test-rules.mjs

# Docker konteynerini yerel inşa edip çalıştırma
docker compose up -d --build

# Canlı sunucuya deploy tetikleme
git push origin main
```

---

## 5. Ajanlar İçin Kesin Kurallar

1. **Dil Kuralı:** Kullanıcı ile iletişim ve dokümanlar her zaman **Türkçe** olmalıdır.
2. **Backend Kuralı:** Backend dili kesinlikle **Node.js 22+ (ESM)** olmalıdır. Python veya başka bir çalışma zamanı eklenemez.
3. **Commit ve Push Disiplini:** Değişiklikler açık dosya yollarıyla stage edilmeli (`git add path/to/file`), anlamlı commit mesajları yazılmalı ve doğrulanmadan push edilmemelidir.
4. **SSH MCP Kuralı:** Sunucu işlemleri `ssh-mcp` ad alanı ve `mustafa-dev` profili ile yürütülmeli; `ssh-mcp-dugun` (`mustafa-prod`) ile asla karıştırılmamalıdır.
