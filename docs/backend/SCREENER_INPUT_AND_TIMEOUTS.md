# Validasi input dan batas waktu screening

Perbaikan 20 Oktober 2026. Model A tetap sama: browser/Go-WASM menghitung
indikator, backend memeriksa izin lalu mengevaluasi rule. Tidak ada migration,
perubahan password, kenaikan entitlement, atau perubahan rumus RSI/EMA.

## 1. Tidak ada data bukan berarti angka nol

Feature vector wajib mengirim empat angka: `price`, `ema9`, `ema20`, `rsi14`.
`core/features_json.go` memakai pointer sementara saat decoding agar dapat
membedakan field hilang/null dari angka nol yang benar-benar dikirim.

| Input RSI pada rule BUY `RSI14 < 30` | Perilaku sekarang |
| --- | --- |
| `40` | Tidak match |
| `0` | Match/BUY; nol adalah RSI sah |
| Field tidak dikirim | `screener.error`, `INVALID_MESSAGE` |
| `null` atau string | `screener.error`, `INVALID_MESSAGE` |

Semua field angka wajib ada. Unknown fields tetap ditolak. Setelah decoding,
core tetap memeriksa nilai finite, harga/EMA positif, RSI 0–100, simbol, kronologi,
dan batas kandidat. Candle mentah juga ditolak jika OHLC NaN/Inf atau volumenya
negatif; volume nol diperbolehkan. NaN/Inf bukan angka JSON standar, tetapi tetap
diperiksa pada API core Go agar pemanggil native baru tidak melewati validasi.

Tes regresi WebSocket memakai rule dan dependency lokal, bukan akun/database
Supabase. Kasus field hilang/null sebelumnya terbukti menghasilkan BUY keliru.

## 2. Batas waktu harus mencakup seluruh batch

Timeout socket HTTP tidak otomatis membatalkan pekerjaan di dalam handler.
Urutan proteksi saat menyiapkan dataset:

1. Middleware memberi `POST /api/v1/datasets/prepare` budget total 10 detik,
   termasuk verifikasi akses dan menunggu harga.
2. Cache mengerjakan maksimal tiga saham sekaligus per batch, bukan sepuluh
   berurutan. Batas global upstream yang sudah ada tetap delapan flight.
3. Response order tetap sama dengan instrument order. Kegagalan satu saham
   menggagalkan batch, bukan dilaporkan sebagai hasil parsial atau No match.
4. Jika context habis, penantian berhenti dan backend mengirim HTTP 504 JSON
   `REQUEST_TIMEOUT` dengan request ID, sebelum write timeout/browser 15 detik.
5. Request yang sudah batal tidak menerbitkan snapshot baru. Shared fetch boleh
   selesai dalam timeout independen 15 detik untuk melayani waiter pengguna lain.

Mutasi bisnis lain tidak otomatis diulang atau diberi kebijakan baru. WebSocket
tetap memakai batas lifecycle sendiri. Perubahan ini bukan jaminan Yahoo selalu
tersedia dan bukan alasan mengabaikan 429/Retry-After dari provider.

Simulasi regresi: sepuluh saham dengan provider buatan 1,6 detik/saham sebelumnya
butuh sekitar 16 detik dan menghasilkan EOF. Setelah perbaikan, cold request
berhasil sekitar 6,41 detik; warm request menggunakan cache. Ini bukti lokal
untuk skenario tersebut, bukan benchmark Yahoo atau kapasitas produksi.

## 3. Kontrak hasil BUY/SELL

`backend/contracts/hybrid-screener.schema.json` sekarang mengizinkan
`signal_type: BUY|SELL`, mewajibkannya untuk `matched: true`, dan melarangnya
untuk `matched: false`. Tidak match/cooldown bukan sinyal jual otomatis.

Tes memakai validator JSON Schema draft 2020-12 pada respons WebSocket aktual,
bukan hanya string fixture. Validator Go dipin ke v6.0.3 dan hanya diimpor tes;
validator tersebut tidak dipasang pada setiap request API. Source stage Docker
juga menyertakan folder contracts agar target test dapat membaca schema.

## 4. Menjalankan tes

Dari folder `backend`:

```sh
SIGNALGEN_RUN_WASM_INTEGRATION=1 go test -race ./...
go vet ./...
go test -race -count=1 -v ./internal/api/tests -run 'TestPrepareTenSlowColdStocksReturnsManifestBeforeHTTPWriteTimeout|TestScreenerRequiresCompleteNumericFeaturesAndMatchesJSONSchema'
```

Pengujian Postgres/RLS opt-in membutuhkan database lokal terisolasi melalui
`SIGNALGEN_TEST_PG_URL`; tidak otomatis dijalankan terhadap database cloud.
Lihat `backend/README.md` untuk build pasangan WASM/runtime/manifest.

## 5. Batas keamanan yang tidak berubah

Menolak payload tidak lengkap tidak membuktikan keaslian angka valid yang dikirim
client. Client tetap bisa memalsukan feature vector yang terlihat sah. Owner,
session, entitlement dan dataset binding tetap diperiksa, tetapi private scoring
bukan bukti transaksi, kompetisi atau billing. Tidak ada rekomputasi penuh server
atau perubahan trust model yang disisipkan pada perbaikan ini.
