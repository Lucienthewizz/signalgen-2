# Panduan Lengkap & Cara Kerja Screener SignalGen 2.0 (Untuk Pemula)

> **Catatan Penting (Disclaimer):** SignalGen 2.0 adalah alat bantu analisis historis berbasis aturan (*rule-based historical screener*), **bukan** aplikasi jual-beli otomatis (*broker/auto-trading*), bukan sinyal harga *real-time* detik ini, dan bukan jaminan keuntungan finansial. Status **Matched** berarti seluruh syarat yang kamu atur terpenuhi pada data penutupan harian (*daily candle*) terakhir.

---

## 1. Apa Itu Stock Screener di SignalGen 2.0?

Bayangkan kamu ingin mencari saham yang sedang bagus dari ratusan saham di Bursa Efek Indonesia (**IDX**, seperti `BBCA`, `BBRI`, `TLKM`) atau Bursa Amerika Serikat (**Nasdaq/NYSE**, seperti `AAPL`, `MSFT`, `NVDA`). Memeriksa grafik saham satu per satu tentu memakan waktu berjam-jam.

**Stock Screener** bekerja seperti **"Saringan Otomatis"**:
1. Kamu menentukan **Syarat Saringan (*Screening Rule*)** — misalnya: *"Cari saham yang tren harganya sedang naik dan belum terlalu mahal."*
2. Kamu memilih **Kelompok Saham (*Stock Universe*)** — misalnya 1 sampai 10 saham pilihanmu dalam satu pasar/mata uang yang sama.
3. **Screener** memeriksa seluruh saham tersebut sekaligus dalam hitungan milidetik dan memberikan laporan lengkap: saham mana yang **Lolos Saringan (*Matched*)**, mana yang **Belum Lolos (*Not Matched*)**, lengkap dengan **Bukti Angka (*Condition Evidence*)** untuk setiap syarat!

---

## 2. Visualisasi Alur Kerja Screener (Arsitektur Hybrid Model A)

Mengapa SignalGen 2.0 terasa cepat sekaligus aman? Karena SignalGen menggunakan arsitektur **Hybrid (Model A)** yang membagi tugas antara perangkatmu (*Browser*) dan *Server*:

```text
+-----------------------------------------------------------------------------------+
|                        ALUR KERJA SCREENER SIGNALGEN 2.0                          |
+-----------------------------------------------------------------------------------+

  [1. PERSIAPAN & AKSES]
   Pengguna memilih Rule & Stock Universe (1-10 saham)
          │
          ▼
   Server Go memeriksa Sesi Login, Hak Akses (Entitlement), & Menyiapkan Dataset Harian
          │
          ▼
  [2. KOMPUTASI INDIKATOR DI BROWSER — Go/WASM Web Worker]
   Data OHLCV harian diproses langsung di laptop/browser kamu (atau diambil dari Cache
   lokal terenkripsi AES-256-GCM di IndexedDB).
   Mesin Go/WASM menghitung angka indikator berat untuk setiap saham:
   • PRICE (Harga Penutupan)
   • EMA 9 (Rata-rata Bergerak Cepat - 9 Hari)
   • EMA 20 (Rata-rata Bergerak Lambat - 20 Hari)
   • RSI 14 (Kekuatan Momentum - 14 Hari)
          │
          │  (Mengemas ringkasan angka / Feature Vector ke dalam 1 Batch)
          ▼
  [3. EVALUASI PRIVAT DI SERVER — Satu Grant, Satu Ticket, Satu WebSocket]
   Browser meminta 1 Compute Grant & 1 Socket Ticket sekali pakai (One-Time Ticket)
          │
          ▼
   Membuka koneksi cepat WebSocket (/api/v1/screener/ws) & mengirim Batch Feature Vector
          │
          ▼
   Decision Kernel di Server Go memeriksa seluruh syarat Rule (Logika AND & Cooldown)
   secara privat tanpa membocorkan rumus sistem ke publik
          │
          ▼
  [4. HASIL & BUKTI INDIKATOR DI LAYAR]
   Tabel Hasil Screening menampilkan:
   • Status: MATCHED (Semua syarat terpenuhi) atau NOT MATCHED (Ada syarat belum terpenuhi)
   • Bukti per Syarat (Condition Evidence), Grafik TradingView, Riwayat & Ekspor CSV
```

### Analogi Sederhana: "Staf Hitung & Supervisor"
* **Go/WASM di Browser adalah Staf Hitung di Mejamu:** Ia mengerjakan hitungan matematika yang berat (menghitung rata-rata harga dan momentum puluhan hari) langsung di komputer kamu supaya server tidak keberatan saat banyak orang memakai aplikasi bersamaan.
* **Server Go adalah Supervisor:** Staf hitung cukup mengirimkan lembar ringkasan angka (*Feature Vector*) melalui jalur khusus (*WebSocket*). Supervisor yang memegang buku aturan rahasia (*Decision Kernel*) lalu mengecek apakah angkanya memenuhi syarat dan memberikan cap **Matched** atau **Not Matched**.

---

## 3. Kamus Istilah (Glossary) untuk Pemula

Jangan khawatir jika kamu baru pertama kali melihat istilah saham atau teknis di aplikasi. Berikut penjelasan bahasa sehari-harinya:

### A. Istilah Pasar & Data Saham

| Istilah di Aplikasi | Arti Bahasa Sehari-hari | Contoh / Penjelasan Praktis |
| :--- | :--- | :--- |
| **Ticker / Symbol** | Kode singkat nama perusahaan di bursa saham. | `BBCA` / `BBCA.JK` (Bank Central Asia di IDX), `AAPL` (Apple di AS). |
| **IDX vs US Market** | Pilihan bursa saham: **IDX** (Bursa Efek Indonesia dalam Rupiah/IDR) atau **US** (Nasdaq/NYSE dalam Dolar/USD). | Dalam 1 *Universe*, semua saham harus berasal dari pasar dan mata uang yang sama (tidak dicampur IDR & USD). |
| **Stock Universe** | "Keranjang" atau daftar kelompok berisi **1 hingga 10 saham** yang ingin kamu saring bersama-sama. | Contoh: Universe *"Bank Besar"* berisi `BBCA`, `BBRI`, `BMRI`, `BBNI`. |
| **Candle / OHLCV** | Rekaman pergerakan harga saham dalam 1 hari perdagangan (*Daily / 1d*). | **O**pen (Harga Buka), **H**igh (Tertinggi), **L**ow (Terendah), **C**lose (Harga Tutup), **V**olume (Jumlah transaksi). |
| **Open & Close Price** | Harga saat bursa buka pagi hari (**Open**) dan harga resmi saat bursa tutup sore hari (**Close**). | Di SignalGen, indikator dihitung menggunakan **Close Price** (harga penutupan harian yang sudah selesai). |
| **Daily Snapshot** | Potret data harian terakhir yang sudah selesai, bukan harga yang berkedip tiap detik (*bukan live streaming*). | Membantu kamu menganalisis dengan tenang tanpa terdistraksi fluktuasi palsu menit-menitan. |

### B. Indikator Teknikal yang Digunakan di SignalGen 2.0

```text
  VISUALISASI TREN (PRICE, EMA 9, EMA 20)
  Harga
    ▲             /\/\`  <-- PRICE (Harga Penutupan Hari Ini - Paling Responsif)
    │          /\/    \  <-- EMA 9 (Garis Cepat 9 Hari - Mengikuti Tren Pendek)
    │       /\/        \ <-- EMA 20 (Garis Lambat 20 Hari - Fondasi Tren Menengah)
    └──────────────────────► Waktu
    * Saat PRICE > EMA 9 dan EMA 9 > EMA 20, artinya saham sedang dalam Tren Naik (Uptrend)!

  VISUALISASI MOMENTUM (RSI 14 — Skala 0 sampai 100)
  0 ─────────── 30 ────────── 45 ─────────────── 75 ──── 70 ────────── 100
  [ Jenuh Jual  ]             [ Zona Momentum    ]       [ Jenuh Beli   ]
  [ (Oversold)  ]             [ Sehat / Ideal    ]       [ (Overbought) ]
  Harga sudah turun           Tenaga naik kuat,          Harga sudah naik terlalu
  terlalu dalam               belum kepanasan            tinggi, rawan koreksi/turun
```

| Indikator | Kepanjangan | Cara Mudah Memahaminya |
| :--- | :--- | :--- |
| **`PRICE`** | *Closing Price* (Harga Penutupan) | Harga terakhir saham saat pasar tutup pada hari tersebut (dalam IDR untuk IDX, atau USD untuk saham AS). |
| **`EMA9`** | *Exponential Moving Average (9)* | Rata-rata harga penutupan selama **9 hari terakhir** dengan bobot lebih besar pada hari-hari terbaru. Garis ini bergerak **cepat** mengikuti harga terbaru. |
| **`EMA20`** | *Exponential Moving Average (20)* | Rata-rata harga penutupan selama **20 hari terakhir** (sekitar 1 bulan bursa). Garis ini bergerak **lebih lambat/halus** dan menjadi acuan tren menengah. |
| **`RSI14`** | *Relative Strength Index (14)* | "Speedometer" kekuatan harga selama **14 hari terakhir** dengan nilai **0 sampai 100**:<br>• **Di bawah 30 (`< 30`):** *Oversold* (Jenuh Jual / harga sudah tertekan turun cukup dalam).<br>• **Antara 45 – 75:** Momentum kenaikan sehat (tenaga beli kuat tapi belum kepanasan).<br>• **Di atas 70–75 (`> 70`):** *Overbought* (Jenuh Beli / harga sudah naik terlalu kencang, rawan berbalik turun). |

### C. Istilah Aturan (*Rules*) & Hasil Evaluasi

| Istilah di Aplikasi | Arti Bahasa Sehari-hari | Cara Kerja di SignalGen |
| :--- | :--- | :--- |
| **Screening Rule** | Daftar syarat (*checklist*) yang kamu gunakan untuk menyaring saham. | Terdiri dari **System Rule** (bawaan SignalGen, *read-only*) dan **Private/Your Rule** (aturan buatanmu sendiri). |
| **Condition (Syarat)** | Rumus perbandingan sederhana: `[Kiri] [Operator] [Kanan]`. | Operator yang didukung: `>` (lebih besar), `>=` (lebih besar/sama dengan), `<` (lebih kecil), `<=` (lebih kecil/sama dengan). |
| **AND Logic** | Logika **"DAN"** — artinya **SEMUA syarat wajib terpenuhi**. | Jika kamu punya 4 syarat dan hanya 3 yang cocok sedangkan 1 gagal, maka hasilnya tetap **Not Matched**. |
| **Cooldown (seconds)** | Jeda waktu tunggu minimum (dalam detik, 0–86.400 detik) sebelum sinyal yang sama boleh muncul lagi pada riwayat saham tersebut. | Mencegah sinyal berulang-ulang terlalu rapat pada rentang waktu yang berdekatan. |
| **Matched (`RULE_MATCHED`)** | **Lolos Saringan!** | Seluruh syarat pada *Rule* terpenuhi oleh data saham pada *candle* terakhir. |
| **Not Matched (`CONDITIONS_NOT_MET`)** | **Belum Lolos Saringan.** | Ada minimal satu syarat pada *Rule* yang belum terpenuhi. Ini **bukan error aplikasi**, melainkan tanda saham tersebut belum sesuai kriteriamu hari ini. |
| **Condition Evidence** | Rincian bukti angka nyata untuk setiap syarat. | Menampilkan perbandingan langsung, misalnya: `RSI14 (27.28) < 30` → **Met (Terpenuhi)** atau `EMA9 (4,120) > EMA20 (4,180)` → **Not met (Tidak terpenuhi)**. |

---

## 4. Instruksi Lengkap Langkah demi Langkah Menggunakan Screener

Ikuti panduan berurutan ini dari awal hingga kamu mendapatkan hasil analisis sahammu:

### Langkah 0: Persiapan Awal & Login
1. Pastikan *Backend Go API* sudah menyala (indikator koneksi aktif) dan buka halaman aplikasi web SignalGen.
2. Masuk (*Sign in*) menggunakan akunmu.
3. Pastikan akunmu memiliki hak akses (**Entitlement**) untuk fitur **Market Screener** (dapat dicek pada menu **Plan & Access** / `#app/subscription`).

### Langkah 1: Buat "Keranjang" Saham (*Stock Universe*)
Sebelum menyaring, kamu perlu menentukan saham apa saja yang ingin dianalisis (maksimal 10 saham per *Universe*):
1. Buka menu **Stock Universes** (`#app/universes`).
2. Pilih pasar saham yang diinginkan (**IDX** untuk saham Indonesia atau **US** untuk Nasdaq/NYSE).
   * *Catatan:* Satu *Universe* hanya boleh berisi saham dari pasar dan mata uang yang sama (minimum 1 saham, maksimum 10 saham).
3. Cari dan klik **1 hingga 10 kode saham** dari katalog resmi (contoh IDX: `BBCA`, `BBRI`, `TLKM`, `BMRI`, `ASII`).
4. Ketik nama kelompok saham pada kolom **Universe name** (contoh: *"Watchlist Perbankan IDX"*).
5. Klik tombol **Create universe**.

### Langkah 2: Buat atau Pilih Aturan Saringan (*Screening Rule*)
Kamu bisa langsung memakai aturan bawaan sistem (**Default Scalping**) atau membuat aturanmu sendiri tanpa koding:
1. Buka menu **Rules** (`#app/rules`).
2. Untuk membuat aturan baru, klik **New blank rule**, lalu isi:
   * **Rule name:** Nama strategi (contoh: *"Cari Saham Diskon RSI Rendah"* atau *"Momentum Uptrend Harian"*).
   * **Cooldown (seconds):** Jeda antar sinyal (default `300` detik; rentang `0` – `86400` detik).
3. Pada bagian **Screening conditions**, klik **Add condition** (bisa memuat 1 sampai 20 syarat dengan logika **AND**):
   * **Kotak Kiri (Indikator):** Pilih `PRICE`, `EMA9`, `EMA20`, atau `RSI14`.
   * **Kotak Tengah (Operator):** Pilih `>`, `>=`, `<`, atau `<=`.
   * **Kotak Kanan (Pembanding):** Ketik nama indikator lain (`EMA9`, `EMA20`, `PRICE`, `RSI14`) **ATAU** ketik angka langsung (misalnya `30`, `50`, atau harga dalam mata uang *Universe* tanpa titik/konversi kurs).
4. Klik tombol **Save rule**.

#### 💡 Contoh Resep Rule untuk Pemula:
* **Resep 1 — System Rule "Default Scalping" (Tren Naik + Momentum Sehat):**
  * `EMA9 > EMA20` *(Tren jangka pendek di atas tren menengah)*
  * `PRICE > EMA9` *(Harga penutupan hari ini kuat di atas rata-rata 9 hari)*
  * `RSI14 > 45` *(Momentum beli sudah mulai kuat)*
  * `RSI14 < 75` *(Harga belum kepanasan / belum jenuh beli)*
* **Resep 2 — "Berburu Saham Jenuh Jual / Oversold":**
  * `RSI14 < 30` *(Mencari saham yang baru mengalami penurunan tajam dan berpotensi memantul)*
* **Resep 3 — "Golden Cross Sederhana":**
  * `PRICE > EMA20`
  * `EMA9 >= EMA20`

### Langkah 3: Jalankan Screener (*Run Screening*)
1. Buka halaman **Screener** (`#app/analysis`).
2. Pada dropdown **Screening rule**, pilih *Rule* yang ingin kamu gunakan (bisa *System rule* atau *Your saved rule*).
3. Pada dropdown **Stock universe**, pilih *Universe* saham yang sudah kamu buat.
4. Periksa ringkasan syarat (*badge* kondisi) yang muncul di bawah pilihanmu.
5. Klik tombol **Run screening**.
6. Perhatikan *Progress Bar* yang berjalan melalui 4 tahap otomatis:
   * **15% — Checking account access:** Memastikan sesi aplikasi dan izin fitur *screener* aktif.
   * **40% — Preparing daily data:** Mengambil *manifest* dataset harian (minimal 20 *candle* historis per saham) dari server/cache terenkripsi.
   * **68% — Calculating indicators:** Mesin lokal **Go/WASM Worker** di browser menghitung `PRICE`, `EMA9`, `EMA20`, dan `RSI14` untuk semua saham sekaligus.
   * **88% — Checking rule conditions:** Mengirim *batch feature vector* lewat **WebSocket** dengan *one-time socket ticket* ke *Decision Kernel* di server Go.
   * **100% — Screening complete:** Hasil siap dibaca! *(Jika ingin membatalkan di tengah jalan, klik tombol **Cancel**).*

### Langkah 4: Membaca Hasil, Bukti Indikator, & Grafik
Setelah proses mencapai 100%, gulir ke bagian **Screening results**:
1. **Filter, Cari, & Urutkan Tabel:**
   * Gunakan filter status (**All**, **Matched**, **Not matched**) untuk menyaring tabel.
   * Gunakan kotak pencarian (**Search**) untuk mencari kode saham tertentu.
   * Urutkan berdasarkan kode saham (**Symbol**), harga, atau nilai indikator.
2. **Klik Baris Saham untuk Melihat Bukti Detail (*Stock Detail & Condition Evidence*):**
   * Saat kamu mengklik salah satu saham (misalnya `TLKM`), panel detail akan terbuka menampilkan:
     * Nilai pasti **Open price**, **Close price**, **EMA 9**, **EMA 20**, dan **RSI 14** pada *candle* terakhir.
     * **Condition evidence:** Daftar ceklis per syarat yang menjelaskan **mengapa** saham tersebut *Matched* atau *Not Matched* (angka kiri dibandingkan langsung dengan angka kanan).
     * **Grafik Interaktif TradingView** untuk melihat bentuk *candlestick* secara visual.
3. **Bandingkan dengan Riwayat Sebelumnya (*Screening History & Comparison*):**
   * Klik panel lipat **Screening history** untuk meninjau hasil saringan terdahulu atau membandingkan perubahan hasil terbaru dengan saringan sebelumnya:
     * **New matches:** Saham yang baru lolos saringan kali ini.
     * **No longer matched:** Saham yang sebelumnya lolos tapi kali ini tidak lolos.
     * **Still matched:** Saham yang konsisten tetap lolos.
4. **Unduh Laporan ke Excel/Spreadsheet (*Export CSV*):**
   * Klik tombol **Export CSV** di kanan atas tabel hasil untuk mengunduh file `signalgen-screening.csv` berisi seluruh angka harga, indikator, status keputusan, dan versi *rule*.

---

## 5. Tanya Jawab & Pemecahan Masalah Umum (FAQ Pemula)

* **T: Mengapa semua saham saya hasilnya "Not matched"? Apakah aplikasinya rusak?**
  * **J:** Tidak rusak! **Not matched** artinya pada penutupan pasar terakhir, belum ada saham di *Universe*-mu yang memenuhi **seluruh** syarat pada *Rule* yang kamu pilih. Klik detail sahamnya untuk melihat syarat mana yang belum terpenuhi (pada bagian *Condition evidence*).
* **T: Mengapa saya tidak bisa mencampur saham Indonesia (`BBCA.JK`) dan saham AS (`AAPL`) dalam satu Universe?**
  * **J:** Karena harga saham IDX menggunakan **Rupiah (IDR)** (misalnya Rp10.000) sedangkan saham AS menggunakan **Dolar (USD)** (misalnya $200). Agar syarat seperti `PRICE > 5000` atau `EMA20` tidak salah arti akibat perbedaan mata uang, setiap *Universe* dikunci pada satu pasar/mata uang.
* **T: Mengapa dibutuhkan minimal 20 candle (hari bursa) untuk menjalankan screener?**
  * **J:** Karena indikator `EMA20` membutuhkan minimal 20 hari data penutupan historis dan `RSI14` membutuhkan minimal 15 hari data agar rumus matematikanya menghasilkan angka yang valid dan akurat.
* **T: Apa yang harus dilakukan jika muncul pesan "Screener access is not active"?**
  * **J:** Buka menu **Plan & Access** (`#app/subscription`) untuk memeriksa status langganan atau minta operator mengaktifkan *grant* fitur `screener` pada akunmu.
