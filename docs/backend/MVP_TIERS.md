# Paket MVP SignalGen — 10 November 2026

Keputusan produk pengguna, mengikuti arahan Prof untuk membedakan paket berdasarkan fitur. Nama, harga dan kuota berikut merupakan keputusan produk, bukan kutipan persetujuan harga dari Prof. Dokumen ini menggantikan deskripsi lama Free sebagai demo-only dan Analyst sebagai paket backtest.

| Kemampuan | Free | Analyst | Pro |
| --- | --- | --- | --- |
| Harga satu bulan | Rp0 | Rp49.000 | Rp99.000 |
| Screening | Rule sistem | Sistem dan pribadi | Sistem dan pribadi |
| Saham per screening | 1–3 | 1–10 | 1–10 |
| Interval | Harian (`1d`) | `1m`, `5m`, `15m`, `1h`, `1d` | Sama |
| Rule pribadi | 0 | 10 | 50 |
| Universe tersimpan | 1 | 5 | 20 |
| Backtest | Contoh statis berlabel | Contoh statis berlabel | Analisis historis tersedia |
| Jurnal | Simpan/baca Match sendiri dengan receipt server | Sama | Sama |

Satu universe memakai satu pasar/mata uang: IDX/IDR atau AS/USD. Dukungan interval tetap bergantung provider. Pembaruan Yahoo berkala, bukan feed real-time berlisensi. Match tidak menjamin transaksi atau keuntungan.

## Sumber akses

`internal/subscription/policy.go` menjadi definisi kebijakan produk. `ReadAccess` membaca status akun, subscription aktif dalam periode yang berlaku, dan grant operator yang belum dicabut/kedaluwarsa. `account.Features`, pemeriksaan fitur, kuota transaksional, account API dan usage memakai resolver tersebut. Harga dan batas katalog paket diturunkan dari definisi yang sama.

Tidak ada subscription berbayar yang berlaku berarti Free untuk akun aktif. Status suspended, bearer, sesi aplikasi dan ownership tetap diperiksa. Grant operator adalah pengecualian eksplisit: label paket tetap Free/Analyst/Pro yang sebenarnya, `source=manual_grant` menjelaskan pengecualian. Grant screener lama mempertahankan 10 saham, interval lengkap dan kapasitas Analyst; tidak otomatis mendapat backtest. Grant backtest mempertahankan hak backtest dan kapasitas historis, tanpa membuka screening pribadi/intraday jika tidak ada hak screener berkapasitas tersebut.

`GET /api/v1/account/me` mempertahankan field lama dan menambah `access={plan_code,source,features,limits,screening}`. `GET /api/v1/subscription` juga mengembalikan akses efektif meskipun `subscription:null`. `/subscription/usage` mengembalikan `access`, `limits`, `used`. `/subscription/plans` memuat `pricing={amount,currency,period,activation}` dan `screening`.

## Batas server

Persiapan dataset membaca universe milik pengguna dari server sebelum provider dipanggil. Manifest/content memeriksa batas snapshot tersimpan, bukan jumlah simbol dari JSON client. Compute grant, socket ticket, upgrade dan setiap batch evaluasi memeriksa rule/timeframe/simbol snapshot serta akses terkini. Grant/snapshot lama bukan bukti akses paket masih berlaku. Downgrade yang terdeteksi monitoring menghentikan run; pilihan dan hasil terakhir tetap tersedia, lalu pengguna memilih konfigurasi Free dan Start ulang.

Fitur premium: `403 FEATURE_NOT_INCLUDED`. Batas jumlah saham/interval/kapasitas: `403 PLAN_LIMIT_EXCEEDED`. Sesi kedaluwarsa, suspended, resource milik orang lain dan layanan gagal tetap mempunyai kode terpisah. Respons WebSocket memakai kode yang sama tanpa mengubah protokol/engine.

Create/update resource memakai transaksi dan lock per owner. Free tidak menulis rule pribadi dan universe dibatasi tiga saham. Read/delete resource lama tidak hilang saat downgrade, termasuk arsip backtest; upload backtest baru tetap premium. Jurnal tetap append-only hasil Match dengan receipt terikat akun/sesi, retry idempotent. Tidak ada konversi transaksi manual atau perubahan ledger.

## Onboarding dan aktivasi

1. Daftar/login dan buat sesi aplikasi seperti biasa. Akun aktif otomatis Free; tidak perlu grant operator untuk mencoba.
2. Buka **Stock universes**, pilih sendiri satu sampai tiga saham dalam satu pasar, beri nama dan simpan. Tidak ada universe otomatis.
3. Buka **Screener**, pilih rule sistem dan universe. Free memakai candle harian. Klik Start; Stop mempertahankan hasil.
4. Match yang memiliki receipt server dapat dipilih, direview di jurnal lalu disimpan. No match adalah hasil sah, bukan error.
5. **Plan & access** dan halaman harga memuat katalog backend. **Ajukan aktivasi** membuka petunjuk menghubungi operator dengan email akun dan paket pilihan; tombol tidak mengirim pembayaran/pesan atau otomatis mengaktifkan paket.
6. Operator mengaktifkan satu bulan melalui alur audit yang sudah ada. Tanggal akhir tampil pada subscription. Tidak ada checkout otomatis, pilihan tahunan, trial, priority support/data atau perpanjangan otomatis.
7. Saat periode berakhir, akun kembali Free. Rule/universe di atas kuota tetap terbaca dan bisa dibersihkan. Untuk penggunaan baru, kurangi universe menjadi tiga saham/pakai baseline atau ajukan aktivasi.

## Rollout dan rollback

Migration `20261110042833_mvp_tier_access.sql` mengubah deskripsi/mapping paket: Free+Analyst screener; Pro screener+backtest. Subscription Pro/periode/data pengguna tidak diubah. Analyst aktif yang ditemukan saat rollout memperoleh grant backtest kompatibilitas sampai akhir periode yang telah diberikan, dengan audit; revoked grant lama tidak dihidupkan melewati periode itu.

1. Uji pada database sementara, termasuk Analyst/grant revoked, kuota bersamaan, ownership dan expired/suspended.
2. Jalankan API baru dan verifikasi `/api` versi **0.19.0**, `/ready`, respons akses dan penolakan batas. API baru aman dengan mapping lama karena definisi produk sudah terpusat.
3. Baru terapkan migration cloud dan periksa mapping serta fingerprint subscription sebelum/sesudah.
4. Jika rollback API: hapus mapping `free/screener` terlebih dahulu dan pulihkan mapping Analyst bila perlu; jangan hapus grant, subscription atau data pengguna. UI/API lama tidak menjadi target perilaku Free baru.

Engine/WASM dan protokol scoring tetap pada versi yang ada. Tidak ada migrasi candle/jurnal dan tidak ada perubahan kunci enkripsi.

## Pengujian yang dapat diulang

Dari `backend`: `go test -race ./...` dan `go vet ./...`. Untuk transaksi/migration, jalankan `MVP_TIER_TEST_DATABASE_URL` hanya pada database disposable bernama `signalgen_tiers_test`, dengan auth stub dan seluruh migration. Test menolak nama database lain. Jangan memakai `.env` cloud.

Dari `frontend/web`: `npm test`, `npm run typecheck`, `npm run build`, lalu `node scripts/test-browser.mjs --tiers` (dengan Playwright CLI). Fixture tiers memakai akun/API/keputusan sintetis, tidak menghubungi Yahoo atau Supabase. Suite monitor/backtest/usability yang ada tetap menjadi regresi jalur Go/WASM dan UI. Hasil fixture berbeda dari smoke test akun/provider asli; lihat laporan penyerahan untuk bukti yang benar-benar dijalankan.

Bukti pelaksanaan dan batas pengujian: [MVP_TIER_VALIDATION.md](MVP_TIER_VALIDATION.md).
