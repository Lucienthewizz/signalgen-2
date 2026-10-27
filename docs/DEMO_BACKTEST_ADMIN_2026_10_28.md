# Panduan demo Backtesting dan Admin — 28 Oktober 2026

Disiapkan dan diuji pada **27 Oktober 2026, WITA**. Panduan ini untuk latihan
sore 27 Oktober dan demo 28 Oktober pada laptop/browser yang sama.

## 1. Status yang benar-benar diuji

| Bagian | Bukti saat persiapan |
| --- | --- |
| Login dan akses akun | Pengguna login sendiri; akun aktif dan menu Admin Panel muncul melalui sidebar. |
| Masa paket | Halaman Plan & access menampilkan paket aktif hingga 25 November 2026; tetap periksa lagi sebelum demo. |
| Backtest manual | Dijalankan melalui browser pengguna, akun asli, API lokal dan provider terkonfigurasi; tiga saham IDX dan dua entry ASII. |
| Backtest rule | Default Scalping berhasil menghasilkan transaksi untuk September 2026 melalui alur akses, private scoring dan Go/WASM. |
| Hasil dan riwayat | T+1…T+3, metrik, tabel transaksi, riwayat tersimpan, reload, lalu buka arsip read-only berhasil. |
| CSV | File hasil manual diunduh lewat browser. Dua baris transaksi, timestamp next-open, currency IDR dan total P&L dicocokkan dengan UI hingga Rp0,01. |
| Admin asli | Directory, pencarian akun, pemilihan akun sendiri, Backtest, preset tujuh hari, review, lalu Cancel berhasil. Tidak ada grant akses anggota/role/subscription yang ditulis. |
| Admin yang menulis akses | Grant/revoke dan kegagalannya diuji dengan akun/API sintetis pada Playwright, bukan mengubah akses anggota asli. |
| Runtime | Delapan pemeriksaan preflight lulus: API, readiness DB/schema/role, versi, proxy, kontrak OpenAPI, penolakan tanpa login, error JSON, serta hash/batas WASM. |
| Browser lintas halaman | Playwright memeriksa 10 halaman workspace, dua ukuran layar dan kedua tema dengan API/akun sintetis. |

**Temuan yang diperbaiki:** Plan & access sebelumnya masih menyebut Backtest
"Not available yet". Sekarang paket yang memenuhi syarat menampilkan **Active**,
sedangkan paket kedaluwarsa tetap **Not included**. README frontend juga dibetulkan
dari `backtest-1` menjadi `backtest-2`. Perbaikan ini tidak memberikan izin baru;
API tetap memvalidasi akses setiap run.

Screenshot lokal hasil pengujian ada di
`frontend/web/output/playwright/demo-readiness-20261027/` dan sengaja tidak masuk
Git. Dua arsip hasil manual/rule sudah tersedia pada riwayat akun di browser yang
dipakai pengujian. Browser/profil lain tidak otomatis memiliki arsip tersebut.

## 2. Periksa sebelum presentasi

1. Gunakan laptop, profil browser dan origin yang sama:
   `http://127.0.0.1:5174`. `localhost` adalah origin berbeda untuk penyimpanan browser.
2. Pastikan Docker/OrbStack dan Go API berjalan; badge aplikasi **Connected**.
3. Login, buka **Plan & access**, cek paket/Backtest aktif dan menu **Admin Panel**.
   Login dan run baru membutuhkan jaringan serta layanan autentikasi/database.
4. Pastikan universe **Uji katalog IDX — ASII ANTM INDF** dan **Default Scalping**
   masih tersedia. Universe ini berisi `ASII.JK`, `ANTM.JK`, `INDF.JK`.
5. Siapkan browser dalam layar lebar saat presentasi. Pada panel sempit, buka
   **Open workspace menu** sebelum memilih halaman dari sidebar. Tabel
   hasil memang memakai scroll horizontal di dalam tabel.
6. Simpan CSV dan screenshot di laptop sebagai cadangan. Arsip di aplikasi masih
   memeriksa akses akun; ia bukan mode offline bila API/database tidak tersedia.

Dari root Git `signalgen-2/signalgen-2`, jalankan pemeriksaan tanpa credential:

```sh
node backend/scripts/demo_preflight.mjs http://127.0.0.1:8080 http://127.0.0.1:5174
```

Targetnya delapan baris `PASS`. Preflight tidak membuat akun, mengubah grant,
menjalankan migrasi, atau membuktikan seluruh alur akun/provider.

Jika layanan belum berjalan:

```sh
docker compose up -d go-api
npm --prefix frontend/web run dev -- --port 5174
```

Perintah Vite berjalan terus pada terminal itu. Jika port 5174 sudah dipakai,
gunakan proses yang ada; jangan membiarkan Vite memilih port lain tanpa sengaja.

## 3. Urutan demo sekitar 10–12 menit

### A. Manual: tunjukkan next-open dan holding period

Buka **Analysis → Backtesting**, lalu isi:

| Kontrol | Nilai latihan |
| --- | --- |
| Entry mode | Manual |
| Stock universe | Uji katalog IDX — ASII ANTM INDF |
| From / To, UTC | 1 September 2026 / 30 September 2026 |
| Holding period | 3 candle |
| Initial capital | 10000000, yaitu modal simulasi Rp10 juta |
| Position sizing / size | Percent of equity / 100% |
| Commission / slippage | 0 / 0 untuk contoh dasar ini |

Pastikan tanggal yang tertulis benar sebelum menekan **Prepare data**. Jika input
tanggal sulit diketik pada browser, gunakan date picker.

Setelah data siap, pilih `ASII.JK` dan tambahkan dua signal candle berikut melalui
dropdown **Signal candle (UTC)**:

- `2026-09-01 · close 4,920`
- `2026-09-02 · close 4,840`

Tekan **Run manual backtest**. Ini memilih waktu acuan sinyal, bukan membeli pada
harga close yang tertulis di dropdown. Tidak ada order broker.

Pada snapshot yang diuji, hasil **T+1** adalah:

| Sinyal | Entry berikutnya | Harga entry | Exit T+1 | Harga exit | Net P&L |
| --- | --- | ---: | --- | ---: | ---: |
| 1 September | 2 September | Rp4.930 | Close 2 September | Rp4.840 | -Rp182.555,78 |
| 2 September | 3 September | Rp4.860 | Close 3 September | Rp5.050 | +Rp383.809,55 |

Modal akhir **Rp10.201.253,77**, net P&L **Rp201.253,77**, return **2,01%**.
Quantity pecahan diperbolehkan dalam simulasi: entry pertama sekitar 2.028,397566
unit. Ini tidak memodelkan aturan lot broker/bursa.

Bandingkan tabel horizon:

| Horizon | Closed trade | Modal akhir pada snapshot uji | Penjelasan |
| --- | ---: | ---: | --- |
| T+1 | 2 | Rp10.201.253,77 | Kedua entry dapat dipakai pada sesi yang berbeda. |
| T+2 | 1 | Rp10.243.407,71 | Posisi pertama menempati sesi sampai close 3 September; entry kedua dilewati. |
| T+3 | 1 | Rp9.939.148,07 | Posisi pertama exit close 4 September; entry kedua tetap dilewati. |

Setiap horizon memulai portfolio tersendiri dari Rp10 juta. Hasil horizon tidak
dijumlahkan. Buka **Skipped entries** pada T+2/T+3: alasan entry kedua adalah
**Another position was open**. Hasil yang rugi tetap keluaran simulasi yang valid.
Data provider dapat direvisi; nilai di atas adalah bukti snapshot 27 Oktober,
bukan jaminan angka tidak akan berubah pada unduhan mendatang.

### B. Jelaskan hasil, CSV dan riwayat

1. Pilih T+1. Jelaskan realized P&L, equity dan win rate 50% dari dua trade closed.
2. Gerakkan slider grafik **Inspect daily equity**. Grafik memuat nilai harian
   snapshot, termasuk prefiks warmup yang bisa terlihat datar sebelum transaksi.
3. Pilih **Export trades CSV**. Seluruh transaksi horizon terpilih diekspor,
   termasuk baris pada halaman tabel lain. **Export horizons CSV** memuat semua horizon.
4. Reload halaman, lalu buka arsip **Manual · ... · 2026-09-01–2026-09-30**.
   Pastikan terlihat **Saved result · read-only**, mata uang IDR dan konfigurasi
   tersimpan pada **Run configuration & source**. Form di bagian atas adalah
   konfigurasi untuk run baru; membuka arsip tidak memulihkan grant lama.

### C. Rule: tunjukkan alur otomatis

Pilih **Rule → Default Scalping**, universe dan rentang September yang sama,
modal Rp10 juta, horizon 3 dan biaya nol. Tekan **Run backtest**.

Pada pengujian akun asli, T+1/T+2/T+3 menghasilkan masing-masing **14/7/5 closed
trades**. T+3 berakhir sekitar **Rp9.200.844,90**, return **-7,99%**, dengan 17
entry dilewati. Tunjukkan bahwa aplikasi membantu mengevaluasi rule, termasuk
ketika hasilnya rugi. Nama Default Scalping tidak mengubah timeframe backtest:
tahap ini tetap **harian**. Jangan mengubah rule hanya untuk menjanjikan hasil profit.

Jika hasil baru tidak persis sama, periksa sumber/versi, rentang, biaya, sizing,
definisi rule dan data provider. **No trades** adalah hasil yang valid, berbeda
dengan error provider, akses ditolak, atau checksum tidak cocok.

### D. Admin: demonstrasikan proses review

1. Buka **Administration → Admin Panel** dari sidebar.
2. Cari email akun demo yang disepakati, pilih akun dan periksa kembali penerimanya.
3. Pilih **Feature access → Backtest → 7 days**, lalu tulis alasan.
4. Tekan **Review access grant** dan tunjukkan penerima, tanggal/jam expiry lokal
   serta alasan. Untuk latihan pada akun asli, pilih **Cancel**.
5. **Confirm change** benar-benar menulis grant. Tekan hanya saat memang ingin
   memberikan akses kepada penerima tersebut. Tidak perlu mengubah **Account role**
   untuk memberikan fitur Backtest; role Operator mengatur kewenangan admin.

Paket/subscription dan direct grant adalah sumber akses yang terpisah. Mencabut
satu direct grant belum tentu menutup akses jika paket masih menyediakannya.
Directory menampilkan profil aplikasi; anggota baru biasanya perlu login sekali.

## 4. Cara kerja yang perlu dikuasai sore ini

```text
Login + app session + hak Backtest + universe milik pengguna
                    ↓
Go API menyediakan snapshot candle + versi + checksum
                    ↓
   Manual: pilih candle       Rule: Go/WASM hitung indikator
             │                       ↓
             │              grant + private scoring Go API
             └───────────────┬───────┘
                             ↓
        Go/WASM menyimulasikan tiap portfolio T+1…T+n
                             ↓
             Transaksi, metrik, grafik, CSV, riwayat lokal
```

Backtest rule menggunakan batch REST `POST /api/v1/backtests/signals` per simbol;
screener memakai jalur WebSocket tersendiri. Indikator dan simulasi portfolio
berjalan di worker Go/WASM. Server memvalidasi akses/scope dan menjalankan rule
privat. WASM dapat dianalisis; jangan menyatakan arsitektur ini kebal reverse
engineering atau bahwa data fitur client merupakan bukti transaksi authoritative.

Istilah yang perlu bisa dijelaskan:

- **T+1:** close candle entry; bukan satu hari kalender setelah entry.
- **Realized / unrealized:** P&L trade tertutup / nilai posisi yang masih terbuka.
  Jika data exit belum cukup, posisi tidak dipaksa ditutup lebih awal.
- **Drawdown:** penurunan equity dari puncak harian, termasuk nilai posisi terbuka.
- **Win rate:** win dibagi jumlah closed trade; tanpa closed trade tampil `—`.
- **Profit factor:** total profit net dibagi absolut total loss net; jika loss nol
  tampil `—`. Satu win saja bukan bukti strategi sudah tervalidasi.
- **Expectancy:** rata-rata net P&L per closed trade. Bukan prediksi profit berikutnya.
- **Average closed return:** rata-rata persen return trade, berbeda dengan return
  portfolio yang dipengaruhi ukuran posisi dan compounding.

Latihan sekitar 40 menit: 10 menit ulangi manual; 10 menit bandingkan horizon dan
skipped entries; 10 menit jalankan rule/CSV/buka arsip; 10 menit review admin lalu
Cancel serta ceritakan kembali alur di atas.

Cek pemahaman: mengapa sinyal 2 September dilewati pada T+2? Jawaban: entry-nya
menginginkan open 3 September, ketika posisi pertama masih aktif sampai close.

## 5. Batas demo dan jalur cadangan

- Fokus pada backtest harian long/holding period dan manajemen akses. Intraday
  backtest, short, TP/SL, exit-rule, history lintas perangkat dan jurnal server
  tidak termasuk tahap ini.
- Komisi/slippage nol adalah pilihan contoh, bukan klaim transaksi nyata bebas biaya.
  Corporate action, likuiditas, pajak, lot size dan fill broker belum dimodelkan.
- Jika provider sementara gagal, tampilkan error yang sebenarnya; gunakan arsip
  bila API/akses masih tersedia, atau CSV/screenshot lokal bila jaringan/API mati.
  Sebutkan bahwa itu hasil tersimpan, bukan run live yang baru.
- Jangan menghapus site data/profil browser sebelum presentasi: arsip lokal bisa hilang.
- Enam warning format pada file lama tidak memengaruhi keberhasilan tes/runtime;
  jangan menyebut seluruh pemeriksaan format repository sudah bersih.

Referensi: [kontrak/kebijakan backtest](backend/BACKTESTING.md),
[panduan frontend](../frontend/web/README.md),
[progres backend](backend/BACKEND_PROGRESS.md).
