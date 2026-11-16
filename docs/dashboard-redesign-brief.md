# Signalgen — Dashboard redesign brief

> **Status:** usulan desain, bukan instruksi implementasi.
> **Lingkup:** dashboard akun / Workspace overview dan navigasi pendukungnya; perluasan canvas untuk komponen, Journal, dan landing page dicatat pada bagian 15.
> **Tujuan:** memperbaiki hierarki informasi, keterbacaan, dan alur penggunaan tanpa mengganti identitas atau menambah fitur produk.
> **Batas:** tidak ada UI atau kode aplikasi yang diubah saat brief ini disusun.

---

## 1. Instruksi untuk desainer atau design tool

Buat proposal redesign dashboard Signalgen berdasarkan brief ini dan screenshot referensi yang disertakan.

**Pertahankan fungsi dan identitas yang sudah ada.** Perubahan difokuskan pada tata letak, prioritas informasi, kepadatan, tipografi, komponen, dan kejelasan interaksi.

Jangan langsung mengubah website, membuat backend, menambahkan API, atau menganggap desain ini sudah disetujui untuk implementasi.

Jika informasi tidak tersedia, tuliskan asumsi atau pertanyaan. Jangan mengisi kekosongan dengan fitur fiktif.

---

## 2. Konteks produk

Signalgen adalah workspace analisis saham dengan aktivitas seperti:

- Menentukan rule analisis.
- Memilih kelompok saham atau *stock universe*.
- Menjalankan screening dan meninjau hasilnya.
- Melakukan backtesting.
- Memantau saham melalui Market monitor.
- Mengakses berita dan screening journal.

Dashboard bukan halaman pemasaran, aplikasi broker, atau ringkasan aset investasi.

**Asumsi pengguna:** analis saham ritel Indonesia dan pengguna yang sedang belajar melakukan analisis berbasis rule. Asumsi ini belum merupakan hasil riset pengguna.

Dashboard harus membantu menjawab:

1. Apa langkah berikutnya yang bisa saya lakukan?
2. Apakah workspace saya sudah siap untuk screening?
3. Apa screening terakhir saya?
4. Bagaimana memakai kembali pilihan rule dan saham sebelumnya?

---

## 3. Fungsi dashboard saat ini

Inventaris berikut berasal dari pembacaan kode, bukan hasil pengujian browser. Sumber utama: `frontend/web/src/pages/workspace-overview-panel.tsx`.

| Bagian | Fungsi yang harus dipertahankan |
|---|---|
| Tindakan utama | Mengarahkan pengguna ke screener atau langkah persiapan yang masih diperlukan. |
| Screening terakhir | Menampilkan pasar, waktu, serta jumlah status Buy, Sell, dan Cooldown ketika riwayat tersedia. |
| Pintasan pasar | Membuka Market monitor dan News. |
| Ringkasan sumber daya | Jumlah Rules, jumlah Stock universes, Plan, dan status Account. |
| Panduan screening pertama | Memeriksa akses, memilih rule, memilih saham, lalu menjalankan screening. |
| Recent screening | Menampilkan maksimal lima screening terbaru. |
| Use selection | Membuka screener dengan pilihan rule dan universe dari screening terkait, bila konteksnya tersedia. |

**Penting:** `Use selection` bukan tombol menjalankan ulang screening secara otomatis dan bukan tombol membuka detail hasil historis.

Dashboard juga sudah memiliki penanganan untuk loading, loading sebagian, kegagalan sebagian, backend unavailable, pengguna belum login, dan riwayat kosong.

### Judul tindakan utama yang sudah ada

Judul pada area tindakan utama berubah mengikuti kesiapan workspace. Teks ini adalah perilaku nyata di kode dan sebaiknya tidak diganti dengan slogan:

| Kondisi | Judul saat ini |
|---|---|
| Sedang memuat | `Loading your workspace` |
| Memiliki riwayat | `Continue your analysis` |
| Siap, belum ada riwayat | `Ready for your first screening` |
| Akses belum tersedia | `Start your first screening` |
| Akses akun gagal diperiksa | `Your access could not be checked` |

### Isi Recent screening

Setiap baris saat ini menampilkan:

- Nama rule.
- Universe, atau daftar simbol bila universe tidak tersedia.
- Timeframe dalam satuan candle.
- Waktu screening.
- Nisbah `<matched> / <total> matched`.
- Tombol `Use selection`.

---

## 4. Arah desain

### Karakter yang dicari

**Workspace analisis yang tenang, presisi, dan mudah dipindai.**

Profesional berarti pengguna memahami informasi dan tindakan berikutnya, bukan antarmuka terlihat mahal karena banyak efek.

Pertahankan:

- Nama dan logo candlestick Signalgen yang disediakan.
- Font Manrope.
- Canvas gelap bernuansa hijau.
- Aksen mint yang terukur.
- Divider tipis dan permukaan relatif datar.
- Angka dengan lebar karakter konsisten.
- Sentence case untuk judul, label, dan tombol.

### Token yang sudah ada

Nilai berikut berasal dari `docs/DESIGN.md`. Nama di kolom pertama adalah nama token sebenarnya; gunakan nama itu saat menulis spesifikasi agar tidak terjadi pemetaan ganda.

| Token | Nilai | Peran |
|---|---|---|
| `canvas` | `#070a08` | Latar utama |
| `sidebar` | `#090c0a` | Latar sidebar |
| `surface` | `#0d110e` | Permukaan panel |
| `surface-2` | `#111612` | Permukaan sekunder |
| `surface-3` | `#171c18` | Permukaan tersier |
| `line` | `#252b27` | Border dan divider |
| `line-soft` | `#1a201c` | Divider lembut |
| `text` | `#f5f7f5` | Teks utama |
| `muted` | `#a4ada7` | Teks sekunder |
| `dim` | `#919b93` | Teks tersier |
| `green` | `#45e69f` | Signal green |
| `green-bright` | `#7af5bd` | Aksen aksi web |
| `green-deep` | `#168f5a` | Hijau dalam |
| `green-soft` | `#9df8cc` | Hijau lembut |
| `danger` | `#ff8585` | Danger |
| `warning` | `#e8bf75` | Warning |
| `skeleton` | `#1a211c` | Kerangka loading |
| `skeleton-resolve` | `#29332d` | Kerangka selesai |

Gunakan sebagai dasar, bukan alasan untuk mengabaikan pengujian kontras. Pertahankan pemetaan warna komponen yang sudah ada saat implementasi nanti.

Jangan mengganti font, logo, palet utama, atau keseluruhan gaya produk hanya agar proposal terlihat berbeda.

---

## 5. Hierarki informasi yang disarankan

Bagian ini adalah **rekomendasi**, bukan deskripsi layout yang sudah diterapkan.

### Prioritas pertama — tindakan berikutnya

Letakkan satu tindakan utama yang menyesuaikan kesiapan workspace:

- Membuka screener jika siap.
- Memilih atau meninjau rule jika belum tersedia.
- Memilih atau menyesuaikan stock universe jika belum valid.
- Meninjau akses jika diperlukan.
- Memuat ulang workspace jika akses akun gagal diperiksa.

Jangan selalu menampilkan `Run screening` jika tindakan sebenarnya hanya membuka screener.

### Prioritas kedua — konteks pekerjaan

Untuk pengguna yang sudah memiliki riwayat:

- Tampilkan ringkasan screening terakhir.
- Bedakan waktu screening dari waktu pembaruan harga.
- Tampilkan status dengan label, bukan warna saja.

Untuk pengguna baru:

- Ganti area tersebut dengan panduan langkah pertama.
- Tunjukkan apa yang sudah siap dan apa yang masih perlu dilakukan.
- Jangan menampilkan panduan onboarding lengkap terus-menerus setelah tidak relevan.

### Prioritas ketiga — recent screening

Gunakan daftar atau tabel ringkas yang memperlihatkan:

- Nama rule.
- Universe atau saham terkait.
- Timeframe.
- Waktu screening.
- Jumlah saham yang cocok dibanding jumlah yang diperiksa.
- Tindakan menggunakan kembali pilihan.

Jangan menyamakan **nol kecocokan** dengan kegagalan sistem. Screening yang berhasil tanpa saham cocok tetap merupakan hasil analisis yang valid.

Saat ini baris dengan nol kecocokan dirender memakai varian badge `destructive`, sehingga tampak seperti error. Ini kandidat perbaikan visual yang perlu dibahas, bukan perubahan yang sudah disetujui.

### Prioritas pendukung — sumber daya dan pintasan

Rules, Stock universes, Plan, dan Account tetap mudah diakses, tetapi tidak harus menjadi empat kartu besar dengan bobot visual yang sama.

Market monitor dan News adalah tindakan sekunder. Keduanya tidak boleh mengalahkan tindakan screening utama.

---

## 6. Navigasi

Pertahankan tujuan navigasi yang sudah ada:

- Dashboard.
- Analysis: Screener, Backtesting, Screening journal.
- Configuration: Rules, Stock universes.
- Market: Market monitor, News.
- Akses akun dan paket yang tersedia.

Perjelas halaman aktif. Jangan menambah submenu, global search, notifikasi, atau command palette yang belum memiliki fungsi.

Sidebar persisten dapat dipertahankan pada desktop. Pada layar kecil, gunakan drawer dengan tombol pembuka dan penutup yang jelas.

---

## 7. Aturan agar tidak menjadi "AI slop"

- Jangan mengubah dashboard menjadi landing page dengan headline besar.
- Jangan menambah gradient ungu, glow neon, glassmorphism, atau ilustrasi dekoratif.
- Jangan membungkus setiap informasi dalam kartu terpisah.
- Jangan menambah grafik jika tidak membantu keputusan pengguna.
- Jangan menambahkan saldo, profit, win rate, atau portfolio value yang tidak tersedia.
- Jangan membuat fitur "AI insights", prediksi harga, atau rekomendasi investasi fiktif.
- Jangan memakai warna hijau untuk semua ikon, angka, border, dan judul.
- Jangan menambahkan sapaan panjang atau slogan sebagai pengganti informasi kerja.
- Jangan menyembunyikan tindakan penting di balik hover.
- Jangan mengecilkan teks agar semua konten muat dalam satu layar.

Karakter Signalgen sebaiknya muncul dari **ketelitian penyajian analisis**, bukan ornamen.

---

## 8. State yang harus didesain

| State | Perilaku yang diharapkan |
|---|---|
| Loading awal | Skeleton mengikuti bentuk konten untuk mengurangi pergeseran layout. |
| Loading sebagian | Informasi yang sudah tersedia tetap terlihat. |
| Pengguna baru | Langkah awal dan tindakan berikutnya jelas. |
| Siap screening | Tindakan membuka screener menjadi fokus utama. |
| Memiliki riwayat | Screening terakhir dan recent screening mudah dipindai. |
| Riwayat kosong | Jelaskan kapan hasil akan muncul; jangan tampilkan data palsu. |
| Gagal sebagian | Pertahankan konten yang berhasil dimuat dan sediakan tindakan `Reload`. |
| Akses akun gagal diperiksa | Jangan menyimpulkan paket pengguna berubah atau aksesnya ditolak. |
| Backend unavailable | Jelaskan keterbatasan dan langkah pemulihan yang memang didukung. |
| Belum login / sesi tidak valid | Tampilkan jalur masuk yang jelas; jangan menampilkan data akun lain. |
| Data lama / cached | Jika metadata tersedia, bedakan dari data terbaru. Jangan mengarang waktu sinkronisasi. |

State data lama dan sesi tidak valid merupakan kebutuhan untuk ditinjau pada implementasi berikutnya, bukan klaim bahwa seluruh perilakunya telah diverifikasi sekarang.

---

## 9. Responsivitas dan aksesibilitas

Siapkan proposal pada lebar **1440 px, 1024 px, dan 390 px**, lalu tinjau kemungkinan overflow pada **320 px**.

- Susun urutan mobile berdasarkan prioritas tugas, bukan sekadar mengecilkan desktop.
- Hindari horizontal scroll seluruh halaman.
- Jika tabel perlu digeser, batasi scroll pada area tabel.
- Jangan memotong nama rule tanpa cara mengakses nama lengkap.
- Pastikan tombol utama tetap terjangkau dan terbaca.
- Sediakan fokus keyboard yang terlihat.
- Drawer harus mendukung keyboard, Escape, dan pengembalian fokus.
- Gunakan target sentuh sekitar 44 x 44 px untuk kontrol utama mobile.
- Targetkan WCAG 2.2 AA: kontras teks normal minimal 4,5:1, teks besar 3:1, serta batas/fokus kontrol penting 3:1 terhadap warna di sekitarnya.
- Jangan menyampaikan status hanya melalui merah dan hijau.
- Hormati reduced motion.
- Pastikan pembesaran teks tidak menutupi konten atau tindakan.

Ukuran teks, spacing, dan tinggi baris boleh disempurnakan sesuai kebutuhan dashboard. Jangan menerapkan ukuran heading landing page ke workspace.

---

## 10. Bahasa dan kejujuran data

Untuk proposal awal, pertahankan bahasa Inggris pada UI agar tidak mencampur bahasa dengan implementasi saat ini.

Gunakan label yang menjelaskan tindakan sebenarnya, misalnya:

- `Open screener`
- `Choose a rule`
- `Choose your first stocks`
- `Use selection`
- `Reload workspace`

Hindari label seperti `Unlock insights` atau `Supercharge your analysis`.

Jangan menganggap identifier internal `realtime` membuktikan tersedianya data pasar real-time.

Timestamp dashboard saat ini menggunakan **Asia/Singapore / UTC+8**, dan kode sudah menyimpan label `Singapore Time (SGT, UTC+8)` pada `frontend/web/src/lib/calendar.ts`. Gunakan label itu; tampilkan zona waktu dengan jelas dan jangan diam-diam mengubahnya menjadi WIB.

Jika memakai data contoh:

- Beri label `Illustrative data`.
- Gunakan nama akun fiktif.
- Jangan memakai data pengguna, token, atau informasi pribadi.
- Jangan mengklaim hasil rule sebagai jaminan keuntungan.

---

## 11. Hasil yang diminta dari design tool

Prioritaskan **satu arah desain yang matang**, bukan banyak variasi dangkal.

Hasil minimal:

1. Dashboard pengguna aktif pada desktop.
2. Dashboard pengguna aktif pada mobile.
3. Dashboard pengguna baru.
4. Loading dan partial error.
5. Backend unavailable.
6. Navigasi mobile terbuka.
7. Spesifikasi komponen dan anotasi tindakan.

Sertakan penjelasan singkat:

- Apa yang dipertahankan.
- Apa yang diubah dan masalah yang ingin diatasi.
- Ke mana setiap tindakan mengarah.
- Mana yang hanya perubahan visual.
- Mana yang memerlukan perubahan perilaku dan persetujuan terpisah.

Tema gelap adalah prioritas sesuai identitas saat ini. Tema terang tidak perlu diciptakan tanpa permintaan tambahan.

---

## 12. Checklist persetujuan

Proposal belum siap diimplementasikan jika salah satu poin berikut belum terpenuhi:

- [ ] Tindakan utama jelas dan sesuai kesiapan akun.
- [ ] Tidak ada fungsi dashboard yang hilang tanpa penjelasan.
- [ ] `Use selection` tidak digambarkan sebagai auto-run.
- [ ] Onboarding dan pengguna berulang mendapat hierarki yang sesuai.
- [ ] Screening tanpa kecocokan dibedakan dari error.
- [ ] Data historis tidak terlihat seperti harga live.
- [ ] Logo, Manrope, dan identitas warna Signalgen dipertahankan.
- [ ] Tidak ada metrik atau fitur fiktif.
- [ ] Loading, kosong, dan error memiliki rancangan.
- [ ] Mobile tetap terbaca tanpa scroll horizontal seluruh halaman.
- [ ] Fokus, kontras, target sentuh, dan reduced motion diperhatikan.
- [ ] Semua perubahan perilaku diberi anotasi untuk ditinjau sebelum implementasi.

---

## 13. Cara menggunakan brief

1. Berikan brief ini kepada Stitch, pen.dev, atau desainer.
2. Jika alat mendukungnya, sertakan screenshot dashboard desktop, mobile, dan kondisi kosong.
3. Hapus informasi akun, email, atau data sensitif dari screenshot.
4. Jangan mengunggah repository lengkap, `.env`, database, atau kredensial.
5. Minta wireframe dan hierarki terlebih dahulu.
6. Setelah alurnya disetujui, lanjutkan ke desain visual.
7. Tinjau proposal memakai checklist di atas sebelum meminta implementasi.

**Prompt pembuka:**

> Design a proposal for the existing Signalgen account dashboard using the attached brief and screenshots. This is a design exploration only; do not modify the existing application. Preserve the current functionality, Manrope typography, supplied candlestick logo, near-black green-tinted surfaces, and restrained mint accents. Prioritize screening readiness, the next meaningful action, and recent screening activity. Do not invent features, financial metrics, live-data availability, or AI recommendations. Start with the information hierarchy and wireframe, then produce desktop and mobile designs with annotated states and interactions.

---

## 14. Dasar penyusunan

Brief ini disusun melalui pembacaan:

- `docs/DESIGN.md`
- `docs/PRODUCT.md`
- `frontend/web/src/pages/workspace-overview-panel.tsx`
- `frontend/web/src/pages/demo-workspace.tsx`
- `frontend/web/src/lib/screening-setup.ts`
- `frontend/web/src/lib/calendar.ts`

Klaim inventaris sudah dicocokkan dengan kode pada commit `e74b165`:

- Token warna dan font Manrope: cocok dengan `docs/DESIGN.md`.
- Batas lima baris Recent screening: `history.slice(0, 5)`.
- Nisbah kecocokan: `<matched> / <total> matched`.
- Status Buy, Sell, Cooldown pada ringkasan screening terakhir: cocok.
- Zona waktu `Asia/Singapore` beserta label `Singapore Time (SGT, UTC+8)`: cocok.

**Batas verifikasi:** belum dilakukan peninjauan visual melalui browser atau usability testing. Rekomendasi dalam brief adalah arah perbaikan untuk diuji, bukan klaim bahwa tampilan sekarang telah terbukti bermasalah.

---

## 15. Perluasan canvas: komponen, Journal, dan landing page

Permintaan lanjutan tetap berupa desain, bukan implementasi aplikasi. Sumber yang dibaca ulang dari working tree: `workspace-journal-panel.tsx`, `journal-portfolio.tsx`, `journal-bento.tsx`, `public-workspace.tsx`, `single-pricing-card-1.tsx`, dan `data/demo.ts`. Inventaris berikut tidak mengklaim bahwa working tree sama dengan commit pada bagian 14.

### Komponen / bagian 00

Tambahan tiga lembar komponen: actions dan fields; data dan navigasi; feedback dan overlays. Mencakup default, hover, pressed, focus, pending, disabled, validation, read-only, select terbuka, status, pagination, progress, empty, alert, dan konfirmasi. Komponen reusable dipakai kembali melalui instance, termasuk tombol dan badge pada Journal dan landing page.

Label tetap terlihat. Helper dan error ditempatkan di bawah kontrol; baris field sejajar di bagian atas agar validasi tidak mengangkat input tetangganya. Fokus, nama aksesibel, pemulihan fokus dialog, dan reduced motion dicatat sebagai kontrak implementasi, bukan hasil pengujian runtime.

### Journal / bagian 05 dan 13

Source terbaru sudah mendukung pencatatan transaksi manual melalui `JournalPortfolio`. Pisahkan dua domain:

- **Screening snapshots:** bukti screening read-only, filter saham/rule/sinyal/pasar/waktu screening SGT, ekspor seluruh hasil terfilter, dan pagination 25 hasil.
- **Recorded transactions:** eksekusi yang dimasukkan pengguna, dengan filter pasar dan portfolio tersendiri. P&L realized dihitung setelah fee; posisi terbuka tidak masuk ringkasan ini. Tidak ada order broker atau valuasi live.

Desain mencakup dialog catat transaksi dari snapshot, validasi Sell melebihi holdings, ledger transaksi, edit, kegagalan rekonsiliasi, pending save, hasil simpan belum pasti, serta write berhasil tetapi refresh portfolio gagal. Harga screening hanya nilai awal yang harus dikonfirmasi. IDX menggunakan kelipatan 100 saham; fee adalah nominal dalam mata uang pasar. Save memakai identitas operasi stabil dan versi transaksi sesuai source.

Audit lanjutan memisahkan tiga outcome: pending menampilkan payload read-only dan submit nonaktif; kegagalan transport tidak dianggap sebagai bukti tidak tersimpan dan menawarkan pemeriksaan record, bukan pengiriman ulang buta; write yang sudah diakui tetap dikonfirmasi ketika read berikutnya gagal, dengan retry khusus read dan daftar lama berlabel cached. Penguncian field/draft reconciliation merupakan rekomendasi UI, belum perubahan kode. Dua state tambahan ada pada 05.14 dan 05.15.

Empat dashboard desktop juga diselaraskan dengan fixture latest screening: 19 Oct, 17:01 SGT dan 0 gagal, bukan tanggal November atau 1 gagal dari contoh lama. Data contoh mobile yang berbeda tetap dipisahkan. Audit struktur tidak menemukan clipping yang terlihat pada frame yang diperiksa; 25 baris field transaksi diperiksa tanpa ketidaksejajaran. Audit canvas ini bukan uji runtime keyboard, screen reader, zoom, API atau retry.

Pengujian runtime terpisah kemudian dijalankan pada aplikasi yang sudah ada di `127.0.0.1:5174`, bukan implementasi desain baru. Akun, provider dan seluruh respons API disimulasikan; tidak ada transaksi atau akun nyata yang diubah. Artefak berada di direktori dokumen canvas: `qa/runtime-check/report.md`, `report.json`, screenshot dan runner.

Hasilnya: 20 pemeriksaan individual lolos; 4 assertion menunjuk 3 masalah UX yang berbeda (kasus resource diuji pada dua lebar). Masalahnya adalah kegagalan memuat rule ditampilkan seperti rule kosong, field transaksi masih editable saat pending, dan hasil simpan tak pasti belum menawarkan pemeriksaan record sebelum save berikutnya. Rancangan perbaikan berada pada 03.17, 05.13 dan 05.14; kode aplikasi belum diubah.

Uji yang lolos mencakup nama kontrol pada accessibility tree Chromium, settled Tab focus trap, pengembalian fokus, indikator fokus, pencegahan klik ganda, reflow 1440/720/390/320 px, konfirmasi write ketika read selanjutnya gagal, dan retry read tanpa write ulang. Fixture Google menggunakan respons sintetis. Fixture recovery lama gagal karena mengharapkan dialog otomatis; adaptasi di memori yang lebih dahulu memilih View error lolos. File test repository tidak diubah.

VoiceOver/NVDA nyata, zoom browser native, Safari/Firefox, Google login nyata dan persistensi/idempotensi backend nyata belum diverifikasi. Kasus 720×500 menguji layout ekuivalen 200%, bukan membuktikan perilaku fitur zoom browser.

Fixture portfolio bersifat ilustratif, terpisah dari fixture backtest: ASII 100 saham dibeli 5.000 dan dijual 5.050 IDR, fee 500 per sisi, realized 4.000 IDR; ANTM 100 saham dibeli 1.600 dan dijual 1.615 IDR, fee 160 per sisi, realized 1.180 IDR. Total 5.180 IDR dari empat transaksi dan dua trade tertutup. Snapshot tersimpan tidak otomatis membuat transaksi.

Versi desktop 1024 px memakai rail terlipat, expand di top bar, timeframe di bawah ticker, serta aksi baris bertumpuk tanpa menghilangkan mata uang atau sinyal.

### Landing page / bagian 17

**Arah:** perluasan identitas Signalgen yang sudah ada, bukan identitas baru. Manrope, logo asli, permukaan near-black hijau, dan mint tetap dipertahankan. Headline `Read the market. Verify the signal.` dipertahankan dari halaman sekarang. Viewport pertama menunjukkan satu bukti RSI ilustratif di samping pesan utama, bukan klaim performa atau harga live.

Alur halaman: mekanisme screening → pengelolaan rule → snapshot Journal → perangkat/sesi → perbandingan akses → FAQ → tindakan berikutnya. Tujuan utama tetap `#app/overview`; autentikasi, subscription, Creators, dan anchor bagian memakai tujuan yang sudah ada. ThemeToggle tetap tersedia. Untuk pengguna login, implementasi harus memakai AccountMenu yang sudah ada.

Profil ulasan pada source secara eksplisit merupakan demo, bukan testimoni terverifikasi. Desain tidak memublikasikannya sebagai social proof. Harga dan kapasitas berasal dari `api.listSubscriptionPlans`; desain tidak mengarang nominal, kuota, diskon, atau checkout. Online upgrade masih belum tersedia.

Katalog yang dipakai komponen `Pricing` berhasil diverifikasi melalui `GET http://localhost:8080/api/v1/subscription/plans` dengan respons HTTP 200: Free Rp0/bulan, Analyst Rp49.000/bulan, Pro Rp99.000/bulan; semuanya memakai aktivasi manual. Free: 3 saham, system rules, 1 universe, preview historis. Analyst: 10 saham, 10 personal rules, 5 universes, preview historis. Pro: 10 saham, 50 personal rules, 20 universes, akses historis. Nilai ditampilkan pada tiga versi landing; implementasi tetap harus membaca API. Ini verifikasi katalog lokal, bukan klaim telah mengecek domain produksi.

Tersedia desktop 1440 px, desktop 1024 px, mobile 390 px, menu mobile terbuka, serta referensi loading dan kegagalan plan. Konten bukti memakai fixture yang diberi label ilustratif. Tidak diperlukan marquee, shine loop, tilt, atau efek live palsu.

### Halaman legal yang diminta kemudian

Bagian 17.06–17.08 memuat draft desktop Privacy policy, Terms of use, dan Data and risk disclosure; 17.09–17.11 adalah versi mobile. Footer mengarah ke rancangan tujuan baru `#privacy`, `#terms`, dan `#disclosures`. Tujuan tersebut belum menjadi route aplikasi yang berfungsi.

Privacy membahas informasi akun/workspace, layanan eksternal, token pada session storage, browser storage, serta perbedaan cache dataset historis dan arsip backtest lokal. Sumber tambahan: `api/client.ts`, `docs/frontend/HISTORICAL_CACHE_SECURITY.md`, dan dokumentasi arsip backtest pada README web. Logout tidak digambarkan sebagai penghapusan seluruh data server atau seluruh arsip lokal.

Terms mempertahankan pemisahan analisis, aktivasi paket manual, transaksi yang dimasukkan pengguna, dan eksekusi broker. Tidak dibuat janji refund, auto-renewal, klausul yurisdiksi, alamat email, atau identitas badan usaha yang belum dikonfirmasi. Disclosure menjelaskan data periodik, label sinyal, asumsi historis, timezone, coverage, dan hasil parsial.

Ketiga dokumen jelas berstatus **Draft for review**, bukan dokumen yang sudah berlaku. Identitas pengelola, kontak resmi, retensi server, effective date, dan ketentuan operasional perlu persetujuan pengelola serta review legal sebelum publikasi. Versi mobile memiliki navigasi dokumen dan daftar isi terlipat. Pemeriksaan layout 320 px dilakukan sementara lalu lebar dikembalikan ke 390 px; pengujian runtime belum dilakukan.

### Checklist peninjauan canvas

- [x] Bagian komponen, Journal, dan landing diperiksa melalui screenshot saat selesai dibuat.
- [x] Root canvas tidak saling tumpang tindih; penomoran, urutan layer, dan indeks mencakup bagian 00–17.
- [x] Tidak ada root yang ditinggalkan sebagai placeholder.
- [x] Field transaksi tetap sejajar saat error kuantitas muncul.
- [x] Mata uang, batas data ilustratif, dan perbedaan snapshot/transaksi terlihat.
- [ ] Routing, ekspor CSV, keyboard, screen reader, reduced motion, dan retry/save terhadap server diuji setelah implementasi.

Canvas berisi 161 screen/reference dalam 18 bagian. Pemeriksaan desain tidak menggantikan pengujian aplikasi.

### Implementasi 16 November 2026

Tiga celah dari uji runtime sudah diperbaiki di aplikasi, bukan hanya di canvas:

- `workspace-screener-panel.tsx`: kegagalan memuat rule/universe menampilkan **Selections are temporarily unavailable** dengan **Reload selections**; state kosong hanya muncul bila server benar-benar mengembalikan daftar kosong.
- `journal-portfolio.tsx`: form berada dalam `fieldset` nonaktif selama menyimpan, status pending diumumkan, dan hasil yang belum pasti menawarkan **Check transactions**, **Retry same transaction**, atau **Use saved version** alih-alih save kedua. `confirmsPortfolioWrite` di `lib/portfolio.ts` hanya menerima ID sama, versi lebih tinggi, dan payload identik.
- Write yang sudah dikonfirmasi tetap berstatus tersimpan ketika read portofolio berikutnya gagal; tombolnya me-retry read saja.
- Auth: panel gambar explorer hijau bertekstur di kiri, form di kanan; DOM tetap form-first; panel disembunyikan di bawah 1020 px.

Aset foto berada di `frontend/web/public/auth/explorer.jpg` (generated, disimpan sebagai JPEG 880×1216). Sumber yang sama dipakai di canvas dan aplikasi. Foto adalah still, sehingga tidak ada kontrol pause.

Verifikasi aplikasi: `npm test` 272/272, `npm run typecheck`, `npm run build`, `npm run test:recovery`, `npm run test:auth`, `npm run test:journal-explorer`. Probe browser tambahan (41 pemeriksaan, semuanya lolos) berada di `qa/runtime-check/` bersama dokumen ini dan memakai akun/API sintetis.

Belum terverifikasi: VoiceOver/NVDA nyata, zoom browser native, Safari/Firefox, Google login nyata, persistensi backend nyata, dan persetujuan legal untuk halaman privasi.
