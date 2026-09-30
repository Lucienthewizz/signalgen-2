# SignalGen 2.0 — Project Context and Architecture

Versi 2.1 · 29 September 2026. Keputusan terbaru pengguna: SignalGen adalah aplikasi web multi-user dengan backend Go/Gin dan Supabase Postgres. **Dokumen target bukan bukti migrasi selesai**.

## 1. Acuan

[PRD utama](PRD.md), [PRD frontend](frontend/FRONTEND_MVP_PRD.md), [PRD backend](backend/BACKEND_MVP_PRD.md), [kontrak target](backend/MVP_API_CONTRACT.md), [provenance rekaman](VOICE_MEMO_CONTEXT.md). Kode/test/OpenAPI runtime menetapkan kontrak aktual; dokumen target menetapkan pekerjaan yang harus dilakukan.

## 2. Arsitektur target

Web analisis adalah produk target; React + TypeScript + Vite. Fokus MVP: efisiensi komputasi dan proteksi akses/lisensi.

```text
Static hosting/CDN → frontend/web
                      ├─ UI React → worker bridge → Go/WASM portable core
                      │                           ↑ historis/cache ciphertext
                      └─ REST/HTTPS → Go API boundary
                                       ├─ Supabase Auth
                                       ├─ Supabase Postgres: profile/session/grant/subscription/rule/jurnal/audit
                                       └─ historical provider adapter

Arsip historis: backend/app Python/FastAPI + frontend/desktop Electron.
Keduanya tidak menentukan desain fitur web baru.
```

Indikator dan komputasi historis yang berat dihitung client. Berdasarkan bimbingan
terbaru, keputusan screener kritis diusulkan tetap berada pada modul kecil server
yang menerima feature vector ringkas melalui WebSocket. Model split final harus
dipilih setelah eksperimen, bukan diasumsikan selesai. Data akun/portofolio/jurnal
tetap authoritative di server. Worker menjaga respons UI, bukan menghilangkan
CPU/RAM perangkat. Go/WASM bukan pengganti React dan bukan jaminan enkripsi kode.

Lihat [desain hybrid screener](backend/HYBRID_SCREENER_DESIGN.md) untuk tiga model
pembanding, threat model, dan urutan implementasi.

## 3. Monorepo dan tanggung jawab

- frontend/web: public/account dan aplikasi analisis utama; tidak ada backend di folder FE.
- frontend/desktop: arsip historis; bukan deliverable produk aktif.
- backend/app: arsip Python/FastAPI untuk pembanding hasil.
- backend: Go API/Gin, pgxpool, dan shared portable core.

Struktur Go berada di backend/cmd/api, backend/cmd/wasm,
backend/internal/{api,auth,account,subscription,session,rules,dataset,compute,screener},
dan backend/core. Core bebas HTTP/storage/provider/Supabase; berbagi source Go.

| Bagian | Ownership |
| --- | --- |
| FE React | Form/navigation, worker orchestration, cache adapter, chart/tabel, session UX, draft jurnal |
| Go core | Indikator/rule subset, screening/backtest, trade/metrics dan versioning |
| Go API | Principal/sesi/role/ownership/entitlement, distribusi historis, rule CRUD, jurnal/P&L, audit |
| Supabase Auth | Password, identitas, token dan recovery sesuai konfigurasi |
| Supabase Postgres | Data aplikasi privat multi-user dengan ownership, RLS, backup/recovery |

FE tidak menentukan izin, memegang server secrets atau mengirim order broker. Core tidak fetch provider/CRUD repository. API tidak menghitung backtest per-user pada slice web baru. Jurnal dihitung server dari transaksi terkonfirmasi; hasil client unverified.

## 4. Migrasi dan kontrak

Satu API boundary /api; setiap route punya satu pemilik selama transisi. /api/v1 merupakan desain target, bukan route yang telah tersedia. P0 boleh API legacy sebagai jembatan jika adapter/tes jelas. MVP end-to-end mensyaratkan Go API slice teruji. Tidak dual-write database tanpa rencana migrasi.

Legacy auth /api/auth/register, /api/auth/login, /api/auth/me tetap kompatibel; field/response tidak diganti diam-diam. Kontrak API dan worker dibekukan M0 lalu diterbitkan OpenAPI/schema. Base URL/version/WASM URL terpusat; FE mengikuti runtime yang benar.

Supabase bearer membuktikan identitas. Sesi aplikasi terikat instalasi browser menyediakan revoke/limit. Setup/refresh sesi dikecualikan dari kewajiban sesi yang belum ada, tetapi bearer tetap diverifikasi. Route bisnis privat memerlukan bearer + sesi sesuai kontrak. Role/entitlement/status dibaca server, bukan user metadata.

ID instalasi bukan hardware ID. IP dicatat sebagai sinyal; hard-lock IP tidak
menjadi default. Grant manual memakai fitur/expiry/alasan/audit. Fondasi
subscription menyimpan paket, periode, status, feature mapping, dan event;
aktivasi MVP dilakukan operator tepercaya. Harga, checkout, dan webhook tetap
menunggu keputusan provider dan tidak boleh disimulasikan sebagai payment sukses.

## 5. Data dan proteksi

Supabase Postgres menjadi sumber authoritative data aplikasi. Schema `signalgen` menyimpan data aktif, schema `legacy` hanya arsip SQLite, dan tabel aplikasi tidak dibuat di `public`. Kedua custom schema tersebut tidak diekspos ke Data API; browser mengakses data aplikasi melalui Go API. Grant dan policy RLS terpilih pada `signalgen` adalah defense in depth dan tidak mengekspos schema dengan sendirinya. Backend menggunakan koneksi server-side dan wajib menerapkan owner filter, role, serta entitlement pada setiap query. Perubahan daftar exposed schema di Supabase adalah perubahan arsitektur/security yang wajib direview. Migration, backup/recovery, dan pengujian dua pengguna adalah gate P1.

Cache historis client ciphertext terkompresi, user/version/checksum scoped. Pilihan storage ciphertext di browser memerlukan keputusan eksplisit sebelum P1 cache selesai. P0 boleh memory-only. Browser storage dapat dihapus, bukan sumber authoritative jurnal.

WASM dapat dianalisis; secret provider/signing/server tidak di client. Encryption cache tidak menyembunyikan plaintext dari client saat dipakai. Entitlement membatasi layanan/data server berikutnya, tidak menarik kembali dataset/modul yang terlanjur diunduh. Data privat tidak di-public-cache CDN.

Normalisasi historis mencakup market/currency/UTC/adjustment/warmup. Provider server-side; hak redistribusi/cache diperiksa. Signal bukan order atau jaminan profit.

## 6. Runtime dan realtime

Frontend static assets/CDN; SSR/Next.js tidak diperlukan. Go API aktif pada port 8080. Python/Socket.IO pada port lama hanya arsip untuk pembanding.

Realtime production P2, bergantung provider nanti. Fixture/replay dilabel simulasi. Socket.IO bukan raw WebSocket; protokol target harus diputuskan, jangan diasumsikan kompatibel.

Secrets/.env/bearer/runtime DB/cache privat tidak masuk Git/log/bundle. Production HTTPS, CORS origin allowlist, key storage di luar repository. Lockfile toolchain digunakan.

## 7. Delivery dan kualitas

M0 fixture/kontrak → M1 core/WASM → M2 P0 akses/demo/benchmark → M3 P1 data/rule/cache/device → M4 jurnal → M5 MVP end-to-end.

Refactor incremental; legacy untuk pembanding. Correctness bug (misalnya look-ahead) diberi fixture/perubahan eksplisit, bukan dipertahankan demi parity.

Graph-first discovery dan coverage sesuai instruksi proyek. Pemeriksaan dokumen ini hanya simbol baseline terpilih, bukan audit lengkap authorization.

Gates: parity core, API/worker contract tests, ownership/role/entitlement, migration Postgres, RLS dua pengguna, backup/recovery, worker cancel, FE lint/typecheck/test/build, profiling CPU/RAM kedua sisi dan demo repeatable. Verifikasi yang belum dijalankan ditulis eksplisit.

## 8. Workflow

main stabil, develop integrasi; PR kecil dengan review anggota lain. Ikuti branch yang diminta; default branch agent codex/. Tidak push/merge atau migration production hanya karena PRD berubah.

Saat mulai: baca acuan terkait, cek git status, kontrak runtime, pilih slice, tulis tes dan verifikasi. Preserve perubahan user. Keputusan terbuka PRD diselesaikan pada gate-nya tanpa menghentikan pekerjaan independen yang aman.
