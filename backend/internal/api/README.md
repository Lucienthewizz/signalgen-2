# API HTTP SignalGen

Folder ini adalah lapisan HTTP/WebSocket, bukan tempat SQL atau rumus indikator.

Mulai dari `server.go` (pemasangan dependency), lalu `routes.go` (penghubung
endpoint). Pengaturan startup berada di `config.go`; kontrak dependency di
`contracts.go`; fallback yang aman di `defaults.go`.

## Gin dan bentuk handler

Semua route REST/HTTP aktif didaftarkan ke Gin melalui
`internal/platform/http/router.go`. `routes.go` memasang adapter ini dan
menghubungkan daftar URL tiap domain dengan handler di folder fitur.
Handler sengaja berbentuk `http.HandlerFunc`: adapter Gin meneruskan writer,
request, dan parameter URL ke handler. Ini bukan router tanpa framework;
Gin mengurus routing/recovery, sementara helper bersama mengurus kontrak JSON.

Satu pengecualian adalah `GET /api/v1/screener/ws`: upgrade koneksi memakai
writer `net/http` asli untuk kompatibilitas dengan `coder/websocket`.
Request ID dan CORS membungkus REST maupun WebSocket. Route REST baru wajib
melewati adapter Gin yang sama; service/repository tidak perlu mengimpor Gin.

| Folder | Tanggung jawab |
|---|---|
| `auth/` | Login, register, refresh identitas, profil publik, recovery password |
| `account/` | Ringkasan akses akun, daftar sesi, pengelolaan perangkat |
| `sessions/` | Membuat, mencabut, dan merotasi secret sesi aplikasi |
| `rules/` | HTTP CRUD rule pribadi dan metadata rule sistem |
| `universes/` | Katalog saham bersama dan kelompok saham pribadi |
| `datasets/` | Menyiapkan dan mengirim snapshot OHLCV terproteksi |
| `compute/` | Penerbitan izin perhitungan untuk konteks yang terverifikasi |
| `screener/` | Ticket, WebSocket, kontrak pesan dan pemanggilan service |
| `subscriptions/` | Paket, subscription pengguna dan aktivasi operator |
| `operator/` | Perubahan grant/role yang membutuhkan operator dan audit |
| `system/` | Health, readiness, status API dan versi kemampuan engine |
| `shared/` | Dependency injection, guard umum dan pemetaan error |
| `tests/` | Test endpoint lintas-fitur, WebSocket dan integrasi penyimpanan |

Setiap folder fitur memiliki `handler.go` untuk struktur Handler dan
`handlers.go` untuk operasi endpoint. File tambahan hanya ketika diperlukan,
misalnya `screener/protocol.go` atau `sessions/rotation.go`.
Pada `compute/`, handler memanggil service domain `internal/compute/issuance.go`;
`errors.go` hanya menerjemahkan error domain menjadi kontrak HTTP yang stabil.
Pada `datasets/`, `service.go` memasang service akses dari `internal/dataset/`.
Prepare/read policy ada di domain; retry header, ETag, dan respons ada di API.
Pada `screener/`, `handlers.go` menangani ticket dan `websocket_handler.go`
menangani satu batch WebSocket. `observation.go` mengukur tahap/outcome tanpa
menyimpan payload; observer domain dipasang melalui dependency injection.
Logger/counter berada di `internal/platform/observability`, bukan di rumus core.
Pada `operator/`, `accounts.go` memetakan listing/status/audit ke kontrak
`account.ManagementRepository`. SQL dan transaksi ada di
`internal/account/management_repository.go`. Route baru tidak masuk `app.py`
atau menjadi handler besar pada server composition root.

`api/rules` dan `internal/rules` bukan duplikasi: yang pertama menangani HTTP,
yang kedua model dan persistence. Jangan mengimpor parent `api` dari subfolder
handler; gunakan domain contract atau `shared` agar tidak ada circular import.

`shared.Context` hanya dipasang saat startup. Jangan mengubah dependency-nya
ketika server melayani request. Test memakai dependency palsu; bukan akun atau
credential production. Jalankan dari `backend/`:

```bash
go test -race ./internal/api/...
```

Test Postgres memerlukan database test lokal terisolasi dan bersifat opt-in.
URL endpoint dan bentuk JSON tidak berubah karena pengelompokan folder ini.
