-- ============================================================
-- Showroom Motor — Skema Database (schema.sql)
-- Deskripsi : Manajemen sorum motor bekas (pembelian → restorasi →
--             penjualan → pembayaran → laporan) + katalog publik.
-- Versi     : 1.0  (sesuai PRD Final 9 Okt 2026)
-- Cara pakai: Supabase Dashboard → SQL Editor → New query →
--             paste seluruh isi file ini → Run.
-- Aman dijalankan berulang (idempotent).
--
-- PERAN
--   owner : akses penuh.
--   admin : petugas sorum. HANYA: tambah/ubah unit motor (tanpa data pembelian),
--           unggah foto/dokumen, isi pemeriksaan, centang tampil di katalog,
--           jual motor, catat pembayaran & buat kuitansi/surat jual-beli.
--           TIDAK boleh melihat/mengisi modal, pembelian, penjual asal motor,
--           biaya restorasi, pengeluaran, laporan; TIDAK boleh menghapus data,
--           membuka Kelola User, Log Aktivitas, atau mengubah Pengaturan usaha.
--   anon  : tanpa login — hanya katalog publik lewat fungsi RPC.
--
-- CATATAN KEAMANAN
--   • RLS aktif di SEMUA tabel. Anon tidak punya akses langsung ke tabel.
--   • RLS bekerja per baris, bukan per kolom. Karena itu data keuangan
--     dipisah ke tabel sendiri (pembelian, reparasi_biaya,
--     pengeluaran_operasional, reparasi, sumber_motor) yang hanya bisa
--     dibaca & diisi owner. Admin tidak punya akses sama sekali.
-- ============================================================


-- ============================================================
-- 0. FUNGSI DASAR
-- ============================================================

-- Tanggal "hari ini" menurut WIB (server Supabase memakai UTC).
create or replace function public.hari_ini()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Jakarta')::date
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create sequence if not exists public.seq_kode_unit;


-- ============================================================
-- 1. TABEL
-- ============================================================

-- 1.1 profiles — pengguna aplikasi (1:1 dengan auth.users)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nama       text not null default '',
  role       text not null default 'admin' check (role in ('owner', 'admin')),
  aktif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- Fungsi pembantu peran (security definer: membaca profiles tanpa
-- terhalang RLS-nya sendiri). Akun nonaktif dianggap tidak punya peran.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and aktif
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid() and aktif) = 'owner', false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid() and aktif) in ('owner', 'admin'), false)
$$;

-- Profil otomatis dibuat saat user baru dibuat di Supabase Auth.
-- User PERTAMA otomatis menjadi owner; berikutnya admin (hak paling kecil).
-- Pastikan "Allow new users to sign up" dimatikan (lihat panduan).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nama, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nama', ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from public.profiles where role = 'owner') then 'admin' else 'owner' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Jika akun sudah dibuat SEBELUM skema ini dijalankan: buatkan profilnya.
-- Akun paling awal menjadi owner bila belum ada owner.
do $$
begin
  insert into public.profiles (id, nama, role)
  select u.id,
         coalesce(nullif(u.raw_user_meta_data->>'nama', ''), split_part(coalesce(u.email, ''), '@', 1)),
         case when row_number() over (order by u.created_at) = 1
                   and not exists (select 1 from public.profiles where role = 'owner')
              then 'owner' else 'admin' end
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;
end $$;

-- 1.2 pengaturan — konfigurasi (key/value)
create table if not exists public.pengaturan (
  key   text primary key,
  value text
);

-- Singkatan showroom untuk kode unit (MTR-0001) & nomor dokumen (KWT/MTR/2026/0001).
-- Diatur owner di Pengaturan → Identitas usaha (kunci 'kode_prefix'). Hanya huruf/angka, maks. 6.
create or replace function public.kode_prefix()
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select upper(regexp_replace(coalesce(value, ''), '[^A-Za-z0-9]', '', 'g')) into v from public.pengaturan where key = 'kode_prefix';
  v := left(coalesce(nullif(v, ''), 'MTR'), 6);
  return v;
end;
$$;

-- 1.3 sumber_motor — penjual / asal motor
create table if not exists public.sumber_motor (
  id         uuid primary key default gen_random_uuid(),
  nama       text not null,
  hp         text,
  alamat     text,
  created_at timestamptz not null default now()
);

-- 1.4 motor — data utama unit
create table if not exists public.motor (
  id                uuid primary key default gen_random_uuid(),
  kode_unit         text unique not null default (public.kode_prefix() || '-' || lpad(nextval('public.seq_kode_unit')::text, 4, '0')),
  merk              text not null,
  tipe              text not null,
  tahun             int  not null check (tahun between 1980 and 2100),
  warna             text,
  nopol             text not null,
  no_rangka         text,
  no_mesin          text,
  kilometer         int  check (kilometer is null or kilometer >= 0),
  status            text not null default 'Masuk'
                    check (status in ('Masuk', 'Pemeriksaan', 'Restorasi', 'Ready', 'Booking', 'Terjual')),
  tanggal_masuk     date not null default public.hari_ini(),
  sumber_id         uuid references public.sumber_motor(id) on delete set null,
  harga_jual        bigint check (harga_jual is null or harga_jual >= 0),
  kelengkapan_surat text,
  deskripsi_publik  text,
  tampil_katalog    boolean not null default false,
  public_slug       text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  catatan           text,
  created_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Lencana "Terverifikasi" (lolos Quality Check) di katalog publik.
-- Hanya bisa diaktifkan jika seluruh butir pemeriksaan unit sudah terisi (lihat trigger trg_motor_before).
alter table public.motor add column if not exists terverifikasi boolean not null default false;
create index if not exists idx_motor_status        on public.motor (status);
create index if not exists idx_motor_tanggal_masuk on public.motor (tanggal_masuk);
-- Dua unit AKTIF tidak boleh memakai nopol yang sama (unit terjual boleh dipakai ulang).
create unique index if not exists uq_motor_nopol_aktif
  on public.motor ((replace(nopol, ' ', ''))) where status <> 'Terjual';
-- Nomor rangka juga tidak boleh kembar pada unit aktif (diabaikan jika kosong).
create unique index if not exists uq_motor_rangka_aktif
  on public.motor ((upper(replace(no_rangka, ' ', ''))))
  where status <> 'Terjual' and coalesce(trim(no_rangka), '') <> '';

-- 1.5 pembelian — 1 motor : 1 pembelian  (DATA KEUANGAN: hanya owner yang boleh membaca)
create table if not exists public.pembelian (
  id                 uuid primary key default gen_random_uuid(),
  motor_id           uuid not null unique references public.motor(id) on delete cascade,
  sumber_id          uuid references public.sumber_motor(id) on delete set null,
  tanggal_beli       date not null default public.hari_ini(),
  harga_beli         bigint not null check (harga_beli >= 0),
  biaya_transport    bigint not null default 0 check (biaya_transport >= 0),
  biaya_administrasi bigint not null default 0 check (biaya_administrasi >= 0),
  biaya_lain         bigint not null default 0 check (biaya_lain >= 0),
  metode_pembayaran  text not null default 'Tunai' check (metode_pembayaran in ('Tunai', 'Transfer')),
  bukti_path         text,
  catatan            text,
  created_at         timestamptz not null default now()
);

-- 1.6 motor_foto — maksimal 5 slot per motor
--     slot 1–4 : bucket publik (tampil di katalog)
--     slot 5   : "Foto Berkas", bucket privat (TIDAK tampil di katalog)
create table if not exists public.motor_foto (
  id         uuid primary key default gen_random_uuid(),
  motor_id   uuid not null references public.motor(id) on delete cascade,
  urutan     smallint not null check (urutan between 1 and 5),
  jenis      text not null check (jenis in ('utama', 'kedua', 'ketiga', 'keempat', 'berkas')),
  bucket     text not null,
  path       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (motor_id, urutan),
  check ((urutan = 5 and bucket = 'motor-privat' and jenis = 'berkas')
      or (urutan < 5 and bucket = 'motor-foto-publik' and jenis <> 'berkas'))
);

-- 1.7 motor_dokumen — STNK, BPKB, Faktur, Kwitansi pembelian
create table if not exists public.motor_dokumen (
  id         uuid primary key default gen_random_uuid(),
  motor_id   uuid not null references public.motor(id) on delete cascade,
  jenis      text not null check (jenis in ('STNK', 'BPKB', 'Faktur', 'Kwitansi_Pembelian', 'Lainnya')),
  tersedia   boolean not null default false,
  path       text,
  catatan    text,
  created_at timestamptz not null default now(),
  unique (motor_id, jenis)
);

-- 1.8 pemeriksaan_template & pemeriksaan — checklist kondisi motor
create table if not exists public.pemeriksaan_template (
  id       uuid primary key default gen_random_uuid(),
  kategori text not null,
  butir    text not null,
  urutan   int  not null default 0,
  unique (kategori, butir)
);

-- Butir yang dimatikan (aktif = false) tidak tampil di tab Pemeriksaan unit.
alter table public.pemeriksaan_template add column if not exists aktif boolean not null default true;

create table if not exists public.pemeriksaan (
  id         uuid primary key default gen_random_uuid(),
  motor_id   uuid not null references public.motor(id) on delete cascade,
  kategori   text not null,
  butir      text not null,
  kondisi    text check (kondisi in ('Baik', 'Perlu Perbaikan', 'Rusak', 'Tidak Ada')),
  catatan    text,
  tanggal    date not null default public.hari_ini(),
  updated_at timestamptz not null default now(),
  unique (motor_id, kategori, butir)
);

-- 1.9 reparasi & reparasi_biaya — 1 motor : banyak pekerjaan : banyak biaya
create table if not exists public.reparasi (
  id              uuid primary key default gen_random_uuid(),
  motor_id        uuid not null references public.motor(id) on delete cascade,
  nama_pekerjaan  text not null,
  deskripsi       text,
  mekanik         text,
  status          text not null default 'Belum' check (status in ('Belum', 'Dikerjakan', 'Selesai')),
  tanggal_mulai   date,
  tanggal_selesai date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_reparasi_motor on public.reparasi (motor_id);

-- DATA KEUANGAN: hanya owner yang boleh membaca
create table if not exists public.reparasi_biaya (
  id           uuid primary key default gen_random_uuid(),
  reparasi_id  uuid not null references public.reparasi(id) on delete cascade,
  jenis        text not null check (jenis in ('Sparepart', 'Jasa')),
  nama         text not null,
  qty          int  not null default 1 check (qty > 0),
  harga_satuan bigint not null check (harga_satuan >= 0),
  subtotal     bigint generated always as (qty::bigint * harga_satuan) stored,
  catatan      text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_reparasi_biaya_reparasi on public.reparasi_biaya (reparasi_id);

-- 1.10 pelanggan
create table if not exists public.pelanggan (
  id         uuid primary key default gen_random_uuid(),
  nama       text not null,
  hp         text,
  alamat     text,
  catatan    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.11 penjualan — 1 motor : 1 penjualan aktif (yang dibatalkan tetap tersimpan sebagai riwayat)
create table if not exists public.penjualan (
  id            uuid primary key default gen_random_uuid(),
  motor_id      uuid not null references public.motor(id) on delete restrict,
  pelanggan_id  uuid not null references public.pelanggan(id) on delete restrict,
  tanggal_jual  date not null default public.hari_ini(),
  harga_jual    bigint not null check (harga_jual > 0),
  diskon        bigint not null default 0 check (diskon >= 0),
  harga_akhir   bigint generated always as (harga_jual - diskon) stored,
  skema         text not null default 'Tunai' check (skema in ('Tunai', 'Kredit Leasing')),
  nama_leasing  text,
  sales         text,
  status        text not null default 'Booking' check (status in ('Booking', 'Proses Leasing', 'Lunas', 'Batal')),
  catatan       text,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (diskon <= harga_jual),
  check (skema <> 'Kredit Leasing' or coalesce(trim(nama_leasing), '') <> '')
);
create unique index if not exists uq_penjualan_motor_aktif on public.penjualan (motor_id) where status <> 'Batal';
create index if not exists idx_penjualan_tanggal on public.penjualan (tanggal_jual);

-- 1.12 pembayaran — 1 penjualan : banyak pembayaran (DP, cicilan, pelunasan, pencairan leasing)
create table if not exists public.pembayaran (
  id           uuid primary key default gen_random_uuid(),
  penjualan_id uuid not null references public.penjualan(id) on delete cascade,
  tanggal      date not null default public.hari_ini(),
  jenis        text not null check (jenis in ('DP', 'Cicilan', 'Pelunasan', 'Pencairan Leasing')),
  jumlah       bigint not null check (jumlah > 0),
  metode       text not null default 'Tunai' check (metode in ('Tunai', 'Transfer', 'QRIS', 'Leasing')),
  bukti_path   text,
  catatan      text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pembayaran_penjualan on public.pembayaran (penjualan_id);

-- 1.13 pengeluaran_operasional (DATA KEUANGAN: hanya owner yang boleh membaca)
create table if not exists public.pengeluaran_operasional (
  id         uuid primary key default gen_random_uuid(),
  tanggal    date not null default public.hari_ini(),
  kategori   text not null check (kategori in ('Listrik', 'Sewa', 'Iklan', 'Transport', 'Lainnya')),
  deskripsi  text,
  jumlah     bigint not null check (jumlah > 0),
  bukti_path text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_pengeluaran_tanggal on public.pengeluaran_operasional (tanggal);

-- 1.14 dokumen_transaksi — PDF buatan sistem (kuitansi & surat jual-beli)
create table if not exists public.dokumen_transaksi (
  id            uuid primary key default gen_random_uuid(),
  penjualan_id  uuid not null references public.penjualan(id) on delete cascade,
  pembayaran_id uuid references public.pembayaran(id) on delete set null,
  jenis         text not null check (jenis in ('Kuitansi', 'Surat Jual-Beli')),
  nomor_dokumen text not null unique,
  path_pdf      text not null,
  dibuat_oleh   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Penomoran dokumen berurutan per jenis per tahun
create table if not exists public.nomor_dokumen_seq (
  jenis    text not null,
  tahun    int  not null,
  terakhir int  not null default 0,
  primary key (jenis, tahun)
);

-- 1.15 activity_log — jejak perubahan (tidak bisa diubah/dihapus dari aplikasi)
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  aksi       text not null check (aksi in ('INSERT', 'UPDATE', 'DELETE', 'LOGIN')),
  tabel      text,
  record_id  text,
  ringkasan  text,
  data_lama  jsonb,
  data_baru  jsonb,
  waktu      timestamptz not null default now()
);
create index if not exists idx_activity_waktu  on public.activity_log (waktu desc);
create index if not exists idx_activity_record on public.activity_log (tabel, record_id);


-- ============================================================
-- 2. TRIGGER BISNIS
-- ============================================================

-- 2.1 updated_at otomatis
do $$
declare t text;
begin
  foreach t in array array['motor', 'motor_foto', 'pemeriksaan', 'reparasi', 'pelanggan', 'penjualan'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 2.2 motor: rapikan nopol & jaga alur status
--     Status Booking/Terjual HANYA diatur otomatis lewat penjualan.
create or replace function public.trg_motor_before()
returns trigger language plpgsql as $$
begin
  new.nopol := upper(regexp_replace(trim(new.nopol), '\s+', ' ', 'g'));
  -- "Terverifikasi" hanya boleh dinyalakan setelah semua butir pemeriksaan terisi.
  if new.terverifikasi and (tg_op = 'INSERT' or not old.terverifikasi) then
    if not exists (select 1 from public.pemeriksaan p where p.motor_id = new.id and p.kondisi is not null)
       or exists (select 1 from public.pemeriksaan_template t
                   where t.aktif and not exists (select 1 from public.pemeriksaan p
                                      where p.motor_id = new.id and p.kategori = t.kategori
                                        and p.butir = t.butir and p.kondisi is not null)) then
      raise exception 'Unit belum dapat ditandai Terverifikasi: lengkapi dulu seluruh butir pada tab Pemeriksaan.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.status in ('Booking', 'Terjual') then
      raise exception 'Motor baru tidak boleh langsung berstatus %. Gunakan menu Penjualan.', new.status;
    end if;
  elsif new.status is distinct from old.status and pg_trigger_depth() = 1 then
    if new.status in ('Booking', 'Terjual') then
      raise exception 'Status % diatur otomatis lewat menu Penjualan.', new.status;
    end if;
    if old.status in ('Booking', 'Terjual') then
      raise exception 'Motor sedang % — batalkan penjualannya terlebih dahulu.', old.status;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_motor_before on public.motor;
create trigger trg_motor_before before insert or update on public.motor
  for each row execute function public.trg_motor_before();

-- 2.3 penjualan: validasi + hitung status otomatis
--     Lunas          : total pembayaran >= harga akhir
--     Proses Leasing : skema kredit leasing & belum lunas
--     Booking        : tunai & belum lunas
--     Batal          : diatur manual dan bersifat tetap
create or replace function public.trg_penjualan_before()
returns trigger language plpgsql as $$
declare
  v_motor_status text;
  v_bayar bigint;
  v_akhir bigint;
begin
  if tg_op = 'INSERT' then
    select status into v_motor_status from public.motor where id = new.motor_id;
    if v_motor_status is null then
      raise exception 'Motor tidak ditemukan.';
    end if;
    if v_motor_status <> 'Ready' and new.status <> 'Batal' then
      raise exception 'Motor harus berstatus Ready untuk dijual (status sekarang: %).', v_motor_status;
    end if;
  elsif new.motor_id <> old.motor_id then
    raise exception 'Motor pada penjualan tidak dapat diganti.';
  end if;

  if new.status = 'Batal' then
    return new;
  end if;

  v_akhir := new.harga_jual - new.diskon;
  select coalesce(sum(jumlah), 0) into v_bayar from public.pembayaran where penjualan_id = new.id;
  if v_bayar > v_akhir then
    raise exception 'Harga akhir tidak boleh lebih kecil dari total pembayaran yang sudah masuk.';
  end if;
  new.status := case
    when v_akhir > 0 and v_bayar >= v_akhir then 'Lunas'
    when new.skema = 'Kredit Leasing' then 'Proses Leasing'
    else 'Booking'
  end;
  return new;
end;
$$;
drop trigger if exists trg_penjualan_before on public.penjualan;
create trigger trg_penjualan_before before insert or update on public.penjualan
  for each row execute function public.trg_penjualan_before();

-- 2.4 penjualan → sinkronkan status motor
create or replace function public.trg_penjualan_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_target text;
begin
  if tg_op = 'DELETE' then
    update public.motor set status = 'Ready' where id = old.motor_id and status in ('Booking', 'Terjual');
    return old;
  end if;
  v_target := case new.status when 'Booking' then 'Booking' when 'Batal' then 'Ready' else 'Terjual' end;
  if new.status = 'Batal' then
    update public.motor set status = 'Ready' where id = new.motor_id and status in ('Booking', 'Terjual');
  else
    update public.motor set status = v_target where id = new.motor_id and status is distinct from v_target;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_penjualan_after on public.penjualan;
create trigger trg_penjualan_after after insert or update or delete on public.penjualan
  for each row execute function public.trg_penjualan_after();

-- 2.5 pembayaran: tolak kelebihan bayar, lalu hitung ulang status penjualan
create or replace function public.trg_pembayaran_before()
returns trigger language plpgsql as $$
declare
  v_akhir bigint;
  v_status text;
  v_lain bigint;
begin
  select harga_akhir, status into v_akhir, v_status from public.penjualan where id = new.penjualan_id;
  if v_akhir is null then
    raise exception 'Penjualan tidak ditemukan.';
  end if;
  if v_status = 'Batal' then
    raise exception 'Penjualan sudah dibatalkan, pembayaran tidak dapat ditambahkan.';
  end if;
  select coalesce(sum(jumlah), 0) into v_lain
    from public.pembayaran where penjualan_id = new.penjualan_id and id <> new.id;
  if v_lain + new.jumlah > v_akhir then
    raise exception 'Total pembayaran (Rp %) melebihi harga akhir (Rp %). Sisa tagihan: Rp %.',
      replace(to_char(v_lain + new.jumlah, 'FM999,999,999,999'), ',', '.'),
      replace(to_char(v_akhir, 'FM999,999,999,999'), ',', '.'),
      replace(to_char(v_akhir - v_lain, 'FM999,999,999,999'), ',', '.');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_pembayaran_before on public.pembayaran;
create trigger trg_pembayaran_before before insert or update on public.pembayaran
  for each row execute function public.trg_pembayaran_before();

create or replace function public.trg_pembayaran_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- "sentuh" penjualan agar trigger BEFORE menghitung ulang statusnya
  update public.penjualan set updated_at = now()
   where id = coalesce(new.penjualan_id, old.penjualan_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_pembayaran_after on public.pembayaran;
create trigger trg_pembayaran_after after insert or update or delete on public.pembayaran
  for each row execute function public.trg_pembayaran_after();

-- 2.6 Log aktivitas: hanya kolom yang BERUBAH yang disimpan saat UPDATE
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb; v_lama jsonb; v_baru jsonb; v_id text; v_ring text;
begin
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new); v_baru := v_row;
  elsif tg_op = 'DELETE' then
    v_row := to_jsonb(old); v_lama := v_row;
  else
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb),
           coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      into v_lama, v_baru
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n on n.key = o.key
     where o.value is distinct from n.value and o.key <> 'updated_at';
    if v_baru = '{}'::jsonb then
      return new;
    end if;
    v_row := to_jsonb(new);
  end if;

  v_id := coalesce(v_row->>'id', v_row->>'key');
  v_ring := case tg_table_name
    when 'motor' then trim(coalesce(v_row->>'kode_unit', '') || ' ' || coalesce(v_row->>'merk', '') || ' ' || coalesce(v_row->>'tipe', ''))
    when 'dokumen_transaksi' then v_row->>'nomor_dokumen'
    when 'pembayaran' then coalesce(v_row->>'jenis', '') || ' Rp ' || coalesce(v_row->>'jumlah', '')
    when 'penjualan' then 'Penjualan ' || coalesce(v_row->>'harga_akhir', '')
    when 'pengeluaran_operasional' then coalesce(v_row->>'kategori', '') || ' ' || coalesce(v_row->>'deskripsi', '')
    else coalesce(v_row->>'nama', v_row->>'nama_pekerjaan', v_row->>'jenis', v_row->>'key')
  end;

  insert into public.activity_log (user_id, aksi, tabel, record_id, ringkasan, data_lama, data_baru)
  values (auth.uid(), tg_op, tg_table_name, v_id, v_ring, v_lama, v_baru);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'pengaturan', 'sumber_motor', 'motor', 'pembelian', 'motor_dokumen',
                           'reparasi', 'reparasi_biaya', 'pelanggan', 'penjualan', 'pembayaran',
                           'pengeluaran_operasional', 'dokumen_transaksi'] loop
    execute format('drop trigger if exists trg_log_%1$s on public.%1$I', t);
    execute format('create trigger trg_log_%1$s after insert or update or delete on public.%1$I for each row execute function public.log_activity()', t);
  end loop;
end $$;


-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

-- 3.1 Pola umum: staff (owner+admin) baca/tambah/ubah, HANYA owner yang boleh hapus
do $$
declare t text;
begin
  foreach t in array array['motor', 'motor_foto', 'motor_dokumen', 'pemeriksaan',
                           'pelanggan', 'penjualan', 'pembayaran'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff_select" on public.%I', t);
    execute format('drop policy if exists "staff_insert" on public.%I', t);
    execute format('drop policy if exists "staff_update" on public.%I', t);
    execute format('drop policy if exists "owner_delete" on public.%I', t);
    execute format('create policy "staff_select" on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy "staff_insert" on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy "staff_update" on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using (public.is_owner())', t);
  end loop;
end $$;

-- 3.2 DATA KEUANGAN & ASAL MOTOR: HANYA owner (admin tidak bisa baca/tulis sama sekali)
--     (pembelian, reparasi, reparasi_biaya, pengeluaran_operasional, sumber_motor)
do $$
declare t text;
begin
  foreach t in array array['pembelian', 'reparasi', 'reparasi_biaya', 'pengeluaran_operasional', 'sumber_motor'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff_select" on public.%I', t);
    execute format('drop policy if exists "staff_insert" on public.%I', t);
    execute format('drop policy if exists "staff_update" on public.%I', t);
    execute format('drop policy if exists "owner_select" on public.%I', t);
    execute format('drop policy if exists "owner_insert" on public.%I', t);
    execute format('drop policy if exists "owner_update" on public.%I', t);
    execute format('drop policy if exists "owner_delete" on public.%I', t);
    execute format('create policy "owner_select" on public.%I for select to authenticated using (public.is_owner())', t);
    execute format('create policy "owner_insert" on public.%I for insert to authenticated with check (public.is_owner())', t);
    execute format('create policy "owner_update" on public.%I for update to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using (public.is_owner())', t);
  end loop;
end $$;

-- 3.3 profiles
alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());
-- Role & status aktif TIDAK bisa diubah langsung dari aplikasi (hanya lewat Edge Function kelola-user).
revoke insert, update, delete on public.profiles from authenticated;
grant update (nama) on public.profiles to authenticated;

-- 3.4 pengaturan: staff boleh baca, owner boleh ubah
alter table public.pengaturan enable row level security;
drop policy if exists "pengaturan_select" on public.pengaturan;
drop policy if exists "pengaturan_owner_write" on public.pengaturan;
create policy "pengaturan_select" on public.pengaturan for select to authenticated using (public.is_staff());
create policy "pengaturan_owner_write" on public.pengaturan for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 3.5 template pemeriksaan: staff baca, owner kelola
alter table public.pemeriksaan_template enable row level security;
drop policy if exists "template_select" on public.pemeriksaan_template;
drop policy if exists "template_owner_write" on public.pemeriksaan_template;
create policy "template_select" on public.pemeriksaan_template for select to authenticated using (public.is_staff());
create policy "template_owner_write" on public.pemeriksaan_template for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 3.6 dokumen_transaksi: staff baca; pembuatan lewat Edge Function (service role); owner boleh hapus
alter table public.dokumen_transaksi enable row level security;
drop policy if exists "dokumen_select" on public.dokumen_transaksi;
drop policy if exists "dokumen_owner_delete" on public.dokumen_transaksi;
create policy "dokumen_select" on public.dokumen_transaksi for select to authenticated using (public.is_staff());
create policy "dokumen_owner_delete" on public.dokumen_transaksi for delete to authenticated using (public.is_owner());
revoke insert, update on public.dokumen_transaksi from authenticated;

-- 3.7 activity_log: hanya owner yang membaca; tidak ada yang bisa menulis dari aplikasi
alter table public.activity_log enable row level security;
drop policy if exists "log_owner_select" on public.activity_log;
create policy "log_owner_select" on public.activity_log for select to authenticated using (public.is_owner());
revoke insert, update, delete on public.activity_log from authenticated;

-- 3.8 nomor_dokumen_seq: tanpa policy = tidak bisa diakses langsung (hanya lewat fungsi)
alter table public.nomor_dokumen_seq enable row level security;


-- ============================================================
-- 4. VIEW
--    • "security_invoker" : hak akses & RLS pemanggil tetap berlaku.
--    • tanpa security_invoker (v_*_ringkas, v_motor_riwayat): sengaja
--      berjalan dengan hak pemilik tabel supaya admin bisa melihat
--      DAFTAR data tanpa kolom nominal. Kolom nominal tidak disertakan.
-- ============================================================
drop view if exists public.v_dashboard_keuangan;
drop view if exists public.v_motor_keuangan;
drop view if exists public.v_dashboard_status;
drop view if exists public.v_peringatan;
drop view if exists public.v_motor_ringkas;
drop view if exists public.v_reparasi_biaya_ringkas;
drop view if exists public.v_pembelian_ringkas;
drop view if exists public.v_pengeluaran_ringkas;
drop view if exists public.v_motor_riwayat;

-- 4.1 Motor + ringkasan (tanpa kolom keuangan selain harga jual)
create view public.v_motor_ringkas with (security_invoker = true) as
select m.*,
       case when m.status = 'Terjual' then null else (public.hari_ini() - m.tanggal_masuk) end as hari_tersimpan,
       (select f.path from public.motor_foto f where f.motor_id = m.id and f.urutan = 1) as foto_utama_path,
       (select count(*) from public.motor_foto f where f.motor_id = m.id)::int as jumlah_foto,
       exists (select 1 from public.motor_dokumen d where d.motor_id = m.id and d.jenis = 'BPKB' and d.tersedia) as bpkb_ada,
       exists (select 1 from public.motor_dokumen d where d.motor_id = m.id and d.jenis = 'STNK' and d.tersedia) as stnk_ada,
       exists (select 1 from public.motor_dokumen d where d.motor_id = m.id and d.jenis = 'Faktur' and d.tersedia) as faktur_ada,
       (select count(*) from public.reparasi r where r.motor_id = m.id)::int as pekerjaan_total,
       (select count(*) from public.reparasi r where r.motor_id = m.id and r.status = 'Selesai')::int as pekerjaan_selesai
from public.motor m;

-- 4.2 Keuangan per motor — HANYA owner (admin mendapat 0 baris)
create view public.v_motor_keuangan with (security_invoker = true) as
with biaya as (
  select r.motor_id, sum(b.subtotal)::bigint as total
    from public.reparasi r join public.reparasi_biaya b on b.reparasi_id = r.id
   group by r.motor_id
), d as (
  select m.id as motor_id, m.kode_unit, m.merk, m.tipe, m.tahun, m.nopol, m.status, m.harga_jual,
         coalesce(p.harga_beli, 0) as harga_beli,
         coalesce(p.biaya_transport, 0) as biaya_transport,
         coalesce(p.biaya_administrasi, 0) as biaya_administrasi,
         coalesce(p.biaya_lain, 0) as biaya_lain,
         coalesce(p.harga_beli, 0) + coalesce(p.biaya_transport, 0)
           + coalesce(p.biaya_administrasi, 0) + coalesce(p.biaya_lain, 0) as total_pembelian,
         coalesce(bi.total, 0) as biaya_restorasi,
         s.id as penjualan_id, s.tanggal_jual, s.harga_akhir, s.status as status_penjualan
    from public.motor m
    left join public.pembelian p on p.motor_id = m.id
    left join biaya bi on bi.motor_id = m.id
    left join public.penjualan s on s.motor_id = m.id and s.status <> 'Batal'
)
select d.*,
       d.total_pembelian + d.biaya_restorasi as total_modal,
       case when d.harga_jual is not null then d.harga_jual - (d.total_pembelian + d.biaya_restorasi) end as estimasi_untung,
       -- keuntungan AKTUAL hanya untuk penjualan yang sudah terjadi (Lunas / Proses Leasing);
       -- penjualan yang masih Booking belum dihitung sebagai terjual.
       case when d.status_penjualan in ('Lunas', 'Proses Leasing')
            then d.harga_akhir - (d.total_pembelian + d.biaya_restorasi) end as untung_aktual
from d
where public.is_owner();

-- 4.3 Dashboard
create view public.v_dashboard_status with (security_invoker = true) as
select count(*) filter (where status <> 'Terjual')::int    as aktif,
       count(*) filter (where status = 'Masuk')::int       as masuk,
       count(*) filter (where status = 'Pemeriksaan')::int as pemeriksaan,
       count(*) filter (where status = 'Restorasi')::int   as restorasi,
       count(*) filter (where status = 'Ready')::int       as ready,
       count(*) filter (where status = 'Booking')::int     as booking,
       count(*) filter (where status = 'Terjual')::int     as terjual,
       (select count(*) from public.penjualan s
         where s.status in ('Lunas', 'Proses Leasing')
           and date_trunc('month', s.tanggal_jual) = date_trunc('month', public.hari_ini()))::int as terjual_bulan_ini
from public.motor;

create view public.v_dashboard_keuangan with (security_invoker = true) as
select * from (
  select coalesce(sum(k.total_modal) filter (where k.status <> 'Terjual'), 0)::bigint      as modal_aktif,
         coalesce(sum(k.estimasi_untung) filter (where k.status <> 'Terjual'), 0)::bigint  as estimasi_untung,
         coalesce(sum(k.untung_aktual) filter (
           where k.tanggal_jual >= date_trunc('month', public.hari_ini())), 0)::bigint     as untung_aktual_bulan_ini,
         coalesce((select sum(s.harga_akhir) from public.penjualan s
           where s.status in ('Lunas', 'Proses Leasing')
             and date_trunc('month', s.tanggal_jual) = date_trunc('month', public.hari_ini())), 0)::bigint as omzet_bulan_ini,
         coalesce((select sum(s.harga_akhir) from public.penjualan s
           where s.status in ('Lunas', 'Proses Leasing')
             and date_trunc('month', s.tanggal_jual) = date_trunc('month', public.hari_ini()) - interval '1 month'), 0)::bigint as omzet_bulan_lalu
    from public.v_motor_keuangan k
) x
where public.is_owner();   -- admin: 0 baris (tidak ada angka omzet/modal yang bocor)

-- 4.4 Peringatan (notifikasi internal) — dihitung saat halaman dibuka
create view public.v_peringatan with (security_invoker = true) as
with cfg as (
  select coalesce((select nullif(value, '')::int from public.pengaturan where key = 'batas_hari_simpan'), 30) as batas
)
select 'lama_simpan'::text as jenis, m.id as motor_id, (m.merk || ' ' || m.tipe) as motor_label,
       (m.merk || ' ' || m.tipe || ' sudah tersimpan ' || (public.hari_ini() - m.tanggal_masuk) || ' hari.') as pesan,
       (public.hari_ini() - m.tanggal_masuk)::int as nilai
  from public.motor m, cfg
 where m.status <> 'Terjual' and (public.hari_ini() - m.tanggal_masuk) > cfg.batas
union all
select 'dokumen', m.id, (m.merk || ' ' || m.tipe),
       (d.jenis || ' ' || m.merk || ' ' || m.tipe || ' belum tersedia.'), 0
  from public.motor m
 cross join (values ('BPKB'), ('STNK')) as d(jenis)
 where m.status <> 'Terjual'
   and not exists (select 1 from public.motor_dokumen x
                    where x.motor_id = m.id and x.jenis = d.jenis and x.tersedia)
union all
select 'restorasi', m.id, (m.merk || ' ' || m.tipe),
       ('Restorasi ' || m.merk || ' ' || m.tipe || ' masih memiliki ' || r.n || ' pekerjaan yang belum selesai.'), r.n::int
  from public.motor m
  join (select motor_id, count(*) as n from public.reparasi where status <> 'Selesai' group by motor_id) r
    on r.motor_id = m.id
 where m.status <> 'Terjual';

-- 4.5 View ringkas (tanpa nominal). Admin TIDAK lagi punya akses ke data ini,
--     sehingga view hanya mengembalikan baris untuk owner (admin = 0 baris).
create view public.v_reparasi_biaya_ringkas as
select id, reparasi_id, jenis, nama, qty, catatan, created_at
  from public.reparasi_biaya
 where public.is_owner();

create view public.v_pembelian_ringkas as
select id, motor_id, sumber_id, tanggal_beli, metode_pembayaran, (bukti_path is not null) as ada_bukti, created_at
  from public.pembelian
 where public.is_owner();

create view public.v_pengeluaran_ringkas as
select id, tanggal, kategori, deskripsi, (bukti_path is not null) as ada_bukti, created_at
  from public.pengeluaran_operasional
 where public.is_owner();

-- 4.6 Riwayat status motor (untuk tab "Riwayat" — tanpa data keuangan)
create view public.v_motor_riwayat as
select l.id, (case when l.tabel = 'motor' then l.record_id::uuid end) as motor_id, l.waktu, p.nama as oleh, l.aksi,
       l.data_lama->>'status' as dari, l.data_baru->>'status' as ke
  from public.activity_log l
  left join public.profiles p on p.id = l.user_id
 where l.tabel = 'motor'
   and (l.aksi = 'INSERT' or l.data_baru ? 'status')
   and public.is_staff();


-- ============================================================
-- 5. FUNGSI RPC
-- ============================================================

-- 5.1 Identitas usaha untuk halaman publik (nama, alamat, WhatsApp)
--     Juga memuat logo & slide banner (disimpan di tabel pengaturan oleh owner).
create or replace function public.json_aman(p text)
returns jsonb language plpgsql immutable as $$
begin
  return coalesce(nullif(p, '')::jsonb, '[]'::jsonb);
exception when others then
  return '[]'::jsonb;   -- JSON rusak tidak boleh merusak halaman publik
end $$;

create or replace function public.rpc_publik_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nama_usaha',   coalesce((select value from public.pengaturan where key = 'nama_usaha'), 'Showroom Motor'),
    'alamat_usaha', coalesce((select value from public.pengaturan where key = 'alamat_usaha'), ''),
    'wa_sorum',     coalesce((select value from public.pengaturan where key = 'wa_sorum'), ''),
    'logo',         coalesce((select value from public.pengaturan where key = 'logo_path'), ''),
    'banner',       public.json_aman((select value from public.pengaturan where key = 'banner_slides')),
    'sosmed',       coalesce((select jsonb_object_agg(replace(key, 'sosmed_', ''), value)
                                from public.pengaturan
                               where key like 'sosmed\_%' and coalesce(trim(value), '') <> ''), '{}'::jsonb)
  )
$$;

-- 5.2 Katalog publik: HANYA motor Ready & tampil_katalog, HANYA kolom publik.
--     Tidak menyertakan nopol, no. rangka, no. mesin, foto berkas, modal, penjual.
create or replace function public.rpc_katalog_publik()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'usaha', public.rpc_publik_config(),
    'motor', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', m.public_slug, 'merk', m.merk, 'tipe', m.tipe, 'tahun', m.tahun,
               'warna', m.warna, 'kilometer', m.kilometer, 'harga', m.harga_jual,
               'kelengkapan_surat', m.kelengkapan_surat,
               'foto', (select f.path from public.motor_foto f where f.motor_id = m.id and f.urutan = 1),
               'fotos', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'v', extract(epoch from f.updated_at)::bigint) order by f.urutan)
                                    from public.motor_foto f where f.motor_id = m.id and f.urutan <= 4), '[]'::jsonb),
               'terverifikasi', m.terverifikasi
             ) order by m.tanggal_masuk desc, m.created_at desc)
        from public.motor m
       where m.status = 'Ready' and m.tampil_katalog
    ), '[]'::jsonb)
  )
$$;

-- 5.3 Detail satu motor publik berdasarkan slug acak.
--     Jika bukan Ready / disembunyikan / tidak ada → {"tersedia": false}.
create or replace function public.rpc_motor_publik(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m public.motor%rowtype;
  v_usaha jsonb := public.rpc_publik_config();
begin
  select * into m from public.motor where public_slug = p_slug and tampil_katalog and status = 'Ready';
  if not found then
    return jsonb_build_object('tersedia', false, 'usaha', v_usaha);
  end if;
  return jsonb_build_object(
    'tersedia', true,
    'usaha', v_usaha,
    'motor', jsonb_build_object(
      'slug', m.public_slug, 'merk', m.merk, 'tipe', m.tipe, 'tahun', m.tahun, 'warna', m.warna,
      'kilometer', m.kilometer, 'harga', m.harga_jual, 'kelengkapan_surat', m.kelengkapan_surat,
      'deskripsi', m.deskripsi_publik, 'terverifikasi', m.terverifikasi
    ),
    'foto', coalesce((
      select jsonb_agg(jsonb_build_object('urutan', f.urutan, 'path', f.path, 'v', extract(epoch from f.updated_at)::bigint) order by f.urutan)
        from public.motor_foto f where f.motor_id = m.id and f.urutan <= 4
    ), '[]'::jsonb)
  );
end;
$$;

-- 5.4 Catat login ke log aktivitas
create or replace function public.rpc_catat_login()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() then
    insert into public.activity_log (user_id, aksi, tabel, ringkasan)
    values (auth.uid(), 'LOGIN', 'auth', 'Masuk ke aplikasi');
  end if;
end;
$$;

-- 5.5 Nomor dokumen berurutan — hanya dipanggil Edge Function (service role)
create or replace function public.rpc_nomor_dokumen(p_jenis text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tahun int := extract(year from public.hari_ini())::int;
  v_no int;
  v_prefix text;
begin
  v_prefix := case p_jenis when 'Kuitansi' then 'KWT' when 'Surat Jual-Beli' then 'SJB' end;
  if v_prefix is null then
    raise exception 'Jenis dokumen tidak dikenal: %', p_jenis;
  end if;
  insert into public.nomor_dokumen_seq (jenis, tahun, terakhir) values (p_jenis, v_tahun, 1)
  on conflict (jenis, tahun) do update set terakhir = public.nomor_dokumen_seq.terakhir + 1
  returning terakhir into v_no;
  return v_prefix || '/' || public.kode_prefix() || '/' || v_tahun || '/' || lpad(v_no::text, 4, '0');
end;
$$;


-- ============================================================
-- 6. HAK AKSES (GRANT / REVOKE)
-- ============================================================

-- Anon: tanpa akses langsung ke tabel/view/sequence — hanya RPC katalog.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Authenticated: hanya boleh menjalankan fungsi yang memang dibutuhkan.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('hari_ini', 'current_user_role', 'is_owner', 'is_staff',
                     'rpc_publik_config', 'rpc_katalog_publik', 'rpc_motor_publik', 'rpc_catat_login', 'kode_prefix') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if r.proname in ('hari_ini', 'rpc_publik_config', 'rpc_katalog_publik', 'rpc_motor_publik') then
      execute format('grant execute on function %s to anon', r.sig);
    end if;
    if r.proname = 'rpc_nomor_dokumen' then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;


-- ============================================================
-- 7. STORAGE (bucket & policy)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('motor-foto-publik', 'motor-foto-publik', true,  5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('motor-privat',      'motor-privat',      false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('dokumen-pdf',       'dokumen-pdf',       false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Foto 1–4 (publik: bisa dilihat siapa saja lewat URL, tulis hanya staff)
drop policy if exists "app_foto_publik_insert" on storage.objects;
drop policy if exists "app_foto_publik_update" on storage.objects;
drop policy if exists "app_foto_publik_delete" on storage.objects;
create policy "app_foto_publik_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'motor-foto-publik' and public.is_staff());
create policy "app_foto_publik_update" on storage.objects for update to authenticated
  using (bucket_id = 'motor-foto-publik' and public.is_staff())
  with check (bucket_id = 'motor-foto-publik' and public.is_staff());
create policy "app_foto_publik_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'motor-foto-publik' and public.is_owner());

-- Foto 1–4: staff juga perlu "select" agar unggahan (INSERT ... RETURNING) berhasil.
--           (Pengunjung publik membaca lewat URL publik, tidak lewat policy ini.)
drop policy if exists "app_foto_publik_select" on storage.objects;
create policy "app_foto_publik_select" on storage.objects for select to authenticated
  using (bucket_id = 'motor-foto-publik' and public.is_staff());

-- Dokumen pribadi, foto berkas, bukti transaksi (privat, via signed URL).
-- Struktur folder (folder pertama = jenis berkas):
--   foto-berkas/  dok/  bayar/   → boleh dibaca owner & admin
--   beli/  keluar/               → bukti pembelian & pengeluaran = DATA KEUANGAN:
--                                  hanya owner (baca, unggah, ubah)
drop policy if exists "app_privat_select" on storage.objects;
drop policy if exists "app_privat_insert" on storage.objects;
drop policy if exists "app_privat_update" on storage.objects;
drop policy if exists "app_privat_delete" on storage.objects;
create policy "app_privat_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'motor-privat' and (
      public.is_owner()
      or (public.is_staff() and (storage.foldername(name))[1] in ('foto-berkas', 'dok', 'bayar'))
      or (public.is_staff() and owner_id = auth.uid()::text)
    )
  );
create policy "app_privat_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'motor-privat' and (
      public.is_owner()
      or (public.is_staff() and (storage.foldername(name))[1] in ('foto-berkas', 'dok', 'bayar'))
    )
  );
create policy "app_privat_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'motor-privat' and (
      public.is_owner()
      or (public.is_staff() and (storage.foldername(name))[1] in ('foto-berkas', 'dok', 'bayar'))
    )
  )
  with check (
    bucket_id = 'motor-privat' and (
      public.is_owner()
      or (public.is_staff() and (storage.foldername(name))[1] in ('foto-berkas', 'dok', 'bayar'))
    )
  );
create policy "app_privat_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'motor-privat' and public.is_owner());

-- PDF kuitansi & surat jual-beli (ditulis Edge Function dengan service role)
drop policy if exists "app_pdf_select" on storage.objects;
drop policy if exists "app_pdf_delete" on storage.objects;
create policy "app_pdf_select" on storage.objects for select to authenticated
  using (bucket_id = 'dokumen-pdf' and public.is_staff());
create policy "app_pdf_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'dokumen-pdf' and public.is_owner());


-- ============================================================
-- 8. DATA AWAL (pengaturan & template checklist)
-- ============================================================
insert into public.pengaturan (key, value) values
  ('nama_usaha',        'Showroom Motor'),
  ('kode_prefix',       'MTR'),
  ('alamat_usaha',      ''),
  ('wa_sorum',          ''),
  ('batas_hari_simpan', '30')
on conflict (key) do nothing;

insert into public.pemeriksaan_template (kategori, butir, urutan) values
  ('Mesin',      'Suara mesin & klep',              1),
  ('Mesin',      'Tarikan & akselerasi',            2),
  ('Mesin',      'Rembesan / kebocoran oli',        3),
  ('Mesin',      'CVT / kopling & transmisi',       4),
  ('Mesin',      'Oli mesin & oli gardan',          5),
  ('Mesin',      'Knalpot & asap',                  6),
  ('Kelistrikan','Starter & aki',                   1),
  ('Kelistrikan','Lampu depan, belakang & sein',    2),
  ('Kelistrikan','Speedometer & indikator',         3),
  ('Kelistrikan','Klakson & saklar',                4),
  ('Rangka',     'Rangka & nomor rangka',           1),
  ('Rangka',     'Shockbreaker depan',              2),
  ('Rangka',     'Shockbreaker belakang',           3),
  ('Rangka',     'Rem depan & belakang',            4),
  ('Rangka',     'Ban & velg',                      5),
  ('Body',       'Cat & body',                      1),
  ('Body',       'Jok',                             2),
  ('Body',       'Spion & aksesoris',               3),
  ('Dokumen',    'BPKB',                            1),
  ('Dokumen',    'STNK & pajak',                    2),
  ('Dokumen',    'Faktur',                          3),
  ('Dokumen',    'Cek fisik nomor rangka & mesin',  4)
on conflict (kategori, butir) do nothing;

-- ============================================================
-- SELESAI. Langkah berikutnya: lihat PANDUAN-INSTALASI.md
-- (data contoh opsional ada di seed-contoh.sql)
-- ============================================================
