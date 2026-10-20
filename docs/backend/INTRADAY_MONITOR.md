# Start–Stop dan candle intraday

Keputusan pengguna, 20 Oktober 2026: pengalaman Start–Stop seperti aplikasi
Claudio, tetapi tetap Model A web multi-user. Ini polling historis Yahoo,
**bukan feed real-time berlisensi, IBKR, atau auto-trading**.

## Alur yang dipelajari

1. Login; pilih rule, universe 1–10 saham satu pasar, dan interval.
2. Start: server memeriksa sesi, entitlement dan ownership; mengambil OHLCV.
3. Browser menghitung EMA9, EMA20 dan RSI14 dengan Go/WASM.
4. Server menilai rule melalui grant + ticket WebSocket sekali pakai.
5. Browser menampilkan hasil, lalu menunggu pemeriksaan berikutnya.
6. Stop membatalkan pekerjaan halaman itu. Navigasi/logout/penutupan halaman juga
   menghentikannya; membuka halaman kembali tidak otomatis Start.

## Interval tidak sama dengan jadwal polling

| Interval candle | Riwayat awal | Perluasan hanya bila candle valid <20 | Polling setelah siklus selesai | TTL harga bersama |
| --- | --- | --- | --- | --- |
| 1m | 3 hari kalender | 7 hari | 1 menit | 30 detik |
| 5m (default UI) | 3 hari kalender | 7, lalu 30 hari | 5 menit | 60 detik |
| 15m | 3 hari kalender | 7, lalu 30 hari | 15 menit | 180 detik |
| 1h | 3 hari kalender | 7, lalu 30 hari | 15 menit | 300 detik |
| 1d | 6 bulan | tidak diperluas | 15 menit | 300 detik |

Misalnya Senin pagi baru ada satu candle 5 menit. Riwayat Jumat membantu
menyiapkan indikator. Tiga hari kalender bukan jaminan tiga sesi: akhir pekan,
libur, suspensi, IPO dan bar null dapat menyebabkan kekurangan data. Aplikasi
memperluas riwayat hanya karena kekurangan candle, tidak karena jaringan gagal.

Permintaan intraday memakai `period1` dan `period2` (Unix seconds, batas akhir
eksklusif), **bukan `range=3d`**. Maksimal 100 candle valid terakhir per saham,
termasuk warmup, minimum 20. Candle 1m mewakili satu menit perdagangan, bukan
satu hari; EMA20 berarti 20 candle pada interval yang dipilih.

Yahoo diminta hanya sesi reguler (`includePrePost=false`). Metadata granularity
dan timezone diperiksa. Bar harus berada dalam salah satu segmen sesi reguler
yang diberikan provider dan sudah berakhir + buffer 10 detik. Bar akhir sesi
boleh lebih pendek daripada interval. Tidak mengarang jam bursa/DST, tidak
mengubah 5m ke 1d diam-diam. Ketersediaan intraday berbeda per ticker/provider.
Kualitas ini bukan jaminan kalender bursa lengkap atau harga tidak akan dikoreksi.

## Kontrak dan kompatibilitas

`POST /api/v1/datasets/prepare` menerima field opsional `timeframe`:

```json
{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ_example","timeframe":"5m"}
```

Field tidak dikirim berarti `1d`, sehingga klien lama tetap harian. Range
ditentukan server; klien tidak mengirim provider symbol/tanggal/owner arbitrer.
Manifest dan content mengandung timeframe aktual. Field tanggal lama tetap;
`available_timestamp_range` memuat batas timestamp candle **inklusif** untuk
verifikasi kandidat; `requested_timestamp_range` menjelaskan jendela request
provider (akhir eksklusif). Kedua timestamp memakai UTC RFC3339.

Snapshot owner-scoped immutable di memori backend, berlaku 5 menit intraday /
15 menit harian (atau lebih singkat bila limit deployment demikian). Polling
boleh memakai ulang snapshot identik owner/rule/universe/interval, tanpa
mengubah expiry-nya. Cache harga bersama tidak memuat rule/token privat dan
dibatasi jumlah entri/candle/in-flight. Stop satu browser tidak mematikan fetch
yang sedang dipakai browser lain. Tidak ada database migration.

OpenAPI 0.11.0; core-0.4.0; capabilities-3. Worker-2, feature schema
screener-features-1, decision-1 dan screener-private-1 tidak berubah. Rebuild
API dan WASM sebagai satu pasangan. Rule Postgres schema yang sama dari
core-0.3.0 tetap dapat dieksekusi setelah validasi: versi eksekusinya diproyeksikan
pada read, tanpa menulis ulang definisi/hash/versi/timestamp pengguna. Versi dan
schema tidak dikenal tidak dipromosikan. Arsip IDX tetap hanya harian.

Error `INTERVAL_UNAVAILABLE` dan `INSUFFICIENT_CANDLES` adalah masalah data,
bukan `No match`. Gangguan provider/rate limit mempertahankan hasil sebelumnya
berlabel belum diperbarui, menghormati Retry-After dan exponential backoff.
401/403 dan kegagalan konteks permanen menghentikan monitor. Tidak bypass
session/entitlement/ownership. IndexedDB tetap AES-GCM, dibersihkan saat logout.

## Batas yang sengaja terlihat

- Timer browser dapat ditunda sistem; bukan jaminan jadwal real-time.
- Range bukan jumlah candle pasti. Contoh 100 maksimum; 78 tetap sah.
- Satu siklus berjalan per halaman, dijadwalkan sesudah siklus sebelumnya
  selesai. Tidak mengejar setiap tick yang terlewat.
- Tidak ada harga baru: tidak mengulang komputasi/scoring. History per akun
  mengganti koreksi candle/konteks yang sama, tidak menambahkan duplikat polling.
- Indicator dihitung ulang dari window maksimal 100 yang tersedia; hasil tetap
  bounded-window historical screening, bukan sinyal eksekusi broker atau ledger
  cooldown yang persisten tanpa batas lintas restart/window.
- Feature vector client belum merupakan bukti kriptografis perhitungan benar.
- Hak penggunaan/redistribusi Yahoo tetap keputusan provider/legal terpisah.

## Verifikasi dan demo

```sh
cd frontend/web
npm test
npm run build
npm run test:monitor
npm run test:browser
npm run test:decisions
npm run test:recovery
```

`test:monitor` menggunakan akun, API dan socket sintetis, tetapi worker Go/WASM
yang dibangun dari source sebenarnya. Memeriksa Start/Stop, lock pilihan,
unchanged-data dedup, candle baru, late-response cancellation, navigasi,
viewport 1440/390 dan kedua tema. Tidak memakai password atau mengubah cloud.

```sh
cd backend
go test -race ./...
SIGNALGEN_TEST_YAHOO_LIVE=1 go test -v ./internal/marketdata -run '^TestYahooIntradayLive$' -count=1
```

Smoke Yahoo opt-in terpisah dari fixture deterministik: BBCA.JK dan AAPL 5m;
jumlah/timestamp dicatat tanpa token/account. Hasil live dapat berubah setiap
run dan bukan bukti semua ticker/interval sudah tersedia. UI demo tetap pada
http://127.0.0.1:5174, backend Go 8080; jangan menjalankan frontend kedua.

## Pemeriksaan kesiapan sebelum demo

Healthcheck tidak boleh membatalkan koneksi cloud yang masih sehat sebelum
seluruh pemeriksaan metadata selesai. Batas berurutan: handler `/ready` **8s**,
probe `signalgen-healthcheck` **9s**, Docker **10s**. Handler/probe berbagi
konstanta di `backend/internal/platform/healthcheck/policy.go`; tes menjaga
budget Docker lebih panjang. Deadline request API tetap 10s, bukan diperpanjang
untuk seluruh endpoint. `/health` tetap hanya liveness, `/ready` tetap memeriksa
schema, RLS, role runtime terbatas, grants/policies dan provider.

Pada 20 Oktober, pool cloud dingin lolos seluruh pemeriksaan schema/RLS/runtime
dalam **2,657s**, melampaui batas lama 2s. Tidak ada perubahan SQL, migration,
role, entitlement, password atau bypass pemeriksaan. Tes read-only opt-in:

```sh
SIGNALGEN_RUN_POSTGRES_RUNTIME_READINESS=1 go test -v ./internal/platform/database -run '^TestPostgresRuntimeReadinessFromColdPool$' -count=1
```

Jalankan dari `backend/` dengan `SUPABASE_DB_URL` role runtime yang sudah dimuat
secara lokal; jangan menempelkan URL/password ke laporan atau commit.

Frontend tetap satu proses di port 5174. `localhost` dan `127.0.0.1` adalah
origin berbeda: jika keduanya dipakai untuk demo, daftarkan keduanya secara
eksplisit di `SIGNALGEN_CORS_ORIGINS` lokal dan restart backend. Jangan memakai
wildcard atau menonaktifkan validasi Origin. Koneksi yang ditolak sebelum
WebSocket upgrade bukan hasil `No match`.
