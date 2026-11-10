# Panduan penggunaan skill SignalGen

Aturan operasional ada di `AGENTS.md`. Pilih skill berdasarkan pekerjaan yang diminta, baca panduannya, lalu verifikasi hasil dengan pemeriksaan yang sesuai. Penggunaan skill membantu proses kerja; hasilnya tetap harus dibuktikan.

## Alur setiap tugas

1. Tentukan hasil yang diminta dan cara memeriksa keberhasilannya.
2. Pilih skill yang relevan dan pelajari implementasi serta pola proyek yang sudah ada.
3. Kerjakan perubahan sesuai lingkup tugas.
4. Jalankan pemeriksaan yang sesuai; untuk UI, periksa juga tampilan dan interaksi yang terpengaruh.
5. Gunakan `no-ai-slop` dan `unslop` untuk memeriksa teks yang diubah serta jawaban akhir. Pertahankan fakta, kutipan, kode, dan hasil pemeriksaan.
6. Tinjau diff, commit dan push sesuai aturan proyek, lalu laporkan hasil verifikasi beserta batasannya.

## Skill untuk implementasi dan verifikasi

| Skill | Kapan digunakan | Contoh permintaan |
| --- | --- | --- |
| `ponytail` | Coding, perbaikan bug, refactoring, dan review kode | “Perbaiki filter yang tidak bekerja dengan perubahan sekecil yang diperlukan.” |
| `codebase-memory` | Menelusuri struktur, pemanggilan fungsi, dependensi, dan dampak perubahan | “Telusuri alur tombol screener dari UI sampai backend.” |
| `frontend-design` | Membuat atau memperbaiki halaman dan komponen frontend | “Buat halaman portofolio sesuai identitas SignalGen.” |
| `ui-ux-pro-max` | Desain dan review UI/UX, termasuk responsivitas dan aksesibilitas | “Rapikan dashboard agar nyaman digunakan di HP.” |
| `playwright` | Verifikasi alur melalui browser | “Uji login dan pesan error-nya di desktop dan HP.” |
| `security-audit` | Pertanyaan keamanan, review batas kepercayaan, dan audit keamanan | “Periksa apakah endpoint ini membatasi data sesuai pemiliknya.” |

`security-audit` menggunakan panduan yang relevan untuk pemeriksaan terarah. Permintaan seperti “Audit keamanan codebase SignalGen dan buat laporannya” memicu workflow audit lengkap, termasuk verifikasi independen. Eksekusi kode target mengikuti persyaratan sandbox skill; pemeriksaan yang terblokir harus dinyatakan belum tervalidasi.

## Skill untuk desain dan teks

| Skill | Kapan digunakan | Contoh permintaan |
| --- | --- | --- |
| `scroll-craft` | Pengalaman scrolling, hero berlapis, dan animasi landing page | “Buat landing page dengan animasi saat scroll dan dukungan reduced motion.” |
| `better-interface` | Review lintas aspek pada layar atau alur tertentu | “Review halaman registrasi dari sisi aksesibilitas, layout, dan tampilan.” |
| `better-accessibility` | Keyboard, fokus, label aksesibel, form, dan pembaca layar | “Pastikan dialog tambah transaksi bisa dipakai dengan keyboard.” |
| `better-layout` | Pengelompokan, alignment, urutan baca, dan layout responsif | “Perbaiki tabel portofolio yang terpotong di layar kecil.” |
| `better-typography` | Skala teks, jarak, wrapping, truncation, dan fitur font | “Rapikan judul, angka, dan teks panjang pada tabel.” |
| `better-colors` | Token warna, palet, makna warna, dan kontras | “Periksa kontras teks pada tema terang dan gelap.” |
| `better-ui` | Permukaan komponen, ikon, state interaksi, dan animasi | “Rapikan state hover, fokus, disabled, dan loading tombol.” |
| `better-writing` | Label, error, kondisi kosong, dan konfirmasi | “Perjelas pesan error agar pengguna tahu langkah berikutnya.” |
| `build-design` | Implementasi berdasarkan Figma atau gambar desain yang diberikan | “Implementasikan desain ini memakai komponen dan token proyek.” |
| `teardown` | Ilustrasi teknis objek atau cara kerja melalui lapisan dan bagian | “Buat ilustrasi lapisan antarmuka beserta penjelasannya.” |
| `no-ai-slop` | Pemeriksaan akhir kejelasan, pengulangan, filler, dan klaim generik | “Rapikan penjelasan fitur ini agar langsung ke intinya.” |
| `unslop` | Pemeriksaan akhir bahasa natural sesuai pembaca dan konteks | “Buat paragraf ini lebih natural, tetap formal dan faktual.” |

`no-ai-slop` dan `unslop` wajib digunakan sebelum jawaban akhir setiap tugas di proyek ini, kecuali pengguna meminta pengecualian. Keduanya juga memeriksa teks UI atau dokumentasi yang dibuat atau diubah. Kalimat yang sudah jelas tidak perlu dipaksakan berubah.

## Workflow yang dijalankan saat diminta khusus

| Skill | Kegunaan | Contoh permintaan |
| --- | --- | --- |
| `interface-review` | Review dampak perubahan branch, PR, atau diff terhadap antarmuka | “Gunakan interface-review untuk perubahan di branch ini.” |
| `explain-interface` | Menjelaskan implementasi tampilan atau efek dari URL atau screenshot | “Gunakan explain-interface untuk menjelaskan efek pada halaman ini.” |
| `break` | Menguji komponen dengan berbagai skenario pada halaman sementara | “Gunakan break untuk menguji form transaksi dengan input ekstrem.” |
| `state-machine` | Menampilkan berbagai state komponen dengan data mock dan pengalih state | “Gunakan state-machine untuk menampilkan state kartu portofolio.” |
| `variant` | Membuat beberapa alternatif komponen untuk dibandingkan | “Gunakan variant untuk membuat tiga pilihan kartu ringkasan.” |
| `afk` | Mengerjakan perbaikan selama pengguna pergi, sesuai lingkup dan batas yang diminta | “Gunakan afk selama satu jam untuk memperbaiki halaman bantuan.” |

Pemasangan skill tidak otomatis menjalankan workflow tersebut. Instruksi pengguna dan aturan proyek tetap menentukan lingkup perubahan serta pengiriman Git.

## Contoh kombinasi untuk satu fitur

Permintaan: “Buat form tambah transaksi yang nyaman di HP, dengan validasi dan pesan error yang jelas.”

- Telusuri implementasi yang terkait memakai `codebase-memory`, lalu gunakan `ponytail` untuk menjaga perubahan tetap sesuai kebutuhan.
- Gunakan `frontend-design`, `ui-ux-pro-max`, serta skill domain yang relevan untuk layout, aksesibilitas, state komponen, dan teks form. Ikuti juga skill frontend lain yang diwajibkan `AGENTS.md` bila tersedia; laporkan bila ada yang tidak tersedia.
- Gunakan panduan `security-audit` pada batas keamanan yang terpengaruh, seperti kepemilikan transaksi dan validasi input.
- Verifikasi alur yang terpengaruh dengan pemeriksaan proyek dan `playwright`, lalu gunakan `no-ai-slop` serta `unslop` sebelum pengiriman.

Daftar ini berfokus pada pengembangan SignalGen dan skill yang dibahas dalam sesi ini. Untuk tugas dokumen, spreadsheet, presentasi, Supabase, atau layanan lain, pilih skill khusus yang tersedia di katalog sesi. Context7, DESIGNmd, dan Git adalah alat pendukung, bukan nama skill dalam daftar ini.
