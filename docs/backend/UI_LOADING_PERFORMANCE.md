# Loading halaman — pemeriksaan 2 November 2026

Pemeriksaan ini melanjutkan perubahan frontend lokal pada branch
`frontend/asis-20261104-backtest-journal-performance`. Tidak ada migration,
perubahan `.env`, cache authorization, atau perubahan algoritme screening.

## Penyebab yang ditemukan

1. Route menunggu sinkronisasi seluruh presentation state sebelum mulai GET
   miliknya. Route yang independen sekarang berjalan bersamaan dengan sync.
   Editor rule/screener/watchlist tetap menunggu hydration agar draft aman.
2. Dashboard memakai satu barrier `Promise.allSettled`, sehingga respons yang
   cepat tidak terlihat sampai respons paling lambat selesai. Kini setiap
   resource diterbitkan sendiri dengan pending state yang tepat.
3. Validasi sesi Postgres selalu SELECT lalu UPDATE `last_seen_at`, termasuk
   beberapa GET serentak dari satu halaman. UPDATE metadata ini menambah
   perjalanan jaringan dan dapat memperebutkan row lock sesi yang sama.
4. List/detail jurnal dan arsip melakukan BEGIN → set owner → SELECT → COMMIT
   secara berurutan. RLS tetap diperlukan, tetapi pengiriman berurutan tidak.

## Sampel waktu backend sebelum optimasi database

Agregasi log GET sukses dalam jendela 90 menit, sebelum rebuild perubahan
database. Hanya nama route, jumlah sampel dan durasi yang dibaca; tidak ada
token, identitas pengguna, SQL atau body yang disalin. Sampel observasional,
bukan eksperimen terkontrol; latensi jaringan, isi data dan cold connection
dapat berbeda antar permintaan. Semua angka milidetik.

| Route | n | p50 | p95 |
| --- | ---: | ---: | ---: |
| `/api/auth/me` | 9 | 264,1 | 378,2 |
| `/api/v1/account/me` | 30 | 1.390,6 | 2.480,4 |
| `/api/v1/workspace` | 15 | 1.921,5 | 4.098,5 |
| `/api/v1/rules` | 14 | 1.590,7 | 2.763,6 |
| `/api/v1/stock-universes` | 13 | 1.249,6 | 3.237,8 |
| `/api/v1/subscription` | 12 | 1.279,4 | 2.044,2 |
| `/api/v1/journal/trades` | 11 | 2.052,9 | 2.829,5 |

Waktu HTTP ini mencakup seluruh handler. Ini tidak membuktikan satu query
atau Supabase Auth sebagai satu-satunya bottleneck. Waktu akhir setiap GET
tetap bergantung pada layanan/jaringan asli.

Smoke test pengguna setelah heartbeat/batch aktif belum menunjukkan gain
yang konsisten: account GET n=6, p50 1.517,9 ms; workspace n=2, p50 1.837,6 ms;
rules n=3, p50 2.043,3 ms; universe n=3, p50 1.404,3 ms. Sampel kecil ini bukan
perbandingan terkontrol dan tidak memuat GET jurnal, sehingga tidak dipakai
untuk mengklaim persentase percepatan. Setelah sampel ini ditemukan dan
dihapus GET sidebar yang tidak digunakan serta pembacaan profil ganda di bawah.

## Optimasi backend

- **Satu pembacaan profil per account GET.** Guard mengembalikan profil aktif
  yang baru saja diperiksa, sehingga handler tidak SELECT profil yang sama
  lagi. Setiap request berikutnya tetap memeriksa status baru; tidak ada
  cache role/status antar request. Tes menolak request berikutnya setelah
  akun disuspensi dan menghitung satu pembacaan profil untuk request sukses.

- **Heartbeat sesi maksimal sekali per menit.** Setiap request tetap SELECT
  sesi dari database dan memeriksa owner, expiry serta revocation. Hanya UPDATE
  waktu presence yang dilewati saat timestamp masih baru. UPDATE bersyarat
  juga menghindari penulisan berulang ketika request datang bersamaan.
  Tampilan last-seen dapat tertinggal sampai sekitar satu menit; izin tidak
  memakai TTL tersebut. Tidak ada perubahan TTL token/sesi.
- **Batch pembacaan record.** Owner transaction-local dan SELECT dikirim
  melalui `pgx.SendBatch`, dengan transaksi implisit dan penutupan results
  sebelum koneksi kembali ke pool. Predicate owner dan RLS tetap berlaku;
  kegagalan baca tetap membersihkan konteks. Write/CAS/lock tidak diubah.
  Batch mengurangi penantian jaringan berurutan; persiapan statement pada
  koneksi baru tetap dapat memerlukan pekerjaan tambahan.

Perilaku batch dikonfirmasi pada versi pgx yang dipasang di `go.mod`; lihat
[SendBatch](https://pkg.go.dev/github.com/jackc/pgx/v5#Conn.SendBatch).
Pool tetap dibatasi lima koneksi, tanpa menaikkan alokasi cloud.

### Lanjutan query — 2 November

Adapter sesi Postgres menyediakan `VerifyAccount`: satu owner/token-bound SELECT
dengan LEFT JOIN profil menggantikan SELECT sesi lalu SELECT profil terpisah.
Revocation/expiry tetap diperiksa sebelum status profil; profile hilang/suspended
ditolak. Adapter legacy tetap memakai alur dua pemeriksaan, tanpa mengubah arsip.
`RequireFeature` juga menggabungkan status akun dan EXISTS grant/subscription
dalam satu SELECT. Rule list memerlukan tiga pembacaan utama, sebelumnya lima,
di luar heartbeat yang memang perlu diperbarui; tidak ada TTL keputusan izin.

pgx 5.9.2 yang terpasang default melakukan ping setelah idle >1 detik. Pengukuran
db_acquire sekitar satu RTT cloud juga dapat mencakup ping, bukan selalu antrean
pool. `ShouldPing` kini memeriksa setelah idle 30 detik. Idle connection disimpan
10 menit (sebelumnya dua); MaxConns=5, MinConns=0, connect timeout dan batas
request tidak dinaikkan. Koneksi yang putus kurang dari 30 detik dapat baru
terdeteksi oleh query; kegagalan tetap dikembalikan, bukan dianggap sukses.
Readiness tetap menguji database. Tidak ada Redis atau perubahan pooler.

Postgres 17 terpisah membuktikan satu joined read, isolasi owner, status suspended,
expiry/revocation, heartbeat dan batas sesi. Harness schema menjalankan 12 migration
dan tiga pemeriksaan policy, lalu seluruh Go/race dengan integration API lokal.
Ini bukti ketepatan query, bukan angka percepatan akun cloud baru. Setelah rebuild,
preflight lokal lulus; pengukuran navigasi cloud hanya boleh dicatat jika request
akun tersebut benar-benar terlihat di log.

Sidebar juga masih mengirim account GET saat navigasi/focus untuk item menu
operator yang sudah dihapus. Effect ini dan kondisi menu yang tidak dipakai
dihapus. Akses halaman operator dan endpoint admin tetap diperiksa melalui
alur server yang ada. Tes navigasi News → Journal memastikan tidak ada lagi
account GET tambahan dari sidebar; data yang diperlukan halaman tetap diambil.

## Bukti pengujian

### Verifikasi JWT lokal dan pemisahan waktu request

Pemeriksaan public endpoint JWKS proyek pada 2 November mengonfirmasi satu
public key ES256. API sekarang mengaktifkan verifikasi tanda tangan lokal
melalui `golang-jwt/jwt/v5` 5.3.1 dan parsing JWK melalui `go-jose/v4` 4.1.7.
Issuer harus tepat proyek ini, audience `authenticated`, exp wajib dan belum
lewat, iat wajib/tidak di masa depan, nbf dihormati, role harus `authenticated`,
serta subject/session ID harus UUID. Metadata pengguna hanya untuk nama tampilan.
Token asimetris gagal tidak dialihkan diam-diam ke `/user`.

Public key dibagikan antar request dalam proses, TTL maksimum 10 menit. Fetch
bersamaan digabung, timeout lima detik, refresh karena key asing/gagal dibatasi
30 detik. Token pembaca yang membatalkan request tidak membatalkan fetch key
bersama. Key kedaluwarsa tidak dipakai jika refresh gagal. Restart proses
mengosongkan cache key. Token HS256 lama tetap diverifikasi ke Supabase Auth;
tidak ada JWT Secret baru yang disimpan. Login, refresh dan recovery tetap
menggunakan Supabase Auth.

Setiap request aplikasi tetap memeriksa app-session, status akun, ownership dan
entitlement yang diperlukan. Tes melalui API dengan JWT ES256 dari key fixture
menolak sesi revoked/expired dan akun suspended pada request berikutnya walau
public key sudah ada. Verifikasi lokal membuktikan token sah sampai exp; bukan
permintaan status user terbaru ke Supabase setiap kali. Perubahan nama/email
dalam token dapat tertunda sampai refresh. Pencabutan sesi aplikasi SignalGen
tetap langsung diperiksa; pencabutan/penghapusan hanya di Supabase Auth tidak
boleh dianggap langsung membatalkan setiap access token yang belum expired.

Log `http_request` menambahkan `timings_us` dengan stage tetap:
`auth_local`, `auth_remote`, `auth_keys`, `db_acquire`, `db_connect`, `db_query`,
`db_batch`. Durasi dalam mikrodetik, dijumlah per stage dalam satu request.
Stage dapat saling mencakup (misalnya auth_local menunggu auth_keys,
db_acquire menunggu db_connect); **jangan menjumlahkan semuanya sebagai waktu
HTTP**. Connect di background yang tidak memiliki context request hanya muncul
melalui tracer/pool summary yang sudah ada. Tidak ada token, claims, SQL,
argumen, URL database, user ID atau body di log.

Benchmark fixture ES256 dengan key hangat (Apple M5, darwin/arm64, Go 1.27.2,
tiga run) menghasilkan 112.679 / 104.194 / 71.227 ns per verifikasi, sekitar
0,071–0,113 ms dan 5,85 kB alokasi/op. Ini biaya verifikasi lokal saja, tidak
memuat fetch key pertama, database, autentikasi akun asli atau render UI.
Tidak digunakan untuk menjanjikan keseluruhan GET menjadi di bawah satu ms.

Setelah pengguna membuka Dashboard, Rules dan Universe di akun asli, log
request sukses memberi sampel berikut. Ini observasi setelah optimasi,
bukan eksperimen before/after terkontrol. Satuan milidetik:

| Route | n | HTTP p50 | HTTP p95 | Auth lokal p50 |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/me` | 3 | 0,808 | 149,365 | 0,285 |
| `/api/v1/account/me` | 8 | 749,455 | 2.735,514 | 0,121 |
| `/api/v1/rules` | 11 | 1.126,655 | 3.023,400 | 0,125 |
| `/api/v1/stock-universes` | 12 | 741,099 | 2.425,162 | 0,125 |
| `/api/v1/subscription` | 4 | 839,420 | 1.697,984 | 0,145 |

Fetch key pertama tercatat 148,837 ms. Pembuatan empat koneksi baru tercatat
1.124–1.350 ms. SQL beberapa perjalanan jaringan dan antrean/koneksi dingin
masih dominan: db_query p50 rules 939,816 ms, universe 563,461 ms, subscription
822,258 ms. Angka ini mencakup round trip driver/jaringan, bukan waktu eksekusi
SQL murni di database. Tahap yang saling mencakup dan p50 tahap terpisah tidak
boleh dijumlah. Tidak ada auth_remote pada sampel sukses ini.

Sesi dan status akun tidak dicache untuk menyamarkan latensi. Untuk kelanjutan,
ukur SQL/round trip dan strategi koneksi hangat sebelum menaikkan pool,
mengubah pooler atau menambah Redis. Penempatan API dekat region database
mengurangi jarak jaringan yang sekarang tetap ditempuh dari laptop.
[Artefak pengukuran](../evidence/auth-local-20261102.json).

Go/race seluruh package, tes timing fast-query/request, tes token/signature,
rotasi/expiry key, provider failure/backoff, cancellation, algoritme yang salah,
metadata role palsu, serta sesi revoked/expired dan akun suspended lulus.
Image Go API berhasil dibangun dan preflight liveness/readiness/OpenAPI serta
kecocokan aset Go/WASM lulus. Tidak ada migration atau pengubahan signing key
cloud. Browser pengguna memberi smoke test akun asli; fixture tetap dibedakan.

Dokumentasi acuan: [Supabase JWT](https://supabase.com/docs/guides/auth/jwts).

### Cache UI lintas halaman

Tahap berikut memakai `@tanstack/query-core` versi tepat 5.105.1, tanpa Redis
atau dependency React provider baru. Daftar rule, universe, katalog saham dan
label paket dipakai bersama oleh halaman yang membutuhkannya. Cache hanya RAM
tab browser, terpisah menurut login revision dan user ID dari identitas yang
diverifikasi. Token, profil otorisasi, grant, jurnal dan candle tidak dicache
oleh lapisan ini. Data paket hanya untuk tampilan; entitlement tetap dicek
server pada operasi yang memerlukannya.

Daftar/paket fresh 30 detik, metadata katalog lima menit. Setelah stale, salinan
terakhir dapat terlihat sambil fetch berjalan. Retensi cache maksimum lima menit
tanpa fetch baru; reload halaman mulai dengan cache kosong. Tombol Refresh
memaksa server read. Create/update/delete yang relevan membuang cache, termasuk
read yang belum selesai. Logout, pergantian akun dan login ulang token yang
sama membersihkan semua entri. Form menerima salinan data agar edit belum
disimpan tidak mengubah cache bersama.

Pada fixture, endpoint GET daftar sengaja ditahan setelah warmup. Kembali ke
Rules/Universes tetap menampilkan data, dengan **nol GET baru untuk daftar**:

| Viewport | Halaman | Dari navigasi sampai elemen daftar terlihat |
| --- | --- | ---: |
| 1440 px | Rules | 34 ms |
| 1440 px | Universes | 28 ms |
| 390 px | Rules | 35 ms |
| 390 px | Universes | 26 ms |

[Artefak JSON](../evidence/ui-cache-20261102.json). Ini empat observasi dengan
API/akun/provider sintetis pada desktop, bukan p50/p95, render/paint lengkap,
benchmark ponsel fisik atau waktu pembukaan pertama. GET lain seperti kuota
tetap dapat berjalan. API asli tidak diklaim berubah menjadi 26–35 ms.

213 tes frontend, typecheck/build, browser workspace desktop/mobile dan suite
admin lulus. Kasus cache mencakup fresh hit, TTL, refresh, update/delete,
respons sebelum mutation yang terlambat, error/retry, clone form, owner,
login revision, logout, token reuse dan revocation. Request otorisasi biasa
dibuktikan tetap mengambil data server pada setiap read terpisah.

Audit npm sebelum/sesudah menunjukkan dua advisory lama yang sama pada Vite
dan source-map-js; dependency cache tidak menambah advisory pada hasil itu.
Upgrade kedua dependency lama tidak dimasukkan ke perubahan cache ini.

### Pemeriksaan sebelumnya

- 205 tes frontend, typecheck/build dan suite browser workspace lulus setelah
  perbaikan progressive loading. Fixture menahan GET workspace dan subscription
  tanpa menyelesaikannya: data akun/rule/universe tetap terlihat pada 1440 dan
  390 px. Kegagalan paket tidak menghilangkan data yang tersedia; riwayat yang
  terlambat tetap diterapkan dan screener menunggu preferensi tersinkron.
- PostgreSQL 17 disposable: tes sesi menghitung penulisan heartbeat nyata.
  Lima sesi baru tidak ditulis ulang saat diverifikasi; tiga pemeriksaan sesi
  yang sudah lama hanya memperbarui presence satu kali. Fresh heartbeat tidak
  melewati pemeriksaan expiry/revocation atau pemeriksaan owner.
- PostgreSQL 17 disposable dengan role non-bypass-RLS dan pool satu koneksi:
  owner/CAS/quota/idempotency, batch read sukses/gagal, pergantian owner serta
  konteks RLS kosong setelah results ditutup lulus. Pembatasan satu koneksi
  memaksa reuse sehingga kebocoran tidak tertutup koneksi lain yang bersih.

Tes lokal membuktikan pengurangan pekerjaan dan correctness, bukan angka
percepatan cloud. Go/race tests, 205 tes frontend, production build, suite
workspace desktop/mobile, suite admin (termasuk forged/suspended role) dan
preflight backend hasil rebuild lulus. Tes RLS batch juga sengaja mengarahkan
predicate SQL ke akun A saat konteksnya B, lalu A lagi pada koneksi yang sama;
RLS tetap mengikuti owner yang benar.

Upaya microbenchmark cloud baca-saja terpisah tidak menghasilkan pengukuran
yang dapat digunakan, sehingga tidak dilaporkan sebagai hasil performa.
Perbandingan GET setelah penghapusan request sidebar/profil ganda perlu diambil
lagi pada kondisi sebanding. Tidak menjanjikan UI instan atau mengabaikan
outage provider demi menghilangkan indikator loading.
