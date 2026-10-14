# Lima sesi untuk pengujian lokal

Pengguna meminta 5 sesi aplikasi aktif per akun agar browser testing tidak
mengeluarkan browser lain. Ini bukan 5 percobaan password atau 5 saham per run.

Default tetap `SIGNALGEN_MAX_ACTIVE_SESSIONS=1`. Repository Postgres sekarang
menerima nilai 1..5. Pakai override lokal secara eksplisit:

```sh
docker compose -f docker-compose.yml -f docker-compose.testing.yml up -d --build go-api
```

Override menetapkan 5 sesi dan origin development 127.0.0.1:5174/5175. Jangan
deploy override ini ke production. Konfigurasi cloud Auth, akun, entitlement,
RLS dan data sesi lama tidak dihapus/diedit manual.

## Kebijakan

- Mode 1 mempertahankan exclusive-device rotation dan cooldown sebelumnya.
- Mode 2..5 memperbolehkan browser berbeda sampai batas. Cooldown pergantian satu
  perangkat eksklusif tidak berlaku dalam mode yang mengizinkan beberapa perangkat.
- Login ulang pada installation/browser yang sama mengganti token instalasi itu
  saja. Token sebelumnya revoked; browser lain tidak ikut dicabut.
- Sesi expired/revoked tidak dihitung. Browser ke-6 ditolak sebelum sesi lain
  diubah. User lock dan transaction menjamin request bersamaan tidak melampaui 5.
- Role/status/suspend, expiry, hash token, owner binding dan socket session
  verification tetap berlaku. Tidak ada token yang disimpan plaintext di DB/log.

Konfigurasi hanya dibaca saat API startup; perubahan ENV membutuhkan restart
Go API. Sesi database tetap bertahan. Kembali ke default dengan Compose tanpa
override **tidak otomatis menghapus sesi testing lama**. Logout/revoke perangkat
testing melalui alur akun yang berizin; pembuatan sesi baru dalam mode 1 kembali
menerapkan kebijakan eksklusif. Jangan melakukan bulk-delete sesi cloud untuk tes.

## Bukti pengujian

Unit tests menolak konfigurasi di luar 1..5, menjaga default cooldown, memeriksa
capacity/filter owner-installation-expiry serta tidak mencabut browser lain.
Tes Postgres 16 lokal sementara membuktikan 5 sesi valid, sesi ke-6 ditolak,
relogin pada slot yang sama, cross-owner denial, dan 10 login paralel menghasilkan
tepat 5 berhasil / 5 ditolak. Tes memakai akun sintetis dalam database lokal
bernama `signalgen_session_policy_test`, bukan akun/cloud nyata; container
pengujian beserta data sementara sudah dihapus setelah tes.

Go API lokal berhasil restart dengan limit 5, `/health` dan `/ready` 200, serta
`/api/v1/stocks` tanpa login tetap 401. Container Python/legacy tidak diganti.

```sh
go test -race ./internal/session ./internal/api/tests
# Opt-in only for the explicitly named local scratch DB, never cloud:
go test -race -v ./internal/session -run TestPostgresMultiSessionPolicy
```

Tes Postgres opt-in membutuhkan `SIGNALGEN_SESSION_POLICY_TEST_DSN`, diperiksa
agar host localhost/127.0.0.1 dan nama DB tepat. Tidak ada DSN/kredensial di source.
