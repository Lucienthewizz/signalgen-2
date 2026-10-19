# Panduan Lengkap & Cara Kerja Screener SignalGen 2.0 (Untuk Pemula)

> **Catatan Penting (Disclaimer):** SignalGen 2.0 adalah sistem pendukung keputusan (*Decision Support System*) berbasis aturan historis (*rule-based historical screener*), **bukan** aplikasi broker jual-beli otomatis (*auto-execution*), bukan sinyal harga *real-time* detik ini, dan bukan jaminan keuntungan finansial. Sinyal **BUY** atau **SELL** berarti seluruh syarat yang kamu tentukan terpenuhi pada data penutupan harian (*daily candle*) terakhir yang sah.

---

## 1. Apa Itu Stock Screener di SignalGen 2.0?

Bayangkan kamu ingin mencari saham potensial dari ratusan saham di Bursa Efek Indonesia (**IDX**, seperti `BBCA`, `BBRI`, `TLKM`) atau Bursa Amerika Serikat (**Nasdaq/NYSE**, seperti `AAPL`, `MSFT`, `NVDA`). Memeriksa grafik satu per satu memakan waktu berjam-jam.

**Stock Screener** bekerja seperti **"Saringan Pintar Otomatis"**:
1. Kamu menentukan **Aksi & Syarat Saringan (*Screening Rule*)**:
   - Ingin mencari sinyal beli (**BUY / Entry**) atau sinyal jual (**SELL / Exit**)?
   - Aturan harus memenuhi *semua* syarat (**Logika AND**) atau *salah satu* syarat saja (**Logika OR**)?
   - Apakah harga sedang memotong garis indikator ke atas (**`CROSS_UP` / Golden Cross**)?
2. Kamu memilih **Kelompok Saham (*Stock Universe*)** — berisi 1 sampai 10 saham pilihanmu dalam pasar dan mata uang yang sama.
3. **Screener** memeriksa seluruh saham tersebut dalam hitungan milidetik dan langsung memberikan rekomendasi aksi:
   - 🟢 **`BUY`**: Saham memenuhi syarat masuk posisi beli.
   - 🔴 **`SELL`**: Saham memenuhi syarat keluar posisi / ambil untung (*take profit*).
   - ⚪ **`Not matched`**: Saham belum memenuhi kriteria hari ini.
   - Dilengkapi **Bukti Angka (*Condition Evidence*)** transparan untuk setiap syarat!

---

## 2. Visualisasi Alur Kerja Screener (Arsitektur Hybrid Model A)

Mengapa SignalGen 2.0 terasa sangat cepat, hemat beban server, sekaligus aman? Karena SignalGen 2.0 menggunakan arsitektur **Hybrid (Model A)**:

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
   (Rumus dan strategi pengguna terlindungi aman, tidak pernah bocor ke publik)
          │
          ▼
  [4. HASIL KEPUTUSAN & BUKTI INDIKATOR DI LAYAR]
   Tabel Screener menampilkan:
   • Label Aksi: BUY (Hijau), SELL (Merah), atau Not matched
   • Kode Alasan: RULE_MATCHED, CONDITIONS_NOT_MET, atau COOLDOWN_ACTIVE
   • Bukti per Syarat (Condition Evidence), Grafik TradingView, Riwayat & Ekspor CSV
```

### Analogi Sederhana: "Staf Hitung & Supervisor Rahasia"
* **Go/WASM di Browser adalah Staf Hitung:** Ia bertugas mengerjakan kalkulasi matematika rumit (menghitung rata-rata bergerak dan momentum puluhan hari) langsung di komputermu, sehingga server tidak lemot saat ribuan pengguna screening bersamaan.
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
  [ (Oversold)  ]             [ Sehat / Ideal    ]   [ (Overbought) ]
  Harga sudah turun           Tenaga beli kuat,      Harga sudah naik terlalu
  terlalu murah               belum kepanasan        tinggi, rawan koreksi turun
```

| Indikator | Kepanjangan | Penjelasan Praktis |
| :--- | :--- | :--- |
| **`PRICE`** | *Close Price* | Harga penutupan resmi saham pada hari bursa terakhir. |
| **`EMA9`** | *Exponential Moving Average (9)* | Rata-rata pergerakan harga selama **9 hari terakhir** dengan pembobotan lebih tinggi pada hari terkini. Garis ini bergerak lincah dan cepat. |
| **`EMA20`** | *Exponential Moving Average (20)* | Rata-rata harga selama **20 hari terakhir** (sekitar 1 bulan perdagangan). Garis ini lebih stabil dan menjadi garis acuan tren (*trendline*). |
| **`RSI14`** | *Relative Strength Index (14)* | Indikator pengukur kejenuhan dan kecepatan harga dengan skala **0 sampai 100**:<br>• **Di bawah 30 (`< 30`):** Jenuh jual (*oversold*), harga terdiskon dalam.<br>• **Rentang 45 – 70:** Momentum tren naik yang sehat dan bertenaga.<br>• **Di atas 70 (`> 70`):** Jenuh beli (*overbought*), harga rawan ambil untung (*profit taking*). |

---

### C. Operator Pembanding & Persilangan (*Crossover*)

SignalGen 2.0 mendukung 6 jenis operator:

| Operator | Nama | Arti & Kapan Digunakan |
| :--- | :--- | :--- |
| **`>`** | Lebih Besar Dari | Memeriksa apakah nilai kiri lebih tinggi dari kanan (misal `PRICE > EMA20`). Bernilai `true` selama harga masih di atas garis. |
| **`>=`** | Lebih Besar atau Sama | Memeriksa apakah nilai kiri setara atau lebih tinggi dari kanan. |
| **`<`** | Lebih Kecil Dari | Memeriksa apakah nilai kiri lebih rendah dari kanan (misal `RSI14 < 30`). |
| **`<=`** | Lebih Kecil atau Sama | Memeriksa apakah nilai kiri setara atau lebih rendah dari kanan. |
| **`CROSS_UP`** | **Golden Cross / Melintas Naik** | **HANYA memicu sinyal tepat pada hari terjadinya persilangan ke atas!**<br>Rumus: $\text{Kemarin} \le \text{Batas} \ \land \ \text{Hari Ini} > \text{Batas}$.<br>Contoh: `EMA9 CROSS_UP EMA20` (Garis cepat memotong garis lambat ke atas = sinyal awal *bullish*). |
| **`CROSS_DOWN`** | **Death Cross / Melintas Turun** | **HANYA memicu sinyal tepat pada hari terjadinya persilangan ke bawah!**<br>Rumus: $\text{Kemarin} \ge \text{Batas} \ \land \ \text{Hari Ini} < \text{Batas}$.<br>Contoh: `EMA9 CROSS_DOWN EMA20` (Garis cepat memotong ke bawah = sinyal awal *bearish*) atau `RSI14 CROSS_DOWN 70` (keluar dari zona bahaya jenuh beli). |

#### 🔍 Perbedaan Penting: Operator `>` vs `CROSS_UP`
* Jika kamu memakai `EMA9 > EMA20`: Sinyal akan muncul **setiap hari berturut-turut** selama EMA9 berada di atas EMA20 (bisa 20 hari berturut-turut).
* Jika kamu memakai `EMA9 CROSS_UP EMA20`: Sinyal **hanya muncul 1 kali** tepat di hari persilangan pertama kali terjadi. Ini sangat disukai trader karena langsung menandai titik masuk (*entry timing*) yang presisi.

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

1. 🟢 **`BUY` (`RULE_MATCHED`)**: Seluruh kriteria aturan beli terpenuhi pada candle terakhir.
2. 🔴 **`SELL` (`RULE_MATCHED`)**: Seluruh kriteria aturan jual terpenuhi pada candle terakhir.
3. ⚪ **`Not matched` (`CONDITIONS_NOT_MET`)**: Saham belum memenuhi kriteria rumus aturan. (Bukan error aplikasi, melainkan kondisi pasar hari ini belum cocok dengan kriteriamu).
4. 🟡 **`Not matched` (`COOLDOWN_ACTIVE`)**: Saham sebenarnya memenuhi rumus aturan, namun sinyal ditahan sementara karena masih berada dalam masa jeda waktu perlindungan (*cooldown period*).

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

### 💡 5 Resep Strategi Saham Praktis untuk Pemula

#### Resep 1: Golden Cross Tren Naik (Aksi: BUY | Logika: AND)
Cocok untuk mencari saham yang baru saja memulai tren kenaikan baru:
1. `EMA9 CROSS_UP EMA20` *(Garis cepat memotong ke atas garis lambat)*
2. `PRICE > EMA9` *(Harga tutup berada di atas EMA9)*
3. `RSI14 > 45` *(Tenaga beli sudah mulai aktif)*
4. `RSI14 < 70` *(Harga belum kemahalan / belum jenuh beli)*

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
| **Arsitektur Sistem** | Monolitik Desktop (Electron + Python FastAPI + SQLite). | **Modern Web Monorepo** (Go API + React 19 + Supabase Postgres). |
| **Komputasi Indikator** | Berat: Server mengunduh data mentah & menghitung semua indikator di server CPU. | **Ringan & Efisien (Model A)**: Komputasi indikator berjalan di browser client via Go/WASM Web Worker. |
| **Keamanan Strategi** | File lokal di komputer user. | **Privat Server**: Evaluasi keputusan di server Go via WebSocket tiket sekali pakai, strategi user aman tidak bocor. |
| **Logika Aturan** | Hanya mendukung `AND`. | Mendukung **`AND` & `OR`**. |
| **Tipe Sinyal** | Hanya filter kecocokan matematis. | **`BUY` (Entry) & `SELL` (Exit)** terintegrasi dengan badge visual. |
| **Operator Persilangan** | Didukung (`CROSS_UP`/`CROSS_DOWN`). | **Didukung (`CROSS_UP`/`CROSS_DOWN`)** dengan perbandingan strictly chronological terhadap candle sebelumnya. |
| **Komentar Kode** | Minim / bahasa campur. | **100% Bahasa Indonesia** terstruktur dan mudah dijelaskan saat sidang. |

---

## 6. Tanya Jawab Umum (FAQ Pemula)

* **T: Kenapa saham saya berlabel "Not matched"? Apakah ada error?**
  * **J:** Tidak ada error! *Not matched* artinya data penutupan saham hari ini belum memenuhi rumus kriteriamu. Klik baris saham tersebut untuk melihat rincian syarat mana yang belum tercapai pada bagian *Condition evidence*.
* **T: Mengapa satu universe dibatasi maksimal 10 saham?**
  * **J:** Batasan 10 saham dirancang untuk menjaga fokus analisis, memastikan komputasi WASM berjalan instan di perangkat apa pun tanpa lag, serta mematuhi alokasi sumber daya komputasi akun secara adil.
* **T: Kapan sebaiknya saya menjalankan screener?**
  * **J:** Waktu terbaik adalah **setelah pasar tutup** (sore atau malam hari):
    - Untuk saham Indonesia (**IDX**): Setelah pukul **16.15 WIB**.
    - Untuk saham Amerika (**US**): Setelah pukul **04.00 WIB** (pagi hari berikutnya).
    Data penutupan resmi (*Daily Close*) pada jam tersebut sudah final dan akurat untuk analisis keesokan harinya.
