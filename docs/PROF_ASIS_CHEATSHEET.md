# Progress Asistensi SignalGen 2.0

## 1. Arahan Prof minggu lalu

Prof meminta agar proses screener tidak dijalankan seluruhnya di server karena beban server akan membesar ketika pengguna bertambah.

Namun, seluruh proses juga tidak boleh diletakkan di client melalui WebAssembly karena kode WASM masih dapat dianalisis atau di-*reverse engineer*.

Solusi yang diminta adalah membagi prosesnya:

- perhitungan indikator yang berat dilakukan di client;
- rule atau keputusan kritis tetap berada di server;
- client meminta keputusan tersebut melalui WebSocket dengan data yang kecil.

Untuk menjawab arahan ini, kami membuat dan membandingkan **Model A** dan **Model B**.

## 2. Model A — decision kernel di server

Pada Model A:

1. Client menerima data saham historis.
2. Go WebAssembly menghitung harga, EMA9, EMA20, dan RSI14.
3. Client mengirim hasil indikator berupa *feature vector* melalui WebSocket.
4. Server menjalankan **decision kernel**, yaitu rule kritis untuk menentukan `match` atau `no-match`.

```text
Data saham
  → WASM menghitung EMA dan RSI
  → feature vector dikirim lewat WebSocket
  → server menjalankan decision kernel
  → hasil match/no-match
```

Kelebihannya adalah komputasi berat dilakukan perangkat pengguna, beban server kecil, dan rule keputusan akhir tidak diberikan ke browser.

Kekurangannya adalah hasil indikator berasal dari browser sehingga secara teori dapat dimanipulasi, dan client tetap membutuhkan koneksi ke server untuk memperoleh keputusan.

## 3. Model B — RSI dihitung di server

Pada Model B:

1. Client hanya menghitung harga, EMA9, dan EMA20.
2. Client mengirim hasil EMA serta rangkaian harga penutupan ke server.
3. Server menghitung RSI14.
4. Server menjalankan decision kernel untuk menghasilkan `match` atau `no-match`.

```text
Data saham
  → WASM menghitung EMA
  → EMA dan rangkaian harga dikirim ke server
  → server menghitung RSI dan decision kernel
  → hasil match/no-match
```

Kelebihannya adalah lebih banyak proses disembunyikan dari client.

Kekurangannya adalah server menerima lebih banyak data dan harus melakukan komputasi lebih besar daripada Model A.

## 4. Hasil perbandingan

Kedua model diuji dengan data dan rule yang sama:

- satu fixture saham BBCA.JK;
- 40 candle historis;
- 21 kandidat yang dapat dinilai;
- satu rule dasar dengan EMA9, EMA20, dan RSI14.

| Perbandingan | Model A | Model B |
| --- | --- | --- |
| Client menghitung | Harga, EMA9, EMA20, RSI14 | Harga, EMA9, EMA20 |
| Server menghitung | Decision kernel | RSI14 dan decision kernel |
| Beban server | Lebih kecil | Lebih besar |
| Hasil screener | Sama dengan acuan | Sama dengan acuan |

Kedua model menghasilkan keputusan yang sama. Namun, pada percobaan kecil ini Model B memakai sekitar **2,24 kali lebih banyak alokasi memori server** dan sekitar **8–11% lebih banyak waktu komputasi server**.

### Kesimpulan sementara

Model A menjadi kandidat sementara karena hasilnya sama dengan Model B, tetapi beban server lebih kecil dan sesuai dengan tujuan agar komputasi berat dilakukan di client.

Model A **belum menjadi keputusan final**. Hasil ini dibawa kepada Prof untuk mendapat persetujuan atau arahan pengujian berikutnya.

## 5. Cara kerja screener yang sudah dibuat

```text
Login Supabase
  → backend memeriksa app session dan entitlement
  → client mengambil dataset yang diizinkan
  → Go/WASM menghitung indikator
  → backend membuat compute grant
  → backend memberikan socket ticket sekali pakai
  → client mengirim feature vector melalui WebSocket
  → server menjalankan decision kernel
  → hasil tampil di UI
```

Penjelasan per bagian:

1. **Supabase Auth** memastikan identitas pengguna melalui login.
2. **App session** memastikan perangkat pengguna masih diizinkan.
3. **Entitlement** memastikan pengguna mempunyai hak memakai screener.
4. **Dataset API** memberikan data historis yang telah diizinkan.
5. **Go/WASM** menghitung indikator berat di browser.
6. **Compute grant** mengizinkan kombinasi user, sesi, dataset, rule, dan versi tertentu.
7. **Socket ticket** memberikan izin satu koneksi WebSocket yang singkat dan hanya dapat dipakai sekali.
8. **WebSocket** membawa feature vector ke server dan membawa hasil keputusan kembali ke client.
9. **Decision kernel** menyimpan serta menjalankan rule kritis di server.

## 6. Peran WebSocket

WebSocket bukan tempat menyimpan data dan tidak digunakan untuk mengirim seluruh dataset.

Dalam satu proses screener:

1. client membuka koneksi memakai ticket sekali pakai;
2. client mengirim satu batch feature vector;
3. server menjalankan decision kernel;
4. server mengembalikan hasil;
5. koneksi dapat ditutup.

Dengan pembagian ini, indikator berat tetap dihitung di client, sedangkan rule kritis tetap terlindungi di server.

## 7. Status progress

### Sudah dibuat

- Pemisahan feature calculation dan decision kernel.
- Model A sampai hasil tampil di UI.
- Prototipe dan perbandingan Model B.
- Login, app session, entitlement, dan pengecekan perangkat.
- Dataset terproteksi dan compute grant.
- Socket ticket sekali pakai dan WebSocket private scoring.
- Pengujian Model A dan Model B dengan fixture yang sama.
- Pengujian beban lokal Model A untuk 1, 10, dan 30 sesi.

Pada pengujian lokal, terdapat 7 kandidat cocok dari 21 kandidat. Kandidat terakhir menghasilkan `No match`.

Hasil tersebut adalah hasil rule screener, bukan prediksi harga atau rekomendasi membeli saham.

### Masih percobaan/beta

- Baru memakai satu fixture BBCA.JK dengan 40 candle.
- Baru memakai satu rule dasar dan indikator terbatas.
- Belum memakai dataset IDX besar atau data real-time.
- Benchmark masih dilakukan di lingkungan lokal.
- CPU dan RAM client/server belum diukur secara terpisah.
- Model B belum diuji melalui alur WebSocket selengkap Model A.
- Belum ada bukti kapasitas production.
- Model A masih memerlukan persetujuan Prof.

## 8. Script singkat untuk disampaikan

> “Minggu lalu Prof meminta agar screener tidak semuanya berjalan di server, tetapi juga tidak semuanya diletakkan di client karena WebAssembly masih dapat dianalisis. Karena itu kami membandingkan dua pembagian proses.”

> “Pada Model A, Go WebAssembly di client menghitung harga, EMA9, EMA20, dan RSI14. Hasil indikator dikirim sebagai feature vector melalui WebSocket. Server hanya menjalankan decision kernel yang berisi rule kritis.”

> “Pada Model B, RSI juga dihitung di server. Kedua model memberikan hasil yang sama pada fixture percobaan, tetapi Model B menggunakan memori dan waktu komputasi server lebih besar. Karena itu Model A menjadi kandidat sementara.”

> “Alur Model A sudah tersambung dari login, pemeriksaan sesi dan entitlement, pengambilan dataset, perhitungan WASM, compute grant, socket ticket, WebSocket, sampai hasil tampil di UI.”

> “Namun pengujian ini masih terbatas pada satu fixture BBCA.JK, 40 candle, dan satu rule dasar. Ini belum data IDX real-time dan belum benchmark production. Kami ingin meminta arahan Prof apakah Model A dapat ditetapkan sebagai model final atau Model B perlu diuji lebih lanjut.”

## 9. Pertanyaan kepada Prof

> “Karena hasil kedua model sama dan beban server Model A lebih kecil, apakah Model A dapat kami tetapkan sebagai pembagian final untuk screener, atau Model B perlu diuji lagi melalui WebSocket dan dataset yang lebih besar?”
