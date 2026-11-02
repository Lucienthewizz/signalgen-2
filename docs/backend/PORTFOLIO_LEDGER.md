# Ledger portofolio manual

Checkpoint 3 November 2026: API `0.16.0`, schema `portfolio-ledger-1`, kebijakan
`weighted-average-fees-1`. Ledger baru disetujui pengguna; jurnal masuk–keluar
lama dan arsip backtest tetap utuh, tanpa konversi otomatis. Ini fitur backend;
halaman portfolio frontend belum dihubungkan ke endpoint ini.

## Alur dan pembagian file

Semua route REST melewati Gin (`internal/api/routes.go`). Handler
`internal/api/portfolio/handler.go` memeriksa bearer, app-session aktif, status
akun, rate limit, UUID, dan JSON ketat. Pemilik berasal dari identitas server,
bukan body. Tidak menambahkan entitlement berbayar untuk pencatatan manual.

`internal/portfolio/model.go` memvalidasi input; `calculate.go` menghitung ulang
holding dan laba/rugi; `store.go` menyimpan melalui `pgxpool` ke tabel privat
`signalgen.portfolio_transactions`. PostgreSQL memaksakan ownership melalui RLS
dan FORCE RLS. Konteks pemilik bersifat transaction-local, sehingga tidak bocor
ke akun berikutnya saat koneksi pool dipakai ulang.

BUY menambah jumlah dan modal termasuk biaya beli. SELL mengurangi jumlah dan
modal memakai rata-rata tertimbang; biaya jual mengurangi hasil penjualan.
Perhitungan memakai `big.Rat` dari string desimal, bukan `float64`. Pembulatan
enam desimal hanya saat output; angka rata-rata yang sudah dibulatkan tidak
dipakai sebagai input perhitungan berikutnya.

Contoh: BUY 200 lembar @4.000, biaya 1.000 → modal 801.000, rata-rata 4.005.
SELL 100 @5.000, biaya 1.000 → hasil bersih 499.000, modal terjual 400.500,
laba terealisasi **98.500**, sisa 100 lembar dengan modal 400.500.
Biaya yang dilaporkan adalah jumlah biaya, jangan dikurangkan lagi dari laba.

## Kontrak untuk frontend dan Postman

Header: `Authorization: Bearer <access_token>` dan `X-App-Session` yang aktif.
Respons privat `Cache-Control: private, no-store`. Semua angka uang dan jumlah
adalah **string desimal** (maksimal enam digit pecahan), bukan angka JSON.

| Method | Route | Hasil |
| --- | --- | --- |
| GET | `/api/v1/portfolio` | Holding, modal, realized P&L, total dan warning |
| GET | `/api/v1/portfolio/transactions` | Daftar transaksi terurut waktu lalu UUID |
| GET | `/api/v1/portfolio/transactions/{id}` | Satu transaksi milik akun |
| PUT | `/api/v1/portfolio/transactions/{id}` | Create `version:0` atau replace dengan versi terkini |
| DELETE | `/api/v1/portfolio/transactions/{id}` | Hapus dengan body `{"version":1}` sesuai versi terkini |

Dua GET daftar/ringkasan menerima `?market=IDX&book=Main`; hanya pasangan filter
tersebut yang diterima. Filter tidak memotong riwayat waktu atau sisi transaksi,
sehingga BUY yang diperlukan untuk menghitung SELL tidak hilang.

Generate UUID lowercase nonzero satu kali per draft. Contoh PUT:

```json
{
  "version": 0,
  "data": {
    "symbol": "BBCA.JK",
    "market": "IDX",
    "currency": "IDR",
    "side": "BUY",
    "quantity": "200",
    "price": "4000",
    "fee": "1000",
    "executed_at": "2026-09-01T02:00:00Z",
    "book": "Main",
    "note": "Catatan transaksi manual"
  }
}
```

Untuk contoh SELL gunakan **UUID berbeda**, `side:SELL`, quantity `100`, price
`5000`, fee `1000`, waktu `2026-09-02T02:00:00Z`, book dan simbol sama. GET
ringkasan menghasilkan angka pada contoh di atas. Gunakan akun/buku uji dan
review permintaan sebelum menyimpan; endpoint mencatat data, bukan order broker.

- Maksimal 1.000 transaksi per akun. Saat penuh, edit/hapus dan retry create
  identik tetap berfungsi. Daftar tidak diam-diam dipotong menjadi 1.000.
- Jumlah maksimal 100 juta lembar, harga per lembar maksimal 1 miliar, biaya dan
  notional masing-masing maksimal 1 triliun dalam mata uang pasar tersebut.
- IDX memakai simbol `.JK`, IDR, kelipatan 100 lembar; AS memakai USD dan boleh
  pecahan. Simbol diperiksa sintaksnya; pencatatan historis tidak mensyaratkan
  saham masih ada pada katalog aktif atau menyediakan quote saat ini.
- `executed_at` RFC3339 maksimal presisi mikrodetik, disimpan UTC; toleransi
  waktu masa depan lima menit. Urutan sama-waktu ditentukan UUID. Jika urutan
  eksekusi penting, isi timestamp berbeda dan benar.
- Idempotensi: ulangi create dengan UUID, `version:0`, dan data identik untuk
  menerima record versi satu yang sama. Payload berbeda atau record yang sudah
  diedit menghasilkan conflict. Edit memakai versi yang diterima dari GET.
- Penulisan diserialkan per akun dengan transaction advisory lock. Riwayat
  kandidat dihitung ulang sebelum commit; edit/hapus BUY tidak boleh membuat
  SELL berikutnya melebihi kepemilikan. Dua SELL bersamaan tidak dapat menghabiskan
  lembar yang sama. Permintaan gagal tidak meninggalkan perubahan parsial.
- `400`: JSON/tipe/field tidak dikenal; `422`: nilai/lot/timestamp/filter invalid;
  `404`: record tidak ada/milik akun lain; `409`: `VERSION_CONFLICT`,
  `INSUFFICIENT_HOLDINGS`, `PORTFOLIO_LIMIT`; `429`: ikuti `Retry-After`;
  `503/504`: kegagalan penyimpanan/timeout. Setelah respons penulisan hilang,
  GET ID yang sama untuk memastikan hasil sebelum mencoba ulang. Jangan otomatis
  mengganti UUID atau menghapus sesi pada error sementara.

## Batas dan pengujian

Total dipisahkan per buku, pasar dan mata uang; tidak menjumlahkan IDR dengan USD.
Posisi yang sudah habis tetap terlihat dengan quantity/modal nol dan average
cost null. `market_value` dan `unrealized_pnl` selalu **null** karena belum ada
valuasi quote; bukan nol dan bukan klaim untung/rugi berjalan.

Belum ada saldo kas, FX, FIFO/pajak, short selling, penyesuaian split/dividen,
sinkronisasi broker atau impor jurnal otomatis. Catatan manual bukan bukti fill.

Tes unit memakai angka desimal exact, partial/full sale, biaya, pemisahan buku,
mata uang, tanggal dan oversell. Tes API memeriksa auth/sesi/status, forged owner,
P&L palsu, tipe angka JSON dan error yang tidak membocorkan detail database.
Tes PostgreSQL lokal memakai role runtime, RLS WITH CHECK, pool reuse, CAS,
rollback edit/hapus, quota 1.000, readiness FORCE RLS dan delapan SELL bersamaan.

```sh
# Hanya database disposable lokal bernama signalgen_test, sudah diberi migration.
PORTFOLIO_TEST_DATABASE_URL='<local-disposable-url>' go test -race ./internal/portfolio
go test -race ./...
```

Pengujian cloud pada delivery hanya memeriksa schema/migration/RLS/readiness;
tidak menambahkan transaksi ke akun asli. Status bukti akhir:
[backend progress](BACKEND_PROGRESS.md).
