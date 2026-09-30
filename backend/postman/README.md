# Postman test — SignalGen Go API

Koleksi ini mengikuti endpoint yang benar-benar tersedia di `backend/openapi.yaml`.
Nilai rahasia sengaja dikosongkan agar password dan token tidak masuk Git.

## 1. Jalankan backend

Pastikan `backend/.env` berisi konfigurasi Supabase, lalu dari root repository:

```bash
docker compose up --build -d go-api
docker compose ps go-api
```

Container harus `healthy`. Base URL lokal adalah `http://127.0.0.1:8080`.

## 2. Import dan isi environment

Import kedua file ini ke Postman:

1. `SignalGen-Go-API.postman_collection.json`
2. `SignalGen-Local.postman_environment.json`

Pilih environment **SignalGen Local**, lalu isi `email` dan `password` hanya di
Postman. Jangan commit atau mengekspor environment yang sudah berisi password,
access token, refresh token, app-session token, atau socket ticket.

Variabel lain diisi otomatis oleh test script. Variabel untuk folder opsional
harus diisi manual sebelum request dijalankan.

## 3. Tiga tingkat akses

| Tingkat | Header | Digunakan untuk |
|---|---|---|
| Publik | Tidak ada | status, health, register, login, recovery |
| Identitas Supabase | `Authorization: Bearer {{access_token}}` | `/api/auth/me` dan membuat app session |
| Sesi aplikasi | Bearer + `X-App-Session: {{app_session_token}}` | account, entitlement, rule, dataset, compute, dan operator |

Bearer token membuktikan identitas Supabase. `X-App-Session` adalah sesi milik
SignalGen yang mengikat user ke instalasi/perangkat dan bisa dicabut oleh backend.

## 4. Alur test utama

Selalu jalankan folder berikut lebih dulu:

1. `00 Public health`
2. `01 Authorization negative checks`
3. `02 Go authentication`
4. `03 App session and account`
5. `03A Subscription status` untuk membaca paket publik dan status subscription
   akun; folder ini tidak mengaktifkan akses atau melakukan payment.

Setelah itu pilih alur yang sesuai:

- **Akun baru tanpa entitlement:** jalankan
  `04 Optional entitlement denial - new user only`. Respons harus
  `403 ENTITLEMENT_REQUIRED`; ini membuktikan authorization bekerja.
- **Akun sudah punya entitlement screener:** lewati folder 04.
- **Sedang login sebagai operator:** folder `05 Operator entitlement` dapat
  memberi/memperpanjang grant atau mengaktifkan subscription MVP. Isi
  `operator_target_user_id` untuk user lain;
  jika kosong, collection otomatis memakai `user_id` akun yang sedang login.
- **Sedang login sebagai user biasa:** jangan menjalankan folder 05. Mintalah
  operator memberi grant, lalu login lagi sebagai user tersebut.

Setelah **Current account**, `user_id` tersimpan otomatis. Untuk database baru,
bootstrap akun itu menjadi operator pertama satu kali saja:

```bash
docker compose exec go-api \
  signalgen-admin bootstrap-operator \
  --user USER_ID \
  --reason "initial Postman operator" \
  --actor "local:postman"
```

Bootstrap hanya untuk database yang belum pernah memiliki operator. Jika sudah
ada operator, gunakan akun operator tersebut; jangan mencoba bootstrap lagi.

Setelah akun pengujian mempunyai entitlement:

1. Jalankan `06 User rule CRUD`.
2. Jalankan `07 Authorized screening Yahoo Finance`.
3. Uji WebSocket secara manual seperti bagian berikut.
4. Jalankan `99 Logout - run last` hanya setelah seluruh test selesai.

Folder 90–92 **jangan dijalankan sekaligus melalui Collection Runner**. Folder
tersebut berisi register/recovery dan tindakan yang dapat mengganti password,
mencabut sesi/perangkat/entitlement, atau mengubah role.

## 5. Uji WebSocket private scoring

Request **Create one-use screener socket ticket** menyimpan
`screener_socket_ticket`. Segera buat **New → WebSocket Request** di Postman:

```text
ws://127.0.0.1:8080/api/v1/screener/ws?ticket={{screener_socket_ticket}}
```

Kirim satu frame:

```json
{
  "type": "screener.evaluate",
  "protocol": "screener-private-1",
  "request_id": "postman-demo-1",
  "engine_version": "core-0.3.0",
  "feature_schema_version": "screener-features-1",
  "candidates": [
    {
      "symbol": "BBCA.JK",
      "timestamp": "2026-02-07T00:00:00Z",
      "features": {"price": 128, "ema9": 125, "ema20": 121, "rsi14": 72}
    }
  ]
}
```

Respons sukses bertipe `screener.result`. Nilai `matched` bergantung pada candle
dari Yahoo Finance. Ticket hanya dapat dipakai sekali dan berumur singkat.

## 6. Penjelasan setiap endpoint

### Operasional

| Method dan path | Fungsi | Akses |
|---|---|---|
| `GET /api` | Identitas dan status ringkas Go API untuk frontend. | Publik |
| `GET /health` | Memastikan proses API hidup; belum menjamin dependency siap. | Publik |
| `GET /ready` | Memastikan storage yang dibutuhkan sudah siap. | Publik |

### Authentication

| Method dan path | Fungsi | Akses |
|---|---|---|
| `POST /api/auth/register` | Membuat user Supabase dari `full_name`, `email`, dan `password`. Bisa meminta konfirmasi email. | Publik |
| `POST /api/auth/login` | Memvalidasi email/password melalui Supabase dan mengembalikan bearer access token. | Publik |
| `GET /api/auth/me` | Memverifikasi bearer token di server dan mengembalikan identitas publik user. Ini bukan login ulang. | Bearer |
| `POST /api/auth/password/reset-request` | Meminta email recovery. Respons dibuat sama untuk email terdaftar/tidak agar akun tidak mudah ditebak. | Publik |
| `POST /api/auth/password/reset` | Memakai recovery access token + refresh token untuk menetapkan password baru. | Publik dengan token recovery di body |

### Session dan account

| Method dan path | Fungsi | Akses |
|---|---|---|
| `POST /api/v1/sessions` | Mendaftarkan instalasi dan membuat app-session SignalGen setelah login Supabase. | Bearer |
| `DELETE /api/v1/sessions/current` | Logout dari app-session yang sedang dipakai. | Bearer + app session |
| `GET /api/v1/account/me` | Membaca profile, role, status, entitlement, session, dan device milik user saat ini. | Bearer + app session |
| `GET /api/v1/account/sessions` | Daftar metadata sesi user; tidak mengembalikan token mentah atau hash. | Bearer + app session |
| `DELETE /api/v1/account/sessions/:id` | Mencabut salah satu sesi milik user berdasarkan ID publik sesi. | Bearer + app session |
| `GET /api/v1/account/devices` | Daftar instalasi/perangkat milik user yang diringkas dari histori sesi. | Bearer + app session |
| `PATCH /api/v1/account/devices/:id` | Mengganti label perangkat atau mencabut seluruh sesi perangkat tersebut. Kirim tepat satu: `label` atau `status: revoked`. | Bearer + app session |

### Rule dan screening

| Method dan path | Fungsi | Akses |
|---|---|---|
| `GET /api/v1/capabilities` | Versi engine/schema/protocol dan fitur analisis yang backend dukung. | Bearer + app session |
| `GET /api/v1/rules` | Daftar baseline rule sistem dan rule pribadi yang terlihat oleh user. | Sesi + entitlement screener |
| `POST /api/v1/rules` | Membuat rule pribadi milik user. | Sesi + entitlement screener |
| `GET /api/v1/rules/:id` | Membaca satu rule yang boleh dilihat user. Definisi privat rule sistem tidak dibocorkan. | Sesi + entitlement screener |
| `PATCH /api/v1/rules/:id` | Memperbarui rule pribadi dengan version check agar update bersamaan tidak menimpa data diam-diam. | Sesi + entitlement screener |
| `DELETE /api/v1/rules/:id` | Menghapus rule pribadi dengan version check. | Sesi + entitlement screener |
| `GET /api/v1/stocks` | Membaca katalog tiga emiten IDX yang didukung. | Bearer + app session |
| `GET/POST /api/v1/stock-universes` | Membaca/membuat bundle saham milik user (maksimal tiga emiten). | Bearer + app session |
| `GET/PATCH/DELETE /api/v1/stock-universes/:id` | Membaca/mengubah/menghapus bundle owner dengan version check. | Bearer + app session |
| `POST /api/v1/datasets/prepare` | Menyiapkan snapshot Yahoo Finance dari `rule_id + universe_id`; tanggal dihitung backend. | Sesi + entitlement screener |
| `GET /api/v1/datasets/:id/manifest` | Membaca metadata dan binding dataset tanpa seluruh candle. | Sesi + entitlement screener |
| `GET /api/v1/datasets/:id/content` | Mengambil isi OHLCV yang akan dihitung menjadi fitur di client/WASM. | Sesi + entitlement screener |
| `POST /api/v1/compute-grants` | Membuat izin komputasi singkat yang mengikat user, dataset, rule, engine, dan schema. | Sesi + entitlement screener |
| `POST /api/v1/screener/socket-tickets` | Menukar compute grant menjadi ticket WebSocket satu kali pakai. | Sesi + entitlement screener |
| `GET /api/v1/screener/ws?ticket=...` | Upgrade ke WebSocket untuk private scoring; dites lewat tab WebSocket, bukan REST runner. | Ticket satu kali pakai |

### Operator

| Method dan path | Fungsi | Akses |
|---|---|---|
| `GET /api/v1/operator/grants?user_id=...` | Melihat grant aktif, kedaluwarsa, dan dicabut milik target user. | Operator |
| `POST /api/v1/operator/grants` | Memberi atau memperpanjang entitlement `screener`/`backtest` beserta alasan audit. | Operator |
| `DELETE /api/v1/operator/grants/:user_id/:feature` | Mencabut entitlement dan menulis audit event. | Operator |
| `PATCH /api/v1/operator/accounts/:user_id/role` | Promote user menjadi operator atau demote menjadi user. Operator aktif terakhir tidak boleh didemote. | Operator |
| `POST /api/v1/operator/subscriptions` | Mengaktifkan/mengganti paket secara manual untuk MVP. Actor berasal dari sesi operator dan event tersimpan; ini bukan bukti payment. | Operator |

### Subscription

| Method dan path | Fungsi | Akses |
|---|---|---|
| `GET /api/v1/subscription/plans` | Daftar paket aktif dan mapping fitur. Harga tidak dikirim sebelum keputusan komersial final. | Publik |
| `GET /api/v1/subscription` | Membaca subscription milik akun saat ini; hasil `null` bila belum ada. | Bearer + app session |
| `POST /api/v1/subscription/cancel` | Membatalkan subscription sendiri sekarang atau menjadwalkan akhir periode. | Bearer + app session |

## 7. Folder opsional

- `90 Optional authentication lifecycle`: isi `register_email`,
  `register_password`, `reset_email`, `recovery_access_token`,
  `recovery_refresh_token`, dan `new_password` sesuai request yang ingin diuji.
- `91 Optional account revocation`: isi `target_session_id` atau
  `target_device_id` dari endpoint list. Jangan memilih sesi/perangkat sekarang
  jika masih ingin melanjutkan test.
- `92 Optional operator administration`: isi `operator_target_user_id`,
  `operator_target_feature`, `operator_reason`, dan `target_role`.

## 8. Hasil utama yang diverifikasi otomatis

- route publik hidup dan request privat tanpa bearer ditolak;
- login Go menghasilkan access token Supabase dan `/api/auth/me` memverifikasinya;
- app-session terikat pada user/perangkat dan token mentah tidak bocor;
- body JSON di atas 64 KiB ditolak;
- ownership, entitlement, dan role operator diterapkan;
- rule pribadi memakai optimistic version check;
- dataset, compute grant, dan socket ticket saling terikat;
- ticket private-scoring hanya dapat dipakai sekali;
- pencabutan sesi berlaku pada request berikutnya.
