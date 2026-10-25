// ============================================================
// Vercel Function — tautan bagikan  /motor/<slug>
// Mengembalikan HTML kecil berisi tag Open Graph (judul, harga, foto) agar
// pratinjau di WhatsApp/Facebook menampilkan foto & harga, lalu mengarahkan
// pengunjung ke aplikasi:  /#/motor/<slug>
// Environment Variables (Vercel → Settings): SUPABASE_URL, SUPABASE_ANON_KEY
// ============================================================
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const base = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const tujuan = `${base}/#/motor/${slug}`;
  let judul = 'Showroom Motor', deskripsi = 'Katalog motor bekas siap jual.', gambar = '';
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
    if (slug && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_motor_publik`, {
        method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_slug: slug })
      });
      const d = await r.json();
      const usaha = (d && d.usaha && d.usaha.nama_usaha) || judul;
      if (d && d.tersedia) {
        const m = d.motor;
        judul = `${m.merk} ${m.tipe} ${m.tahun}${m.harga ? ' — ' + rp(m.harga) : ''} | ${usaha}`;
        deskripsi = [m.warna, m.kilometer != null ? Number(m.kilometer).toLocaleString('id-ID') + ' km' : '', m.kelengkapan_surat].filter(Boolean).join(' · ') || deskripsi;
        const f = (d.foto || [])[0];
        if (f) gambar = `${SUPABASE_URL}/storage/v1/object/public/motor-foto-publik/${f.path.split('/').map(encodeURIComponent).join('/')}?v=${f.v}`;
      } else judul = `Motor tidak tersedia | ${usaha}`;
    }
  } catch (e) { /* tetap tampilkan halaman dasar */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>${esc(judul)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(judul)}"><meta property="og:description" content="${esc(deskripsi)}"><meta property="og:url" content="${esc(`${base}/motor/${slug}`)}">
${gambar ? `<meta property="og:image" content="${esc(gambar)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(gambar)}">` : ''}
<meta http-equiv="refresh" content="0;url=${esc(tujuan)}"><link rel="canonical" href="${esc(tujuan)}"></head>
<body><p>Membuka halaman… <a href="${esc(tujuan)}">Klik di sini</a> bila tidak berpindah otomatis.</p><script>location.replace(${JSON.stringify(tujuan)});</script></body></html>`);
};
