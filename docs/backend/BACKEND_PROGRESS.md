# Backend progress

## Pemeriksaan demo dengan akun asli — 27 Oktober 2026

Uji browser langsung memakai akun yang diloginkan pengguna pada aplikasi lokal,
tanpa fixture API: manual/rule backtest pada tiga saham IDX, snapshot provider
terkonfigurasi, next-open, perbandingan T+1…T+3, CSV, reload dan pembukaan arsip
berhasil. CSV manual dua entry ASII dicocokkan dengan UI sampai Rp0,01; hasil
T+1 Rp10.201.253,77 dari modal simulasi Rp10 juta. Ini bukti pada snapshot uji,
bukan benchmark produksi atau validasi strategi investasi.

Admin asli diuji sampai pencarian/pemilihan akun sendiri, preset Backtest tujuh
hari dan review → Cancel; tidak ada perubahan grant akses anggota, role, atau
subscription. Write grant/revoke tetap diperiksa pada Playwright dengan akun/API
sintetis. Preflight delapan pemeriksaan dan regresi sepuluh halaman workspace
(dua viewport × dua tema), 187 tes frontend, build, serta regresi admin lulus.
Browser langsung tidak merekam error pada pemeriksaan log terakhir.

Temuan: Plan & access masih mengunci label Backtest pada “Not available yet”, dan
tes browser lama justru mengharuskan label tersebut. Label/deskripsi diperbaiki
untuk fitur yang sudah tersedia, dengan tes paket aktif dan kedaluwarsa. Batas
otorisasi API tidak berubah. Referensi `backtest-1` pada README frontend juga
dibetulkan menjadi `backtest-2`.

[Panduan latihan dan demo 28 Oktober](../DEMO_BACKTEST_ADMIN_2026_10_28.md)
memuat urutan presentasi, angka contoh, penjelasan arsitektur/metrics, preflight
dan cadangan ketika jaringan/provider bermasalah. Screenshot dan CSV lokal tidak
masuk Git. Masa paket yang terlihat pada akun demo saat pengujian sampai 25
November 2026; periksa ulang sebelum presentasi. Warning format enam file lama
di luar perubahan ini tetap terbuka.

## Backtest schema 2, analisis dan riwayat lokal — 27 Oktober 2026

Branch `frontend/backtest-analysis` menambahkan statistik closed-trade net
(expectancy, average profit/loss, average return, rasio average profit/loss) dan
`by_symbol` dari accepted trades portfolio. Win rate tanpa closed trade menjadi
null. Schema berubah ke `backtest-2`; policy `holding-next-open-1`, kontrak
screener, next-open, sizing/fee dan posisi terbuka dipertahankan.

UI membandingkan seluruh horizon (10 baris/halaman), grafik equity SVG dengan
slider keyboard/touch, ringkasan saham, total biaya, tabel equity 25 baris/halaman,
CSV seluruh transaksi/horizon dan bulk manual dengan validasi atomik nomor baris.
Arsip menyimpan hasil/config/currency/provenance tanpa candle/credential/rule privat.
IndexedDB terpisah mempertahankan maksimal 10 run / 50 MiB per akun, termasuk
setelah logout sesuai pilihan pengguna; pembukaan memverifikasi akses, tanpa
provider/scoring ulang. Arsip read-only terpisah dari snapshot aktif, dengan
hapus satu/semua yang dikonfirmasi. Quota/abort/corrupt storage tidak menghilangkan
hasil aktif atau mengklaim persistence berhasil.

Verifikasi: seluruh `go test ./...`, 187 tes frontend, typecheck/build,
fixture formula Claudio, parity native/WASM (rule/manual, biaya, tanpa sinyal,
jam harian dan presisi subdetik) serta pemeriksaan marker rule privat lulus.
Playwright memakai aplikasi/WASM dan IndexedDB asli dengan akun/API sintetis:
bulk atomik, paging, download semua baris CSV, kegagalan save, persistensi
reload/logout, isolasi akun, late-save cancellation, corrupt archive, batas
10 run/50 MiB dan rollback quota. Backtest diuji 1440/390 pada kedua tema;
regresi admin lulus 1440/375 serta 844×390 pada kedua tema.

File yang diubah lulus Prettier; format-check global masih menandai enam file
lama yang tidak diubah (`screener-engine.ts`, `market-news.ts` dan empat stylesheet
workspace). Tidak ada migrasi/history server, jurnal authoritative, intraday,
short, TP/SL, exit-rule atau Sharpe. Bukan bukti akun/provider produksi diuji.

## UI/UX admin dan penemuan menu — 26 Oktober 2026

Kelanjutan `frontend/admin-access` memakai skill UI/UX Pro Max: directory anggota
dan pengaturan akses berdampingan pada desktop, lalu ditumpuk pada layar kecil.
Daftar anggota 10 per halaman dan ringkasan grant menggantikan tabel yang perlu
digeser di ponsel. Kontrol 44px, token tema, fokus validasi, dan urutan kerja
pemilihan anggota → pengaturan → review dipertahankan.

Menu **Administration → Admin Panel** memakai role/status dari account API.
Sebelumnya sidebar memakai respons identity login yang tidak memuat role aplikasi,
sehingga operator sah dapat kehilangan menu. State terikat user/session, respons
lama diabaikan, dan role dicek ulang pada navigasi/focus/perubahan role sendiri.
Menu mobile menutup setelah navigasi atau Escape. Endpoint dan izin backend tetap.

Verifikasi frontend mencakup 181 tes + build, Playwright admin melalui sidebar
dengan identity tanpa role, penolakan metadata role palsu/akun suspended, fokus
validasi, kontras token, kontrol 44px, serta desktop 1440, ponsel 375 dan landscape
844×390 pada kedua tema. Fixtures akun/API sintetis; bukan grant akun cloud nyata.

## Kemudahan pemberian akses admin — 26 Oktober 2026

Branch `frontend/admin-access`: panel admin yang ada kini mempunyai directory
profil dengan pencarian email/UUID, filter status, pagination 25 pengguna,
pemilihan langsung dan pemuatan grant otomatis. Preset akses 7/30/90 hari memakai
waktu lokal; email/UUID penerima ikut review sebelum grant/revoke dikirim. Reason,
konfirmasi, pemeriksaan operator database dan audit server tetap berlaku.
Pergantian identitas membersihkan target/review dan mengabaikan respons lama.

`GET /api/v1/operator/accounts` menerima filter `q` opsional, case-insensitive dan
literal (bukan SQL wildcard), maksimum 200 karakter. Tidak ada migration, perubahan
role/grant akun nyata, atau bootstrap operator dalam pekerjaan ini. Runtime API
Docker lokal dibangun ulang; database sementara untuk tes sudah dihapus.

Verifikasi: 181 tes frontend + build, seluruh Go race suite dan vet, serta schema
harness (11 migration/3 policy checks) dan tes PostgreSQL operator terisolasi.
Tes SQL memeriksa pencarian email/UUID, wildcard/injection literal, kontrol akses,
pagination dan atomicity status/sesi/audit. Playwright admin memeriksa search,
filter/paging, keyboard, grant/revoke/review/cancel, failed writes dan non-operator
di 1440/390px, kedua tema, dengan akun/API sintetis. Akun operator cloud nyata
belum digunakan untuk grant/revoke pada slice ini.

## UI pengujian backtest — 26 Oktober 2026

Branch `frontend/backtesting-workspace` menambahkan halaman `#app/backtest` untuk
rule BUY/manual, historical snapshot, konfigurasi sizing/biaya, hasil T+1…T+n,
transaksi tertutup/terbuka, skipped entries dan equity. Semua komputasi memakai
Go/WASM; evaluasi rule privat tetap memakai API backtest. Akses online dan versi
snapshot diperiksa ulang sebelum run; worker dihentikan saat cancel/unmount.
Snapshot/hasil hanya di memori halaman. Tidak ada perubahan API, schema database,
entitlement akun atau penulisan jurnal.

Verifikasi frontend: 179 unit/contract tests, build, Playwright backtest dan
regresi monitor dengan WASM asli, serta regresi workspace di 1440/390px, kedua
tema. Akun/data/API browser merupakan fixture sintetis; login/provider akun asli
belum diuji pada slice UI.
Runtime Docker Go lokal diselaraskan ke 0.12.0 dan artefak WASM lokal dibangun ulang.
[Panduan frontend](../../frontend/web/README.md#basic-backtesting-workspace-26-october-2026).

## Perbaikan readiness dan pengujian demo — 20 Oktober 2026

Branch `frontend/intraday-monitor`: pemeriksaan cloud dingin sebelumnya diputus
oleh batas handler/probe 2s dan Docker 3s. Sekarang memakai budget berurutan
8s / 9s / 10s; request API tetap dibatasi 10s. Pemeriksaan schema, RLS, role,
grants/policies dan dataset tetap aktif, bukan diganti liveness atau bypass.
Tidak ada migration/SQL write, perubahan kredensial, role atau entitlement.

Tes regresi mencakup dependensi sehat yang memerlukan >2s, penolakan 503 untuk
dependensi gagal, deadline parent 504, probe gagal koneksi, dan konsistensi
budget Docker. Seluruh Go race suite tanpa cache dan `go vet` lolos. Tes cloud
read-only dari pool dingin memverifikasi schema/RLS/izin runtime dalam 2,657s.
Backend hasil rebuild healthy, delapan preflight termasuk readiness lolos.

Pengujian akun asli melalui `http://localhost:5174`: rule RSI14 <30 berjalan
pada 3 saham IDX (300 candle 5m), 10 saham IDX (1.000 candle 5m), dan 10 saham
AS (880 candle 5m). WebSocket upgrade 101, hasil dikirim (`result_written`).
Hasil No match sesuai nilai RSI yang ditampilkan, bukan error. Stop mengosongkan
jadwal berikutnya dan mempertahankan hasil. Pada 10 saham AS interval 1m,
siklus kedua berjalan otomatis tanpa Start ulang: pemeriksaan 22:26:00 menjadi
22:27:10 WITA; candle terakhir bergeser dari 14:24 ke 14:25 UTC. Jadwal dihitung
setelah siklus selesai, bukan jaminan polling tepat pada detik yang sama.
Rule sistem juga diuji pada 10 saham AS 5m: pemeriksaan 22:28:35 WITA memakai
890 candle, menghasilkan BUY untuk AMZN/TSLA dan No match untuk delapan lainnya.
Ini keputusan rule pada snapshot tersebut, bukan transaksi broker atau jaminan
hasil investasi. Monitoring dihentikan setelah pengujian.
Tidak mengubah definisi rule atau universe tersimpan; grant/history dari
pengujian mengikuti alur screening normal.
Ini bukti demo lokal pada waktu pengujian, bukan jaminan layanan cloud/Yahoo
selalu tersedia atau uji seluruh ticker/interval/kapasitas produksi.

## Monitoring Start–Stop dan intraday — 20 Oktober 2026

Branch `frontend/intraday-monitor`: Start–Stop selama halaman terbuka, default
5m, pilihan 1m/5m/15m/1h/1d. Range intraday 3 hari kalender diperluas hanya bila
candle valid <20, maksimum 100 candle/saham dan 10 saham. Endpoint prepare
menerima timeframe opsional, default tetap harian bagi klien lama. Snapshot
intraday 5 menit, reuse owner-scoped dan cache terpisah per interval. Tidak ada
endpoint background Start/Stop, IBKR, Redis atau migration database.

Verifikasi lokal: 160 tes frontend + build; seluruh Go race suite dan `go vet`;
actual WASM parity 3 series; OpenAPI validation; browser workspace/catalog/
BUY-SELL/recovery dan monitor di 1440/390px serta kedua tema; 8 preflight layanan.
Smoke Yahoo 5m terpisah pada 20 Oktober: BBCA.JK 100 candle selesai, AAPL 78;
bukan bukti semua ticker/interval tersedia atau feed realtime berlisensi. Akun
asli end-to-end dan Postgres/RLS opt-in tidak diulang pada slice ini.

Kontrak OpenAPI 0.11.0, core-0.4.0, capabilities-3. API/WASM dibangun ulang
berpasangan, frontend tetap 5174. [Panduan dan batas](INTRADAY_MONITOR.md).

## Perbaikan regresi screening — 20 Oktober 2026

- JSON feature wajib lengkap/non-null; RSI 0 sah dibedakan dari RSI yang hilang.
- Pengambilan cache dingin dibatasi tiga saham paralel per batch, tetap memakai
  batas global upstream. Prepare dataset mendapat budget total 10 detik agar
  timeout menjadi error JSON sebelum write timeout; request batal tidak
  menerbitkan snapshot baru.
- Schema hasil selaras dengan BUY/SELL dan diuji menggunakan respons WebSocket
  aktual. Validasi candle core juga menolak NaN/Inf dan volume negatif.
- Tes regresi, seluruh Go race suite/actual WASM dan pemeriksaan frontend/build
  lulus lokal. Tidak ada migration cloud atau perubahan izin/akun pada slice ini;
  tes Postgres opt-in tidak diulang pada slice ini.

Rincian dan batas klaim: [validasi input dan timeout](SCREENER_INPUT_AND_TIMEOUTS.md).

## Checkpoint terbaru — 20 Oktober 2026

Branch aktif: `integration/backend-frontend-20261019`, melanjutkan merge frontend
`a1f5b12`. Perubahan yang diselesaikan pada slice hardening ini:

- Go module dan Docker memakai Go 1.27.2; dependensi jaringan `x/net` 0.60.0.
- Adapter Yahoo dan collector baru memfilter candle harian belum tutup, serta
  melaporkan null rows/finality fallback. Warning tidak hilang melalui cache/arsip.
- Readiness mencakup tabel, kolom, RLS dan izin workspace. Tidak ada migration
  cloud baru atau perubahan password/role/entitlement pengguna pada slice ini.
- Tes Postgres nyata memakai role runtime terbatas untuk persistensi workspace,
  isolasi dua pemilik, stale version dan satu pemenang dari delapan writer.

Bukti lokal: sebelas migration dan tiga pemeriksaan SQL pada Postgres 16 sementara;
seluruh Go race suite dengan Postgres/actual WASM, `go vet`, 151 tes frontend,
TypeScript/production build, lima tes preflight dan delapan pemeriksaan runtime
lolos. API Go yang dibangun ulang healthy di 8080; frontend/proxy di 5175.
Pemindaian API menemukan nol kerentanan terjangkau dan nol imported-package
findings; advisory module-only OpenPGP tidak digunakan, detail di hardening.
Ini bukan verifikasi production/load, feed resmi, atau demo ulang akun nyata.

Panduan: [kualitas candle harian](DAILY_DATA_QUALITY.md) dan
[keamanan/runtime](SECURITY_HARDENING.md). Jurnal transaksi backend, posisi/P&L,
policy backtest, kalender/corporate actions serta bukti efisiensi produksi tetap
pekerjaan terpisah. Warnings sudah dikirim API tetapi belum semuanya ditampilkan
oleh footer screener frontend; UI tidak diubah pada slice backend ini.

## Arsip checkpoint — 6 Oktober 2026

Bagian di bawah adalah catatan historis, termasuk branch, port, jumlah tes,
dan pekerjaan terbuka pada tanggal tersebut; bukan status terbaru.

Checkpoint aktif untuk persiapan asis 7 Oktober. Ini bukan klaim seluruh PRD,
penelitian atau deployment production selesai.

Branch: `feature/backend-web-integration`. HEAD: `b62e30c`, merge frontend
`1378033` dengan backend. Perbaikan hardening dan demo setelah merge masih
lokal, belum di-commit atau di-push; remote CI belum diverifikasi untuk perubahan ini.
Catatan lama dipertahankan di [arsip checkpoint](BACKEND_PROGRESS_HISTORY.md).

## Fitur yang sudah diimplementasikan

| Bagian | Implementasi aktif | Batas klaim |
| --- | --- | --- |
| Auth | Register/login/me, recovery dan refresh gateway Supabase | Otomatisasi refresh identity di frontend belum selesai |
| Account | Profile editable dengan version check; status/role/entitlement server-side | User tidak boleh mengubah izin lewat profile/metadata Auth |
| Session/device | Create, rotate, list, rename, revoke dan device limit | Tidak menggantikan bearer Supabase |
| Rules | System rule privat dan CRUD rule milik user, version/hash | Hanya subset indikator/operator yang didukung core |
| Universe/dataset | Katalog bersama, universe pribadi, historical provider/cache dan snapshot privat | Yahoo unofficial; bukan feed resmi IDX realtime |
| Screener Model A | Indikator Go/WASM di client, decision privat Go melalui WebSocket | Screening historis berbasis rule, bukan prediksi ML atau order broker |
| Subscription | Plans/state/cancel serta aktivasi dan grant oleh operator | Checkout/payment webhook belum ada |
| Operator | Metadata akun, role/grant/status, revoke sesi dan audit atomik | Tidak memberikan akses otomatis ke rule/dataset privat user |
| Infrastruktur | Gin, pgxpool, Supabase Postgres, readiness, OpenAPI dan telemetry aman | State ticket/limiter masih satu proses; production belum siap |

## Perbaikan untuk demo asis

- Orchestrator frontend menggabungkan kandidat seluruh series ke **satu grant,
  satu ticket dan satu WebSocket**. Tiga simbol tidak lagi membuka tiga socket
  yang melampaui batas dua socket per user. Batas server tetap dipertahankan.
- Jumlah dan urutan simbol/timestamp hasil diperiksa sebelum memasangkan
  keputusan dengan bukti indikator. Batal/empty/mixed-version batch ditolak.
- Status API dipantau ulang tanpa reload, sehingga form login dapat pulih
  setelah API dinyalakan kembali. Probe tidak tumpang tindih dan berhenti saat
  komponen dilepas.
- Bootstrap app-session bersamaan memakai satu request per tab/login. Respons
  lama tidak boleh memulihkan token setelah logout atau menghapus sesi login
  baru, termasuk jika bearer yang diberikan provider sama. Sesi revoked meminta
  login ulang; hanya GET/HEAD expired yang boleh diulang sekali, bukan mutation.
- UI profile kini memakai GET/PATCH backend dengan version check. Nama baru
  disimpan hanya setelah server berhasil; conflict 409 meminta reload. Avatar
  tetap lokal, editor bio belum dibuat. Nama rule/universe tampil pada pilihan
  screener, bukan ID internalnya.
- Harness load test memakai identitas/sesi berbeda per user. Sebelumnya seluruh
  simulasi memakai satu identitas sehingga penolakan limit per-user adalah benar.
  Tidak ada kenaikan batas akses production untuk meluluskan tes.
- `backend/scripts/demo_preflight.mjs` memeriksa health/readiness, versi proxy,
  kontrak, respons denial dan artifact WASM secara read-only. Tidak membaca `.env`,
  mengirim token atau membuat data.

## Database dan security

Delapan migration lokal cocok dengan history Supabase cloud pada 6 Oktober.
Runtime memakai role terbatas `signalgen_api`; kredensial migration/admin terpisah.
Readiness memeriksa akses tabel, policy dan sequence yang dibutuhkan runtime,
bukan hanya apakah koneksi Postgres berhasil.

Query pgx tetap wajib memfilter verified owner; koneksi backend tidak otomatis
mendapat konteks `auth.uid()` browser. RLS adalah defense in depth, bukan alasan
menghapus authorization service. Secrets/token tidak masuk Git atau laporan.

Advisor Supabase: satu WARN leaked-password protection belum aktif dan tiga INFO
RLS tanpa policy pada tabel arsip `legacy`. Info arsip dipertahankan deny-by-default;
peringatan EXECUTE helper publik lama sudah diperbaiki. Leaked-password protection
memerlukan paket Pro atau lebih tinggi; tidak ada perubahan paket berbayar.
Detail: [hardening](SECURITY_HARDENING.md).

## Bukti verifikasi lokal

- PostgreSQL 16 sementara: delapan migration dan tiga pemeriksaan SQL schema/
  ownership/runtime privilege lolos; bukan pengujian yang menghapus data cloud.
- Go race suite dengan Postgres dan actual WASM/WebSocket serta `go vet` lolos.
- Frontend: 42 tes, TypeScript dan production build lolos. Build masih memberi
  warning entry chunk lebih dari 500 kB, bukan error; code splitting menjadi backlog.
- Preflight: lima unit test dan delapan pemeriksaan layanan lokal lolos.
- Parity core Model A/B serta tiga run microbenchmark lolos. Load Model A 1/10/30
  user memakai identitas berbeda: 8/80/240 warm batch selesai, nol gagal.
  Detail dan batas interpretasi: [laporan asis](../ASIS_2026_10_07.md).
- Layanan demo: frontend `http://127.0.0.1:5175`, API `http://127.0.0.1:18090`;
  `/health` dan `/ready` 200. Port ini terpisah dari container lama yang dipertahankan.

Satu pengulangan preflight sempat gagal pada readiness database cloud. Pemeriksaan
ulang `/ready` dan preflight berikutnya kembali lolos delapan checks; penyebab
sementara tersebut belum dipastikan. Jangan menganggap tes lokal atau satu
respons 200 sebagai jaminan stabilitas cloud; ulangi preflight sebelum meeting.

Uji akun nyata: akun awal tanpa fitur `screener` ditolak; setelah pengguna
memilih akun lain yang sudah berizin, login dan screening tiga saham berhasil.
Universe pribadi `Demo asis 7 Oktober 2026` dibuat untuk BBCA/BBRI/TLKM.
Default Scalping menghasilkan tiga baris `No match`, quality `complete`, range
14 Mei–6 Oktober 2026. Satu prepare/grant/ticket/socket tercatat, dan hasil
terlihat pada browser. Agent tidak mengubah password, entitlement, role atau
subscription. Signup/recovery dan automatic identity refresh masih terbuka.

Uji tambahan melalui browser: profile PATCH 200, kemudian GET 200 setelah
reload, tanpa mengubah nama akun. Rule pribadi baru `Rule demo asis — RSI 14 < 30`
tersimpan v1 dan berhasil dijalankan pada universe demo: TLKM `Match` (RSI 27,28),
BBCA/BBRI `No match` (41,17/41,21), quality `complete`. Rule demo dipertahankan
untuk asis; rule lama tidak diubah/dihapus. Hasil ini menunjukkan evaluasi rule
berjalan, bukan rekomendasi transaksi atau jaminan keuntungan.

## Pekerjaan yang masih terbuka

1. Ulangi preflight dan demo akun berizin sebelum meeting; bukti end-to-end sudah
   ada, tetapi provider/koneksi cloud tetap dependency eksternal.
2. Retain/refresh identity token frontend dan rotation app-session sesuai kontrak;
   uji signup confirmation dan email recovery dengan user nyata.
3. Perbandingan penelitian lengkap: Model B transport setara, CPU/RAM client/server
   terpisah, data realistis dan persetujuan pembimbing. Model A dipilih pengguna,
   belum otomatis disetujui pembimbing.
4. Policy fill/cost/ordering/rounding sebelum backtest, jurnal server dan portfolio/P&L.
   Preview jurnal browser bukan ledger authoritative.
5. Hak provider, encrypted persistent cache, TLS/reverse proxy, multi-replica state
   dan drill backup cloud sebelum klaim production.
6. Review perubahan, commit/push dan remote CI setelah diizinkan.

Panduan kontrak: [Model A handoff](MODEL_A_FRONTEND_HANDOFF.md),
[refresh](AUTH_REFRESH.md), [session/socket lifecycle](SESSION_AND_SOCKET_LIFECYCLE.md),
[profile dan legacy](PROFILE_AND_LEGACY.md). Scope produk tetap mengikuti PRD.

## Backtesting core — 26 Oktober 2026

Branch `backend/backtesting-core` dari integration `b9c98d6`. Tahap ini menambahkan
backtest Go portable/WASM harian untuk rule/manual, long-only, holding period
T+1…T+n, fee/slippage, sizing, equity/drawdown dan status posisi terbuka. API
menyiapkan snapshot historis owner-scoped dan mengevaluasi rule privat melalui
`POST /api/v1/backtests/signals`; financial compute tetap di client. Entitlement
`backtest`, sesi, rule dan dataset/grant binding diperiksa server.

Acuan Claudio dibekukan terbatas pada struktur horizon dan formula harga/modal;
next-open entry, satu posisi dan incomplete exit sengaja dikoreksi. Kebijakan,
kontrak, contoh runnable dan batas bukti ada di [BACKTESTING](BACKTESTING.md).
UI, intraday, short, target-stop, exit-rule, history server dan jurnal belum masuk.

Verifikasi lokal: seluruh `go test ./...` dan `go vet ./...` lulus; race checks
untuk core/dataset/backtest/compute, alur API backtest dan range cache lulus.
172 tes frontend serta build lulus. Fixture formula Claudio dijalankan dari
fungsi Python asli; output native Go/WASM cocok pada fixture rule/manual dan
marker rule privat absen dari artefak. Ini bukti lokal dengan fixture/test
doubles; login, data provider dan Postgres produksi tidak diuji pada slice ini.

Audit lanjutan 26 Oktober 2026 menemukan dan memperbaiki reuse modal pada
tanggal yang sama ketika label jam candle antar saham berbeda, return posisi
terbuka yang masih nol, export fitur yang menerima intraday, serta kehilangan
presisi/prioritas timestamp subdetik. Kasus tersebut direproduksi dengan tes
gagal sebelum perbaikan. Coverage tambahan mencakup konservasi modal pada 100
skenario harga/biaya, grant lintas pengguna/sesi, suspend, snapshot dan rate limit.
