# SignalGen 2.0 — Product Requirements Document

- **Status:** Baseline / approved product scope
- **Document owner:** SignalGen 2.0 team
- **Related architecture:** [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)
- **Primary product:** Desktop stock screening and trading-signal application
**Supporting product:** Public web and account portal

## 1. Document purpose

Dokumen ini adalah sumber kebenaran kebutuhan produk SignalGen 2.0. Tujuannya
adalah menjaga fitur, prioritas, dan hasil akhir tetap konsisten selama proses
pengembangan tugas akhir.

Pembagian sumber kebenaran:

- `PRD.md` menetapkan apa yang harus dibuat dan kapan dianggap selesai.
- `PROJECT_CONTEXT.md` menetapkan bagaimana sistem dibagi dan batas arsitekturnya.
- OpenAPI backend menetapkan kontrak teknis API yang sedang berjalan.
- Kode dan test menetapkan detail implementasi aktual.

Jika muncul ide baru yang tidak ada di PRD, ide tersebut masuk backlog dan tidak
langsung dikerjakan. Perubahan scope inti harus mengikuti proses change control
di bagian akhir dokumen ini.

## 2. Product summary

SignalGen 2.0 adalah aplikasi desktop yang membantu pengguna menyaring saham,
membuat strategi berbasis indikator teknikal, melakukan backtest, dan menerima
trading signal ketika kondisi strategi terpenuhi.

Target awalnya adalah pengguna yang mengamati saham Indonesia/IDX. Produk dapat
memakai data historis Yahoo dan data pasar IBKR sesuai kemampuan integrasi yang
tersedia.

SignalGen adalah alat bantu analisis. Hasil BUY/SELL menunjukkan kondisi rule
terpenuhi, bukan kepastian pergerakan harga, rekomendasi investasi personal, atau
jaminan keuntungan.

## 3. Problem statement

Pengguna yang melakukan analisis teknikal sering harus:

- Memeriksa banyak ticker secara manual.
- Mengulang kondisi indikator yang sama pada setiap saham.
- Memisahkan proses screening, backtest, dan monitoring realtime.
- Sulit menjelaskan alasan sebuah signal muncul.
- Sulit menyimpan strategi dan hasil analisis secara terstruktur.

SignalGen 2.0 menyatukan proses tersebut dalam satu aplikasi desktop dengan akun,
rule yang dapat dikustomisasi, screening, backtest, dan monitoring signal.

## 4. Product goals

### Primary goals

1. Pengguna dapat membuat akun dan masuk dengan aman.
2. Pengguna dapat membuat dan mengelola rule indikator tanpa menulis kode.
3. Pengguna dapat membuat daftar saham dan ticker universe.
4. Pengguna dapat menjalankan screening dan melihat alasan hasilnya.
5. Pengguna dapat menjalankan backtest dan membaca hasil performanya.
6. Pengguna dapat menjalankan engine dan menerima pembaruan signal.
7. Data pribadi pengguna tidak dapat diakses pengguna lain.
8. Aplikasi dapat dipasang dan dijalankan sebagai desktop application.
9. Web dapat menjelaskan produk dan menjadi pintu akun, subscription, payment,
   serta download aplikasi.

### Academic goals

1. Menunjukkan pengembangan nyata dari SignalGen versi senior.
2. Menunjukkan implementasi authentication dan authorization multi-user.
3. Menunjukkan pemisahan frontend, backend, database, dan external service.
4. Menunjukkan proses rule-based screening dan signal generation yang dapat
   dijelaskan serta diuji.
5. Menghasilkan progres yang dapat didemonstrasikan kepada dosen pembimbing.

## 5. Non-goals for the current scope

Fitur berikut tidak termasuk baseline dan tidak boleh menggeser prioritas:

- Auto-buy atau auto-sell ke akun broker.
- Pengelolaan dana pengguna.
- Jaminan atau prediksi pasti keuntungan saham.
- Social trading atau copy trading.
- Chat komunitas.
- Mobile application native.
- AI yang memberikan rekomendasi investasi personal.
- Migrasi otomatis seluruh SQLite ke Supabase/PostgreSQL.
- Microservices terpisah untuk setiap engine.
- Backend yang berbeda untuk web dan desktop.
- Multi-broker production integration selain integrasi yang sudah direncanakan.

Fitur non-goal hanya dapat masuk scope melalui change control.

## 6. Target users

### User — investor/trader

Pengguna yang ingin menyaring saham berdasarkan indikator teknikal, menyimpan
rule, melakukan backtest, dan memonitor signal tanpa menulis program.

Kebutuhan utama:

- Alur yang mudah dipahami.
- Penjelasan kenapa signal muncul.
- Data dan strategi tersimpan aman.
- Hasil screening dan backtest yang dapat ditinjau kembali.

### Admin

Pengelola produk yang menangani status akun, role, subscription, dan kebutuhan
operasional. Admin tidak otomatis boleh melihat secret atau password pengguna.

### Development team

Backend dan frontend developer yang membutuhkan kontrak API stabil, pembagian
tanggung jawab jelas, serta proses review sebelum perubahan masuk branch stabil.

## 7. Product surfaces

### Desktop application — primary

Desktop adalah tempat fitur analisis SignalGen digunakan:

- Authentication.
- Dashboard.
- Rule builder.
- Watchlist dan ticker universe.
- Scalping/realtime engine.
- Swing screening.
- Signal history.
- Backtesting.
- Settings dan notification.

### Web application — supporting

Web digunakan untuk:

- Landing page.
- Informasi fitur.
- Register/login dan account portal.
- Pricing dan subscription.
- Payment/checkout.
- Download desktop application.

Web bukan pengganti penuh aplikasi desktop pada baseline saat ini.

## 8. Roles and access

Baseline role:

| Role | Kemampuan |
| --- | --- |
| Guest | Melihat landing, pricing, register, dan login |
| User | Menggunakan fitur SignalGen dan hanya mengakses data miliknya |
| Admin | Mengelola kebutuhan administratif yang ditentukan kemudian |

Aturan wajib:

- Authentication membuktikan identitas user.
- Authorization menentukan resource yang boleh diakses user tersebut.
- User A tidak boleh membaca, mengubah, atau menghapus data User B.
- Pembatasan harus dilakukan di backend, bukan hanya menyembunyikan UI.
- Endpoint admin harus memvalidasi role di backend.

## 9. Core user journeys

### Journey A — account onboarding

```text
Register -> email confirmation jika aktif -> login -> session valid -> dashboard
```

Hasil yang diharapkan:

- User mendapatkan pesan yang jelas jika harus mengonfirmasi email.
- Login yang berhasil menghasilkan session.
- Session invalid/expired membawa user kembali ke login.
- User dapat logout.

### Journey B — create and use a rule

```text
Login -> buka Rule Builder -> pilih indikator/operator -> simpan rule
      -> pilih rule -> jalankan screening/engine -> lihat hasil dan alasan
```

### Journey C — screening

```text
Pilih ticker universe + rule + timeframe -> jalankan screening
-> lihat status proses -> lihat saham yang memenuhi rule -> buka detail/chart
```

### Journey D — backtest

```text
Pilih rule + ticker + periode + konfigurasi modal/exit -> jalankan backtest
-> lihat ringkasan hasil -> lihat detail trade -> simpan/lihat history
```

### Journey E — realtime signal

```text
Pilih watchlist + rule -> start engine -> monitor status dan harga
-> kondisi terpenuhi -> signal muncul realtime -> signal tersimpan
```

### Journey F — subscription and desktop access

```text
Buka web -> pilih plan -> payment -> subscription aktif
-> login/account portal -> download desktop -> login di desktop
```

Journey F adalah target setelah kontrak subscription dan payment backend selesai.

## 10. Functional requirements

Kode prioritas:

- `P0`: wajib untuk baseline tugas akhir/demo utama.
- `P1`: wajib sebelum produk dianggap lengkap sesuai rencana.
- `P2`: peningkatan setelah alur utama stabil.

### FR-AUTH — Authentication

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| AUTH-01 | P0 | User dapat register dengan nama, email, dan password | Data valid membuat akun; error aman dan mudah dipahami |
| AUTH-02 | P0 | Sistem mendukung email confirmation Supabase | UI menjelaskan langkah selanjutnya jika session belum tersedia |
| AUTH-03 | P0 | User dapat login | Credential valid menghasilkan access token dan data user |
| AUTH-04 | P0 | Sistem dapat memeriksa current user | Bearer token valid diterima `/api/auth/me`; token invalid menghasilkan `401` |
| AUTH-05 | P0 | User dapat logout | Session lokal dibersihkan dan halaman kembali ke login |
| AUTH-06 | P1 | Session dapat diperbarui | Refresh flow bekerja tanpa meminta login terus-menerus |
| AUTH-07 | P1 | User dapat meminta reset password | Email diarahkan ke halaman recovery yang benar dan password baru dapat dipakai |
| AUTH-08 | P1 | Role tersedia | Backend membedakan minimal user dan admin |

### FR-AUTHZ — Authorization and ownership

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| AUTHZ-01 | P0 | Endpoint data pribadi memerlukan user | Request tanpa token mendapat `401` |
| AUTHZ-02 | P0 | Data memiliki ownership | Resource pribadi menyimpan Supabase `user_id` |
| AUTHZ-03 | P0 | User hanya mengakses data sendiri | Percobaan akses resource user lain ditolak `403` atau disembunyikan sebagai `404` secara konsisten |
| AUTHZ-04 | P0 | CRUD selalu memfilter ownership | List, detail, update, dan delete tidak bocor antar-user |
| AUTHZ-05 | P1 | Endpoint admin memerlukan role | User biasa tidak dapat menjalankan fungsi admin |

Resource pribadi minimal meliputi custom rules, watchlists, signals, settings
personal, Telegram configuration, ticker universe personal, dan backtest history.
System rules atau reference data dapat menjadi data bersama jika ditandai jelas.

### FR-DASH — Dashboard

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| DASH-01 | P0 | Dashboard menampilkan status sistem | Loading, online/offline, dan error terlihat jelas |
| DASH-02 | P0 | Dashboard menampilkan ringkasan user | Minimal rule, watchlist, signal, dan recent activity |
| DASH-03 | P1 | Dashboard memperbarui status realtime | Perubahan engine/signal muncul tanpa reload manual |

### FR-RULE — Rule management

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| RULE-01 | P0 | User dapat melihat rule | Hanya rule sistem dan rule milik user yang tampil |
| RULE-02 | P0 | User dapat membuat rule tanpa kode | Operand, operator, value, dan logic dapat dipilih dari UI |
| RULE-03 | P0 | Rule divalidasi backend | Rule invalid ditolak dengan pesan yang dapat ditampilkan UI |
| RULE-04 | P0 | User dapat edit/delete rule miliknya | Ownership diperiksa pada backend |
| RULE-05 | P0 | User dapat memilih rule aktif | Status aktif konsisten setelah refresh |
| RULE-06 | P1 | UI menjelaskan rule | User dapat membaca kondisi dalam bahasa yang mudah dipahami |

### FR-WATCH — Watchlist and ticker universe

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| WATCH-01 | P0 | User dapat membuat watchlist | Nama dan ticker tervalidasi dan tersimpan |
| WATCH-02 | P0 | User dapat edit/delete watchlist | Hanya owner yang dapat mengubahnya |
| WATCH-03 | P0 | User dapat memilih watchlist aktif | Engine memakai watchlist yang dipilih |
| WATCH-04 | P0 | User dapat mengelola ticker universe | Universe dapat dipakai pada swing screening |
| WATCH-05 | P1 | UI menangani ticker invalid/duplikat | Pesan validasi terlihat sebelum atau setelah request |

### FR-SCREEN — Screening

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| SCREEN-01 | P0 | User dapat memilih rule, universe, dan timeframe | Request tidak dijalankan jika input wajib belum ada |
| SCREEN-02 | P0 | User dapat menjalankan swing screening | Hasil menampilkan ticker yang memenuhi kondisi |
| SCREEN-03 | P0 | Hasil dapat dijelaskan | Ticker menunjukkan rule/kondisi yang menyebabkan match |
| SCREEN-04 | P1 | User dapat melihat chart terkait | Periode dan ticker sesuai hasil yang dipilih |
| SCREEN-05 | P1 | Data historis dapat dipersiapkan | Backfill/cache memiliki status berhasil atau gagal yang jelas |

### FR-ENGINE — Realtime/scalping engine

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| ENGINE-01 | P0 | User dapat melihat status engine | Idle, starting, running, stopping, dan error dapat dibedakan |
| ENGINE-02 | P0 | User dapat memulai engine | Watchlist dan rule valid diperlukan |
| ENGINE-03 | P0 | User dapat menghentikan engine | Engine berhenti aman dan status UI diperbarui |
| ENGINE-04 | P0 | Signal tersimpan | Signal baru muncul di history dengan symbol, waktu, price, dan rule |
| ENGINE-05 | P1 | UI menerima event realtime | Socket.IO reconnect dan error ditangani |
| ENGINE-06 | P1 | Demo mode tersedia | Demo dapat berjalan tanpa IBKR dan diberi label simulated/demo |

### FR-BACKTEST — Backtesting

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| BACKTEST-01 | P0 | User dapat mengatur request backtest | Rule, symbol, timeframe, date range, dan source tervalidasi |
| BACKTEST-02 | P0 | User dapat mengatur modal dan biaya | Initial capital, sizing, commission, dan slippage digunakan dalam hasil |
| BACKTEST-03 | P0 | User dapat memilih exit strategy | Holding period, target/stop, atau exit signal tervalidasi |
| BACKTEST-04 | P0 | Hasil memiliki ringkasan | Minimal return/P&L, trade count, win/loss, dan detail trade tersedia jika didukung engine |
| BACKTEST-05 | P0 | Riwayat backtest tersimpan | User dapat membuka dan menghapus history miliknya |
| BACKTEST-06 | P1 | Hasil dapat diekspor | CSV yang dihasilkan sesuai hasil backtest yang dipilih |

### FR-SIGNAL — Signal history

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| SIGNAL-01 | P0 | User dapat melihat signal miliknya | List dapat dibatasi dan difilter symbol |
| SIGNAL-02 | P0 | Signal menampilkan konteks | Minimal symbol, time, price, dan rule tersedia |
| SIGNAL-03 | P0 | User dapat menghapus signal | Single delete dan clear history memeriksa ownership |
| SIGNAL-04 | P1 | Signal realtime muncul di UI | Event baru tidak membutuhkan page reload |

### FR-NOTIFY — Notification

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| NOTIFY-01 | P1 | User dapat menyimpan konfigurasi Telegram | Token/chat configuration tidak terlihat user lain |
| NOTIFY-02 | P1 | User dapat menguji konfigurasi | UI menampilkan hasil test dengan aman |
| NOTIFY-03 | P1 | Signal dapat dikirim ke Telegram | Hanya jika fitur diaktifkan user |

### FR-WEB — Public web and commercial flow

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| WEB-01 | P1 | Landing menjelaskan produk | Value, fitur, disclaimer, dan CTA jelas |
| WEB-02 | P1 | User dapat register/login dari web | Menggunakan identitas/backend yang sama dengan desktop |
| WEB-03 | P1 | Pricing menampilkan pilihan plan | Harga dan benefit berasal dari konfigurasi yang konsisten |
| WEB-04 | P1 | User dapat melakukan payment | Status payment diverifikasi backend, bukan hanya frontend |
| WEB-05 | P1 | Account menampilkan subscription | Status entitlement sesuai data backend |
| WEB-06 | P1 | User dapat download desktop | Build yang sesuai platform tersedia |

Payment provider dan detail paket belum dikunci oleh PRD ini. Keputusan tersebut
harus ditambahkan sebelum implementasi WEB-03 sampai WEB-05 dianggap selesai.

### FR-DESKTOP — Desktop shell and distribution

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| DESKTOP-01 | P0 | Aplikasi berjalan melalui Electron | Window membuka renderer dan flow utama dapat digunakan |
| DESKTOP-02 | P0 | Renderer terisolasi dari Node | `nodeIntegration` nonaktif, `contextIsolation` dan sandbox aktif |
| DESKTOP-03 | P0 | Native API dibatasi | Hanya API yang diperlukan diekspos melalui preload/context bridge |
| DESKTOP-04 | P1 | Lifecycle backend dikelola | Desktop dapat mendeteksi/start/stop backend lokal dengan pesan error jelas |
| DESKTOP-05 | P1 | Installer tersedia | Build platform target dapat dipasang dan dijalankan |
| DESKTOP-06 | P2 | Update mechanism tersedia | Versi baru dapat diperiksa dan dipasang dengan aman |

## 11. Business rules

1. Password tidak disimpan oleh database aplikasi; ditangani Supabase Auth.
2. Secret backend tidak pernah dikirim ke frontend.
3. Resource pribadi selalu terikat pada user ID.
4. Signal hanya dibuat berdasarkan rule dan input data yang digunakan engine.
5. Hasil simulated/demo harus diberi label agar tidak dianggap live market data.
6. Status subscription harus diverifikasi backend untuk fitur berbayar.
7. UI tidak menjadi satu-satunya pengaman authorization atau entitlement.
8. Rule sistem dapat dibaca bersama tetapi tidak dapat diubah user biasa.
9. Waktu penyimpanan harus konsisten dan dapat dikonversi untuk tampilan lokal.
10. Kegagalan external provider tidak boleh menghapus data user yang sudah ada.

## 12. UX requirements

- Bahasa utama antarmuka dapat menggunakan Bahasa Indonesia.
- Istilah teknikal penting boleh menggunakan istilah pasar yang umum.
- Setiap proses asynchronous memiliki loading state.
- Setiap daftar memiliki empty state.
- Form memiliki validasi dan pesan error yang dapat ditindaklanjuti.
- Destructive action memerlukan konfirmasi yang sesuai.
- Status demo, live, connected, disconnected, dan error mudah dibedakan.
- Tampilan utama desktop mendukung ukuran layar laptop yang umum.
- Navigasi mempertahankan konteks user dan tidak kehilangan input tanpa peringatan.
- Signal/backtest menyertakan konteks sehingga hasil dapat dijelaskan saat demo.

## 13. Non-functional requirements

### Security

- Tidak ada credential atau secret dalam Git dan frontend bundle.
- Token tidak ditulis ke log.
- Backend memvalidasi token serta ownership.
- Electron memakai context isolation, sandbox, preload terbatas, dan CSP.
- Input API divalidasi.
- Error publik tidak membocorkan stack trace atau secret.

### Reliability

- Backend mempunyai health endpoint.
- Kegagalan Supabase, data source, IBKR, Telegram, atau Socket.IO menghasilkan
  error yang jelas tanpa membuat aplikasi crash tanpa penjelasan.
- SQLite menggunakan lokasi persistent saat dijalankan dengan Docker.
- Operasi start/stop engine mencegah state ganda yang tidak konsisten.

### Performance

- UI tetap responsif selama screening/backtest.
- Pekerjaan berat tidak memblokir renderer Electron.
- List besar menggunakan limit/pagination atau mekanisme pembatasan yang sesuai.
- Realtime update tidak memicu render ulang seluruh aplikasi tanpa kebutuhan.

### Maintainability

- Backend menuju pola router -> service -> repository/integration.
- Frontend menuju pola page/component -> feature service/state -> API client.
- Kontrak API terpusat dan dapat diturunkan dari OpenAPI bila memungkinkan.
- Fitur baru disertai test sesuai risikonya.
- Refactor dan fitur besar tidak dicampur dalam satu Pull Request.

### Portability

- Backend development dapat dijalankan melalui Docker Compose.
- Frontend dependencies terkunci melalui lockfile.
- Desktop dirancang minimal untuk Windows dan macOS; Linux dapat didukung jika
  waktu dan pipeline memungkinkan.
- Build lintas platform dilakukan pada runner/platform terkait.

## 14. Data classification

### Private user data

- Profile dan account metadata.
- Custom rules.
- Watchlists dan personal ticker universe.
- Signals dan backtest history.
- Personal settings.
- Telegram configuration.
- Subscription/payment relationship.

### Shared/system data

- System rule templates.
- Supported indicator/operator schema.
- Public product/pricing information.
- Reference ticker data jika disediakan bersama.
- Application version dan public system metadata.

### Sensitive data

- Password.
- Access/refresh token.
- Supabase/service secret.
- Telegram bot token.
- Payment provider secret/webhook secret.
- Broker credential jika kelak digunakan.

Sensitive data tidak boleh tampil di log, screenshot demo, error response, atau
frontend bundle.

## 15. API and integration baseline

Backend development URL:

```text
http://127.0.0.1:3456
```

OpenAPI:

```text
http://127.0.0.1:3456/docs
```

Socket.IO development URL:

```text
http://127.0.0.1:8765
```

External integration baseline:

- Supabase Auth: account dan session.
- SQLite: operational application data.
- Yahoo data source/cache: historical market data sesuai kemampuan engine.
- IBKR: market data/live integration sesuai environment pengguna.
- Telegram: optional signal notification.
- Payment provider: belum dipilih/dikunci.

## 16. Delivery phases

### Phase 0 — Architecture baseline

- Monorepo dipisahkan menjadi backend, frontend web, dan frontend desktop.
- Docker backend tersedia.
- Context dan PRD dikunci.

### Phase 1 — Secure user foundation

- Authentication selesai.
- Refresh/reset flow selesai.
- Ownership column dan authorization diterapkan.
- Test isolation User A/User B tersedia.

### Phase 2 — Backend modularization

- Route dipindahkan bertahap dari `app.py` ke router.
- Service dan repository boundary diperjelas.
- API behavior dipertahankan.

### Phase 3 — Desktop frontend foundation

- Electron, renderer framework, dan toolchain ditentukan.
- Secure preload dibuat.
- API client, auth state, route guard, dan application shell tersedia.

### Phase 4 — Desktop feature migration

- Dashboard.
- Rules dan watchlists.
- Screening dan chart.
- Engine, realtime signal, dan history.
- Backtesting.
- Settings dan Telegram.

### Phase 5 — Web and subscription

- Landing dan account portal.
- Pricing/payment decision.
- Subscription/entitlement backend.
- Download desktop.

### Phase 6 — Packaging and release readiness

- Installer.
- Code signing jika diperlukan.
- Backend lifecycle integration.
- Security testing.
- End-to-end test dan demo scenario.

## 17. Success criteria

Baseline dianggap berhasil ketika:

1. Dua user dapat register/login dan hanya melihat data masing-masing.
2. User dapat membuat rule dan watchlist tanpa menulis kode.
3. User dapat menjalankan minimal satu screening sampai hasil dapat dijelaskan.
4. User dapat menjalankan minimal satu backtest sampai hasil tersimpan.
5. Engine demo atau data source yang tersedia dapat menghasilkan signal yang
   tampil di desktop.
6. Desktop dapat dijalankan sebagai Electron application.
7. Backend dapat dijalankan ulang dari clone melalui Docker dan dokumentasi.
8. Automated tests utama lulus.
9. Tidak ada secret di Git/frontend bundle.
10. Alur demo dapat dijalankan tanpa perubahan manual pada kode.

## 18. Demonstration scenario

Skenario demo utama untuk dosen pembimbing:

1. Menjalankan backend Docker dan menunjukkan health endpoint.
2. Membuka desktop application.
3. Register/login user.
4. Membuka dashboard dan identitas current user.
5. Membuat rule indikator.
6. Membuat watchlist/ticker universe IDX.
7. Menjalankan screening dan menjelaskan alasan ticker lolos.
8. Menjalankan backtest serta membaca hasilnya.
9. Menjalankan demo engine dan menunjukkan signal/realtime update.
10. Login sebagai user kedua dan menunjukkan data user pertama tidak dapat
    diakses.

Jika integrasi market live tidak tersedia saat demo, gunakan demo/simulated data
yang diberi label jelas.

## 19. Quality gates

Sebelum merge ke `develop`:

- Scope PR sesuai satu fitur atau refactor yang jelas.
- Test/lint/build bagian yang berubah berhasil.
- Tidak ada secret atau `.env` nyata.
- Error dan unauthorized state diuji jika relevan.
- API change dijelaskan.
- Satu anggota tim lain memberikan approval.

Sebelum merge `develop` ke `main`:

- Seluruh automated test wajib lulus.
- Docker backend dapat dibangun dan health check berhasil.
- Frontend production build berhasil.
- Skenario utama diuji secara manual.
- Migration dan environment example diperbarui.
- Tidak ada known blocker severity tinggi.
- Satu anggota tim lain memberikan approval.

## 20. Open decisions

Keputusan berikut masih terbuka dan tidak boleh diasumsikan sepihak:

- Framework renderer desktop dan web, dengan arah yang direkomendasikan
  React + TypeScript + Vite.
- Package manager serta versi Node.js.
- Payment provider.
- Struktur pricing dan subscription plan.
- Mekanisme penyimpanan token Electron yang final.
- Strategi packaging backend Python bersama Electron.
- Target operating system pertama untuk installer.
- Apakah seluruh data aplikasi tetap SQLite atau dimigrasikan bertahap ke
  Supabase/PostgreSQL setelah MVP.

Open decision bukan izin untuk mengubah arsitektur utama. Setelah diputuskan,
keputusan ditambahkan ke PRD melalui change control.

## 21. Change control

PRD ini tidak diubah hanya karena muncul ide baru saat implementasi.

Perubahan produk hanya diterima jika:

1. Ada masalah, kebutuhan user, atau kebutuhan akademik yang jelas.
2. Dampak terhadap scope, waktu, backend, frontend, database, dan testing ditulis.
3. Fitur yang harus ditunda atau ditukar disebutkan jika scope bertambah.
4. Kedua anggota tim menyetujui perubahan.
5. Perubahan dibuat melalui Pull Request khusus atau bagian PR yang jelas.
6. `PRD.md` dan `PROJECT_CONTEXT.md` diperbarui bila arsitektur ikut berubah.

Perubahan berikut tidak memerlukan perubahan scope PRD selama behavior tetap:

- Bug fix.
- Perbaikan visual minor.
- Penambahan test.
- Pemecahan file/module internal.
- Optimasi yang tidak mengubah hasil bisnis.

Perubahan berikut wajib melalui change control:

- Menambah atau menghapus fitur inti.
- Mengubah desktop menjadi web-only atau sebaliknya.
- Menambah backend kedua.
- Mengganti Supabase Auth.
- Mengubah ownership atau model role.
- Mengaktifkan auto-trading/order execution.
- Mengganti database utama.
- Mengganti batas web, desktop, dan backend.
- Mengubah prioritas delivery phase secara material.

## 22. Final definition of product done

SignalGen 2.0 dinyatakan selesai untuk baseline tugas akhir apabila seluruh
success criteria terpenuhi, P0 requirements selesai, tidak ada masalah keamanan
utama yang diketahui, dokumentasi dapat digunakan oleh developer lain setelah
clone, dan skenario demo berhasil dijalankan secara konsisten.

P1 yang belum selesai harus dilaporkan transparan sebagai remaining work. P2
tidak menghalangi kelulusan baseline kecuali kemudian disetujui sebagai kebutuhan
wajib oleh tim dan dosen pembimbing.
