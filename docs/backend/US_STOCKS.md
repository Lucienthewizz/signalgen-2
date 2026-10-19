# Dukungan saham Amerika Serikat

Permintaan pengguna 19 Oktober 2026: tambahkan saham AS ke web aktif. Ini perluasan
bertahap, bukan klaim semua bursa/seluruh saham AS atau akses harga real-time.

- Katalog awal 20 saham: AAPL, ADBE, AMD, AMZN, AVGO, BAC, BRK-B, DIS, GOOGL,
  JPM, KO, MA, META, MSFT, NFLX, NVDA, QCOM, TSLA, V, XOM. Sebanyak 12 Nasdaq
  (`XNAS`) dan 8 NYSE (`XNYS`), seluruhnya USD. Bukan rekomendasi investasi.
- Metadata listing diperiksa dari direktori resmi [Nasdaq Trader](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs):
  `nasdaqlisted.txt` dan `otherlisted.txt` pada 19 Oktober 2026. Pilihan awal
  ini bukan katalog lengkap dan perlu dipelihara bila listing berubah.
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

Verifikasi lokal: migration/RLS pada Postgres disposable, API ownership, unit
isolasi pasar, histori/cache USD, dan test browser sintetis. Live Yahoo smoke
memverifikasi AAPL/MSFT/BRK-B masing-masing 100 candle: 27 Mei–16 Oktober 2026,
dengan timestamp pembukaan sesi 13:30 UTC pada sampel ini. Bukan janji seluruh
20 ticker selalu tersedia atau SLA provider. `SIGNALGEN_TEST_YAHOO_LIVE=1` mengaktifkan
tes jaringan opt-in; CI default tidak mengambil harga live.

Keamanan di luar scope: advisor Supabase masih melaporkan leaked-password protection
Auth nonaktif ([panduan](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).
Tidak diaktifkan otomatis oleh fitur pasar AS. Arsip `legacy` tetap deny-by-default
melalui RLS tanpa policy; tidak dibuka sebagai efek samping.
