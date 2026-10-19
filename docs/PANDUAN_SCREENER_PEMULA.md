# Panduan Lengkap & Cara Kerja Screener SignalGen 2.0 (Untuk Pemula)

> **Catatan Penting:** SignalGen 2.0 adalah screener berbasis aturan historis, **bukan** broker, auto-trading, prediksi harga yang pasti, atau jaminan profit. Sinyal **BUY/SELL** berarti rule lolos sesuai logika **AND/OR** dan cooldown pada candle yang dievaluasi. Arah sinyal dipilih pembuat rule, bukan ditebak dari indikator. **Match tidak sama dengan BUY.**

Untuk menjelaskan kode saat asis, baca [alur backend, contoh JSON, match/BUY/SELL dan bug riwayat](backend/SCREENER_DECISIONS.md).

---

## 1. Apa Itu Stock Screener di SignalGen 2.0?

Bayangkan kamu ingin mencari saham potensial dari ratusan saham di Bursa Efek Indonesia (**IDX**, seperti `BBCA`, `BBRI`, `TLKM`) atau Bursa Amerika Serikat (**Nasdaq/NYSE**, seperti `AAPL`, `MSFT`, `NVDA`). Memeriksa grafik satu per satu memakan waktu berjam-jam.

**Stock Screener** bekerja seperti **"Saringan Pintar Otomatis"**:
1. Kamu menentukan **Aksi & Syarat Saringan (*Screening Rule*)**:
   - Ingin mencari sinyal beli (**BUY / Entry**) atau sinyal jual (**SELL / Exit**)?
   - Aturan harus memenuhi *semua* syarat (**Logika AND**) atau *salah satu* syarat saja (**Logika OR**)?
   - Apakah harga sedang memotong garis indikator ke atas (**`CROSS_UP` / Golden Cross**)?
2. Kamu memilih **Kelompok Saham (*Stock Universe*)** — berisi 1 sampai 10 saham pilihanmu dalam pasar dan mata uang yang sama.
3. **Screener** memeriksa saham tersebut; total waktu bergantung pada provider, jaringan, perangkat dan server. Hasilnya:
   - 🟢 **`BUY`**: Lolos rule yang diberi arah BUY.
   - 🔴 **`SELL`**: Lolos rule yang diberi arah SELL; bukan bukti pengguna memiliki saham atau memperoleh profit.
   - ⚪ **`Not matched`**: Saham belum memenuhi kriteria hari ini.
   - Dilengkapi **Bukti Angka (*Condition Evidence*)** transparan untuk setiap syarat!

---

## 2. Visualisasi Alur Kerja Screener (Arsitektur Hybrid Model A)

SignalGen 2.0 menggunakan **Hybrid (Model A)** untuk membagi pekerjaan indikator dan evaluasi rule. Efisiensi serta kapasitas tetap perlu diukur; pilihan arsitektur sendiri bukan bukti performa atau keamanan mutlak.

```text
+-----------------------------------------------------------------------------------+
|                        ALUR KERJA SCREENER SIGNALGEN 2.0                          |
+-----------------------------------------------------------------------------------+

  [1. PERSIAPAN & AKSES]
   Pengguna memilih Rule (BUY/SELL, AND/OR) & Stock Universe (1-10 saham)
          │
          ▼
   Server Go memeriksa Sesi Login, Entitlement, & Menyiapkan Dataset Harian
          │
          ▼
  [2. KOMPUTASI INDIKATOR DI BROWSER — Go/WASM Web Worker]
   Data OHLCV harian diproses langsung di browser laptop/HP kamu (atau diambil dari
   Cache terenkripsi AES-256-GCM di IndexedDB).
   Mesin Go/WASM menghitung indikator teknikal secara lokal:
   • PRICE (Harga Penutupan Terakhir)
   • EMA 9 (Rata-rata Eksponensial Cepat - 9 Hari)
   • EMA 20 (Rata-rata Eksponensial Lambat - 20 Hari)
   • RSI 14 (Momentum Kekuatan Relatif - 14 Hari)
          │
          │  (Mengemas ringkasan fitur / Feature Vector ke dalam 1 Batch ringkas)
          ▼
  [3. EVALUASI PRIVAT DI SERVER — Satu Grant, Satu Ticket, Satu WebSocket]
   Browser meminta 1 Compute Grant & 1 Socket Ticket sekali pakai (One-Time Ticket)
          │
          ▼
   Membuka koneksi kilat WebSocket (/api/v1/screener/ws) & mengirim Batch Feature Vector
          │
          ▼
   Decision Kernel di Server Go mengevaluasi seluruh syarat Rule secara privat:
   • Mengecek logika perbandingan (<, <=, >, >=)
   • Mengecek persilangan candle hari ini vs kemarin (CROSS_UP / CROSS_DOWN)
   • Mengecek logika kombinasi (AND / OR)
   • Memeriksa masa jeda proteksi (Cooldown)
   (Akses dibatasi per pengguna; rule milik sendiri dapat dibaca pemilik di browser.
    Definisi rule sistem privat tidak dikirim; ini bukan jaminan anti-reverse-engineering.)
          │
          ▼
  [4. HASIL KEPUTUSAN & BUKTI INDIKATOR DI LAYAR]
   Tabel Screener menampilkan:
   • Label Aksi: BUY (Hijau), SELL (Merah), atau Not matched
   • Kode Alasan: RULE_MATCHED, CONDITIONS_NOT_MET, atau COOLDOWN_ACTIVE
   • Bukti per Syarat (Condition Evidence), Grafik TradingView, Riwayat & Ekspor CSV
```

### Analogi Sederhana: "Staf Hitung & Supervisor Rahasia"
* **Go/WASM di Browser adalah Staf Hitung:** Ia menghitung indikator di perangkat pengguna, sehingga pekerjaan indikator per pengguna tidak semuanya masuk server. Ini bukan jaminan server mampu melayani ribuan pengguna; CPU/RAM client dan server, latensi serta kegagalan perlu diuji.
* **Server Go adalah Supervisor:** Staf hitung hanya mengirimkan ringkasan angka akhir. Supervisor yang menyimpan brankas strategi privat kemudian mencocokkannya dengan kriteria aturan pengguna dan memberi stempel keputusan: **BUY**, **SELL**, atau **Not matched**.

---

## 3. Kamus Istilah (Glossary) Lengkap untuk Pemula

### A. Istilah Pasar & Data Saham

| Istilah | Arti Bahasa Sehari-hari | Contoh / Penjelasan Praktis |
| :--- | :--- | :--- |
| **Ticker / Symbol** | Kode unik perusahaan di bursa efek. | `BBCA.JK` (Bank Central Asia di IDX), `NVDA` (Nvidia di Nasdaq AS). |
| **IDX vs US Market** | Pilihan bursa: **IDX** (Indonesia, mata uang Rupiah/IDR) atau **US** (Amerika Serikat, mata uang Dolar/USD). | Saham dalam 1 *Universe* wajib berasal dari bursa yang sama (tidak boleh campur IDR dan USD). |
| **Stock Universe** | Daftar kelompok berisi **1 hingga 10 saham** yang disaring bersama-sama. | Contoh: Universe *"Perbankan Unggulan"* berisi `BBCA`, `BBRI`, `BMRI`, `BBNI`. |
| **Candle / OHLCV** | Rekaman pergerakan harga saham dalam 1 hari bursa (*Daily*): **O**pen (Buka), **H**igh (Tertinggi), **L**ow (Terendah), **C**lose (Tutup), **V**olume (Volume). | Di SignalGen, indikator teknikal dihitung berdasarkan harga penutupan resmi (**Close Price**). |
| **Daily Snapshot** | Potret data harian terakhir yang sudah selesai (*closed candle*). | Membantu trading tenang berbasis data harian valid, bukan harga kedip-kedip tiap detik (*noise*). |

---

### B. Indikator Teknikal yang Didukung

```text
  VISUALISASI TREN (PRICE, EMA 9, EMA 20)
  Harga
    ▲             /\/\`  <-- PRICE (Harga Penutupan Hari Ini - Paling Cepat)
    │          /\/    \  <-- EMA 9 (Garis Cepat 9 Hari - Mengikuti Tren Pendek)
    │       /\/        \ <-- EMA 20 (Garis Lambat 20 Hari - Penentu Tren Menengah)
    └──────────────────────► Waktu

  VISUALISASI MOMENTUM (RSI 14 — Skala 0 sampai 100)
  0 ─────────── 30 ────────── 45 ─────────────── 70 ────────── 100
  [ Jenuh Jual  ]             [ Zona Momentum    ]   [ Jenuh Beli   ]
  [ (Oversold)  ]             [ Rentang contoh   ]   [ (Overbought) ]
  Label momentum ini bukan penilaian murah/mahal atau jaminan arah harga berikutnya.
```

| Indikator | Kepanjangan | Penjelasan Praktis |
| :--- | :--- | :--- |
| **`PRICE`** | *Close Price* | Harga penutupan resmi saham pada hari bursa terakhir. |
| **`EMA9`** | *Exponential Moving Average (9)* | Rata-rata pergerakan harga selama **9 hari terakhir** dengan pembobotan lebih tinggi pada hari terkini. Garis ini bergerak lincah dan cepat. |
| **`EMA20`** | *Exponential Moving Average (20)* | Rata-rata harga selama **20 hari terakhir** (sekitar 1 bulan perdagangan). Garis ini lebih stabil dan menjadi garis acuan tren (*trendline*). |
| **`RSI14`** | *Relative Strength Index (14)* | Mengukur momentum perubahan harga pada skala **0–100**. Angka 30/70 dapat dipakai sebagai batas contoh rule. RSI rendah bukan bukti saham murah, RSI tinggi bukan jaminan harga akan turun, dan keduanya tidak otomatis menentukan BUY/SELL. |

---

### C. Operator Pembanding & Persilangan (*Crossover*)

SignalGen 2.0 mendukung 6 jenis operator:

| Operator | Nama | Arti & Kapan Digunakan |
| :--- | :--- | :--- |
| **`>`** | Lebih Besar Dari | Memeriksa apakah nilai kiri lebih tinggi dari kanan (misal `PRICE > EMA20`). Bernilai `true` selama harga masih di atas garis. |
| **`>=`** | Lebih Besar atau Sama | Memeriksa apakah nilai kiri setara atau lebih tinggi dari kanan. |
| **`<`** | Lebih Kecil Dari | Memeriksa apakah nilai kiri lebih rendah dari kanan (misal `RSI14 < 30`). |
| **`<=`** | Lebih Kecil atau Sama | Memeriksa apakah nilai kiri setara atau lebih rendah dari kanan. |
| **`CROSS_UP`** | Melintas naik | Kondisi benar jika kiri sebelumnya ≤ kanan sebelumnya dan kiri sekarang > kanan sekarang. Contoh: `EMA9 CROSS_UP EMA20` atau `RSI14 CROSS_UP 30`. |
| **`CROSS_DOWN`** | Melintas turun | Kondisi benar jika kiri sebelumnya ≥ kanan sebelumnya dan kiri sekarang < kanan sekarang. Contoh: `EMA9 CROSS_DOWN EMA20` atau `RSI14 CROSS_DOWN 70`. |

Crossover adalah perbandingan dua candle. Istilah Golden/Death Cross tidak perlu dipakai untuk semua pasangan indikator atau batas angka. Sinyal akhir tetap mengikuti rule dan cooldown.

#### 🔍 Perbedaan Penting: Operator `>` vs `CROSS_UP`
* `EMA9 > EMA20` bernilai benar selama EMA9 berada di atas EMA20.
* `EMA9 CROSS_UP EMA20` bernilai benar ketika EMA9 sebelumnya ≤ EMA20 sebelumnya, lalu EMA9 sekarang > EMA20 sekarang. Dua nilai EMA20 itu dapat berbeda. Tanpa kandidat sebelumnya, crossover tidak dipicu.
* Itu hasil **satu kondisi**, bukan jaminan sinyal akhir. Kondisi lain pada AND, kondisi alternatif pada OR dan cooldown tetap berpengaruh. Pada rule OR, kondisi lain yang terus benar dapat membuat rule tetap lolos meskipun crossover tidak terjadi lagi.

---

### D. Logika Aturan & Arah Tindakan Sinyal

| Fitur | Pilihan | Arti & Fungsi |
| :--- | :--- | :--- |
| **Signal Action** | **`BUY`** | Aturan dirancang untuk mencari titik masuk beli (*Entry Position*). |
| | **`SELL`** | Aturan dirancang untuk mencari titik keluar / jual (*Exit / Take Profit / Stop Loss*). |
| **Rule Logic** | **`AND`** | **Semua syarat wajib terpenuhi**. Jika ada 4 syarat dan 1 saja gagal, saham dinyatakan *Not matched*. |
| | **`OR`** | **Minimal satu syarat terpenuhi**. Sangat berguna untuk aturan proteksi/keluar (misal: Jual jika `RSI14 > 75` **ATAU** `PRICE < EMA20`). |
| **Cooldown (Sec)** | `0 – 86400` | Jeda waktu minimum antar sinyal untuk simbol yang sama. Mencegah alarm sinyal berbunyi berkali-kali pada saham yang sama. |

---

### E. Status Keputusan Screener

1. 🟢 **`BUY` (`RULE_MATCHED`)**: Rule berarah BUY lolos; AND membutuhkan semua kondisi, OR minimal satu, dan cooldown tidak menahan sinyal.
2. 🔴 **`SELL` (`RULE_MATCHED`)**: Rule berarah SELL lolos dengan prinsip yang sama. Bukan transaksi jual otomatis.
3. ⚪ **`Not matched` (`CONDITIONS_NOT_MET`)**: Saham belum memenuhi kriteria rumus aturan. (Bukan error aplikasi, melainkan kondisi pasar hari ini belum cocok dengan kriteriamu).
4. 🟡 **`Cooldown` (`COOLDOWN_ACTIVE`)**: Rumus cocok tetapi sinyal ditahan. Pada respons sekarang `matched` bernilai false dan arah sinyal tidak dikirim. Cooldown dilacak per saham dalam evaluasi batch, bukan alarm persisten lintas seluruh klik Run.
5. **`Matched` tanpa arah**: Riwayat lama kehilangan `signal_type`. UI tidak boleh menebaknya sebagai BUY. Jika data candle sebelumnya juga hilang, bukti crossover dinyatakan tidak tersedia. Jalankan ulang untuk hasil lengkap.

---

## 4. Panduan Langkah demi Langkah Menggunakan Screener

### Langkah 1: Buat Kelompok Saham (*Stock Universe*)
1. Buka menu **Stock Universes** di navigasi kiri (`#app/universes`).
2. Tentukan pasar yang ingin dianalisis (**IDX** untuk saham Indonesia atau **US** untuk saham Amerika).
3. Cari dan pilih **1 hingga 10 saham** dari katalog resmi (contoh IDX: `BBCA`, `BBRI`, `BMRI`, `TLKM`, `ASII`).
4. Beri nama kelompok sahammu (misalnya *"Saham Bluechip IDX"*).
5. Klik **Create universe**.

---

### Langkah 2: Buat atau Pilih Aturan Saringan (*Screening Rule*)
1. Buka menu **Rules** (`#app/rules`).
2. Klik tombol **New blank rule**, lalu isi:
   - **Rule name**: Beri nama yang jelas (contoh: *"Golden Cross Momentum Beli"*).
   - **Signal action**: Pilih **`BUY`** (untuk mencari sinyal beli) atau **`SELL`** (untuk sinyal keluar).
   - **Rule logic**: Pilih **`AND`** (semua syarat wajib cocok) atau **`OR`** (cukup salah satu syarat cocok).
   - **Cooldown (seconds)**: Tentukan jeda waktu (default `300` detik = 5 menit).
3. Tambahkan kondisi pada bagian **Screening conditions** (bisa 1 sampai 20 kondisi):
   - **Kiri**: Pilih indikator utama (`PRICE`, `EMA9`, `EMA20`, `RSI14`).
   - **Tengah**: Pilih operator (`>`, `>=`, `<`, `<=`, `CROSS_UP`, `CROSS_DOWN`).
   - **Kanan**: Isi dengan indikator pembanding (misal `EMA20`) atau ketik angka langsung (misal `30` atau `70`).
4. Klik **Save rule**.

---

### 5 Contoh Rule untuk Belajar Operator

Contoh berikut adalah latihan konfigurasi, bukan strategi yang sudah terbukti menguntungkan atau rekomendasi untuk membeli/menjual saham.

#### Resep 1: Golden Cross Tren Naik (Aksi: BUY | Logika: AND)
Cocok untuk mencari saham yang baru saja memulai tren kenaikan baru:
1. `EMA9 CROSS_UP EMA20` *(Garis cepat memotong ke atas garis lambat)*
2. `PRICE > EMA9` *(Harga tutup berada di atas EMA9)*
3. `RSI14 > 45` *(Tenaga beli sudah mulai aktif)*
4. `RSI14 < 70` *(Batas oscillator dalam contoh ini; bukan penilaian saham murah/mahal)*

#### Resep 2: Pantulan Jenuh Jual / Oversold Rebound (Aksi: BUY | Logika: AND)
Mencari saham yang baru selesai terkoreksi dalam dan mulai memantul naik:
1. `RSI14 CROSS_UP 30` *(RSI baru saja menembus ke atas level 30 dari zona jenuh jual)*
2. `PRICE > EMA9` *(Harga mulai berhasil menembus rata-rata 9 hari)*

#### Resep 3: Amankan Profit / Exit Jenuh Beli (Aksi: SELL | Logika: OR)
Menggunakan logika `OR` untuk memberikan peringatan jual jika salah satu kondisi bahaya muncul:
1. `RSI14 CROSS_DOWN 70` *(RSI berbalik turun menembus 70 setelah jenuh beli)*
2. `PRICE < EMA9` *(Harga mulai jatuh di bawah rata-rata 9 hari)*

#### Resep 4: Death Cross Defensive (Aksi: SELL | Logika: AND)
Peringatan pembalikan tren turun (*downtrend*):
1. `EMA9 CROSS_DOWN EMA20` *(Garis EMA9 memotong ke bawah garis EMA20)*
2. `PRICE < EMA20` *(Harga tertekan di bawah garis tren menengah)*

#### Resep 5: Sistem Bawaan SignalGen ("Default Scalping")
Strategi konservatif bawaan sistem untuk *swing trading* harian:
- Sinyal: `BUY` | Logika: `AND`
- `EMA9 > EMA20`
- `PRICE > EMA9`
- `RSI14 > 45`
- `RSI14 < 75`

---

### Langkah 3: Jalankan Screener (*Run Screening*)
1. Buka menu **Screener** (`#app/analysis`).
2. Pilih aturan yang ingin kamu jalankan pada dropdown **Screening rule**.
3. Pilih kelompok sahammu pada dropdown **Stock universe**.
4. Klik tombol **Run screening**.
5. Amati *Progress Bar* 4 tahap:
   - **15% — Validating access**: Verifikasi sesi login dan hak akses akun.
   - **40% — Preparing data**: Menyiapkan candle harian historis (minimal 20 hari).
   - **68% — Loading engine (Go/WASM)**: Browser menghitung indikator `PRICE`, `EMA9`, `EMA20`, `RSI14`.
   - **88% — Private scoring (WebSocket)**: Evaluasi privat di server Go via WebSocket satu tiket.
   - **100% — Screening complete**: Hasil siap ditinjau!

---

### Langkah 4: Membaca Hasil & Bukti Indikator
1. **Periksa Kolom Decision di Tabel**:
   - Badge hijau **`BUY`**: Lolos aturan beli.
   - Badge merah **`SELL`**: Lolos aturan jual.
   - Badge abu-abu **`Not matched`**: Belum memenuhi syarat.
2. **Klik Nama Saham untuk Membuka Detail**:
   - Melihat nilai eksak harga buka, harga tutup, EMA9, EMA20, dan RSI14.
   - Memeriksa **Condition Evidence**: Memperlihatkan perbandingan angka nyata per syarat sehingga kamu tahu persis syarat mana yang lolos dan syarat mana yang gagal.
   - Menikmati tampilan grafik interaktif **TradingView**.
3. **Ekspor CSV**:
   - Klik tombol **Export CSV** untuk mengunduh laporan lengkap dalam format Excel/Spreadsheet.

---

## 5. Perbandingan: SignalGen 2.0 vs Legacy Screener (Claudio)

Untuk kebutuhan laporan atau sidang skripsi, berikut perbandingan arsitektur SignalGen 2.0 dengan sistem warisan desktop lama:

| Fitur / Parameter | Legacy Desktop (Claudio) | SignalGen 2.0 (Sekarang) |
| :--- | :--- | :--- |
| **Arsitektur Sistem** | Baseline desktop/Python/SQLite; lihat source legacy untuk rincian. | Web multi-user Go/Gin + React 18 + Supabase Postgres. |
| **Komputasi Indikator** | Komputasi pada runtime Python legacy. | Indikator di browser Go/WASM, keputusan di server. Dampak efisiensi harus diukur, bukan diasumsikan. |
| **Keamanan Strategi** | File lokal di komputer user. | Akses resource dibatasi per pengguna; pemilik dapat membaca rule miliknya. Rule sistem privat tetap di server, bukan jaminan tidak dapat dianalisis ulang. |
| **Logika Aturan** | Hanya mendukung `AND`. | Mendukung **`AND` & `OR`**. |
| **Tipe Sinyal** | Hanya filter kecocokan matematis. | **`BUY` (Entry) & `SELL` (Exit)** terintegrasi dengan badge visual. |
| **Operator Persilangan** | Didukung (`CROSS_UP`/`CROSS_DOWN`). | **Didukung (`CROSS_UP`/`CROSS_DOWN`)** dengan perbandingan strictly chronological terhadap candle sebelumnya. |
| **Komentar Kode** | Mengikuti source legacy. | Penjelasan Indonesia ditambahkan pada bagian tertentu; bukan klaim seluruh source sudah dikomentari. |

---

## 6. Tanya Jawab Umum (FAQ Pemula)

* **T: Kenapa saham saya berlabel "Not matched"? Apakah ada error?**
  * **J:** Tidak ada error! *Not matched* artinya data penutupan saham hari ini belum memenuhi rumus kriteriamu. Klik baris saham tersebut untuk melihat rincian syarat mana yang belum tercapai pada bagian *Condition evidence*.
* **T: Mengapa satu universe dibatasi maksimal 10 saham?**
  * **J:** Ini batas screening per universe saat ini, bukan jumlah seluruh saham dalam katalog. Batas tersebut membatasi pekerjaan satu run; kinerja tetap bergantung pada jumlah candle, perangkat dan jaringan. Tidak ada jaminan instan pada setiap perangkat.
* **T: Kapan sebaiknya saya menjalankan screener?**
  * **J:** Untuk memahami hasil aplikasi, periksa tanggal candle terakhir, periode dataset, timezone dan kualitas pada snapshot. Jangan menyimpulkan data sudah final hanya dari satu jam WIB: kalender bursa, timezone dan keterlambatan provider perlu diperhatikan. WebSocket di aplikasi ini mengirim hasil penilaian, bukan bukti harga real-time.
