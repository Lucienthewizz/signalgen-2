# Eksperimen Split Screener — Model A vs Model B

Tanggal: 27 September 2026
Status: microbenchmark lokal untuk bahan diskusi pembimbing, bukan benchmark production.

## Tujuan

Membandingkan dua cara menyimpan bagian kritis screener di server tanpa memindahkan
seluruh komputasi ke server.

- **Model A:** client/WASM menghitung PRICE, EMA9, EMA20, dan RSI14. Server hanya
  menjalankan decision kernel.
- **Model B:** client/WASM menghitung PRICE, EMA9, dan EMA20. Client juga mengirim
  rangkaian close; server menghitung RSI14 lalu menjalankan decision kernel.

Keduanya diuji memakai fixture `default_scalping_v1.json` dan rule baseline yang
sama. Kode eksperimen berada di `core/split_models_test.go` dan tidak masuk jalur
runtime production.

## Perintah

```bash
go test ./core \
  -run TestSplitModelsMatchFrozenBaseline \
  -bench 'BenchmarkSplitModel(A|B)' \
  -benchmem -count=3
```

## Hasil lokal

Mesin: Apple M5, darwin/arm64. Dataset fixture: 40 candle, 21 kandidat matang.

| Ukuran | Model A | Model B |
| --- | ---: | ---: |
| Hasil sinyal | sama dengan golden fixture | sama dengan golden fixture |
| Payload JSON fixture | 3.334 byte | 2.994 byte |
| Waktu server, kisaran 3 run | 2.654–2.682 ns/op | 2.921–2.943 ns/op |
| Alokasi server | 1.392 B/op, 4 allocs | 3.120 B/op, 6 allocs |

Angka payload Model B lebih kecil sekitar 10% pada fixture kecil ini karena deret
close berisi bilangan sederhana sedangkan RSI Model A memiliki desimal panjang.
Ini bukan bukti bahwa Model B selalu lebih hemat pada dataset nyata. Model B harus
mengirim data close tambahan dan biaya server tumbuh bersama panjang seri.

Pada microbenchmark ini, Model B menggunakan sekitar 2,24 kali byte alokasi server
dan sekitar 8–11% waktu server lebih tinggi. Selisih absolut masih sangat kecil
karena dataset hanya 40 candle dan belum mencakup network, WebSocket, JSON decode,
database, 10/30 pengguna, atau browser nyata.

## Interpretasi

Model A tetap menjadi kandidat awal karena:

- server hanya menerima feature vector dan menjalankan perbandingan ringan;
- tidak perlu menghitung ulang indikator per pengguna;
- implementasi vertical slice, ticket, WebSocket, dan replay protection sudah ada;
- batas client/server mudah dijelaskan dan diuji.

Model B masih layak sebagai pembanding karena memindahkan RSI dari WASM, tetapi
membutuhkan close series dan alokasi server lebih besar. Perlindungan tambahan juga
belum terbukti signifikan: pola RSI mungkin tetap dapat ditebak dari input-output.

## Microbenchmark batch konkuren Model A

Benchmark tambahan menjalankan decision kernel yang sama secara bersamaan. Angka ini
**hanya** mencakup kernel dan penjadwalan goroutine—belum mencakup HTTP, WebSocket,
JSON, auth, database, atau jaringan.

| Sesi per batch | Waktu satu batch, kisaran 3 run | Alokasi per batch |
| ---: | ---: | ---: |
| 1 | 3,775–3,841 µs | 1.536 B |
| 10 | 18,338–18,396 µs | 15.216 B |
| 30 | 42,254–42,601 µs | 45.617 B |

Perintah yang dapat diulang:

```bash
go test ./core -run '^$' \
  -bench BenchmarkSplitModelAConcurrentBatches -benchmem -count=3
```

## Yang belum boleh disimpulkan

- Belum ada klaim kapasitas 30 pengguna atau penghematan biaya production; benchmark
  30 sesi di atas baru mengukur kernel, bukan perjalanan request secara penuh.
- Belum ada benchmark browser/WASM dan latency jaringan.
- Belum ada dataset IDX besar atau distribusi nilai harga nyata.
- Belum ada keputusan final Model A; hasil ini harus dibawa ke pembimbing.

## Eksperimen berikutnya

1. Jalankan 1/10/30 sesi melalui WebSocket lengkap dan ukur p50/p95.
2. Ukur WebSocket connect, JSON decode, decision, dan response secara terpisah.
3. Uji 100, 1.000, dan 10.000 candle dengan kandidat yang dibatasi.
4. Bandingkan bagian formula yang tampak di WASM dan pesan jaringan.
5. Diskusikan hasil dengan pembimbing sebelum menetapkan split final.
