# Dukungan saham Amerika Serikat

Permintaan pengguna 19 Oktober 2026: tambahkan saham AS ke web aktif. Ini perluasan
bertahap, bukan akses harga real-time atau cakupan seluruh venue AS/OTC.

- Katalog 20 pilihan awal **sudah diperluas**: impor 19 Oktober 2026 menerima
  **5.600 listing** (3.439 Nasdaq `XNAS`, 2.161 NYSE `XNYS`), seluruhnya USD.
  Seluruh row dari dua direktori diproses; tidak ada batas 20/100 pilihan manual.
  Bukan rekomendasi investasi atau jaminan seluruh ticker mempunyai OHLCV Yahoo.
- Metadata listing diperiksa dari direktori resmi [Nasdaq Trader](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs):
  `nasdaqlisted.txt` dan `otherlisted.txt` pada 19 Oktober 2026. Metadata katalog
  harus diperbarui operator bila listing berubah, bukan mengambil harga ribuan
  saham saat login. Cakupan ini Nasdaq/NYSE, bukan NYSE American/Arca, OTC atau
  semua instrumen keuangan AS. `ETF=Y`, `Test Issue=Y`, deskripsi preferred/debt,
  waran, rights, units, serta simbol unsupported dilewati dengan hitungan alasan.
  Filter deskripsi/simbol adalah heuristik konservatif, bukan klasifikasi CFI
  resmi; ADR, saham biasa/ordinary dan saham REIT dapat diterima.
- Yahoo Finance tetap adapter OHLCV. Simbol AS dikirim tanpa `.JK`; kelas saham
  memakai `BRK-B`. Range `6mo`, interval `1d`, maksimal 100 candle terakhir yang
  valid, minimal 20. Timestamp disimpan UTC, bukan zona waktu bursa Indonesia.
- Satu universe tetap 1–10 simbol, **satu pasar/mata uang**. IDX dan AS tidak boleh
  digabung dalam satu universe; Nasdaq dan NYSE boleh digabung karena sama-sama
  pasar AS/USD. Backend memvalidasi simbol aktif dan metadata katalog sebelum
  membuat membership/snapshot. Tidak ada konversi IDR/USD.
- Manifest/content menyatakan `market: US`, `currency: USD`. Field tambahan
  `exchanges` pada manifest paralel dengan `symbols` untuk chart Nasdaq/NYSE;
  fixture lama boleh tidak memuatnya. Cache AES-GCM/checksum tetap berlaku.
- Indikator RSI/EMA dan private scoring Model A tidak berubah. Rule dengan ambang
  PRICE/EMA numerik harus disesuaikan pengguna terhadap mata uang universe.
- UI: buat universe → pilih **Amerika Serikat · Nasdaq/NYSE · USD** → pilih saham
  → simpan → pilih universe itu di screener. Tabel/CSV/detail menampilkan USD.
  Watchlist AS memakai `US:AAPL` agar tidak bertabrakan dengan kode IDX lama.
  Chart BRK-B memakai `NYSE:BRK.B`. Chart pihak ketiga bukan snapshot authoritative.

Migration `20261019025014_add_us_stock_catalog.sql` memperluas constraint katalog
dan menambah 20 row secara add-only. Sebanyak 962 row IDX tetap ada. Ownership,
grant/session/entitlement, RLS dan exposed schema Supabase tidak diubah. Cloud
migration version sudah dicocokkan dengan file repo; tidak perlu menjalankannya
ulang pada project yang sudah mencatat version tersebut.

## Memperbarui katalog tanpa mengubah batas screening

Tool operator baru `backend/cmd/importus` memvalidasi **seluruh** file resmi:

```sh
cd backend
go run ./cmd/importus -report /path/to/new-us-catalog-report.json
# Tambahkan -apply hanya dengan SUPABASE_ADMIN_DB_URL di environment server.
go run ./cmd/importus -apply
# Alternatif offline: tambahkan -nasdaq /path/nasdaqlisted.txt -nyse /path/otherlisted.txt
```

Default dry-run tidak membaca credentials atau membuka koneksi DB. Unduhan hanya
dua HTTPS URL tetap, dengan timeout, tanpa redirect, batas 8 MiB/file dan 30.000
row/file. Header/footer, flag, nama, pasangan currency/exchange, duplikasi dan
normalisasi `BRK.B` → `BRK-B` diverifikasi sebelum write. Report memuat timestamp
pengambilan, creation time sumber, SHA-256, accepted/skipped dan metadata hasil.
File report harus baru; tool menolak overwrite. Report ini bukan secret, tetapi
artifact lokal tidak perlu dimasukkan Git.

`ImportUSCatalog` memakai satu parameterized batch INSERT dan `ON CONFLICT DO
NOTHING`: tidak menghapus, mengaktifkan ulang atau mengganti metadata lama,
tidak menulis universe pengguna, dan tidak memberikan hak akses. Katalog IDX
tetap dipertahankan. Tidak ada perubahan schema/migration/RLS untuk perluasan ini.
Delisting/rename perlu review operator terpisah; additive refresh bukan sinkronisasi
keanggotaan bursa secara otomatis. Jangan pakai runtime DB role untuk impor.

### Bukti sumber impor 19 Oktober 2026

Diambil 03:07:52 UTC; kedua file ber-footer `1016202621:31` (waktu sumber tanpa
asumsi timezone tambahan). Penjumlahan accepted + semua skipped sama dengan row
sumber; tidak ada saham dibuang hanya untuk mempertahankan angka 20.

| File | Row | Diterima | Dilewati |
| --- | ---: | ---: | --- |
| nasdaqlisted.txt | 5.634 | 3.439 | 1.296 ETF; 891 deskripsi non-equity; 8 test |
| otherlisted.txt | 7.674 | 2.161 | 4.752 di luar Nasdaq/NYSE; 79 ETF; 647 deskripsi non-equity; 29 test; 6 simbol unsupported |

SHA-256 sumber Nasdaq: `9f5c42346e6ab594a9e16bed99757e38cda89645c776b987626c9f51813bc99b`.
SHA-256 sumber otherlisted: `cb31dccc5b4ac680fb9170552d3b479c9f6fe21aae5c32ab21615b5fc8a78012`.

Supabase cloud telah menerima 5.580 row tambahan (20 sebelumnya dipertahankan).
Verifikasi pasca-impor: 5.600 AS aktif + 962 IDX aktif, RLS ketiga tabel
katalog/universe/member tetap aktif; role runtime dan authenticated tetap tidak
memiliki izin INSERT katalog. Tidak ada migration tambahan yang diperlukan.

Frontend mengambil metadata katalog melalui endpoint privat yang sama, memakai
pencarian seluruh katalog dan maksimum 12 tombol per halaman. Unit/browser test
mencakup ribuan entri sintetis, pemilihan 3/10 dan penolakan pilihan ke-11. Data
harga tetap diminta hanya untuk 1–10 anggota universe saat prepare screening;
historis/cache terenkripsi dan private scoring tidak berubah.

Verifikasi lokal: migration/RLS pada Postgres disposable, API ownership, unit
isolasi pasar, histori/cache USD, dan test browser sintetis. Live Yahoo smoke
memverifikasi AAPL/MSFT/BRK-B masing-masing 100 candle: 27 Mei–16 Oktober 2026,
dengan timestamp pembukaan sesi 13:30 UTC pada sampel ini. Bukan janji seluruh
ticker katalog selalu tersedia atau SLA provider. `SIGNALGEN_TEST_YAHOO_LIVE=1` mengaktifkan
tes jaringan opt-in; CI default tidak mengambil harga live.

Keamanan di luar scope: advisor Supabase masih melaporkan leaked-password protection
Auth nonaktif ([panduan](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).
Tidak diaktifkan otomatis oleh fitur pasar AS. Arsip `legacy` tetap deny-by-default
melalui RLS tanpa policy; tidak dibuka sebagai efek samping.

## Uji akun asli setelah perbaikan manifest (19 Oktober 2026)

Frontend kini membaca `GET /api/v1/datasets/{id}/manifest`, sesuai OpenAPI dan
route Go. URL tanpa `/manifest` bukan alias yang tersedia. Tes kontrak membaca
OpenAPI dan pendaftaran route Go; mock browser mengembalikan 404 untuk URL salah,
bukan menganggap setiap URL dataset sebagai manifest.

Uji melalui akun asli dan Yahoo Finance, bukan mock API: universe uji baru berisi
AAPL/MSFT/BRK-B berhasil screening (243 kandidat, satu koneksi private scoring).
Universe uji yang sama kemudian diperluas menjadi 10: AAPL, MSFT, BRK-B, NVDA,
AMZN, META, TSLA, GOOG, GOOGL dan COST (810 kandidat, satu koneksi). Pilihan ke-11
nonaktif. Universe/rule lama tidak diubah, entitlement tidak ditambahkan.

Kedua run memakai snapshot harian 27 Mei–16 Oktober 2026, USD, kualitas
`complete`, dengan rule yang sudah ada `RSI14 < 30`. Semua keputusan terakhir
`Tidak memenuhi` konsisten dengan nilai RSI sampel, bukan error screening
(misalnya NVDA 37,52 tidak kurang dari 30). Ini bukan harga real-time, rekomendasi
investasi, benchmark kapasitas, atau bukti semua 5.600 ticker sudah diuji OHLCV.

Regresi cache IndexedDB/AES-GCM dan browser AS juga lulus pada konteks browser
uji yang terpisah; tes sintetis tidak menggantikan verifikasi akun asli di atas.
