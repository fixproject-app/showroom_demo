// ============================================================
// Showroom Motor — Konfigurasi
// Isi nilai di bawah ini sesuai project Supabase Anda
// (Dashboard Supabase → Project Settings → API).
// "anon public key" AMAN berada di frontend karena data dilindungi RLS.
// JANGAN PERNAH menaruh service_role key di file ini.
// ============================================================
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ymfhivsthnlucgbgwscx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_-rAi2ur3lfy3a9sJpHhLRw_r1PSpVwB',

  // Alamat situs setelah di-deploy (tanpa garis miring di akhir), dipakai untuk tautan bagikan.
  SITE_URL: 'showroomdemo-one.vercel.app',

  // true  → tautan bagikan berbentuk  https://domain/motor/<slug>   (pratinjau WhatsApp ada foto & harga;
  //         butuh api/motor.js + vercel.json dari paket ini → hosting Vercel)
  // false → tautan berbentuk           https://domain/#/motor/<slug> (jalan di hosting statis mana pun)
  SHARE_PRETTY_LINK: true
};
