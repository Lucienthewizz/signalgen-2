# Verifikasi paket MVP — 10 November 2026

Branch `frontend/mvp-tier-access`. Acuan: [MVP_TIERS.md](MVP_TIERS.md). API **0.19.0**; engine `core-0.5.0` dan protokol `screener-private-1` tidak berubah.

## Pengujian yang lulus

- Go/race seluruh paket dan `go vet ./...`, termasuk database opt-in pada dua database disposable loopback.
- OpenAPI, local-reference contract dan JSON socket schema; `swagger-cli validate backend/openapi.yaml`.
- **242 tes frontend**, TypeScript dan build Vite.
- Browser tiers: onboarding kosong tanpa modal, pilihan tiga saham, saham keempat/interval premium dibatasi, baseline ke jurnal, preview Free/Analyst tanpa request komputasi premium, petunjuk aktivasi.
- UI Free: ringkasan di Screener/sidebar normal dan diciutkan, 1440/390px; screenshot diperiksa. Sidebar tidak mengulang label paket pada tombol profil.
- Browser usability: hasil tetap terlihat saat refresh/gagal, error inline dan dialog atas permintaan, jurnal receipt-only, retry hanya baris gagal, paging.
- Browser monitoring: Start/Stop, WASM asli, dedup, candle baru, cancel/navigasi, desktop/mobile.
- Browser backtest: Go/WASM, simulasi/arsip/CSV, batas penyimpanan, isolasi akun, preview setelah downgrade dengan riwayat tetap terbaca.

Database fixture menguji delapan pembuatan universe bersamaan (tepat satu Free berhasil), batas rule Analyst, ownership dua pengguna, expiry/revoke/suspension, serta pembacaan/pembersihan setelah downgrade. Konflik versi diuji dengan pool satu koneksi untuk memastikan transaksi tidak menunggu koneksi kedua.

Migration diuji berulang dengan Analyst aktif dan grant revoked: kompatibilitas tidak diperpanjang melewati hak periode berbayar dan audit tidak berganda. API/Postgres dengan role runtime terbatas, provider sintetis dan WASM asli memproses tiga seri / 243 kandidat dan keputusan untuk fixture Free. Match terbaru mendapat receipt; retry menyimpan satu jurnal, akun lain ditolak. Ini bukti integrasi deterministik, bukan hasil pasar atau kapasitas produksi.

Test HTTP/socket memeriksa batas pada ticket, upgrade dan batch sesudah downgrade, termasuk grant yang diterbitkan saat Pro. Dataset/compute memblokir intraday, saham keempat dan rule pribadi sebelum fetch/grant. Kode penolakan socket tetap berbeda dari jaringan gagal.

## Cloud dan smoke akun asli

Backend dengan kebijakan baru dijalankan dan `/api` 0.19.0 serta `/ready` diperiksa sebelum mapping Free diaktifkan. Migration **20261110042833_mvp_tier_access.sql** sinkron dengan cloud. Mapping hasil: Free/Analyst screener; Pro screener dan backtest.

Dua subscription mempunyai fingerprint identik sebelum/sesudah migration; tidak ada Analyst aktif saat preflight. Hak Analyst lama dibuktikan dengan fixture. Periode/subscription Pro cloud tidak diubah. Tidak ada migrasi candle, penghapusan data pengguna, perubahan kunci enkripsi, atau `.env` yang diserahkan.

Login Free dan penyimpanan universe **Uji Free MVP — 3 saham IDX** (BBCA, BBRI, TLKM) diamati melalui UI; saham keempat dinonaktifkan. Pengguna menjalankan screening Yahoo dan melaporkan **No match**. Tidak mengklaim Match/jurnal dari harga asli; bukti positifnya berasal dari fixture di atas. Universe uji tetap tersedia untuk diedit pengguna.

## Batas bukti dan alat

Browser fixtures memakai identitas/API/provider/keputusan sintetis sesuai suite dan memblokir koneksi eksternal. Suite monitoring/backtest serta integrasi Postgres menggunakan WASM asli secara terpisah. Desktop/mobile memakai tema aktif gelap; CSS light yang dipertahankan juga dipaksa sebagai regresi, bukan penambahan kontrol tema.

UI menggunakan skill frontend-design dan ui-ux-pro-max, komponen/token yang ada, dan Playwright CLI. Penelusuran struktur memakai codebase-memory dengan coverage dan fallback pembacaan sumber; Context7 dipakai untuk pgx. Skill impeccable, apple-design, shadcn dan executable DESIGNmd tidak tersedia di sesi ini dan tidak diklaim dijalankan/dipasang. Tidak ada dependensi UI baru.

Aktivasi berbayar tetap melalui operator. Ajukan aktivasi membuka petunjuk, tidak mengirim pembayaran/pesan atau mengaktifkan paket otomatis. Tidak ada klaim kapasitas ribuan pengguna, feed real-time berlisensi, atau smoke akun Analyst/Pro asli baru.

Rebuild Docker sempat timeout saat unduhan modul melalui jaringan BuildKit. Dockerfile kini menyimpan hasil `go mod download` sebagai layer terpisah agar perubahan source tidak mengunduh dependensi ulang. Tidak ada proxy/key yang dimasukkan ke image atau repository.

Rebuild akhir berhasil dengan `docker build --network=host --file backend/Go.Dockerfile --target api-runtime --tag signalgen-2-go-api .`; flag host hanya untuk jaringan build, bukan jaringan container aplikasi. Layanan diaktifkan memakai Compose. Upaya refresh indeks graph pada akhir sesi mengalami `Transport closed`; verifikasi akhir tetap memakai sumber/diff dan tes di atas.
