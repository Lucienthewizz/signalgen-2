# Pembayaran Midtrans

Pembelian paket Analyst/Pro memakai Midtrans Snap. User membayar di popup
Snap, lalu paket aktif otomatis tanpa operator. Satu pembayaran memberi satu
bulan; tidak ada penagihan otomatis.

## Alur

1. Frontend memanggil `POST /api/v1/payments/checkout` dengan `plan_code`.
   Nominal diambil dari server (`PriceForPlan`), bukan dari browser.
2. Backend membuat order `pending` di `signalgen.payment_orders`, meminta Snap
   token ke Midtrans, lalu frontend membuka popup Snap.
3. Midtrans mengirim notifikasi ke
   `POST /api/v1/payments/midtrans/notification`. Backend menolak signature
   yang salah (`SHA512(order_id + status_code + gross_amount + Server Key)`),
   lalu membaca ulang status dari API Midtrans. Isi notifikasi tidak dipakai
   untuk memberi akses.
4. Jika status `settlement` (atau `capture` dengan fraud `accept`) dan
   nominalnya sama dengan order, order ditandai `paid` dan subscription
   diaktifkan dalam satu transaksi database. Notifikasi berulang tidak
   mengubah apa pun.
5. Frontend memeriksa `GET /api/v1/payments/orders/{id}`. Untuk order yang
   masih pending, backend juga membaca status Midtrans, sehingga paket tetap
   aktif walaupun notifikasi terlambat atau tidak sampai.

Aturan periode: membayar paket yang sama saat masih aktif menambah satu bulan
dari tanggal berakhir. Paket berbeda atau paket yang sudah berakhir dimulai
dari sekarang. Order yang gagal atau kedaluwarsa tidak mengubah akses, dan
order yang sudah `paid` tidak bisa berubah lagi.

## Konfigurasi

| Tempat | Variabel |
| --- | --- |
| `backend/.env` (rahasia) | `MIDTRANS_SERVER_KEY`, `MIDTRANS_IS_PRODUCTION=false` |
| `frontend/web/.env.local` | `VITE_MIDTRANS_CLIENT_KEY` |

Server Key cukup dengan izin **Snap Checkout: Write** dan **Core API: Read**.
Tanpa Server Key, endpoint pembayaran mengembalikan `503`. Tanpa Client Key,
dialog paket menampilkan bahwa pembayaran online belum disiapkan.

Backend tidak memuat `.env` otomatis. Muat variabelnya saat menjalankan API,
misalnya `set -a; source backend/.env; set +a`.

Migration `20261116120000_payment_orders.sql` harus diterapkan ke database
sebelum checkout dipakai. Saat Midtrans aktif, `/ready` gagal jika tabelnya
belum ada.

## Notification URL

Midtrans harus bisa menjangkau backend. Untuk demo lokal, jalankan tunnel
(misalnya `cloudflared tunnel --url http://localhost:8080`), lalu isi
**Settings → Payment → Notification URL** di dashboard Midtrans dengan
`https://<tunnel>/api/v1/payments/midtrans/notification`. URL tunnel berubah
setiap dijalankan ulang.

## Uji sandbox

- QRIS/VA: bayar lewat simulator sandbox Midtrans.
- Kartu: `4811 1111 1111 1114`, CVV `123`, tanggal kedaluwarsa di masa depan,
  OTP `112233`.

## Tes

- `go test ./internal/payments/ ./internal/api/tests/ -run 'Payment|Checkout|Notification|Status'`
- Tes Postgres (database sekali pakai yang sudah dimigrasi, misalnya setelah
  `cmd/schematest`):
  `PAYMENTS_TEST_DATABASE_URL=postgres://...@127.0.0.1:<port>/signalgen_test go test ./internal/payments/`
