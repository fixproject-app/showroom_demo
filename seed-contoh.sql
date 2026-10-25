-- ============================================================
-- Showroom Motor — DATA CONTOH (opsional)
-- Jalankan SETELAH schema.sql, hanya untuk mencoba aplikasi.
-- Semua data contoh memakai kode unit DEMO-xxx / nama "(Demo)"
-- sehingga mudah dibersihkan (lihat bagian paling bawah).
-- ============================================================

do $$
declare
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid;
  s1 uuid; p1 uuid; p2 uuid; j1 uuid; j2 uuid; r1 uuid; r2 uuid;
begin
  if exists (select 1 from public.motor where kode_unit like 'DEMO-%') then
    raise notice 'Data contoh sudah ada, dilewati.'; return;
  end if;

  insert into public.sumber_motor (nama, hp, alamat) values ('Pak Hadi (Demo)', '081200000001', 'Tegal') returning id into s1;

  insert into public.motor (kode_unit, merk, tipe, tahun, warna, nopol, no_rangka, kilometer, status, tanggal_masuk, sumber_id, harga_jual, kelengkapan_surat, deskripsi_publik, tampil_katalog)
  values ('DEMO-001','Honda','Beat Street',2021,'Hitam','B 1001 DMO','MH1DEMO0000000001',18500,'Ready', public.hari_ini()-12, s1, 16500000,'BPKB + STNK + Faktur','Terawat, mesin halus, pajak hidup.', true) returning id into m1;
  insert into public.motor (kode_unit, merk, tipe, tahun, warna, nopol, no_rangka, kilometer, status, tanggal_masuk, sumber_id, harga_jual, kelengkapan_surat, deskripsi_publik, tampil_katalog)
  values ('DEMO-002','Yamaha','NMAX',2020,'Abu-abu','B 1002 DMO','MH3DEMO0000000002',27000,'Ready', public.hari_ini()-40, s1, 24500000,'BPKB + STNK','Siap pakai, servis rutin.', true) returning id into m2;
  insert into public.motor (kode_unit, merk, tipe, tahun, warna, nopol, kilometer, status, tanggal_masuk, sumber_id, harga_jual)
  values ('DEMO-003','Honda','Vario 125',2019,'Merah','B 1003 DMO',41000,'Restorasi', public.hari_ini()-6, s1, 14000000) returning id into m3;
  insert into public.motor (kode_unit, merk, tipe, tahun, warna, nopol, kilometer, status, tanggal_masuk)
  values ('DEMO-004','Suzuki','Satria FU',2017,'Biru','B 1004 DMO',60000,'Pemeriksaan', public.hari_ini()-2) returning id into m4;
  insert into public.motor (kode_unit, merk, tipe, tahun, warna, nopol, kilometer, status, tanggal_masuk, harga_jual, tampil_katalog)
  values ('DEMO-005','Yamaha','Mio M3',2018,'Putih','B 1005 DMO',33000,'Ready', public.hari_ini()-20, 12000000, false) returning id into m5;

  insert into public.pembelian (motor_id, sumber_id, harga_beli, biaya_transport, biaya_administrasi, metode_pembayaran) values
    (m1, s1, 13000000, 100000, 150000, 'Tunai'),
    (m2, s1, 20000000, 150000, 200000, 'Transfer'),
    (m3, s1, 10000000, 100000, 100000, 'Tunai'),
    (m4, s1,  8000000,  50000, 100000, 'Tunai'),
    (m5, s1,  9500000,  50000, 100000, 'Tunai');

  insert into public.reparasi (motor_id, nama_pekerjaan, mekanik, status, tanggal_mulai) values
    (m3, 'Servis mesin & CVT', 'Pak Joko', 'Dikerjakan', public.hari_ini()-4) returning id into r1;
  insert into public.reparasi (motor_id, nama_pekerjaan, mekanik, status) values
    (m3, 'Cat ulang body', 'Mas Dedi', 'Belum') returning id into r2;
  insert into public.reparasi_biaya (reparasi_id, jenis, nama, qty, harga_satuan) values
    (r1,'Sparepart','Kampas ganda + roller',1,180000),
    (r1,'Sparepart','Oli mesin',1,60000),
    (r1,'Jasa','Jasa servis',1,150000),
    (r2,'Jasa','Cat body',1,450000);

  insert into public.motor_dokumen (motor_id, jenis, tersedia) values
    (m1,'BPKB',true),(m1,'STNK',true),(m1,'Faktur',true),
    (m2,'BPKB',true),(m2,'STNK',true),
    (m3,'STNK',true);

  insert into public.pelanggan (nama, hp, alamat) values ('Budi Santoso (Demo)','081300000001','Jakarta') returning id into p1;
  insert into public.pelanggan (nama, hp, alamat) values ('Siti Aminah (Demo)','081300000002','Bekasi') returning id into p2;

  -- Penjualan tunai yang masih Booking (DP saja) → motor jadi "Booking"
  insert into public.penjualan (motor_id, pelanggan_id, harga_jual, skema) values (m5, p1, 12000000, 'Tunai') returning id into j1;
  insert into public.pembayaran (penjualan_id, jenis, jumlah, metode) values (j1, 'DP', 2000000, 'Tunai');

  -- Penjualan tunai lunas bulan ini → motor jadi "Terjual"
  insert into public.penjualan (motor_id, pelanggan_id, harga_jual, skema) values (m2, p2, 24500000, 'Tunai') returning id into j2;
  insert into public.pembayaran (penjualan_id, jenis, jumlah, metode) values (j2, 'Pelunasan', 24500000, 'Transfer');

  insert into public.pengeluaran_operasional (kategori, deskripsi, jumlah) values
    ('Listrik','Listrik showroom (Demo)', 450000),
    ('Iklan','Boost iklan marketplace (Demo)', 300000);
end $$;

-- ------------------------------------------------------------
-- BERSIHKAN DATA CONTOH (jalankan bila sudah tidak dibutuhkan):
--   delete from public.penjualan where motor_id in (select id from public.motor where kode_unit like 'DEMO-%');
--   delete from public.motor where kode_unit like 'DEMO-%';
--   delete from public.pelanggan where nama like '%(Demo)';
--   delete from public.sumber_motor where nama like '%(Demo)';
--   delete from public.pengeluaran_operasional where deskripsi like '%(Demo)';
-- Catatan: penghapusan hanya bisa dilakukan owner / SQL Editor.
-- ------------------------------------------------------------
