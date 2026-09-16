# SignalGen 2.0 — Product Requirements Document

Versi 2.0 · 16 September 2026 · Baseline kebutuhan terbaru atas revisi voice memo yang ditetapkan pengguna. Status implementasi: belum selesai.

## 1. Otoritas dan revisi

PRD ini menggantikan baseline desktop-first v1. Pengguna menegaskan rekaman Universitas Udayana.m4a sebagai revisi terbaru. Rekaman adalah sumber kebutuhan, bukan bukti implementasi atau hasil benchmark. Revisi dokumen tidak menghapus kode/data legacy.

Acuan: [konteks arsitektur](PROJECT_CONTEXT.md), [PRD frontend](frontend/FRONTEND_MVP_PRD.md), [PRD backend](backend/BACKEND_MVP_PRD.md), [kontrak target bersama](backend/MVP_API_CONTRACT.md), dan [konteks rekaman](VOICE_MEMO_CONTEXT.md). Kontrak target belum berarti endpoint tersedia; kode/test/OpenAPI runtime tetap sumber kebenaran perilaku aktual.

| Baseline lama | Baseline terbaru |
| --- | --- |
| Electron desktop utama; web portal/download | Web analisis utama; desktop legacy bukan deliverable MVP |
| Engine Python di server | Shared core Go; screening/backtest historis di client Go/WASM |
| FastAPI target permanen | API target Go; FastAPI legacy/baseline selama migrasi |
| Realtime, installer dan payment di delivery awal | Correctness, efisiensi dan proteksi didahulukan |
| Paket belum dikunci | Entitlement berbasis fitur; grant manual untuk MVP |

Frontend baseline: **React + TypeScript + Vite**, sesuai preferensi pengguna dan arah rekomendasi percakapan. Next.js/SSR dan migrasi Svelte tidak diperlukan.

## 2. Produk, masalah dan pengguna

SignalGen membantu pengguna membuat rule indikator, menyaring saham, menguji strategi historis dan mencatat transaksi pribadi. Bukan broker, bukan auto-trading, bukan rekomendasi personal atau jaminan profit.

Masalah utama: backtest per-user di server berpotensi meningkatkan CPU/RAM/biaya; distribusi kode menimbulkan risiko reverse engineering/pemakaian ulang; login saja tidak menyelesaikan ownership/entitlement; installer lintas OS menambah pekerjaan.

Cerita biaya sekitar USD 3 untuk sekitar 30 pengguna di rekaman adalah motivasi riset, bukan benchmark terverifikasi.

Pengguna:

- Pengguna analisis/trader: menguji rule tanpa coding, memahami alasan dan hasil.
- Operator: mengelola grant/sesi demo terkontrol, tanpa otomatis membaca data trading privat.
- Tim/pembimbing: membutuhkan demo repeatable, parity, benchmark dan threat model.

Outcome: login browser → pilih rule/data → screening/backtest lokal → pahami hasil → catat transaksi terkonfirmasi di jurnal server.

## 3. Prioritas dan batas MVP

| Tahap | Arti |
| --- | --- |
| P0 | Vertical slice demo pertama: satu strategi, fixture historis, Go/WASM, server access control, benchmark |
| P1 | Wajib sebelum MVP end-to-end selesai: provider historis berizin, CRUD rule subset, cache, perangkat, jurnal |
| P2 | Backlog; tidak menghalangi penerimaan P0/P1 |

P0 selesai bukan berarti MVP selesai. Target satu minggu demo adalah estimasi awal yang dikalibrasi setelah baseline; sekitar delapan bulan dalam rekaman mengacu target riset keseluruhan, bukan deadline pasti MVP.

## 4. Functional requirements

| ID | Tahap | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| MVP-AUTH-01 | P0 | Login, principal dan logout | Server memverifikasi identitas; logout mencabut sesi aplikasi; invalid session ditangani |
| MVP-AUTH-02 | P1 | Registrasi/konfirmasi, refresh/recovery | Email confirmation bukan login sukses; flow Supabase terdokumentasi dan diuji |
| MVP-OWN-01 | P0 | Isolasi resource privat | A tidak dapat list/detail/mutate rule/data B melalui request langsung |
| MVP-ENT-01 | P0 | Entitlement screener/backtest | Layanan/data server terkait memvalidasi hak; client tidak menjadi otoritas |
| MVP-ENT-02 | P1 | Grant manual berwenang | Features, expiry, reason dan actor diaudit; bukan payment status palsu |
| MVP-RULE-01 | P0 | Satu strategi baseline | Snapshot, fixture, engine version dan asumsi eksekusi dibekukan untuk parity |
| MVP-RULE-02 | P1 | CRUD rule subset tanpa kode | Operand/operator didukung core; backend/WASM menolak yang unsupported |
| MVP-DATA-01 | P0 | Fixture historis berversi | Sumber, market, currency, UTC, warmup, adjustment dan checksum tercatat |
| MVP-DATA-02 | P1 | Provider historis melalui server | IDX dahulu; hak penggunaan/redistribusi diperiksa; timeout/rate limit/missing data ditangani |
| MVP-SCREEN-01 | P0 | Screening historis lokal | Fixture universe kecil menghasilkan match dengan alasan; bukan live signal |
| MVP-WASM-01 | P0 | Backtest Go/WASM di worker | Jalur web baru tanpa backtest compute server; run/status/result/error/cancel tersedia |
| MVP-PARITY-01 | P0 | Kesetaraan hasil | Signal/trade sesuai baseline; toleransi metrik disepakati sebelum tes |
| MVP-RESULT-01 | P0 | Hasil dapat dijelaskan | Metrik, signal/trade dan asumsi tervalidasi; unsupported ditandai, bukan dipalsukan |
| MVP-CACHE-01 | P1 | Cache terkompresi/terenkripsi | Tidak ada plaintext persisten; user/version/checksum terpisah; clear cache tersedia |
| MVP-DEVICE-01 | P1 | Instalasi browser, limit dan revoke | Limit configurable; sesi revoked ditolak server; IP sebagai sinyal risiko |
| MVP-JOURNAL-01 | P1 | Jurnal server CRUD BUY/SELL | Waktu, quantity, harga, fee, catatan dan ownership tervalidasi |
| MVP-JOURNAL-02 | P1 | Draft dari hasil analisis | Harga/waktu editable; konfirmasi wajib; tidak mengirim order broker |
| MVP-PORT-01 | P1 | Posisi/P&L server | Cost-basis terdokumentasi; harga terakhir/timestamp bukan klaim live |
| MVP-EVAL-01 | P0/P1 | Evaluasi | 1/10/30 sesi, cold/warm, CPU/RAM kedua sisi, latency/traffic/failure dan threat model |
| MVP-WEB-01 | P1 | Informasi produk/akun jujur | CTA menuju web app; tidak menjanjikan checkout/installer/live feed yang belum ada |

History backtest lintas perangkat di server, full watchlist, CSV, banyak indikator/exit strategy masuk P2. Hasil backtest P0/P1 lokal/ephemeral; jurnal transaksi terkonfirmasi disimpan server.

## 5. Journeys dan business rules

- Onboarding: register/konfirmasi atau login → principal → sesi/instalasi browser → workspace sesuai entitlement.
- Analisis: rule + saham/periode → server access check → data berversi → worker → hasil/asumsi.
- Limited access: penjelasan hak fitur dan aktivasi manual; bukan checkout palsu; API tetap menolak request tanpa hak.
- Jurnal: input manual/draft dari hasil historis → edit harga, quantity, waktu aktual → konfirmasi → server menghitung ulang.
- Perangkat: list/revoke/registrasi ulang dengan limit; sesi lama ditolak pada request berikutnya.

Owner berasal dari principal, bukan payload user_id. Role operator terpisah dari entitlement dan tidak otomatis mengizinkan akses resource privat orang lain. Paket berbasis fitur; nama/harga/kuota komersial belum final. Aplikasi meminta validasi akses server untuk run baru, termasuk cache hit; offline run bukan fitur MVP.

Entitlement bukan DRM absolut: data/modul yang sudah didistribusikan dapat digunakan ulang oleh client modifikasi. Pengguna screener bisa menghitung backtest sendiri dari data yang sudah mereka miliki; jangan menjanjikan server dapat melarang operasi matematika lokal.

## 6. UX, estetika dan performa

Workspace mode Operate: konfigurasi → proses → hasil, satu tugas dominan per view. Gunakan identitas/logo/palet/tipografi yang sudah ada di DESIGN.md; bukan redesign visual.

Loading, empty, validation, error, offline, denied, cancelled dan success wajib. Keyboard/focus, label form, status selain warna, reduced motion dan viewport laptop/narrow diuji.

Frontend static hosting/CDN tanpa SSR runtime. WASM/chart di-lazy-load; worker tidak menghilangkan CPU/RAM client. Batasi dataset/job, gunakan array transferable, hindari candle besar di global React state, virtualisasi/pagination tabel. Budget teknik dan test profile dijabarkan pada PRD FE; bukan klaim benchmark yang sudah tercapai.

## 7. Security, storage dan integrasi

Supabase Auth tetap identitas/password. Server memvalidasi sesi aplikasi, status, ownership, role dan entitlement. Secrets tidak di client/log/demo.

SQLite tetap target server dengan encryption at rest nyata, key lifecycle dan recovery teruji sebelum P1 selesai. Cache client ciphertext terkompresi; SQLite browser versus storage ciphertext alternatif harus diputuskan pada gate P1. P0 boleh in-memory.

WASM bukan enkripsi kode; ID instalasi browser bukan hardware ID; IP bukan identitas tetap. Hard-lock IP bukan default MVP. Hasil WASM unverified, tidak menentukan izin/payment; draft jurnal butuh konfirmasi.

Provider diakses server. Hak distribusi/cache diperiksa. Data fixture/replay diberi label simulasi. Realtime provider belum tersedia bukan alasan menampilkan harga palsu sebagai live.

## 8. Non-goals / P2

Realtime production/broadcast dan API yang diberikan belakangan; integrasi IBKR baru; semua bursa sekaligus; Telegram tambahan; full admin dashboard; billing/payment/webhook otomatis; OCR; auto-trading; native mobile; installer/code signing/updater; full engine parity; jaminan anti-reverse-engineering. Tidak otomatis migrasi database ke PostgreSQL atau membuat backend di frontend.

Legacy tetap tersedia untuk baseline/rollback. Perubahan behavior correctness dipisahkan dari migrasi; jangan mempertahankan bug look-ahead hanya demi parity.

## 9. Milestones, evaluasi dan DoD

| Milestone | Owner | Exit gate |
| --- | --- | --- |
| M0 | FE + BE/core | Strategi/fixture, parity policy, schema API/worker, target perangkat disepakati |
| M1 | BE/core | Go unit parity, build WASM, worker run/cancel; core bebas repository/provider |
| M2 — P0 | FE + BE | Flow analisis + access control/isolation, benchmark awal, threat model |
| M3 — P1 foundation | FE + BE | Provider berizin, rule CRUD, grant audit, device/session, encryption/cache |
| M4 — jurnal | FE + BE | CRUD/draft, posisi/P&L, cross-user tests |
| M5 — end-to-end | Tim | Slice API Go, migration/recovery, build/tests, evaluasi dan demo repeatable |

Benchmark membandingkan kerja sama pada baseline Python vs Go/WASM. Pisahkan fetch, transfer, startup dan compute. Catat hardware/browser, durasi, p50/p95, CPU/RAM kedua sisi, bytes, failure/correctness. Tiga puluh sesi generator lokal bukan bukti tiga puluh perangkat fisik atau kapasitas production.

P0 selesai: screening/backtest subset repeatable, parity/access/isolation lulus, UI responsif, benchmark dan batas proteksi jelas.

MVP selesai: **seluruh P0/P1** lulus; slice API target Go teruji; provider berizin, SQLite/cache protection/recovery, grant/sesi/perangkat dan jurnal bekerja; lint/typecheck/build/tests terkait lulus; setup dapat diulang tanpa edit kode; tidak ada blocker keamanan tinggi. P2 dilaporkan sebagai remaining work.

## 10. Open decisions dan change control

| Keputusan | Owner | Gate |
| --- | --- | --- |
| Strategi, indikator, exit/sizing, fees dan baseline engine path | BE/core + pembimbing | M0 |
| Provider/hak distribusi data | Product + BE | P1 data |
| SQLite encryption server, key storage/recovery | BE/security | P1 storage |
| SQLite browser terenkripsi vs alternatif ciphertext | FE + BE + product/pembimbing | P1 cache |
| Device/session/grant limits dan IP policy | Product + BE/security | P1 device |
| Browser/perangkat target dan budget final | FE + BE | M0 |
| Benefit/harga/provider pembayaran | Product | P2 komersial; tidak memblokir grant MVP |

Usulan teknik bukan ucapan pembimbing. Perubahan berikutnya memperbarui scope, dampak, acceptance dan kontrak bersama. Review/merge tetap lewat PR. Revisi ini tidak membuat commit/push, menghapus legacy, atau menjalankan migration production.
