# Panduan membaca backend SignalGen

Produk aktif adalah aplikasi web multi-user. Backend memakai Go/Gin;
Supabase Auth menyediakan identitas dan Postgres menyimpan data aplikasi.
Kode Python, Electron, dan adapter SQLite adalah referensi lama, bukan arah
pengembangan produk baru. Tidak perlu menghapusnya untuk menjalankan API web.

## Mulai dari satu alur

```text
Browser mengirim request
  → routes.go menentukan endpoint
  → internal/api/<fitur>/handlers.go membaca input dan identitas
  → service fitur menjalankan aturan/alur bisnis
  → repository membaca/menulis data dengan owner ID
  → handler mengirim respons
```

Tidak semua fitur membutuhkan service tambahan. CRUD sederhana boleh langsung
memanggil repository setelah guard dan validasi input. Service berguna ketika
satu operasi menggabungkan beberapa dependency atau kebijakan bisnis.

## Padanan dengan Express

| Di JavaScript | Di backend ini |
|---|---|
| Entry point dan dependency setup | `cmd/api/main.go` |
| Router | `internal/<fitur>/routes.go` |
| Controller | `internal/api/<fitur>/handlers.go` |
| Kontrak dependency | `internal/<fitur>/contracts.go` |
| Business service | Contohnya `internal/screener/authorization.go` |
| Database repository | `internal/<fitur>/repository.go` |
| Utility infrastruktur | `internal/platform/` |
| Perhitungan tanpa HTTP/database | `core/` |

`contracts.go` berisi interface: daftar operasi yang diperlukan pemanggil.
Interface tidak menjalankan query. Implementasinya berada di repository atau
provider yang dipasang saat startup. Nama `Service` pada interface bukan berarti
file itu berisi seluruh implementasi bisnis.

Contoh lain adalah `internal/compute/issuance.go`: service ini memeriksa izin
fitur, membaca dataset dan rule milik owner, membandingkan versi/checksum,
lalu meminta repository menyimpan compute grant. `api/compute/handlers.go`
hanya menangani request/response; `api/compute/errors.go` menerjemahkan error.
Owner dan session ID diambil dari credential terverifikasi, bukan body JSON.

`internal/dataset/service.go` memeriksa entitlement dan ownership rule sebelum
menyiapkan dataset. Untuk pembacaan manifest/content, izin diperiksa berdasarkan
purpose snapshot milik user. Jika izin dicabut, service tidak mengembalikan byte
OHLCV maupun metadata. Mekanisme provider/cache tetap ada di repository dataset.
Handler di `api/datasets/` hanya menangani input, guard, error HTTP, dan header.

## Contoh alur screening

1. User login dan mendapat bearer token identitas.
2. API memverifikasi identitas, sesi aplikasi, dan entitlement.
3. User memilih rule dan stock universe miliknya; backend menyiapkan snapshot
   OHLCV dari provider, lalu mengikatnya pada compute grant.
4. Browser menghitung feature dengan Go/WASM dan mengirimnya lewat WebSocket
   yang dibuka menggunakan ticket sekali pakai.
5. `screener/authorization.go` mengecek ulang izin, grant, dataset, dan rule.
6. `screener/decision.go` menjalankan keputusan per simbol menggunakan `core`.
7. File API mengirim hasil atau error dalam envelope WebSocket.

Koneksi WebSocket bukan bukti bahwa izin berlaku selamanya. Izin dapat berubah
saat client menghitung; karena itu pemeriksaan ulang tetap diperlukan.

## Cara membaca test

Semua test kontrak API berada di `internal/api/tests/`, terpisah dari handler.

- `*_handlers_test.go`: kontrak endpoint dan penolakan akses per fitur.
- `server_http_test.go`: health, readiness, CORS, body limit, dan rate limit.
- `screener_transport_test.go`: lifecycle ticket dan WebSocket.
- `test_helpers_test.go`: fake dependency dan assertion bersama.
- `legacy_integration_test.go`: pembanding SQLite, bukan runtime aktif.
- `postgres_integration_test.go`: integrasi penyimpanan aktif; baca syarat
  environment pada test sebelum menjalankannya.

## Dua folder yang namanya mirip

`internal/api/rules/` menangani request HTTP seperti body JSON dan status error.
`internal/rules/` memiliki model, kontrak, dan penyimpanan rule pribadi.
Begitu juga `api/screener/` adalah adapter WebSocket, sedangkan
`internal/screener/` berisi policy authorization dan evaluasi keputusan.
Pemilahan ini membuat perubahan transport tidak mencampuri perhitungan atau SQL.

Di root `api`, baca `server.go` untuk startup dan `routes.go` untuk daftar
penghubung fitur. Folder `shared/` hanya memuat dependency bersama, guard akses,
dan pemetaan respons; bukan tempat menaruh seluruh logika bisnis baru.

## Batas yang perlu dijelaskan saat asis

Struktur ini dirapikan bertahap, bukan klaim seluruh handler sudah tipis.
Alur dataset, compute grant dan authorization screening berada di service domain;
sebagian alur handler lain masih perlu dipisahkan bertahap.
Snapshot/cache/ticket masih process-local, sehingga
deployment multi-replica membutuhkan desain lanjutan.
Status fitur dan pekerjaan terbuka berada di `BACKEND_PROGRESS.md`; struktur
folder saja bukan bukti semua fitur PRD atau evaluasi Model A/B telah selesai.
