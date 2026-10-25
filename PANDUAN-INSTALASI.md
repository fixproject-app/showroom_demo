# 📋 Panduan Instalasi — Showroom Motor

Aplikasi manajemen showroom motor bekas + katalog publik.
Backend **Supabase** (Postgres, Auth, Storage, Edge Functions) · Frontend **file statis** di **Vercel** · Kode di **GitHub**.
Paket ini dibuat agar **satu showroom = satu set akun baru** (Supabase, GitHub, Vercel sendiri-sendiri), tanpa data showroom lain.

## Isi paket
| Berkas | Fungsi |
|---|---|
| `schema.sql` | Tabel, trigger bisnis, RLS, view, RPC, bucket Storage, data awal. Aman dijalankan berulang. |
| `seed-contoh.sql` | (Opsional) data contoh. Jangan dijalankan di showroom yang sudah live. |
| `index.html`, `style.css`, `app.js` | Aplikasi web (SPA). Tidak perlu diubah. |
| `config.js` | **Satu-satunya berkas yang wajib Anda isi** (URL & anon key Supabase, alamat situs). |
| `supabase/functions/kelola-user`, `buat-dokumen-pdf` | Edge Function: kelola akun & kuitansi/surat PDF. |
| `api/motor.js`, `vercel.json` | Tautan bagikan `/motor/<kode>` dengan pratinjau foto & harga di WhatsApp. |

Nama showroom, logo, alamat, WhatsApp, sosial media, banner, dan **singkatan kode unit** (mis. `CMJ-0001`, `KWT/CMJ/2026/0001`) semuanya diatur dari menu **Pengaturan** setelah aplikasi jalan — tidak perlu mengubah kode.

---
## Langkah 1 — Supabase (project baru)
1. https://supabase.com/dashboard → **New project** (nama bebas, mis. nama showroom; simpan *Database password*).
2. Setelah siap, buka **Project Settings → API**. Catat:
   - **Project URL** (`https://xxxx.supabase.co`) → `xxxx` adalah **Project ID**
   - **anon public key** (atau *publishable key*)
   - ⚠️ Jangan pernah memakai **service_role key** di `config.js`/GitHub.
3. **Authentication → Sign In / Providers → Email** → matikan **Allow new users to sign up** (agar orang asing tidak bisa mendaftar).
4. **Authentication → Users → Add user → Create new user**: isi email & kata sandi pemilik, centang **Auto Confirm User**. Akun **pertama** otomatis menjadi **Owner**; akun berikutnya **Admin**.
5. **SQL Editor → New query** → tempel seluruh isi `schema.sql` → **Run**. Harus selesai tanpa error. (Ini juga membuat 3 bucket Storage: `motor-foto-publik`, `motor-privat`, `dokumen-pdf`.)

## Langkah 2 — Edge Functions (di komputer Anda)
Butuh Node.js (https://nodejs.org, versi LTS). Buka terminal di folder paket ini:
```bash
npx supabase login
npx supabase link --project-ref PROJECT_ID_BARU
npx supabase functions deploy kelola-user --no-verify-jwt
npx supabase functions deploy buat-dokumen-pdf --no-verify-jwt
```
`--no-verify-jwt` aman: kedua fungsi memeriksa sendiri token & peran pemanggil. Tidak ada secret tambahan — `SUPABASE_URL` dan `SERVICE_ROLE_KEY` disediakan Supabase otomatis.
> Pastikan `PROJECT_ID_BARU` adalah project showroom **ini**, bukan project showroom lain. `link` lama akan tertimpa.

## Langkah 3 — GitHub (repo baru)
1. https://github.com/new → nama mis. `nama-showroom` → **Private** (disarankan, karena `schema.sql` ikut tersimpan) → Create.
2. **Add file → Upload files**: unggah **isi** folder paket (bukan folder pembungkusnya): `index.html`, `style.css`, `app.js`, `config.js`, `vercel.json`, folder `api/`, folder `supabase/`, `schema.sql`, `PANDUAN-INSTALASI.md`. Commit.
3. Edit `config.js` langsung di GitHub (ikon pensil):
```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJ...',                         // anon public key
SITE_URL: 'https://nama-showroom.vercel.app',        // isi setelah Langkah 4 (boleh diedit lagi)
SHARE_PRETTY_LINK: true
```

## Langkah 4 — Vercel (project baru)
1. https://vercel.com/new → **Import** repo tadi. Framework Preset: **Other**. Build command & output directory dibiarkan kosong. → **Deploy**.
2. **Settings → Environment Variables**: tambahkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` (nilai sama seperti `config.js`) → lalu **Redeploy** (Deployments → ⋯ → Redeploy).
3. Salin alamat situsnya, tempel ke `SITE_URL` di `config.js` (GitHub) → Vercel otomatis deploy ulang.
4. Katalog publik tampil di alamat itu. Halaman staf: `alamat-anda/#/masuk` (atau ikon gembok di footer).

## Langkah 5 — Setelan awal (sebagai Owner)
1. Masuk dengan akun Owner → **Pengaturan → Identitas usaha**: isi **nama usaha, alamat, WhatsApp, singkatan** (2–6 huruf/angka; dipakai kode unit & nomor kuitansi). Atur **sebelum** membuat unit pertama agar kodenya sesuai.
2. **Pengaturan → Katalog publik**: unggah logo (PNG/JPG), banner, tautan sosial media, dan atur watermark foto.
3. **Pengguna → Tambah**: buat akun Admin untuk staf.
4. **+ → Unit Motor Baru** → isi data & pembelian → tab **Foto** → status **Ready** → centang **Tampil di katalog**.

## Hak akses
| | Owner | Admin |
|---|---|---|
| Daftar motor, ubah data unit, foto, dokumen, pemeriksaan, tambah unit, centang tampil katalog | ✅ | ✅ |
| Jual motor, catat pembayaran, kuitansi, surat jual-beli | ✅ | ✅ |
| Data pembelian/penjual, keuangan unit, restorasi, pengeluaran, pelanggan (daftar), dokumen, dashboard, laporan | ✅ | ❌ (menu & data tidak tampil) |
| Template pemeriksaan (ubah / tampilkan–sembunyikan), identitas usaha, katalog, hapus data, batalkan penjualan, log, kelola pengguna | ✅ | ❌ |

Unit yang dibuat Admin belum punya data pembelian — Owner melengkapinya lewat tombol **Catat pembelian** di halaman unit.

## Aturan bisnis otomatis (di database)
- Status **Booking / Terjual** mengikuti penjualan (tunai belum lunas → Booking; lunas → Terjual; leasing → Proses Leasing & Terjual; batal → Ready).
- Pembayaran melebihi sisa tagihan ditolak. Motor hanya bisa dijual saat **Ready**.
- Nopol & no. rangka tidak boleh kembar pada unit aktif. Label **Terverifikasi** hanya bisa diaktifkan bila semua butir pemeriksaan *yang ditampilkan* sudah terisi.
- Semua perubahan tercatat di Log Aktivitas (Owner).

## Mengosongkan data uji sebelum live
SQL Editor → jalankan:
```sql
begin;
truncate table public.penjualan, public.motor, public.pelanggan, public.sumber_motor,
  public.pengeluaran_operasional, public.activity_log, public.nomor_dokumen_seq cascade;
alter sequence public.seq_kode_unit restart with 1;
commit;
```
Akun, pengaturan, dan template pemeriksaan tidak terhapus. File foto/dokumen di **Storage** perlu dihapus manual dari bucket (kecuali folder `logo/` & `banner/`).

## Pemecahan masalah
- **"Konfigurasi belum diisi"** → `config.js` belum diisi / belum ter-deploy (hard refresh: Ctrl+Shift+R).
- **Tampilan berantakan / fitur baru tak muncul** → file lama ter-cache atau belum ikut diunggah ke GitHub; unggah ulang lalu hard refresh.
- **Tidak bisa masuk / halaman kosong** → pastikan `schema.sql` sudah dijalankan & akun tidak dinonaktifkan.
- **Daftar pengguna / PDF gagal** → Edge Function belum di-deploy ke project yang benar (Langkah 2). Cek log: Supabase → Edge Functions → Logs.
- **Foto tidak tampil di katalog** → unit harus Ready, *Tampil di katalog* aktif, dan ada foto slot 1.
- **Pratinjau WhatsApp tanpa foto** → variabel Vercel belum diisi / belum redeploy; WhatsApp menyimpan cache, coba tautan baru.
- Setiap kali `schema.sql` diperbarui, jalankan ulang di SQL Editor (aman diulang).

## Keamanan
- Browser hanya memegang *anon key*; seluruh data dilindungi RLS di database.
- Katalog publik hanya membaca lewat fungsi RPC yang tidak menyertakan nopol, no. rangka, penjual, modal, atau foto berkas.
- Bukti pembelian/pengeluaran hanya bisa dibaca Owner. Admin tidak dapat membaca/menulis tabel keuangan (dikunci di database, bukan hanya disembunyikan di tampilan).
