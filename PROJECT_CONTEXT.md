# SignalGen 2.0 — Project Context and Architecture

- **Status:** Canonical / agreed project direction
- **Audience:** Backend developer, frontend developer, reviewer, and coding agent
- **Purpose:** Menjadi satu sumber kebenaran agar tujuan produk, pembagian aplikasi,
  fitur, dan arsitektur tidak berubah-ubah selama pengembangan.

Jika README, percakapan, kode lama, atau asumsi pribadi bertentangan dengan
dokumen ini, gunakan dokumen ini sebagai acuan keputusan. Kode yang sudah berjalan
tetap menjadi sumber kebenaran untuk detail kontrak teknis aktual seperti nama
field dan bentuk response API.

## 1. Latar belakang

SignalGen 2.0 adalah pengembangan lanjutan dari SignalGen yang sebelumnya dibuat
oleh senior. Proyek ini digunakan sebagai tugas akhir dan dikembangkan oleh tim
backend dan frontend.

Aplikasi membantu pengguna melakukan screening saham, membuat rule berbasis
indikator teknikal, menjalankan backtest, dan menerima trading signal. Fokus pasar
adalah saham Indonesia/IDX, dengan kemungkinan integrasi sumber data lain.

Trading signal adalah hasil evaluasi rule terhadap data pasar. Signal bukan
jaminan keuntungan dan bukan kepastian prediksi harga.

## 2. Tujuan produk

Tujuan utama SignalGen 2.0:

1. Menyediakan aplikasi desktop untuk analisis, screening, dan signal saham.
2. Memiliki akun pengguna melalui Supabase Auth.
3. Memisahkan data pribadi setiap pengguna melalui authorization.
4. Menyediakan web publik untuk informasi produk, akun, pricing/payment,
   subscription, dan download aplikasi desktop.
5. Menggunakan satu backend yang sama untuk frontend web dan desktop.
6. Menjaga engine analisis tetap berada di backend Python.

## 3. Batas interpretasi produk

- `screening` berarti menyaring saham berdasarkan kondisi rule.
- `trading signal` berarti kondisi strategi terpenuhi, misalnya BUY atau SELL.
- `realtime` berarti pembaruan data dan event dikirim saat sistem berjalan;
  kualitas realtime tetap bergantung pada sumber data pasar.
- SignalGen bukan broker dan tidak melakukan auto-execution order pada scope saat
  ini.
- SignalGen tidak boleh dipresentasikan sebagai sistem yang menjamin prediksi
  harga atau profit.

## 4. Arsitektur final yang disepakati

```text
                       INTERNET / USER
                              |
                 +------------+------------+
                 |                         |
                 v                         v
       frontend/web/              frontend/desktop/
       Landing dan portal         Electron + renderer
       akun/subscription           aplikasi SignalGen
                 |                         |
                 +------ REST/HTTPS -------+
                 +------ Socket.IO --------+
                              |
                              v
                         backend/
                    Python + FastAPI
              API, authorization, engines,
                data access, notifications
                    |                 |
                    v                 v
              Supabase Auth        SQLite
              identitas user       data aplikasi
```

Keputusan tetap:

- Repository menggunakan bentuk monorepo.
- Frontend hanya memiliki dua aplikasi: `web` dan `desktop`.
- Backend hanya satu. Tidak dibuat backend terpisah untuk web dan desktop.
- Web dan desktop menggunakan kontrak API yang sama.
- Backend menggunakan Python dan FastAPI.
- Desktop menggunakan Electron dan JavaScript/TypeScript.
- Supabase dipakai untuk authentication.
- SQLite masih dipakai untuk data aplikasi selama tahap sekarang.
- Docker dipakai untuk menjalankan backend saat development.
- Frontend dijalankan langsung menggunakan Node.js agar hot reload dan debugging
  lebih mudah.

Perubahan terhadap keputusan di atas membutuhkan persetujuan kedua anggota tim
dan harus diperbarui dalam dokumen ini melalui Pull Request tersendiri.

## 5. Struktur repository

```text
signalgen-2/
├── backend/
│   ├── app/
│   │   ├── auth/             authentication dependency
│   │   ├── core/             rule dan indicator logic
│   │   ├── data_sources/     IBKR, Yahoo, dan cache
│   │   ├── db/               integrasi Supabase
│   │   ├── engines/          scalping, swing, backtesting
│   │   ├── notifications/    Telegram notification
│   │   ├── storage/          repository dan SQLite
│   │   ├── ws/               Socket.IO broadcaster
│   │   ├── app.py            aplikasi dan route FastAPI saat ini
│   │   └── main.py           entry point backend
│   ├── scripts/
│   ├── tests/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── web/                  landing, account, payment, download
│   └── desktop/
│       ├── electron/         Electron main dan preload
│       ├── renderer/         UI desktop
│       └── public/           aset desktop
├── docker-compose.yml
├── PROJECT_CONTEXT.md        dokumen kanonis ini
└── README.md
```

Folder baru tingkat atas tidak dibuat tanpa alasan arsitektural yang disetujui
bersama. Pemecahan internal menjadi router, service, repository, component, atau
module diperbolehkan selama tidak mengubah tanggung jawab aplikasi.

## 6. Tanggung jawab setiap bagian

### Backend

Backend bertanggung jawab atas:

- REST API dan dokumentasi OpenAPI.
- Validasi input.
- Verifikasi access token Supabase.
- Authorization dan isolasi data pengguna.
- Rule engine dan indicator engine.
- Screening, scalping, dan backtesting engine.
- Akses SQLite dan sumber data pasar.
- Socket.IO/realtime event.
- Telegram notification.
- Integrasi layanan sensitif menggunakan secret backend.

Logic bisnis tidak dipindahkan ke web atau Electron renderer hanya untuk
mempermudah tampilan.

### Frontend web

Web bertanggung jawab atas:

- Landing page dan informasi produk.
- Register, login, dan pengelolaan akun.
- Pricing dan checkout/payment.
- Status subscription.
- Download aplikasi desktop.

Web bukan tempat utama menjalankan engine trading lokal.

### Frontend desktop

Desktop bertanggung jawab atas:

- Electron main process, preload, dan renderer.
- Login/register serta session pengguna.
- Dashboard SignalGen.
- Rule builder dan watchlist.
- Screening, signal, dan backtest interface.
- Menampilkan status engine dan realtime event.
- Integrasi lifecycle backend lokal pada tahap packaging berikutnya.

Renderer tidak boleh memiliki akses langsung ke Node.js atau secret. Operasi
native Electron harus melalui preload dengan API terbatas.

## 7. Authentication dan authorization

Supabase Auth menangani identitas pengguna, password, email confirmation, session,
dan penerbitan token. Backend tetap menjadi pintu masuk aplikasi.

Alur dasar:

```text
Register -> FastAPI -> Supabase Auth -> akun dibuat
Login    -> FastAPI -> Supabase Auth -> access token diberikan
Request  -> Bearer token -> FastAPI verifikasi -> route dijalankan
```

Endpoint authentication yang sudah tersedia:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

`/api/auth/login` membuat session dan memberikan token. `/api/auth/me` memeriksa
token yang sudah dimiliki dan mengembalikan user aktif; endpoint ini bukan login
kedua.

Request yang membutuhkan login mengirim:

```http
Authorization: Bearer <access_token>
```

Kondisi saat dokumen dibuat:

- Register, login, dan pemeriksaan current user sudah tersedia.
- Authorization seluruh data bisnis belum lengkap.
- Rules, watchlists, signals, settings, backtest, dan data pribadi lain belum
  boleh dianggap terisolasi per-user sampai backend menyelesaikannya.
- Refresh token, logout server-side, reset-password aplikasi, role, dan permission
  perlu diselesaikan sebagai pekerjaan lanjutan.

Frontend wajib menangani response `401` dengan menghapus session tidak valid dan
mengarahkan user kembali ke halaman login.

## 8. Database

Pembagian saat ini:

- Supabase Auth menyimpan akun dan identitas pengguna.
- SQLite menyimpan data operasional SignalGen seperti rules, watchlists, signals,
  settings, cache, universe, dan hasil backtest.

Target authorization multi-user:

- Tabel data pribadi mempunyai `user_id` yang berasal dari Supabase user ID.
- Query create/read/update/delete selalu dibatasi berdasarkan current user.
- Data sistem bersama dipisahkan dari data milik user.
- Validasi ownership dilakukan backend, bukan hanya menyembunyikan tombol di UI.

Migrasi seluruh database aplikasi ke Supabase/PostgreSQL bukan keputusan otomatis.
Jika diperlukan, perubahan tersebut harus dibahas dan dicatat sebagai keputusan
arsitektur baru.

## 9. API dan realtime contract

Base URL development backend:

```text
http://127.0.0.1:3456
```

Dokumentasi aktual:

```text
http://127.0.0.1:3456/docs
```

Kelompok API utama:

- `/api/auth`
- `/api/rules`
- `/api/watchlists`
- `/api/engine`
- `/api/signals`
- `/api/settings`
- `/api/backtest`
- `/api/swing`
- `/api/telegram`

Realtime menggunakan Socket.IO di:

```text
http://127.0.0.1:8765
```

Event yang tersedia antara lain `signal`, `price_update`, `engine_status`,
`watchlist_update`, `rule_update`, `ibkr_status`, `log_entry`, dan `error`.

Aturan kontrak:

- OpenAPI dan implementasi backend adalah sumber kebenaran nama field aktual.
- Frontend tidak membuat endpoint atau response shape berdasarkan asumsi.
- Perubahan API dilakukan backend dahulu, didokumentasikan, lalu frontend
  mengikuti.
- Base URL diletakkan di satu konfigurasi, bukan di-hardcode pada banyak komponen.
- HTTP request dipusatkan pada API client/service.

## 10. Docker dan environment

Docker Compose di root repository menjalankan backend dan menyediakan volume
persistent untuk SQLite.

Setup awal:

```bash
cp backend/.env.example backend/.env
docker compose up --build backend
```

Variabel backend minimum:

```dotenv
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
SIGNALGEN_DB_PATH=/workspace/backend/runtime/signalgen.db
```

Endpoint pemeriksaan:

```text
http://127.0.0.1:3456/api/health
http://127.0.0.1:3456/docs
```

Aturan keamanan environment:

- `.env`, password, token, secret key, dan database runtime tidak boleh di-commit.
- Service-role key hanya boleh digunakan backend jika benar-benar dibutuhkan.
- Frontend tidak boleh membaca atau menyalin `backend/.env`.
- Publishable/anon key hanya boleh berada di frontend jika arsitektur memang
  membutuhkan akses langsung Supabase dan RLS sudah benar.

## 11. Fitur yang dipertahankan

Fitur backend/UI lama berikut merupakan cakupan produk yang dipertahankan dan
dimigrasikan bertahap:

- Register dan login.
- Dashboard dan system status.
- Rule builder dan CRUD rule.
- Watchlist dan ticker universe.
- Scalping engine.
- Swing screening.
- Signal history.
- Backtesting dan riwayat backtest.
- Pengaturan timeframe/mode.
- Telegram notification.
- Realtime event melalui Socket.IO.

Mempertahankan fitur tidak berarti seluruh implementasi lama harus dipertahankan.
Struktur internal dan UI boleh dirapikan selama perilaku tidak hilang dan kontrak
yang berubah dikoordinasikan.

## 12. Prioritas pengembangan

Urutan yang disepakati:

1. Menstabilkan arsitektur monorepo dan Docker backend.
2. Menyelesaikan authentication flow.
3. Menambahkan authorization dan ownership data per-user.
4. Memecah backend besar menjadi router/service/repository secara bertahap.
5. Menentukan toolchain frontend bersama.
6. Membuat API client dan auth flow frontend baru.
7. Migrasi desktop per vertical slice tanpa langsung menghapus UI lama.
8. Menambahkan Socket.IO setelah REST flow stabil.
9. Mengembangkan landing/account/pricing web secara paralel.
10. Menambahkan subscription/payment setelah kontrak backend ditentukan.
11. Packaging Electron dan pengelolaan lifecycle backend.
12. Testing, hardening, demo, dan release.

Pekerjaan baru tidak boleh mengganti prioritas utama tanpa alasan yang dicatat.

## 13. Strategi refactor

Refactor dilakukan bertahap, bukan rewrite besar.

Backend target secara konseptual:

```text
api/router -> service -> repository/integration
```

Frontend target secara konseptual:

```text
page/component -> feature service/state -> centralized API client
```

Aturan refactor:

- Satu perubahan kecil dan dapat diuji.
- Pertahankan behavior/API kecuali perubahan memang disepakati.
- Tambahkan atau perbarui test sebelum menghapus implementasi lama.
- Jangan mencampur refactor besar dengan penambahan fitur besar dalam satu PR.
- UI lama baru dihapus setelah penggantinya mencapai feature parity.

## 14. Git workflow

Branch utama:

- `main`: versi stabil untuk demo/release.
- `develop`: integration branch frontend dan backend.
- `feature/...`: branch pendek untuk satu pekerjaan.

Contoh:

```text
feature/backend-authorization
feature/backend-auth-refresh
feature/frontend-login
feature/desktop-rule-list
feature/web-landing
```

Alur:

```text
feature branch -> Pull Request -> develop -> testing -> Pull Request -> main
```

Aturan:

- Tidak push langsung ke `main`.
- Sebaiknya tidak push langsung ke `develop`.
- Pull Request memerlukan satu approval dari anggota tim lain.
- Build/test wajib lulus sebelum merge.
- Gunakan squash merge untuk feature branch.
- Perubahan API, database, environment, atau dokumen ini harus disebutkan jelas
  di deskripsi Pull Request.
- Hindari branch `dev-frontend` dan `dev-backend` yang hidup terlalu lama karena
  meningkatkan perbedaan dan konflik.

## 15. Definition of done

Perubahan dianggap selesai jika:

- Scope dan acceptance criteria terpenuhi.
- Tidak menghilangkan fitur lama tanpa persetujuan.
- Error, validation, loading, dan empty state ditangani bila relevan.
- Authentication/authorization diuji bila endpoint membutuhkan user.
- Test, lint, dan build terkait berhasil.
- Tidak ada secret atau file runtime masuk Git.
- Kontrak API yang berubah sudah didokumentasikan.
- Developer lain dapat menjalankannya dari hasil clone dengan instruksi repository.
- Pull Request sudah direview anggota tim lain.

## 16. Change control

Dokumen ini sengaja dibuat untuk mencegah perubahan arah berulang. Perubahan
fitur inti atau arsitektur hanya dilakukan jika:

1. Ada masalah atau kebutuhan yang jelas.
2. Dampak ke backend, web, desktop, database, dan deployment ditulis.
3. Kedua anggota tim menyetujui keputusan.
4. Perubahan dibuat melalui Pull Request khusus.
5. `PROJECT_CONTEXT.md` diperbarui sebelum atau bersamaan dengan implementasi.

Perubahan styling, bug fix, pemecahan file internal, atau peningkatan test tidak
dianggap perubahan arsitektur selama tidak mengubah batas tanggung jawab dan
kontrak utama.

## 17. Instruksi singkat untuk developer atau Codex baru

Saat mulai bekerja:

1. Baca seluruh `PROJECT_CONTEXT.md`.
2. Periksa branch dan `git status` sebelum mengubah file.
3. Jalankan backend dan buka `/docs` untuk melihat kontrak aktual.
4. Baca README bagian yang akan dikerjakan.
5. Buat feature branch dari `develop` terbaru.
6. Kerjakan hanya satu scope yang jelas.
7. Jangan mengubah arsitektur atau fitur inti tanpa persetujuan tim.
8. Jalankan pemeriksaan yang relevan sebelum membuat Pull Request.

Dokumen ini tidak menyimpan credential, token, password, atau nilai `.env` nyata.
