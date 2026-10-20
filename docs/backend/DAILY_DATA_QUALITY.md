# Candle harian dan kualitas data — 20 Oktober 2026

## Intinya

`interval=1d` berarti satu candle untuk satu hari perdagangan. Itu **bukan**
jaminan bahwa candle terakhir sudah tutup, dan bukan jadwal refresh sekali sehari.
Harga penutupan sementara saat pasar masih buka tidak dipakai sebagai close final.

Contoh: pada pukul 13.00 New York, harga terakhir AAPL masih dapat berubah.
Backend mengecualikan candle hari itu, lalu screening memakai candle tertutup
yang tersedia. Jika provider menyatakan sesi sudah berakhir pada tanggal pasar
yang sama, candle hari itu boleh dipakai. Jam contoh di tes adalah fixture,
bukan kalender/jadwal resmi perdagangan yang di-hardcode ke aplikasi.

## Alur kode

1. `marketdata/yahoo_finance.go` mengambil array OHLCV dan metadata Yahoo.
2. `marketdata/daily_finality.go` membaca timezone bursa dan batas sesi reguler.
   IANA timezone menangani DST Amerika; offset provider menjadi fallback.
3. Candle masa depan atau hari berjalan yang belum dikonfirmasi tutup dikeluarkan.
   Metadata sesi hilang/salah/stale tidak boleh menjadi izin memakai candle itu.
   Fallback konservatif memakai tanggal pasar, atau UTC jika timezone tidak ada.
4. Baris OHLCV null dihitung dan dilewati; tidak diganti nol atau harga buatan.
5. Baru ambil sampai 100 candle valid terakhir. Kurang dari 20 candle tertutup
   menggagalkan persiapan dataset, bukan menghasilkan `No match`.
6. Catatan kualitas ikut setiap series melalui cache RAM, lalu diterbitkan di
   `manifest.quality.warnings`. Salinan dipisahkan antar pemanggil/pengguna.
7. Browser tetap menerima `ohlcv-multi-1`, menghitung indikator lewat WASM,
   lalu backend mengevaluasi rule melalui Model A seperti sebelumnya.

Collector `DailyHistory` memakai kebijakan yang sama untuk koleksi baru. Laporan
menyimpan `skipped_null_rows` dan `excluded_open_rows`; archive provider meneruskan
warnings koleksi ke snapshot API. Arsip lama tidak ditulis ulang otomatis dan
tidak diberi klaim retroaktif bahwa seluruh candle lamanya sudah diverifikasi.

## Arti `quality.status=complete`

Kontrak frontend yang ada menggunakan `complete` untuk **payload terpilih yang
lolos validasi**. Nilai itu bukan bukti semua hari bursa, semua emiten, suspensi,
atau corporate actions sudah direkonsiliasi. Warnings tetap wajib dibaca.
Perubahan ini mempertahankan enum/format yang dipakai frontend; warning per-series
tidak ditambahkan ke bentuk JSON OHLCV, melainkan ke manifest.

Contoh warning:

```text
AAPL: excluded 1 unfinished or unconfirmed daily candle(s)
BBCA.JK: excluded 1 null OHLCV row(s); history may have gaps
```

Frontend dapat mengambil warnings tersebut dari API. Tampilan screener terbaru
belum merender seluruh warning di footer; backend tidak mengubah UI pada slice
ini. Jangan hanya menggunakan label `complete` untuk menyimpulkan data sempurna.

## Batas yang tetap ada

- Metadata sesi adalah informasi provider, bukan bukti independen quote sudah
  selesai diselesaikan/settled atau feed bursa resmi. Tidak ada janji real-time.
- Belum ada kalender exchange/suspensi atau rekonsiliasi tanggal yang hilang.
- Harga tetap raw OHLCV; kebijakan split/dividen belum divalidasi untuk backtest.
- Arsip tetap data riset plaintext di backend. SHA-256 adalah integrity check,
  bukan enkripsi. Cache IndexedDB terenkripsi adalah lapisan terpisah.
- Batas screening tetap 1–10 saham; Model A, rule, auth, dan entitlement tidak berubah.

## Uji regresi

Tes deterministik meliputi sesi IDX/US sedang buka dan sesudah tutup, tepat batas
penutupan, DST, UTC midnight, metadata hilang/invalid/stale, candle masa depan,
null rows, minimum warmup, collector historis, dan isolasi warning cache/snapshot.
Tes tidak bergantung harga Yahoo live, hari kerja, akun asli, atau database cloud.
