# SignalGen — Frontend MVP PRD

Versi 2.0 · 16 September 2026 · Target implementasi web berdasarkan revisi voice memo. Owner: frontend developer. Scope/priority mengikuti [PRD utama](../PRD.md); arsitektur mengikuti [context](../PROJECT_CONTEXT.md); API dan worker mengikuti [kontrak bersama](../backend/MVP_API_CONTRACT.md).

## 1. Tujuan dan toolchain

Membangun flow analisis web yang estetik, mudah dipakai dan responsif, sambil memindahkan komputasi berat ke Go/WASM worker. React + TypeScript + Vite adalah baseline. Pertahankan toolchain, lockfile dan komponen yang sudah ada jika sesuai; tidak mengganti framework menjadi Svelte/Next.js atau mengulang design system.

Static production assets disajikan hosting/CDN; tidak perlu proses SSR FE per request. Backend Go menangani data/akses/jurnal. FE tidak menentukan akses bisnis dan tidak menghitung ulang core dengan implementasi TypeScript yang berbeda.

Status saat revisi: frontend web sudah mempunyai basis React/TypeScript/Vite serta public/account flow menurut README yang dibaca. Ini bukan audit lengkap UI atau bukti WASM/workspace target sudah tersedia. Legacy desktop tidak dihapus.

## 2. Audience, visitor mode dan visual authority

Pengguna memahami saham/indikator dasar, bekerja di laptop, ingin mencoba rule tanpa coding. Workspace mode **Operate**: konfigurasi → proses → hasil; utamakan scanability dan tindakan nyata. Public page menjelaskan produk secara ringkas, bukan pusat pengerjaan MVP.

Gunakan logo candlestick, palet, tipografi dan komponen sesuai DESIGN.md dan implementasi yang sudah ada. Jangan mengganti visual world melalui PRD ini. Angka tabular; satu primary action per area; status memakai teks/icon selain warna. Hindari animasi/blur kontinu dan decorative card grids. Tidak perlu comp/imagegen untuk deliverable perencanaan ini.

## 3. Information architecture dan screen inventory

Route berikut adalah desain UI yang diusulkan, bukan klaim route sudah ada:

| Surface | Route konsep | Tahap | Konten/tindakan utama |
| --- | --- | --- | --- |
| Public | `/` | P1 | Produk, disclaimer, CTA buka aplikasi; tidak ada checkout/download palsu |
| Auth | `/login`, `/register`, `/auth/recovery` | Login P0; lainnya P1 | Login/register, confirmation, recovery dan feedback aman |
| Workspace | `/app` | P0 | Pilih screen/backtest, rule, dataset/saham/periode; configure/run/cancel |
| Rule management | `/app/rules` | P1 | List sistem/milik user, create/edit/delete subset, unsupported warning |
| Results | panel/route dalam workspace | P0 | Summary, alasan match, signal/trade, assumptions, data quality |
| Journal | `/app/journal` | P1 | Form manual, draft hasil, transaksi, posisi/P&L server |
| Account | `/app/account` | P0/P1 | Identitas/hak fitur, sesi/perangkat, revoke, clear cache |

Tidak membuat screen admin lengkap, watchlist suite atau settings realtime untuk memenuhi MVP. Operator grant P0 dapat CLI; minimal grant tooling P1 sesuai BE, UI operator bukan syarat.

## 4. Requirements dan acceptance

| ID | Tahap | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| FE-AUTH-01 | P0 | Shared API client + principal/session | Base URL terpusat; token tidak di URL/log; bearer dan app-session sesuai kontrak |
| FE-AUTH-02 | P0 | Login/logout dan route guard | Session expired/revoked/suspended dibedakan; logout membersihkan state, worker dan cache user |
| FE-AUTH-03 | P1 | Register/confirm/refresh/recovery | Confirmation nullable token ditangani; refresh single-flight; gagal kembali login tanpa retry loop |
| FE-ENT-01 | P0 | UX entitlement | Screen/backtest hanya ditawarkan sesuai features; denied diberi explanation; UI gate bukan keamanan |
| FE-RULE-01 | P0 | Pilih baseline rule | Snapshot/version terlihat; configuration yang unsupported tidak ditawarkan |
| FE-RULE-02 | P1 | Builder CRUD subset | Input tervalidasi; server errors per field; rule privat dan system read-only dibedakan |
| FE-DATA-01 | P0/P1 | Dataset preparation | Fixture P0/provider P1 jelas labelnya; metadata/range/warmup/checksum divalidasi |
| FE-WORKER-01 | P0 | WASM bridge lazy-loaded | Satu worker/job per tab; loader error tertangani; tidak memblokir thread UI |
| FE-WORKER-02 | P0 | Progress/run/cancel lifecycle | Correlation job_id; stale results diabaikan; cancel terminate worker dan dapat run ulang |
| FE-RESULT-01 | P0 | Output explainable | Match reason/signal/trade, metrics, assumptions, engine/data version, warnings tersedia |
| FE-RESULT-02 | P0 | Chart/table bounded | Chart/virtualized table tidak render semua data tanpa batas; no fabricated live values |
| FE-CACHE-01 | P1 | Compressed ciphertext cache | Per-user scope; schema/version/checksum mismatch invalidasi; quota/corruption fallback aman |
| FE-CACHE-02 | P1 | Clear/logout cache behavior | Logout/user switch terminate worker, clear dataset plaintext dan remove cached user data/key |
| FE-DEVICE-01 | P1 | Device/session UX | List instalasi, current marker, revoke confirmation, limit reached dan re-registration |
| FE-JOURNAL-01 | P1 | Transaksi manual CRUD | BUY/SELL quantity/price/fee/time; delete confirmation; server authoritative validation |
| FE-JOURNAL-02 | P1 | Draft from analysis | Label draft/historical, editable price/time, confirm before saving; no broker order |
| FE-PORT-01 | P1 | Server position/P&L | Refresh after mutation; show valuation source/time/cost method; missing quote not zero value |
| FE-QUALITY-01 | P0/P1 | UX/performance tests | Contract/unit/E2E/profile sesuai gate; performance target bukan klaim implementasi |

## 5. State machine dan edge cases

```text
idle → validating_access → preparing_data → loading_engine → running → completed
  └──── setiap tahap dapat berakhir denied / failed / cancelled
```

- Jangan tampilkan progress angka palsu jika engine belum memberi count; gunakan indeterminate stage.
- Update progress maksimum sekitar 4 kali/detik; hasil terminal tidak ditunda oleh throttle.
- Cancel abort fetch dan terminate worker, bersihkan buffer; pesan worker job lama tidak boleh mengganti hasil job baru.
- Preserve config draft ketika run gagal; beri retry eksplisit, bukan background run loop.
- Data kosong berbeda dari tidak ada match/trade. Partial/missing data ditandai; jangan tampilkan sukses penuh.
- Navigasi saat running memberi pilihan cancel/lanjut pada batas yang didukung; unmount terminal membersihkan worker.
- Network putus: cached result boleh dilihat dalam sesi yang sama; run baru perlu online access check; tidak menjanjikan DRM offline.
- Unsupported WASM/Web Crypto/storage: error capability jelas; **tidak diam-diam fallback ke backtest server**.
- Storage quota/corrupt: hapus entry invalid, refetch jika online; tidak menyimpan plaintext sebagai fallback.
- Entitlement berubah: recheck run berikutnya, hentikan layanan server yang ditolak; dataset yang terlanjur di memory bukan dapat ditarik kembali.

## 6. Data dan integrasi

Gunakan schema kontrak bersama, bukan field hasil tebakan. Normalisasi legacy dilakukan pada adapter API, bukan pada setiap component. Mock transport/dataset diberi label dan hanya untuk tests/demo fixture.

Worker menerima portable rule snapshot + canonical dataset + configuration. Buffer transferable untuk menghindari duplikasi; hasil besar diberi typed/bounded representation. State React menyimpan config/status/summary/result handles, bukan seluruh candle besar pada global context. Chart menerima data bounded lewat adapter/ref yang sesuai.

Metadata hasil: job_id, execution=client_wasm, engine/schema/data version, checksum, assumptions, warnings. Jangan menyebut hasil server-verified. Server jurnal hanya menerima transaksi yang dikonfirmasi pengguna.

## 7. Cache, sesi dan privasi

P0 memory-only dapat diterima. P1 cache adalah compressed ciphertext. Pilih SQLite browser encrypted atau alternatif ciphertext setelah spike/decision tercatat; PRD tidak menganggap SQLCipher browser sudah tersedia.

Usulan jika storage ciphertext alternatif disetujui: IndexedDB + Web Crypto AES-GCM, nonce unik, key per-user/instalasi non-extractable dan versioned. Ini mengurangi accidental key export, **tidak melindungi dari XSS/pemilik browser yang mengendalikan runtime**. Kunci/nonce tidak hardcoded/global; key lifecycle dan user switch diuji.

Jurnal tidak disimpan offline sebagai database authoritative. Session secrets di memory default; reload dapat meminta login ulang sampai mekanisme persistence aman disepakati. Jika cookie/token persistence diusulkan, dokumentasikan CSRF/XSS, expiry dan cleanup sebelum implementasi. Jangan memindahkan raw refresh token ke localStorage sekadar agar reload nyaman.

ID instalasi browser adalah UUID pseudonymous, bukan hardware fingerprint. IP dicatat server; FE tidak meminta akses identitas perangkat invasif.

## 8. Non-functional budgets

Target teknik awal, dikalibrasi M0 dan diukur pada production build; tidak merupakan angka hasil uji:

| Budget | Target awal / kondisi |
| --- | --- |
| Initial app JS | Maksimum 250 KiB gzip, tidak termasuk lazy chart/WASM/fonts; catat total route bytes juga |
| WASM/chart | Tidak di initial auth/public bundle; fetch saat fitur dibuka/dijalankan; ukur cold start terpisah |
| Job concurrency | Maksimum satu compute job per tab; tab/device lain tidak dianggap dapat dikontrol absolut oleh FE |
| Progress | Maksimum 4 UI update/detik; jangan trigger whole-app render |
| Cancel feedback | Tombol/status berubah dalam 200 ms pada profile test; worker terminated dan cleanup terverifikasi |
| Main thread | Tidak ada task >50 ms yang berulang akibat loop backtest; laporkan long-task traces |
| Dataset demo | 1–5 saham, timeframe daily, 1–3 tahun; bukan batas paket komersial |
| Hard guard awal | Maksimum 100.000 candle agregat dan 50 MiB decoded dataset per job; selaraskan API limits, ukur heap total |

Threshold bukan jaminan semua low-end device mampu memproses dataset maksimum. Profil minimum kandidat: laptop RAM 8 GB, browser modern; hardware/browser/versi final ditetapkan M0. Tidak menjanjikan speedup Go atas Python tanpa benchmark.

## 9. Accessibility, responsive dan copy

Keyboard navigation, visible focus, labelled inputs/errors, live status region, contrast WCAG AA, reduced motion. Denied/error tidak hanya warna. Status angka dan chart diberi tabel/summary alternatif yang bisa dibaca.

Validasi layout 1366×768, 1024×768 dan 390×844. Laptop flow analisis penuh; layar sempit tetap usable dengan konfigurasi stacked/table scroll, tidak memaksa semua chart tampil bersamaan. Angka/periode/timezone/currency eksplisit; istilah BUY/SELL/ticker standar dipertahankan; copy utama Indonesia sentence case.

## 10. Testing, handoff dan DoD

Unit/contract: API error codes, auth single-flight, worker correlation/cancel/stale messages, schema validation, cache scope/corruption, draft journal mapping. E2E: login → screen/backtest → hasil; denied direct API; A/B isolation; cancel/rerun; revoked; journal CRUD and invalid SELL; user switch/cache cleanup. Test ini target, belum dijalankan oleh revisi dokumentasi.

Backend menyerahkan OpenAPI, stable errors, capabilities, fixture profiles/grants dan dataset tanpa secrets. Core menyerahkan versioned WASM + runtime yang sesuai, schema, fixture dan parity report. FE menyerahkan routes, state machine, production build, integration tests dan profile report.

P0 FE done: auth/access UX + worker screening/backtest subset + results/cancel/error + profiling awal. P1 FE done: seluruh requirement P1, encryption/device/journal flows, responsive/a11y, lint/typecheck/tests/build terkait lulus dan API nyata terintegrasi. Tidak menyatakan done hanya karena mock berjalan.

Open gates: exact rule/config schema dan baseline strategy M0; device/session policy, key lifecycle dan SQLite-browser decision P1; final performance profile M0. Tidak membuka pertanyaan visual baru atau membuat implementasi UI dalam revisi PRD ini.
