# Pemantauan proses screening

Tujuannya sederhana: saat screening gagal, backend bisa menunjukkan **tahap
mana yang gagal**, tanpa memasukkan token, rules, saham atau isi feature ke log.
Ini bukan endpoint baru, tabel baru, atau perubahan rumus Model A.

## Dua jenis laporan yang berbeda

`http_request` menjelaskan request/koneksi. Status **101 hanya berarti WebSocket
tersambung**, bukan berarti saham sudah selesai dievaluasi.

`screener_evaluation` dicatat sekali setelah satu handler socket selesai,
termasuk socket yang ditolak sebelum upgrade. Penerbitan ticket lewat POST tetap
masuk laporan HTTP, bukan percobaan evaluasi socket. `screener_summary` merangkum
semua percobaan dalam satu proses; dicetak bersama ringkasan HTTP setiap menit
dan saat shutdown. Semua hitungan reset saat proses dimulai ulang.

| Tahap | Yang dilakukan |
|---|---|
| `authorize` | Consume ticket, cek sesi/akun/entitlement/grant/dataset/rule dan kapasitas |
| `upgrade` | Mengubah koneksi HTTP menjadi WebSocket |
| `read` | Menunggu satu pesan text dari browser |
| `validate` | Memeriksa JSON, versi protokol dan jumlah kandidat |
| `recheck` | Memeriksa kembali izin setelah menunggu pesan browser |
| `evaluate` | Mengevaluasi feature dengan keputusan privat yang sudah ada |
| `write` | Menulis hasil atau pesan error ke koneksi |
| `close` | Menutup koneksi dan melepas sumber daya |

Durasi adalah waktu nyata yang berlalu (*wall-clock*), bukan CPU. Tahap `read`
termasuk waktu browser menyiapkan/mengirim pesan; `close` dapat menunggu handshake.
Total waktu tidak boleh dipresentasikan sebagai kecepatan rumus atau efisiensi
Model A tanpa pengukuran terpisah. Durasi tiap tahap dibulatkan ke mikrodetik.

## Membaca outcome

- `result_written`: keputusan dihitung dan penulisan `screener.result` berhasil.
  Ini belum membuktikan browser menerima, memproses atau menampilkan hasil.
- `authorization_rejected`: ticket/izin/binding tidak valid, kedaluwarsa,
  dicabut atau tidak cocok. Ticket replay juga termasuk di sini.
- `invalid_message`: pesan binary, terlalu besar, JSON/kontrak salah, atau
  feature/simbol/timestamp tidak valid.
- `service_unavailable`: dependency server gagal; error mentah tidak dicatat.
- `capacity_rejected`: batas socket tercapai, bukan hasil evaluasi saham.
- `upgrade_failed`, `read_failed`, `write_failed`: kegagalan transport pada tahap
  terkait. Jika konteks sudah dibatalkan/kedaluwarsa, dipakai `canceled` atau
  `deadline_exceeded`.
- `panic`: kegagalan tak terduga; tahap asal dipertahankan sebelum cleanup.
  Nilai panic tidak dicetak. Recovery HTTP tetap bertanggung jawab atas transport.
- `internal_failure`: fallback tetap untuk label/observasi yang tidak valid.

`failed_stage` menunjuk tahap penyebab awal, bukan tahap penulisan pesan error.
`reply_written=true` dapat berarti **pesan error** berhasil ditulis; jangan
menganggapnya sebagai screening sukses. Hanya `result_written` yang menandai
penulisan hasil berhasil. Log tetap mempertahankan penyebab awal jika penulisan
pesan error juga gagal; `reply_written=false` menjelaskan tidak ada reply yang
berhasil ditulis. Outcome operasional tidak mengubah HTTP/JSON kontrak lama.

## Data yang boleh dicatat

Field per percobaan: `request_id`, `outcome`, `failed_stage`, `upgraded`,
`reply_written`, `contract_candidate_count`, `received_text_bytes`, `duration_us`
dan `stage_duration_us`.

- `request_id` dibuat server untuk request HTTP upgrade, bukan `request_id`
  yang dikirim browser dalam pesan screening. Frontend dapat mencocokkannya
  dengan header `X-Request-ID`.
- `contract_candidate_count` menghitung kandidat setelah pemeriksaan envelope;
  **bukan** bukti feature benar/jujur. Validasi numerik dilakukan kemudian.
  Kandidat dapat dihitung walaupun recheck/evaluasi berikutnya gagal.
- `received_text_bytes` hanya panjang pesan text yang dibaca lengkap. Bukan
  total trafik wire, bukan ukuran handshake/error/binary/partial/oversized frame.

Vocabulary outcome dan tahap tetap; tidak ada map per user atau ID rule/dataset.
Observer menyaring label asing, ID korelasi bukan milik server, nilai negatif
dan jumlah melebihi batas kontrak. Observasi `result_written` tanpa upgrade atau
reply berhasil dialihkan ke `internal_failure`.

Tidak ada bearer/session/ticket, user ID, email, IP, simbol, definisi rule,
isi feature/hasil, error database/provider, atau nilai panic dalam event ini.
Tetap batasi akses dan retensi log. Reverse proxy harus menyaring query ticket
secara terpisah; perlindungan logger aplikasi tidak berlaku otomatis pada proxy.

## Urutan membaca kode

1. `internal/screener/observation.go`: kontrak angka/label tanpa payload privat.
2. `internal/api/screener/websocket_handler.go`: urutan screening yang diamati.
3. `internal/api/screener/observation.go`: pengukuran lokal per request.
4. `internal/platform/websocket/connection.go`: error read/timeout/ukuran pesan.
5. `internal/platform/observability/screener.go`: logger/counter yang aman.
6. `cmd/api/main.go`: dependency injection dan lifecycle ringkasan.

`internal/api/screener/handlers.go` sekarang fokus pada penerbitan ticket;
alur WebSocket dipisah agar mudah dibaca. Observer tidak bisa memberi izin,
mengubah keputusan, menulis database atau menerima payload screening.

## Verifikasi

Unit test memeriksa penulisan hasil gagal/canceled/deadline, tahap panic,
label/jumlah terbatas dan snapshot concurrent. Test API memakai WebSocket nyata
untuk hasil valid, replay, JSON salah, binary, oversized, pencabutan izin sesudah
upgrade, gangguan dependency dan shutdown. Test menunggu observer selesai, tidak
sekadar menerima HTTP 101, sebelum memeriksa log.

Ini fondasi diagnosis lokal. Belum ada histogram persentil, collector lintas
replica, dashboard, metrik provider/cache, load test staging atau benchmark
CPU/RAM server/browser. Tidak ada perubahan schema/migration untuk fitur ini.
