# Backtesting backend/core — 26 Oktober 2026

Status: backend/core slice `backtest-1`, policy `holding-next-open-1`. Ini mengikuti
analisis T+1…T+n Claudio dengan kebijakan eksekusi baru. UI, penyimpanan history,
jurnal authoritative, intraday, short, target-stop dan exit-rule belum termasuk.

## Alur dan kontrak

1. Login dan buat app session seperti biasa. Akun harus memiliki entitlement
   `backtest`; hak `screener` saja tidak cukup. Semua route memakai bearer dan
   `X-App-Session`, pemilik berasal dari credentials, bukan JSON.
2. Siapkan universe milik pengguna: 1–10 saham, satu pasar/mata uang (IDX/IDR atau
   US/USD). POST `/api/v1/datasets/prepare`:

```json
{"purpose":"backtest","mode":"rule","rule_id":"RULE_ID","universe_id":"UNIVERSE_ID","timeframe":"1d","from":"2026-01-01","to":"2026-06-30","n_steps":3}
```

   Untuk manual, ubah `mode` menjadi `manual` dan hilangkan `rule_id`. `from/to`
   adalah tanggal UTC sesi candle, inklusif, maksimal lima tahun dan tidak di masa
   depan. `n_steps` wajib 1–100. Field mode/range/horizon khusus backtest; request
   screener tetap memakai kontrak sebelumnya.
3. Ambil manifest/content lewat route dataset yang ada. Snapshot immutable punya
   checksum, expiry, `backtest` scope, requested entry range, available range dan
   warnings. Jangan menafsirkan available range sebagai batas entry.
4. Rule: jalankan `signalgenComputeBacktestFeatures` dalam worker, satu series per
   panggilan dengan `purpose=backtest`. Buat `/api/v1/compute-grants` dengan purpose
   `backtest`, metadata snapshot dan rule hash/engine/schema versi saat ini.
5. POST `/api/v1/backtests/signals`, maksimal 1 MiB:

```json
{"compute_grant_id":"GRANT_ID","feature_schema_version":"screener-features-1","policy_version":"holding-next-open-1","candidates":[]}
```

   Ganti `candidates` dengan seluruh hasil fitur satu simbol; array kosong ditolak.
   Wajib mencakup semua timestamp candle index 19 sampai akhir snapshot, termasuk
   warmup/buffer exit. Jangan membagi satu simbol ke beberapa request. Server
   memeriksa grant, user/session, entitlement, versi/checksum, rule dan timestamp;
   server hanya mengevaluasi rule ringan. Crossover memakai candle sebelumnya;
   match di luar entry range tidak menghabiskan cooldown. Respons berisi
   `signals`, `evaluations`, dan `entries` siap dipakai core. Gabungkan entries
   seluruh simbol sebelum simulasi portfolio; maksimum 2.000 entries total.
6. Manual: buat entries BUY dengan `symbol` dan **timestamp candle snapshot yang
   persis sama**. Timestamp adalah candle acuan yang sudah selesai, bukan waktu
   fill. Rule/grant/scoring tidak dibutuhkan untuk perhitungan manual.
7. Panggil `signalgenRunBacktest(JSON.stringify(request))` di worker. Ini mengembalikan
   envelope `{ok,result}` atau `{ok:false,error}`. Request:

```json
{
  "schema_version":"backtest-1",
  "config":{"mode":"manual","timeframe":"1d","from":"2026-01-01","to":"2026-06-30","n_steps":3,"exit_strategy":"holding_period","initial_capital":10000,"position_sizing":"percent_equity","position_size":100,"commission_pct":0,"slippage_pct":0},
  "series":[],
  "entries":[{"symbol":"TEST","timestamp":"2026-01-20T00:00:00Z","signal_type":"BUY"}]
}
```

   Isi `series` dengan series snapshot, bukan array kosong. Contoh lengkap runnable:
   `backend/core/testdata/backtest_next_open_v1.json`. Core native memakai
   `DefaultBacktestConfig`; JSON menerapkan default hanya untuk field yang
   dihilangkan. Null, field asing, zero capital dan SELL ditolak. Kapabilitas
   tersedia di `GET /api/v1/capabilities` pada field `backtest` serta export
   `signalgenBacktestCapabilities()`. Versi/limit screener tidak diganti.

## Kebijakan simulasi yang dibekukan

- Sinyal diketahui setelah close. Entry selalu open candle berikutnya, tidak
  menggunakan harga close/open/high/low candle sinyal sebagai fill. T+1 exit pada
  close candle entry; T+k exit pada close candle ke-k sejak entry.
- Satu posisi untuk seluruh portfolio. Urutan fill menurut tanggal sesi UTC;
  jika sama, urutan waktu sinyal lalu simbol alfabetis. Perbedaan jam label
  candle antar saham tidak membuat sesi baru. Posisi menempati sesi
  sampai close; entry lain pada open sesi itu dilewati, termasuk pada hari exit.
  Setiap horizon menghitung portfolio independen dari modal awal yang sama.
  Timestamp entry dibandingkan sebagai instant UTC dengan presisi subdetik;
  format offset yang berbeda boleh merujuk instant yang sama.
- Alokasi percent equity 0–100% atau fixed amount positif, dibatasi kas. Default
  modal 10.000 (mata uang dataset), sizing 100%, fee/slippage 0%. Tidak ada leverage.
  Quantity pecahan = budget / (open × (1+slippage) × (1+commission)).
- Slippage menaikkan fill beli dan menurunkan fill jual. Commission dihitung dari
  notional masing-masing sisi. Biaya entry termasuk budget; tidak meminjam kas
  untuk membayar fee. P&L/metrics memakai nilai penuh, UI boleh membulatkan.
- Equity harian = kas + quantity × close terakhir yang tersedia. Drawdown memakai
  peak equity harian, termasuk unrealized. Jika horizon belum tersedia, posisi
  tetap `open`, `exit_price=null`, tanpa fee exit atau exit sintetis. Unrealized
  mencakup fee entry; `net_pl_cash` hanya realized P&L transaksi tertutup.
  `return_pct` posisi terbuka memakai unrealized P&L dibagi biaya entry total,
  tanpa fee exit hipotetis. Equity curve memiliki satu titik per tanggal UTC
  (timestamp tengah malam adalah label tanggal, bukan waktu quote/fill).
- Win rate hanya transaksi tertutup setelah biaya. Profit factor adalah total
  profit / absolut total loss setelah biaya, `null` jika loss nol. Tidak ada
  Sharpe annualized atau klaim return yang dijamin. `NO_NEXT_CANDLE`,
  `POSITION_OPEN`, `INSUFFICIENT_CAPITAL` menjelaskan entry yang dilewati.

## Data dan batas kepercayaan

Yahoo range history memakai cache bounded/coalescing yang sama dengan screening,
namun key mencakup seluruh rentang. Prefiks warmup 90 hari kalender, wajib minimal
20 candle sebelum awal entry range; buffer exit `3*n_steps+11` hari dari tanggal
akhir, dipotong sampai saat ini. Maksimal 2.500 candle/simbol; seluruh fetch window
harus muat batas provider enam tahun. Provider mode yang tidak mendukung range
(misal archive adapter saat ini) mengembalikan `HISTORY_UNAVAILABLE`, tanpa fallback.

Missing/null/open candles tidak dibuat-buat. Per-symbol data invalid atau warmup
kurang menggagalkan preparation; warnings gap/finality dibawa ke manifest. Quality
`partial` secara sengaja tidak menyatakan exchange-calendar completeness. Data raw
OHLCV: corporate actions, likuiditas, lot size, spread, pajak, dan fill broker belum
termodelkan. Kekurangan exit buffer tampak sebagai posisi terbuka.

Fitur dari client dapat dimodifikasi. Dataset/grant membatasi akses dan konteks,
bukan membuktikan fitur atau P&L benar. Hasil bukan bukti pembayaran, kompetisi,
atau jurnal transaksi nyata. Cancel dilakukan dengan menghentikan worker; tidak
ada background job/server fallback. Tidak ada migrasi atau penyimpanan hasil baru.

## Verifikasi lokal

Dari `backend/`:

```bash
go test ./...
go test ./internal/api/tests -run BacktestHTTP -v
python3 scripts/check_claudio_backtest.py
bash scripts/verify_backtest.sh
go run ./cmd/backtest < core/testdata/backtest_next_open_v1.json
```

Fixture Claudio hanya membekukan formula harga/modal untuk satu long tanpa biaya,
dengan SHA-256 sumber dan eksekusi fungsi Python asli via AST. Tidak menyatakan
parity penuh: entry candle, overlap modal dan exit pendek pada legacy sengaja
berbeda. Golden baru memakai next-open, cash/fees, overlap dan posisi terbuka.
Harness API menguji real routing/domain/snapshot/rule store dengan identitas,
market data dan grant test; tidak mengklaim login/provider/Postgres produksi diuji.
Harness WASM membandingkan output native pada fixture sama untuk mode rule/manual
(toleransi absolut 1e-9 + relatif 1e-12) serta memeriksa marker rule privat absen.
Regresi audit juga memeriksa jam candle antar saham yang berbeda pada tanggal
yang sama, prioritas sinyal subdetik, return posisi terbuka, dan penolakan
candle intraday pada export fitur. Tes properti dengan 100 skenario deterministik
memeriksa final equity = modal awal + realized + unrealized, batas drawdown,
fee, dan hasil yang stabil saat urutan input dibalik. Tes HTTP secara khusus
menolak pemakaian grant oleh pengguna lain yang sama-sama memiliki entitlement.
