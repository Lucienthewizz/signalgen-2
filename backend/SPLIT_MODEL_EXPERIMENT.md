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

- Belum ada klaim kapasitas production atau penghematan biaya production; pengujian
  lokal belum menyertakan Supabase, SQLite, proxy/TLS, atau jaringan internet.
- Belum ada benchmark browser/WASM dan latency jaringan.
- Belum ada dataset IDX besar atau distribusi nilai harga nyata.
- Belum ada keputusan final Model A; hasil ini harus dibawa ke pembimbing.

## Profil WebSocket lengkap 1/10/30 sesi

Tes opt-in di `internal/api/screener_load_test.go` melewati perjalanan lokal lengkap:

1. membuat socket ticket melalui HTTP;
2. membuka koneksi WebSocket dengan ticket sekali pakai;
3. mengirim 250 feature candidate kronologis untuk satu simbol;
4. memvalidasi dan menjalankan private decision;
5. membaca serta memvalidasi response.

Perintah:

```bash
SIGNALGEN_RUN_SCREENER_LOAD_PROFILE=1 \
  go test ./internal/api \
  -run '^TestScreenerWebSocketLoadProfile$' -count=1 -v
```

Snapshot lokal 28 September 2026, Apple M5, darwin/arm64, Go 1.27.1:

| Sesi konkuren | Cold p50 | Cold p95 | Warm p50 | Warm p95 | Selesai/gagal |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4,086 ms | 4,086 ms | 1,420 ms | 1,589 ms | 8 / 0 |
| 10 | 4,019 ms | 4,643 ms | 3,063 ms | 4,461 ms | 80 / 0 |
| 30 | 8,017 ms | 9,059 ms | 6,716 ms | 8,009 ms | 240 / 0 |

Hasil warm berasal dari delapan batch setelah satu batch cold. Pada batch 30 sesi,
proses tes mengalokasikan total sekitar 153,4 MB atau 639 KB per perjalanan sesi.
Payload aplikasi yang tercatat sekitar 6,96 MB dikirim dan 6,27 MB diterima untuk
240 perjalanan. Angka byte tidak menyertakan header HTTP, frame WebSocket, TCP, atau
TLS. Angka CPU dan memori mencakup client serta server dalam satu proses tes.

Dependency identity, session, entitlement, dan compute grant memakai fake in-memory
yang aman untuk konkurensi. Oleh sebab itu, hasil ini membuktikan jalur transport dan
decision dapat menyelesaikan 30 sesi konkuren di lingkungan lokal tanpa kegagalan,
tetapi **bukan** bukti kapasitas production maupun jumlah pengguna yang dapat dijual.

## Validasi E2E dengan Supabase Auth

Pada 28 September 2026, alur hybrid juga diverifikasi manual melalui frontend web
dan backend integrasi dengan akun Supabase nyata serta database SQLite E2E terpisah:

1. login Supabase dan verifikasi bearer berhasil;
2. app-session perangkat berhasil dibuat;
3. entitlement `screener` sementara diberikan melalui admin CLI dengan audit trail;
4. dataset fixture BBCA.JK terproteksi berhasil diambil;
5. browser memverifikasi artefak lalu menghitung feature melalui Go/WASM;
6. compute grant dan socket ticket sekali pakai berhasil dibuat;
7. WebSocket private scoring mengembalikan `decision-1`; dan
8. UI menampilkan hasil `No match`, 7 dari 21 kandidat cocok, serta kualitas data
   `complete` tanpa mengklaim prediksi harga.

Tidak ada password, bearer token, refresh token, atau identifier akun yang dicatat
di laporan maupun Git. Validasi ini membuktikan vertical slice bekerja dengan Auth
nyata pada lingkungan lokal, tetapi belum menggantikan pengujian staging/production.

## Eksperimen berikutnya

1. Ukur WebSocket connect, JSON decode, decision, dan response secara terpisah.
2. Uji payload 100 dan 1.000 kandidat dengan dataset IDX nyata.
3. Jalankan client dan server di proses/perangkat berbeda agar CPU/RAM terpisah.
4. Bandingkan bagian formula yang tampak di WASM dan pesan jaringan.
5. Diskusikan hasil dengan pembimbing sebelum menetapkan split final.
