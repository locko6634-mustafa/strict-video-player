# StrictVideo — Katı Kurallarla Korunan Video Oynatıcı

StrictVideo, video oynatma güvenliğini ve dikkat bütünlüğünü sağlamak için tasarlanmış minimalist ve katı kurallarla korunan bir web video oynatma arayüzüdür.

## 🛡️ Uygulanan Katı Güvenlik Kuralları

1. **İleri Sarma Yasağı (Anti-Forward Seek)**
   - İlerleme çubuğunda ileri bir noktaya tıklanamaz.
   - Klavye kısayolları (`Sağ Ok`, `PageUp`, `End`, `L` vb.) engellenmiştir.
   - Konsol veya script üzerinden `video.currentTime` ileri bir değere atanırsa, oynatıcı durumu algılar ve videoyu izlenen son güvenli noktaya (`lastSafeTime`) geri çeker.
   - Kullanıcı dilerse yalnızca geriye sarabilir veya "↺ 5s" butonuyla önceki bölümleri tekrar izleyebilir.

2. **Hız Sabitleme (1.0x Kilitli - Anti-Speed Tampering)**
   - Video oynatma hızı kesin olarak `1.0x` seviyesindedir.
   - Tarayıcı eklentileri (Video Speed Controller vb.) veya konsol müdahaleleri `ratechange` olay dinleyicisi ve `Object.defineProperty` ile anında `1.0x` değerine geri döndürülür.

3. **Odak ve Sekme Denetimi (Focus & Tab Enforcement)**
   - `window.blur`: Kullanıcı başka bir programa, pencereye veya işletim sistemi bildirimine odaklandığında video salisesinde durdurulur.
   - `document.visibilitychange`: Sekme değiştirildiğinde veya tarayıcı simge durumuna küçültüldüğünde video durdurulur.
   - Odak kaybında ekranda uyarı katmanı açılır; kullanıcı sayfaya geri dönüp onaylamadıkça video devam etmez.

4. **Geliştirici Araçları ve Kısayol Koruması**
   - `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C`, `Ctrl+U` (kaynak görüntüleme) ve `Ctrl+S` engellenmiştir.
   - Sağ tık menüsü (Context Menu) devredışıdır (İncele, Video Kaydet seçeneklerine erişilemez).
   - Pencere boyutu ve viewport farkı (DevTools tespit mekanizması) ile inceleme penceresi açıldığında video kilitlenir.

5. **Canlı Güvenlik ve Denetim Günlüğü**
   - Sayfa üzerinde tüm ihlal teşebbüsleri (odak kaybı, ileri sarma, hız manipülasyonu, F12) renk kodlu olarak anlık raporlanır.

---

## 🚀 Projeyi Çalıştırma

Projeyi yerel olarak çalıştırmak için:

```bash
# Proje dizinine girin
cd /home/mustafaayverdi/.gemini/antigravity/scratch/strict-video-player

# Hazır sunucu scriptini çalıştırın (Port 8095 veya dilediğiniz bir port)
bash ./sunucu_baslat.sh 8095
```

Tarayıcınızda açın:
👉 `http://127.0.0.1:8095`

## 🧪 Testleri Çalıştırma

```bash
node tests/test-rules.mjs
```
Tüm katı kuralların (ileri sarma engelleme, hız kilidi, odak kaybı denetimi, geriye sarma serbestliği) birim testleri anında koşar ve doğrulanır.
