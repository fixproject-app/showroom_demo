/* ============================================================
   Showroom Motor — app.js
   SPA statis: supabase-js (anon key) + RLS. Tanpa build step.
   Bagian: 1 Inti · 2 Publik & Login · 3 Dashboard & Motor ·
           4 Transaksi · 5 Pelanggan/Pengeluaran/Dokumen/Laporan ·
           6 Admin & Pengaturan · 7 Router
   ============================================================ */
'use strict';

// ───────────────────────── 1. INTI ─────────────────────────
const CFG = window.APP_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const S = {
  session: null, profile: null, usaha: null,
  tema: 'auto', cache: {}, motorFilter: { q: '', status: 'Semua' }
};
const isOwner = () => S.profile && S.profile.role === 'owner';
// Admin hanya mengelola unit motor (data & foto) dan penjualan; pemilik mengakses semuanya.
const rumah = () => (isOwner() ? '#/dashboard' : '#/motor');
const HAL_ADMIN = ['motor', 'unit', 'transaksi', 'jual', 'penjualan', 'pengaturan'];

// Pemilihan elemen & escape HTML (WAJIB untuk semua data dari database)
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rp = (n) => (n == null || n === '') ? '—' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');
const angka = (n) => (n == null ? '—' : Number(n).toLocaleString('id-ID'));
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function tgl(d) {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return `${dd} ${BULAN[m - 1].slice(0, 3)} ${y}`;
}
function tglWaktu(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
}
const hariIni = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD (WIB)
const awalBulan = (d) => (d || hariIni()).slice(0, 7) + '-01';

// Ikon Material Symbols
const ic = (n, cls) => `<span class="ms ${cls || ''}" aria-hidden="true">${n}</span>`;
const badge = (s) => `<span class="badge ${esc(String(s).replace(/ /g, '-'))}">${esc(s)}</span>`;

// Terjemahan pesan error Postgres → bahasa pengguna
function pesanError(e) {
  const m = (e && (e.message || e.msg)) || String(e || 'Terjadi kesalahan.');
  if (/uq_motor_nopol_aktif/.test(m)) return 'Nomor polisi ini sudah dipakai unit lain yang masih aktif.';
  if (/uq_motor_rangka_aktif/.test(m)) return 'Nomor rangka ini sudah dipakai unit lain yang masih aktif.';
  if (/uq_penjualan_motor_aktif/.test(m)) return 'Motor ini sudah memiliki penjualan aktif.';
  if (/duplicate key/.test(m)) return 'Data yang sama sudah ada.';
  if (/row-level security|permission denied/i.test(m)) return 'Anda tidak memiliki izin untuk tindakan ini.';
  if (/Invalid login credentials/i.test(m)) return 'Email atau kata sandi salah.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
  if (/violates check constraint/.test(m)) return 'Ada isian yang nilainya tidak valid.';
  if (/violates foreign key/.test(m)) return 'Data ini masih dipakai data lain sehingga tidak bisa diubah/dihapus.';
  if (/JWT expired/i.test(m)) return 'Sesi berakhir. Silakan masuk kembali.';
  return m; // pesan dari trigger bisnis sudah berbahasa Indonesia
}

// Toast
function toast(msg, tipe) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + (tipe || '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), tipe === 'err' ? 5000 : 3000);
}
const ok = (m) => toast(m, 'ok');
const gagal = (e) => { console.error(e); toast(pesanError(e), 'err'); };

// Pembungkus pemanggilan: mengembalikan data, atau null bila error (sudah ditoast)
async function q(promise, opsi) {
  try {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  } catch (e) {
    if (!opsi || !opsi.senyap) gagal(e);
    return null;
  }
}

// Untuk operasi tulis tanpa data balik (insert/update tanpa .select): true bila sukses
async function tulis(promise, pesanOk) {
  try { const { error } = await promise; if (error) throw error; if (pesanOk) ok(pesanOk); return true; }
  catch (e) { gagal(e); return false; }
}

// Kunci tombol saat menyimpan (mencegah klik ganda)
async function sibuk(btn, fn) {
  if (btn) btn.disabled = true;
  document.body.classList.add('busy');
  try { return await fn(); } finally { document.body.classList.remove('busy'); if (btn) btn.disabled = false; }
}

// ── Bottom sheet / modal ──
function sheet(judul, isi, opsi) {
  opsi = opsi || {};
  const root = $('#sheet-root');
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet ${opsi.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(judul)}">
    <header><h2>${esc(judul)}</h2><button class="icon-btn" data-x aria-label="Tutup">${ic('close')}</button></header>
    <div class="body">${isi}</div>${opsi.footer ? `<footer>${opsi.footer}</footer>` : ''}</div>`;
  const tutup = () => { back.remove(); if (opsi.onClose) opsi.onClose(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) tutup(); });
  $('[data-x]', back).onclick = tutup;
  root.appendChild(back);
  const f = $('input:not([type=hidden]),select,textarea', back);
  if (f && !opsi.noFocus) setTimeout(() => f.focus(), 50);
  return { el: back, body: $('.body', back), close: tutup, $: (s) => $(s, back) };
}

function konfirmasi(judul, teks, labelOk, bahaya) {
  return new Promise((res) => {
    let selesai = false;
    const sh = sheet(judul, `<p>${esc(teks)}</p>`, {
      noFocus: true,
      footer: `<button class="btn ghost" data-no>Batal</button><button class="btn ${bahaya ? 'danger' : ''}" data-ya>${esc(labelOk || 'Ya, lanjut')}</button>`,
      onClose: () => { if (!selesai) { selesai = true; res(false); } }
    });
    $('[data-no]', sh.el).onclick = () => sh.close();
    $('[data-ya]', sh.el).onclick = () => { selesai = true; sh.el.remove(); res(true); };
  });
}

// Form generik di dalam sheet: fields = [{k,label,type,req,opts,val,hint,full}]
function fieldHtml(f) {
  const id = 'f_' + f.k, v = f.val == null ? '' : f.val;
  let ctl;
  if (f.type === 'select') ctl = `<select id="${id}" name="${f.k}" ${f.req ? 'required' : ''}>${f.opts.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') ctl = `<textarea id="${id}" name="${f.k}" ${f.req ? 'required' : ''} placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<label class="row" style="gap:10px"><input type="checkbox" id="${id}" name="${f.k}" ${v ? 'checked' : ''} style="width:20px;min-height:20px"> <span>${esc(f.label)}</span></label>`;
  else if (f.type === 'rupiah') ctl = `<input id="${id}" name="${f.k}" inputmode="numeric" data-rupiah value="${v === '' ? '' : angka(v)}" ${f.req ? 'required' : ''} placeholder="${esc(f.ph || '0')}">`;
  else ctl = `<input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.req ? 'required' : ''} ${f.max ? `maxlength="${f.max}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} placeholder="${esc(f.ph || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}>`;
  return `<div class="field"><label for="${id}" class="${f.req ? 'req' : ''}">${esc(f.label)}</label>${ctl}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
}
function bacaForm(root, fields) {
  const o = {};
  for (const f of fields) {
    const el = $('[name="' + f.k + '"]', root);
    if (!el) continue;
    if (f.type === 'checkbox') o[f.k] = el.checked;
    else if (f.type === 'rupiah') o[f.k] = el.value.trim() === '' ? null : Number(el.value.replace(/\D/g, ''));
    else if (f.type === 'number') o[f.k] = el.value === '' ? null : Number(el.value);
    else { const t = el.value.trim(); o[f.k] = t === '' ? null : t; }
  }
  return o;
}
// Format ribuan otomatis pada input Rupiah
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t && t.dataset && t.dataset.rupiah !== undefined) {
    const d = t.value.replace(/\D/g, '');
    t.value = d ? Number(d).toLocaleString('id-ID') : '';
  }
});

// Sheet berisi formulir; onSubmit(values, sheetObj) mengembalikan true bila sukses (sheet ditutup)
function formSheet(judul, fields, onSubmit, opsi) {
  opsi = opsi || {};
  const html = `<form class="stack" novalidate>${fields.map((f) => f.html || fieldHtml(f)).join('')}${opsi.extra || ''}</form>`;
  const sh = sheet(judul, html, { footer: `<button class="btn ghost" data-no>Batal</button><button class="btn accent" data-ya>${esc(opsi.simpan || 'Simpan')}</button>`, wide: opsi.wide });
  const form = $('form', sh.el);
  const kirim = async () => {
    const wajib = fields.filter((f) => f.req && f.type !== 'checkbox');
    for (const f of wajib) {
      const el = $('[name="' + f.k + '"]', form);
      if (el && !String(el.value).trim()) { toast(`${f.label} wajib diisi.`, 'err'); el.focus(); return; }
    }
    const nilai = bacaForm(form, fields);
    const btn = $('[data-ya]', sh.el);
    const hasil = await sibuk(btn, () => onSubmit(nilai, sh));
    if (hasil) sh.close();
  };
  $('[data-no]', sh.el).onclick = () => sh.close();
  $('[data-ya]', sh.el).onclick = kirim;
  form.addEventListener('submit', (e) => { e.preventDefault(); kirim(); });
  if (opsi.onOpen) opsi.onOpen(sh, form);
  return sh;
}

// ── Penyimpanan (Storage) ──
const urlPublik = (path, v) => path ? `${CFG.SUPABASE_URL}/storage/v1/object/public/motor-foto-publik/${path.split('/').map(encodeURIComponent).join('/')}${v ? '?v=' + v : ''}` : '';
// Favicon & ikon layar utama mengikuti logo showroom (Pengaturan → Katalog). Tanpa logo → ikon bawaan index.html.
const FAV_AWAL = (() => { const l = document.querySelector('link[rel="icon"]'); return l ? l.getAttribute('href') : ''; })();
function terapkanFavicon(u) {
  try {
    const logo = u && u.logo ? urlPublik(u.logo) : '';
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((e) => e.remove());
    const baru = document.createElement('link'); baru.rel = 'icon'; baru.href = logo || FAV_AWAL; document.head.appendChild(baru);
    if (logo) { const a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = logo; document.head.appendChild(a); }
  } catch (e) { /* favicon bukan fitur kritis */ }
}
const _signed = {};
async function urlTertanda(bucket, path) {
  const k = bucket + '/' + path, c = _signed[k];
  if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300);
  if (error) throw error;
  _signed[k] = { url: data.signedUrl, exp: Date.now() + 240000 };
  return data.signedUrl;
}
// Kompres gambar di browser (hemat kuota & storage)
function kompres(file, maks, mutu, tipe, hias) {
  maks = maks || 1600; mutu = mutu || 0.82; tipe = tipe || 'image/jpeg';
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) return res(file);
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      const r = Math.min(1, maks / Math.max(w, h));
      w = Math.round(w * r); h = Math.round(h * r);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d');
      if (tipe === 'image/jpeg') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }   // PNG transparan → latar putih, bukan hitam
      cx.drawImage(img, 0, 0, w, h);
      if (hias) { try { hias(cx, w, h); } catch (e) { console.warn('Watermark gagal digambar', e); } }
      c.toBlob((b) => { URL.revokeObjectURL(u); b ? res(b) : rej(new Error('Gagal memproses gambar.')); }, tipe, mutu);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('File gambar tidak dapat dibaca.')); };
    img.src = u;
  });
}
function pilihFile(accept) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept || 'image/*';
    i.onchange = () => res(i.files[0] || null); i.click();
  });
}
// Unggah berkas (gambar dikompres; PDF apa adanya) → mengembalikan path atau null
async function unggah(bucket, path, file, upsert, hias) {
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Ukuran file maksimal 10 MB.');
    let body = file, type = file.type;
    if (/^image\//.test(file.type)) { body = await kompres(file, bucket === 'motor-foto-publik' ? 1600 : 2000, 0.82, 'image/jpeg', hias); type = 'image/jpeg'; }
    const { error } = await sb.storage.from(bucket).upload(path, body, { contentType: type, upsert: !!upsert });
    if (error) throw error;
    return path;
  } catch (e) { gagal(e); return null; }
}
const ekst = (f) => (/pdf/.test(f.type) ? 'pdf' : 'jpg');

// Pratinjau berkas di modal (tidak pernah tab baru)
async function pratinjau(bucket, path, judul) {
  const sh = sheet(judul || 'Pratinjau', '<div class="preview"><div class="spinner"></div></div>', { wide: true, noFocus: true });
  try {
    const url = bucket === 'motor-foto-publik' ? urlPublik(path) : await urlTertanda(bucket, path);
    const pdf = /\.pdf($|\?)/i.test(path);
    $('.preview', sh.el).innerHTML = pdf ? `<iframe src="${esc(url)}" title="PDF"></iframe>` : `<img src="${esc(url)}" alt="${esc(judul || '')}">`;
    const ft = document.createElement('footer');
    ft.innerHTML = `<button class="btn ghost" data-t>Tutup</button><a class="btn accent" href="${esc(url)}" download target="_blank" rel="noopener">${ic('download', 'sm')} Unduh</a>`;
    $('.sheet', sh.el).appendChild(ft);
    $('[data-t]', ft).onclick = () => sh.close();
  } catch (e) { sh.close(); gagal(e); }
}

// ── Watermark foto katalog (ditempel permanen saat unggah; hanya foto publik slot 1–4) ──
// Pengaturan: watermark_aktif ('0' = mati; selain itu hidup), watermark_teks (kosong = nama usaha).
function muatGambar(url) {
  return new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}
async function siapkanWatermark() {
  const { data, error } = await sb.from('pengaturan').select('key,value').in('key', ['watermark_aktif', 'watermark_teks', 'nama_usaha', 'logo_path']);
  if (error || !data) return null;   // gagal baca pengaturan → unggah tanpa watermark (foto tetap tersimpan)
  const c = {}; data.forEach((r) => c[r.key] = r.value);
  if (c.watermark_aktif === '0') return null;
  const teks = (c.watermark_teks || c.nama_usaha || '').trim(), logo = c.logo_path ? await muatGambar(urlPublik(c.logo_path) + '?wm=1') : null;
  if (!teks && !logo) return null;
  return (cx, w, h) => {
    const sisi = Math.min(w, h), gap = Math.round(sisi * 0.025), fam = '"Plus Jakarta Sans", Inter, Arial, sans-serif';
    let fs = Math.max(14, Math.round(sisi * 0.055)), lw = 0, lh = 0;
    cx.save(); cx.globalAlpha = 0.5; cx.textAlign = 'center'; cx.textBaseline = 'top';
    if (teks) { cx.font = `700 ${fs}px ${fam}`; while (fs > 10 && cx.measureText(teks).width > w * 0.8) { fs--; cx.font = `700 ${fs}px ${fam}`; } }
    if (logo) { lw = Math.round(Math.min(w * 0.3, sisi * 0.34)); lh = Math.round(lw * logo.naturalHeight / logo.naturalWidth); if (lh > h * 0.3) { lh = Math.round(h * 0.3); lw = Math.round(lh * logo.naturalWidth / logo.naturalHeight); } }
    const th = teks ? fs : 0, total = lh + (logo && teks ? gap : 0) + th;
    let y = Math.round((h - total) / 2);
    cx.shadowColor = 'rgba(0,0,0,.65)'; cx.shadowBlur = Math.round(sisi * 0.02);
    if (logo) { cx.drawImage(logo, Math.round((w - lw) / 2), y, lw, lh); y += lh + gap; }
    if (teks) { cx.fillStyle = '#fff'; cx.fillText(teks, w / 2, y); }
    cx.restore();
  };
}

// (akhir watermark)

// ── Tema ──
function terapkanTema() {
  const dark = S.tema === 'dark' || (S.tema === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0B1220' : '#14284B';
}
function aturTema(t) { S.tema = t; try { localStorage.setItem('app_tema', t); } catch (e) {} terapkanTema(); }
try { S.tema = localStorage.getItem('app_tema') || 'auto'; } catch (e) {}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.tema === 'auto') terapkanTema(); });

// ── Pembantu tampilan umum ──
const kosong = (ikon, teks) => `<div class="empty">${ic(ikon)}<p>${esc(teks)}</p></div>`;
const loading = (n) => Array.from({ length: n || 3 }, () => '<div class="skeleton" style="margin-bottom:10px"></div>').join('');
const nmMotor = (m) => `${m.merk} ${m.tipe}`;
const STATUS_MOTOR = ['Masuk', 'Pemeriksaan', 'Restorasi', 'Ready', 'Booking', 'Terjual'];
const FOTO_JENIS = { 1: 'utama', 2: 'kedua', 3: 'ketiga', 4: 'keempat', 5: 'berkas' };
const waLink = (nomor, teks) => 'https://wa.me/' + String(nomor || '').replace(/\D/g, '').replace(/^0/, '62') + (teks ? '?text=' + encodeURIComponent(teks) : '');
function linkBagikan(slug) {
  const ada = CFG.SITE_URL && !/GANTI-DENGAN/.test(CFG.SITE_URL);
  const base = String(ada ? CFG.SITE_URL : location.origin).replace(/\/$/, '');
  return CFG.SHARE_PRETTY_LINK ? `${base}/motor/${slug}` : `${base}/#/motor/${slug}`;
}
// Jendela "Bagikan": tautan + Salin + WhatsApp (+ menu bagikan bawaan perangkat bila ada)
function bagikan(m) {
  const url = linkBagikan(m.public_slug || m.slug), judul = `${m.merk} ${m.tipe} ${m.tahun}`;
  const teks = `${judul} — ${(S.usaha && S.usaha.nama_usaha) || 'Showroom Motor'}\n${url}`;
  const belumTampil = m.status !== undefined && (m.status !== 'Ready' || !m.tampil_katalog);
  const sh = sheet('Bagikan motor', `<div class="stack">
    ${belumTampil ? `<div class="alert">${ic('warning')}<div>Unit ini <b>belum tampil di katalog</b> (harus berstatus Ready dan "Tampil di katalog" aktif). Penerima tautan akan melihat pesan "motor tidak tersedia".</div></div>` : ''}
    <div class="field"><label for="bg-url">Tautan</label><input id="bg-url" readonly value="${esc(url)}"></div>
    <div class="grid c2"><button class="btn" data-salin>${ic('content_copy', 'sm')} Salin tautan</button><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(teks)}">${ic('chat', 'sm')} WhatsApp</a></div>
    ${navigator.share ? `<button class="btn ghost block" data-lain>${ic('ios_share', 'sm')} Bagikan lewat aplikasi lain…</button>` : ''}</div>`, { noFocus: true });
  const inp = $('#bg-url', sh.el);
  inp.onfocus = () => inp.select();
  $('[data-salin]', sh.el).onclick = async () => {
    try { await navigator.clipboard.writeText(url); ok('Tautan disalin.'); }
    catch (e) { inp.focus(); inp.select(); try { document.execCommand('copy'); ok('Tautan disalin.'); } catch (e2) { toast('Tekan Ctrl+C untuk menyalin.', 'err'); } }
  };
  const lain = $('[data-lain]', sh.el);
  if (lain) lain.onclick = async () => { try { await navigator.share({ title: judul, text: judul, url }); } catch (e) { /* dibatalkan */ } };
}
function unduhBerkas(nama, isi, mime) {
  const b = new Blob([isi], { type: mime }), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = nama; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ───────────────────── 2. PUBLIK, LOGIN, SHELL ─────────────────────
const app = () => $('#app');

// ── Slider / carousel (dipakai hero banner, kartu motor, dan galeri detail) ──
// Markup: <div class="sl"><div class="sl-track"><div class="sl-item">…</div></div> [data-sl="-1|1"] .sl-dots .sl-count</div>
// Geser dengan sentuhan (scroll-snap native) atau tombol panah. Pendengar dipasang SATU kali per wadah (delegasi).
function pasangSlider(root) {
  root.addEventListener('scroll', (e) => {
    const t = e.target; if (!t.classList || !t.classList.contains('sl-track')) return;
    const n = t.children.length, i = Math.min(n - 1, Math.max(0, Math.round(t.scrollLeft / Math.max(1, t.clientWidth)))), s = t.closest('.sl');
    $$('.sl-dots i', s).forEach((d, k) => d.classList.toggle('on', k === i));
    const c = $('.sl-count', s); if (c) c.textContent = `${i + 1}/${n}`;
  }, true);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sl]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const t = $('.sl-track', b.closest('.sl')), n = t.children.length, w = t.clientWidth, i = Math.round(t.scrollLeft / Math.max(1, w)) + Number(b.dataset.sl);
    t.scrollTo({ left: ((i % n) + n) % n * w, behavior: 'smooth' });   // berputar: setelah foto terakhir kembali ke pertama
  });
}
const slDots = (n) => n > 1 ? `<div class="sl-dots">${Array.from({ length: n }, (_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : '';
const slPanah = (n) => n > 1 ? `<button class="sl-nav prev" data-sl="-1" aria-label="Sebelumnya">${ic('chevron_left')}</button><button class="sl-nav next" data-sl="1" aria-label="Berikutnya">${ic('chevron_right')}</button>` : '';
const lencanaVerif = () => `<span class="vbadge" title="Sudah melewati pemeriksaan kondisi">${ic('verified', 'sm')} Terverifikasi</span>`;
let _heroTimer = null;

function heroHtml(u) {
  const adaBanner = Array.isArray(u.banner) && u.banner.length;
  const sl = adaBanner ? u.banner : [{ label: 'Motor Bekas Pilihan', judul: 'Kualitas Terbaik, Harga Bersahabat', sub: 'Temukan motor impianmu dengan mudah dan aman.' }];
  const item = (b, i) => `<div class="sl-item hero-slide ${b.path ? 'berfoto' : 'polos'} ${b.label || b.judul || b.sub ? 'bergaris' : ''}">${b.path ? `<img ${i ? 'loading="lazy" ' : ''}src="${esc(urlPublik(b.path))}" alt="${esc(b.judul || 'Banner')}" draggable="false">` : ''}
    <div class="hero-txt">${b.label ? `<span class="hero-lbl">${esc(b.label)}</span>` : ''}${b.judul ? `<h2>${esc(b.judul)}</h2>` : ''}${b.sub ? `<p>${esc(b.sub)}</p>` : ''}</div></div>`;
  return `<section class="hero sl" id="hero" aria-label="Banner"><div class="sl-track">${sl.map(item).join('')}</div>${slPanah(sl.length)}${slDots(sl.length)}</section>`;
}
function putarHero() {
  clearInterval(_heroTimer);
  const h = $('#hero'); if (!h || h.querySelectorAll('.sl-item').length < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let jeda = false;
  ['pointerdown', 'mouseenter', 'focusin'].forEach((ev) => h.addEventListener(ev, () => { jeda = true; }));
  ['mouseleave', 'focusout'].forEach((ev) => h.addEventListener(ev, () => { jeda = false; }));
  h.addEventListener('touchend', () => { setTimeout(() => { jeda = false; }, 4000); }, { passive: true });
  _heroTimer = setInterval(() => {
    if (!document.body.contains(h)) return clearInterval(_heroTimer);
    if (jeda || document.hidden) return;
    const t = $('.sl-track', h), n = t.children.length, w = t.clientWidth, i = Math.round(t.scrollLeft / Math.max(1, w));
    t.scrollTo({ left: ((i + 1) % n) * w, behavior: 'smooth' });
  }, 5000);
}
const logoUsaha = (u) => u && u.logo ? `<img class="pub-logo" src="${esc(urlPublik(u.logo))}" alt="Logo ${esc(u.nama_usaha)}">` : `<span class="pub-logo ikon">${ic('two_wheeler')}</span>`;

// ── Footer publik: media sosial + ikon masuk staf ──
const IKON_SOSMED = {
  instagram: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M14 8.5V7c0-.7.3-1 1.100-1H17V3h-2.700C11.600 3 10.500 4.600 10.500 6.800V8.500H8v3h2.500V21h3.500v-9.500h2.600l.4-3H14z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16.500 3c.3 2.200 1.600 3.700 3.800 3.900v3.100c-1.400 0-2.700-.4-3.800-1.200v6.100a6 6 0 1 1-6-6c.3 0 .6 0 .9.100v3.200a2.900 2.900 0 1 0 2 2.700V3h3.100z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M21.600 7.200a2.500 2.500 0 0 0-1.800-1.800C18.200 5 12 5 12 5s-6.200 0-7.800.4A2.500 2.500 0 0 0 2.400 7.200C2 8.800 2 12 2 12s0 3.200.4 4.800a2.500 2.500 0 0 0 1.800 1.800C5.800 19 12 19 12 19s6.200 0 7.800-.4a2.500 2.500 0 0 0 1.800-1.800c.4-1.600.4-4.800.4-4.800s0-3.200-.4-4.800zM10 15V9l5.200 3L10 15z"/></svg>'
};
const NAMA_SOSMED = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
// Terima URL lengkap (http/https) ATAU nama akun saja; selain itu dijadikan alamat akun di situs tujuan.
function linkSosmed(k, v) {
  v = String(v || '').trim(); if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const u = v.replace(/^@/, '').replace(/[^\w.\-]/g, '');
  if (!u) return '';
  return { instagram: `https://instagram.com/${u}`, facebook: `https://facebook.com/${u}`, tiktok: `https://tiktok.com/@${u}`, youtube: `https://youtube.com/@${u}` }[k] || '';
}
function footerPublik(u) {
  const so = u.sosmed || {}, tautan = Object.keys(NAMA_SOSMED).map((k) => [k, linkSosmed(k, so[k])]).filter((x) => x[1]);
  if (u.wa_sorum) tautan.push(['whatsapp', waLink(u.wa_sorum)]);
  const masuk = S.profile ? `<a class="pf-staff" href="${rumah()}" aria-label="Buka aplikasi" title="Buka aplikasi">${ic('dashboard')}</a>` : `<a class="pf-staff" href="#/masuk" aria-label="Masuk staf" title="Masuk staf">${ic('lock')}</a>`;
  return `<footer class="pub-foot"><div class="pf-nama">${esc(u.nama_usaha)}</div>${u.alamat_usaha ? `<div class="pf-alamat">${ic('location_on', 'sm')} ${esc(u.alamat_usaha)}</div>` : ''}
    ${tautan.length ? `<div class="pf-sosmed">${tautan.map(([k, h]) => `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer" aria-label="${k === 'whatsapp' ? 'WhatsApp' : NAMA_SOSMED[k]}" title="${k === 'whatsapp' ? 'WhatsApp' : NAMA_SOSMED[k]}">${k === 'whatsapp' ? ic('chat') : IKON_SOSMED[k]}</a>`).join('')}</div>` : ''}
    <div class="pf-bawah"><span>© ${new Date().getFullYear()} FIX PROJECT DEVELOPER</span>${masuk}</div></footer>`;
}

// ── Katalog publik ──
async function halKatalog() {
  clearInterval(_heroTimer);
  app().innerHTML = `<header class="pub-head"><div class="in row between"><div class="pub-brand"><span id="pub-logo">${logoUsaha(S.usaha)}</span><div><h1 id="pub-nama">${esc((S.usaha && S.usaha.nama_usaha) || 'Showroom Motor')}</h1><p>Jual Beli Motor Bekas Berkualitas</p></div></div></div></header>
    <div class="pub-wrap"><div id="k-hero"></div>
    <div class="pub-tools"><div class="search">${ic('search')}<input id="k-cari" type="search" placeholder="Cari merk, tipe, atau tahun…" aria-label="Cari motor"></div>
    <div class="chips-wrap"><div class="chips" id="k-merk" role="group" aria-label="Merk"></div></div>
    <div class="tools-bar"><span class="small muted" id="k-jumlah" aria-live="polite"></span><label class="urut"><span class="xs muted">Urutkan</span><select id="k-urut" aria-label="Urutkan"><option value="baru">Terbaru</option><option value="murah">Harga terendah</option><option value="mahal">Harga tertinggi</option></select></label></div></div>
    <div class="cars" id="k-list">${loading(3)}</div><div id="k-foot"></div></div>`;
  const d = await q(sb.rpc('rpc_katalog_publik'));
  if (!$('#k-list')) return;   // pengguna sudah pindah halaman
  if (!d) { $('#k-list').innerHTML = kosong('cloud_off', 'Katalog belum dapat dimuat. Coba lagi nanti.'); return; }
  S.usaha = d.usaha; terapkanFavicon(d.usaha); $('#pub-nama').textContent = d.usaha.nama_usaha; document.title = d.usaha.nama_usaha; $('#pub-logo').innerHTML = logoUsaha(d.usaha); $('#k-foot').innerHTML = footerPublik(d.usaha);
  $('#k-hero').innerHTML = heroHtml(d.usaha); pasangSlider($('#k-hero')); putarHero();
  const semua = d.motor || []; let merk = 'Semua';
  const merkList = ['Semua', ...Array.from(new Set(semua.map((m) => m.merk))).sort()];
  $('#k-merk').innerHTML = merkList.map((m) => `<button class="chip ${m === merk ? 'active' : ''}" data-merk="${esc(m)}">${esc(m)}</button>`).join('');
  const kartu = (m) => {
    const fo = m.fotos && m.fotos.length ? m.fotos : (m.foto ? [{ path: m.foto }] : []), nm = nmMotor(m), href = `#/motor/${esc(m.slug)}`;
    const pesan = `Halo ${d.usaha.nama_usaha}, saya tertarik dengan ${nm} ${m.tahun}. Apakah masih tersedia?\n${linkBagikan(m.slug)}`;
    return `<article class="car" data-href="${href}"><div class="ph sl">${m.terverifikasi ? lencanaVerif() : ''}${fo.length > 1 ? `<span class="sl-count">1/${fo.length}</span>` : ''}
      ${fo.length ? `<div class="sl-track">${fo.map((f, i) => `<div class="sl-item"><img ${i ? 'loading="lazy" ' : ''}src="${esc(urlPublik(f.path, f.v))}" alt="${esc(nm)} foto ${i + 1}" draggable="false"></div>`).join('')}</div>${slPanah(fo.length)}${slDots(fo.length)}` : `<div class="sl-kosong">${ic('two_wheeler', 'lg')}</div>`}</div>
      <div class="bd"><a class="nm" href="${href}">${esc(nm)} ${esc(m.tahun)}</a>
      <div class="specs">${m.kilometer != null ? `<span class="spec">${ic('speed', 'sm')} ${angka(m.kilometer)} km</span>` : ''}${m.warna ? `<span class="spec">${ic('palette', 'sm')} ${esc(m.warna)}</span>` : ''}${m.kelengkapan_surat ? `<span class="spec">${ic('description', 'sm')} ${esc(m.kelengkapan_surat)}</span>` : ''}</div>
      <div class="pr">${m.harga ? rp(m.harga) : 'Hubungi kami'}</div>
      <div class="car-aksi"><a class="btn ghost" href="${href}">Lihat Detail</a>${d.usaha.wa_sorum ? `<a class="btn wa" href="${esc(waLink(d.usaha.wa_sorum, pesan))}" target="_blank" rel="noopener">${ic('chat', 'sm')} Tanya via WA</a>` : ''}</div></div></article>`;
  };
  const gambar = () => {
    const cari = $('#k-cari').value.toLowerCase().trim(), urut = $('#k-urut').value;
    let l = semua.filter((m) => (merk === 'Semua' || m.merk === merk) && (!cari || `${m.merk} ${m.tipe} ${m.tahun} ${m.warna || ''}`.toLowerCase().includes(cari)));
    if (urut === 'murah') l.sort((a, b) => (a.harga || 9e15) - (b.harga || 9e15)); else if (urut === 'mahal') l.sort((a, b) => (b.harga || 0) - (a.harga || 0));
    $('#k-jumlah').textContent = `${l.length} unit tersedia`;
    $('#k-list').innerHTML = l.length ? l.map(kartu).join('') : kosong('search_off', semua.length ? 'Tidak ada motor yang cocok dengan pencarian.' : 'Belum ada unit yang ditampilkan saat ini.');
  };
  pasangSlider($('#k-list'));
  $('#k-list').addEventListener('click', (e) => { if (e.target.closest('a,button')) return; const c = e.target.closest('[data-href]'); if (c) location.hash = c.dataset.href; });
  $('#k-cari').oninput = gambar; $('#k-urut').onchange = gambar;
  $('#k-merk').onclick = (e) => { const b = e.target.closest('[data-merk]'); if (!b) return; merk = b.dataset.merk; $$('#k-merk .chip').forEach((c) => c.classList.toggle('active', c === b)); gambar(); };
  gambar();
  if (d.usaha.wa_sorum) { const bar = document.createElement('div'); bar.className = 'cta-bar'; bar.innerHTML = `<a class="btn wa" href="${esc(waLink(d.usaha.wa_sorum, 'Halo ' + d.usaha.nama_usaha + ', saya ingin tanya motor yang tersedia.'))}" target="_blank" rel="noopener">${ic('chat')} Tanya via WhatsApp</a>`; app().appendChild(bar); }
}

// ── Detail motor publik ──
async function halDetailPublik(slug) {
  clearInterval(_heroTimer);
  app().innerHTML = `<div class="pub-head" style="padding-bottom:16px"><div class="in row"><a class="icon-btn" href="#/" aria-label="Kembali" style="color:#fff">${ic('arrow_back')}</a><h2 style="color:#fff" id="pd-nama">Detail motor</h2></div></div><div class="pub-wrap" style="margin-top:12px" id="pd">${loading(2)}</div>`;
  const d = await q(sb.rpc('rpc_motor_publik', { p_slug: slug }));
  const box = $('#pd'); if (!box) return;
  if (!d || !d.tersedia) {
    box.innerHTML = `<div class="card">${kosong('sentiment_dissatisfied', 'Maaf, motor ini sudah tidak tersedia.')}<div class="center"><a class="btn" href="#/">Lihat motor lainnya</a></div></div>`; return;
  }
  const m = d.motor, u = d.usaha; document.title = `${nmMotor(m)} ${m.tahun} — ${u.nama_usaha}`; $('#pd-nama').textContent = nmMotor(m);
  const fotos = d.foto || [];
  const pesan = `Halo ${u.nama_usaha}, saya tertarik dengan ${nmMotor(m)} ${m.tahun}${m.warna ? ' (' + m.warna + ')' : ''}. Apakah masih tersedia?\n${linkBagikan(m.slug)}`;
  box.innerHTML = `<div class="grid cols" style="align-items:start"><div class="gallery"><div class="main-ph sl">${m.terverifikasi ? lencanaVerif() : ''}${fotos.length > 1 ? `<span class="sl-count">1/${fotos.length}</span>` : ''}
    ${fotos.length ? `<div class="sl-track">${fotos.map((f, i) => `<div class="sl-item"><img ${i ? 'loading="lazy" ' : ''}src="${esc(urlPublik(f.path, f.v))}" alt="${esc(nmMotor(m))} foto ${i + 1}" draggable="false"></div>`).join('')}</div>${slPanah(fotos.length)}${slDots(fotos.length)}` : `<div class="sl-kosong">${ic('two_wheeler', 'lg')}</div>`}</div></div>
    <div class="card stack"><div><h1>${esc(nmMotor(m))}</h1><div class="muted">${esc(m.tahun)}${m.warna ? ' · ' + esc(m.warna) : ''}</div></div>
    <div class="pr num" style="font-size:26px;font-weight:800;color:var(--accent)">${m.harga ? rp(m.harga) : 'Hubungi kami'}</div>
    <div>${[['Tahun', m.tahun], ['Warna', m.warna], ['Kilometer', m.kilometer != null ? angka(m.kilometer) + ' km' : null], ['Kelengkapan surat', m.kelengkapan_surat], ['Pemeriksaan', m.terverifikasi ? 'Terverifikasi (lolos pengecekan kondisi)' : null]].filter((r) => r[1]).map((r) => `<div class="kv"><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join('')}</div>
    ${m.deskripsi ? `<div><h3>Deskripsi</h3><p style="white-space:pre-line;margin:6px 0 0">${esc(m.deskripsi)}</p></div>` : ''}
    ${u.alamat_usaha ? `<div class="small muted">${ic('location_on', 'sm')} ${esc(u.alamat_usaha)}</div>` : ''}</div></div>
    <div class="cta-bar">${u.wa_sorum ? `<a class="btn wa" href="${esc(waLink(u.wa_sorum, pesan))}" target="_blank" rel="noopener">${ic('chat')} Tanya via WhatsApp</a>` : ''}<button class="btn ghost" id="g-share" style="max-width:120px">${ic('share')} Bagikan</button></div>`;
  box.insertAdjacentHTML('beforeend', footerPublik(u));
  pasangSlider($('.gallery', box));
  $('#g-share').onclick = () => bagikan(m);
}

// ── Login ──
function halLogin() {
  app().innerHTML = `<div class="login"><div class="box"><div class="center mb"><div class="logo">${ic('two_wheeler', 'lg')}</div><h1>${esc((S.usaha && S.usaha.nama_usaha) || 'Showroom Motor')}</h1><p class="muted small" style="margin:4px 0 0">Masuk untuk mengelola showroom</p></div>
    <form class="card stack" id="f-login" novalidate><div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="username" inputmode="email" required></div>
    <div class="field"><label for="l-pass">Kata sandi</label><div class="row"><input id="l-pass" type="password" autocomplete="current-password" required><button type="button" class="icon-btn" id="l-eye" aria-label="Tampilkan kata sandi">${ic('visibility')}</button></div></div>
    <div class="alert bad hidden" id="l-err" role="alert"></div><button class="btn accent block" type="submit">Masuk</button></form>
    <p class="center small mt"><a href="#/">← Kembali ke katalog</a></p></div></div>`;
  $('#l-eye').onclick = () => { const i = $('#l-pass'); i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const em = $('#l-email').value.trim(), pw = $('#l-pass').value, er = $('#l-err');
    er.classList.add('hidden');
    if (!em || !pw) { er.textContent = 'Email dan kata sandi wajib diisi.'; er.classList.remove('hidden'); return; }
    await sibuk($('button[type=submit]'), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) { er.textContent = pesanError(error); er.classList.remove('hidden'); return; }
      await muatProfil();
      if (S.profile) { sb.rpc('rpc_catat_login').then(() => {}, () => {}); location.hash = rumah(); }
      else { er.textContent = 'Akun Anda tidak aktif. Hubungi pemilik.'; er.classList.remove('hidden'); await sb.auth.signOut(); }
    });
  };
}

async function muatProfil() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session; S.profile = null;
  if (!session) return null;
  const { data } = await sb.from('profiles').select('id,nama,role,aktif').eq('id', session.user.id).maybeSingle();
  if (data && data.aktif) S.profile = data;
  return S.profile;
}
async function keluar() {
  await sb.auth.signOut(); S.session = S.profile = null; S.cache = {}; location.hash = '#/masuk';
}

// ── Shell terautentikasi ──
const MENU = [
  { k: 'dashboard', t: 'Dashboard', i: 'dashboard', owner: true }, { k: 'motor', t: 'Motor', i: 'two_wheeler' }, { k: 'transaksi', t: 'Transaksi', i: 'receipt_long' },
  { k: 'restorasi', t: 'Restorasi', i: 'build', owner: true }, { k: 'pelanggan', t: 'Pelanggan', i: 'group', owner: true }, { k: 'pengeluaran', t: 'Pengeluaran', i: 'payments', owner: true },
  { k: 'dokumen', t: 'Dokumen', i: 'description', owner: true }, { k: 'laporan', t: 'Laporan', i: 'assessment', owner: true },
  { k: 'user', t: 'Pengguna', i: 'manage_accounts', owner: true }, { k: 'log', t: 'Log Aktivitas', i: 'history', owner: true }, { k: 'pengaturan', t: 'Pengaturan', i: 'settings' }
];
const NAV_OWNER = ['dashboard', 'motor', 'transaksi', 'restorasi'], NAV_ADMIN = ['motor', 'transaksi'];
const navBawah = () => (isOwner() ? NAV_OWNER : NAV_ADMIN);
const menuAktif = () => MENU.filter((m) => !m.owner || isOwner());

function shell(judul, aktif, opsi) {
  opsi = opsi || {};
  const nm = (S.usaha && S.usaha.nama_usaha) || 'Showroom Motor';
  const side = menuAktif().map((m) => `<a href="#/${m.k}" class="${m.k === aktif ? 'active' : ''}">${ic(m.i)} ${esc(m.t)}</a>`).join('');
  const bawah = navBawah().map((k) => { const m = MENU.find((x) => x.k === k); return `<button data-nav="${k}" class="${k === aktif ? 'active' : ''}">${ic(m.i)}<span>${esc(m.t)}</span></button>`; }).join('')
    + `<button data-more class="${navBawah().includes(aktif) ? '' : 'active'}">${ic('menu')}<span>Lainnya</span></button>`;
  app().innerHTML = `<div class="shell"><nav class="sidebar" aria-label="Menu utama"><div class="brand">${esc(nm)}</div>${side}<div class="spacer"></div>
    <a href="#/" target="_blank" rel="noopener">${ic('storefront')} Katalog publik</a><button class="navlink" data-keluar>${ic('logout')} Keluar</button></nav>
    <div class="content"><header class="topbar">${opsi.kembali ? `<a class="icon-btn" href="${esc(opsi.kembali)}" aria-label="Kembali">${ic('arrow_back')}</a>` : `<span class="brand">${ic('two_wheeler')}</span>`}
    <div class="title">${esc(judul)}</div>${opsi.aksi || ''}<button class="icon-btn" data-tema aria-label="Ganti tema">${ic('contrast')}</button></header>
    <main class="main" id="page">${loading(3)}</main></div>
    <nav class="bottomnav" aria-label="Menu bawah">${bawah}</nav>
    <button class="fab" data-fab aria-label="Tambah cepat">${ic('add')}</button></div>`;
  $$('[data-nav]').forEach((b) => b.onclick = () => { location.hash = '#/' + b.dataset.nav; });
  $('[data-more]').onclick = menuLainnya;
  $('[data-fab]').onclick = menuTambah;
  $('[data-keluar]').onclick = keluar;
  $('[data-tema]').onclick = () => { aturTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };
  document.title = judul + ' — ' + nm;
  return $('#page');
}
function menuLainnya() {
  const sh = sheet('Menu lainnya', `<div class="fab-menu">${menuAktif().filter((m) => !navBawah().includes(m.k)).map((m) => `<button data-go="${m.k}">${ic(m.i)}${esc(m.t)}</button>`).join('')}<button data-go-pub>${ic('storefront')}Katalog publik</button><button data-out>${ic('logout')}Keluar</button></div>`, { noFocus: true });
  sh.el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.go) { sh.close(); location.hash = '#/' + b.dataset.go; } else if (b.hasAttribute('data-go-pub')) { sh.close(); window.open('#/', '_blank'); } else if (b.hasAttribute('data-out')) { sh.close(); keluar(); } };
}
function menuTambah() {
  const it = [['two_wheeler', 'Unit Motor Baru', 'unitBaru'], ['sell', 'Jual Motor', 'jual'], ['payments', 'Pembayaran', 'bayar'], ...(isOwner() ? [['build', 'Pekerjaan Restorasi', 'resto'], ['receipt', 'Pengeluaran', 'keluar'], ['person_add', 'Pelanggan', 'pelanggan']] : [])];
  const sh = sheet('Tambah cepat', `<div class="fab-menu">${it.map((x) => `<button data-a="${x[2]}">${ic(x[0])}${x[1]}</button>`).join('')}</div>`, { noFocus: true });
  sh.el.onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; sh.close(); aksiCepat(b.dataset.a); };
}

// ───────────────────── 3. DASHBOARD & MOTOR ─────────────────────
const WARNA_STATUS = { Masuk: 'var(--st-masuk)', Pemeriksaan: 'var(--st-periksa)', Restorasi: 'var(--st-resto)', Ready: 'var(--st-ready)', Booking: 'var(--st-booking)', Terjual: 'var(--st-terjual)' };
const thumbMotor = (m) => `<div class="thumb">${m.foto_utama_path ? `<img loading="lazy" src="${esc(urlPublik(m.foto_utama_path))}" alt="">` : ic('two_wheeler')}</div>`;
const kartuMotor = (m, extra) => `<a class="item" href="#/unit/${esc(m.id)}">${thumbMotor(m)}<div class="grow"><div class="t">${esc(nmMotor(m))} <span class="muted small">${esc(m.tahun)}</span></div>
  <div class="small muted">${esc(m.kode_unit)} · ${esc(m.nopol)}</div><div class="row wrap mt-s">${badge(m.status)}${m.hari_tersimpan != null ? `<span class="xs muted">${m.hari_tersimpan} hari</span>` : ''}${m.tampil_katalog && m.status === 'Ready' ? `<span class="badge ok">${ic('public', 'sm')} Katalog</span>` : ''}</div></div>
  <div class="right"><div class="num" style="font-weight:700">${m.harga_jual ? rp(m.harga_jual) : '—'}</div>${extra || ''}</div></a>`;

// ── Dashboard ──
async function halDashboard() {
  const p = shell('Dashboard', 'dashboard');
  const [st, per, keu, baru] = await Promise.all([
    q(sb.from('v_dashboard_status').select('*').maybeSingle()),
    q(sb.from('v_peringatan').select('*').order('jenis').limit(30)),
    isOwner() ? q(sb.from('v_dashboard_keuangan').select('*').maybeSingle()) : Promise.resolve(null),
    q(sb.from('v_motor_ringkas').select('*').neq('status', 'Terjual').order('created_at', { ascending: false }).limit(5))
  ]);
  if (!st) { p.innerHTML = kosong('error', 'Dashboard belum dapat dimuat.'); return; }
  const k = (label, val, sub, aksen) => `<div class="card kpi-card ${aksen ? 'accent' : ''}"><div class="label">${label}</div><div class="value">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  let insight = '';
  if (keu) {
    const sel = keu.omzet_bulan_ini - keu.omzet_bulan_lalu;
    insight = `<div class="alert info">${ic('insights')}<div>Omzet bulan ini ${rp(keu.omzet_bulan_ini)}${keu.omzet_bulan_lalu > 0 ? ` — ${sel >= 0 ? 'naik' : 'turun'} ${Math.abs(Math.round(sel / keu.omzet_bulan_lalu * 100))}% dibanding bulan lalu` : ' (belum ada penjualan bulan lalu sebagai pembanding)'}. Modal tertanam di ${st.aktif} unit aktif sebesar ${rp(keu.modal_aktif)}.</div></div>`;
  }
  const total = Math.max(1, st.aktif);
  const pipa = ['Masuk', 'Pemeriksaan', 'Restorasi', 'Ready', 'Booking'].map((s) => [s, st[s.toLowerCase()]]);
  p.innerHTML = `<div class="stack">
    <div><h1>Halo, ${esc((S.profile.nama || '').split(' ')[0] || 'Admin')} 👋</h1><div class="muted small">${isOwner() ? 'Pemilik' : 'Admin'} · ${tgl(hariIni())}</div></div>
    ${insight}
    <div class="grid kpi">${k('Unit aktif', st.aktif, 'belum terjual')}${k('Siap jual', st.ready, 'status Ready', true)}${k('Terjual bulan ini', st.terjual_bulan_ini, 'lunas / proses leasing')}${k('Booking', st.booking, 'menunggu pelunasan')}
    ${keu ? k('Modal aktif', rp(keu.modal_aktif), 'stok belum terjual') + k('Estimasi untung', rp(keu.estimasi_untung), 'jika terjual sesuai harga jual') + k('Omzet bulan ini', rp(keu.omzet_bulan_ini), 'penjualan sah') + k('Untung aktual', rp(keu.untung_aktual_bulan_ini), 'bulan ini') : ''}</div>
    <div class="card"><h3>Alur unit</h3><div class="pill-bar mt-s">${pipa.map(([s, n]) => `<i style="width:${n / total * 100}%;background:${WARNA_STATUS[s]}" title="${s}: ${n}"></i>`).join('')}</div>
      <div class="row wrap mt-s">${pipa.map(([s, n]) => `<a href="#/motor?status=${s}" class="row small" style="gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${WARNA_STATUS[s]}"></span>${s} <b class="num">${n}</b></a>`).join('')}</div></div>
    <div class="card"><h3>${ic('notifications', 'sm')} Perlu perhatian ${per && per.length ? `<span class="badge warn">${per.length}</span>` : ''}</h3>
      ${per && per.length ? `<div class="list mt-s">${per.slice(0, 8).map((x) => `<a class="row small" href="#/unit/${esc(x.motor_id)}${x.jenis === 'restorasi' ? '/restorasi' : x.jenis === 'dokumen' ? '/dokumen' : ''}">${ic(x.jenis === 'dokumen' ? 'description' : x.jenis === 'restorasi' ? 'build' : 'schedule', 'sm')}<span class="grow">${esc(x.pesan)}</span>${ic('chevron_right', 'sm')}</a>`).join('')}${per.length > 8 ? `<div class="xs muted">+${per.length - 8} peringatan lain</div>` : ''}</div>` : '<p class="muted small">Tidak ada peringatan. Semua beres ✅</p>'}</div>
    <div><div class="row between mb"><h2>Unit terbaru</h2><a href="#/motor" class="small">Lihat semua</a></div><div class="list">${baru && baru.length ? baru.map((m) => kartuMotor(m)).join('') : kosong('two_wheeler', 'Belum ada unit. Tekan tombol + untuk menambah.')}</div></div></div>`;
}

// ── Daftar motor ──
async function halMotor(parsed) {
  const p = shell('Motor', 'motor');
  if (parsed && parsed.status) S.motorFilter.status = parsed.status;
  const data = await q(sb.from('v_motor_ringkas').select('*').order('tanggal_masuk', { ascending: false }).order('created_at', { ascending: false }));
  if (!data) { p.innerHTML = kosong('error', 'Data motor belum dapat dimuat.'); return; }
  const F = S.motorFilter;
  p.innerHTML = `<div class="stack"><div class="search">${ic('search')}<input id="m-cari" type="search" placeholder="Cari kode, merk, tipe, nopol…" value="${esc(F.q)}"></div>
    <div class="chips" id="m-chips">${['Semua', ...STATUS_MOTOR].map((s) => `<button class="chip ${F.status === s ? 'active' : ''}" data-s="${s}">${s}${s !== 'Semua' ? ' ' + data.filter((m) => m.status === s).length : ''}</button>`).join('')}</div>
    <div class="list" id="m-list"></div></div>`;
  const gambar = () => {
    const c = F.q.toLowerCase().trim();
    const l = data.filter((m) => (F.status === 'Semua' || m.status === F.status) && (!c || `${m.kode_unit} ${m.merk} ${m.tipe} ${m.nopol} ${m.tahun}`.toLowerCase().includes(c)));
    $('#m-list').innerHTML = l.length ? l.map((m) => kartuMotor(m)).join('') : kosong('two_wheeler', data.length ? 'Tidak ada unit yang cocok.' : 'Belum ada unit. Tekan tombol + untuk menambah.');
  };
  $('#m-cari').oninput = (e) => { F.q = e.target.value; gambar(); };
  $('#m-chips').onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; F.status = b.dataset.s; $$('#m-chips .chip').forEach((c) => c.classList.toggle('active', c === b)); gambar(); };
  gambar();
}

// ── Form unit (tambah / ubah) ──
async function daftarSumber() { return (await q(sb.from('sumber_motor').select('id,nama,hp').order('nama'))) || []; }
async function formUnit(m) {
  const baru = !m, sumber = isOwner() ? await daftarSumber() : [];
  const bisaStatus = baru || ['Masuk', 'Pemeriksaan', 'Restorasi', 'Ready'].includes(m.status);
  const F = [
    { k: 'merk', label: 'Merk', req: true, val: m && m.merk, ph: 'Honda' }, { k: 'tipe', label: 'Tipe', req: true, val: m && m.tipe, ph: 'Beat Street' },
    { k: 'tahun', label: 'Tahun', type: 'number', req: true, val: m && m.tahun, min: 1980, inputmode: 'numeric' }, { k: 'warna', label: 'Warna', val: m && m.warna },
    { k: 'nopol', label: 'Nomor polisi', req: true, val: m && m.nopol, ph: 'B 1234 ABC' }, { k: 'kilometer', label: 'Kilometer', type: 'number', val: m && m.kilometer, min: 0, inputmode: 'numeric' },
    { k: 'no_rangka', label: 'Nomor rangka', val: m && m.no_rangka }, { k: 'no_mesin', label: 'Nomor mesin', val: m && m.no_mesin },
    bisaStatus ? { k: 'status', label: 'Status', type: 'select', opts: ['Masuk', 'Pemeriksaan', 'Restorasi', 'Ready'], val: m ? m.status : 'Masuk', hint: 'Booking & Terjual diatur otomatis lewat menu Penjualan.' } : { html: `<div class="field"><label>Status</label><div>${badge(m.status)} <span class="hint">diatur otomatis oleh penjualan</span></div></div>` },
    ...(!isOwner() ? [] : [{ k: 'sumber_id', label: 'Penjual / asal motor', type: 'select', opts: [['', '— belum dipilih —'], ...sumber.map((s) => [s.id, s.nama + (s.hp ? ' · ' + s.hp : '')]), ['__baru', '+ Tambah penjual baru…']], val: (m && m.sumber_id) || '' },
    { k: 'sumber_nama', label: 'Nama penjual baru', val: '' }, { k: 'sumber_hp', label: 'No. HP penjual', val: '', inputmode: 'tel' }]),
    { k: 'harga_jual', label: 'Harga jual (Rp)', type: 'rupiah', val: m && m.harga_jual }, { k: 'kelengkapan_surat', label: 'Kelengkapan surat', val: m && m.kelengkapan_surat, ph: 'BPKB + STNK + Faktur' },
    { k: 'deskripsi_publik', label: 'Deskripsi untuk katalog', type: 'textarea', val: m && m.deskripsi_publik }, { k: 'catatan', label: 'Catatan internal', type: 'textarea', val: m && m.catatan },
    { k: 'tampil_katalog', label: 'Tampilkan di katalog publik (jika Ready)', type: 'checkbox', val: m && m.tampil_katalog }
  ];
  if (baru && isOwner()) F.push(
    { html: '<h3 style="margin-top:8px">Data pembelian</h3>' },
    { k: 'harga_beli', label: 'Harga beli (Rp)', type: 'rupiah', req: true }, { k: 'biaya_transport', label: 'Biaya transport', type: 'rupiah' }, { k: 'biaya_administrasi', label: 'Biaya administrasi', type: 'rupiah' }, { k: 'biaya_lain', label: 'Biaya lain', type: 'rupiah' },
    { k: 'metode_pembayaran', label: 'Metode pembayaran', type: 'select', opts: ['Tunai', 'Transfer'], val: 'Tunai' }, { k: 'tanggal_beli', label: 'Tanggal beli', type: 'date', val: hariIni() });
  formSheet(baru ? 'Tambah unit motor' : 'Ubah unit', F, async (v) => {
    if (v.tahun < 1980 || v.tahun > new Date().getFullYear() + 1) { toast('Tahun tidak valid.', 'err'); return false; }
    let sumberId = isOwner() ? v.sumber_id : null;
    if (sumberId === '__baru') {
      if (!v.sumber_nama) { toast('Nama penjual baru wajib diisi.', 'err'); return false; }
      const s = await q(sb.from('sumber_motor').insert({ nama: v.sumber_nama, hp: v.sumber_hp }).select('id').single());
      if (!s) return false; sumberId = s.id;
    }
    const rec = { merk: v.merk, tipe: v.tipe, tahun: v.tahun, warna: v.warna, nopol: v.nopol, no_rangka: v.no_rangka, no_mesin: v.no_mesin, kilometer: v.kilometer,
      ...(isOwner() ? { sumber_id: sumberId || null } : {}), harga_jual: v.harga_jual, kelengkapan_surat: v.kelengkapan_surat, deskripsi_publik: v.deskripsi_publik, catatan: v.catatan, tampil_katalog: !!v.tampil_katalog };
    if (bisaStatus) rec.status = v.status;
    if (baru) {
      const mm = await q(sb.from('motor').insert(rec).select('id').single());
      if (!mm) return false;
      if (!isOwner()) { ok('Unit tersimpan. Pemilik akan melengkapi data pembelian.'); location.hash = '#/unit/' + mm.id + '/foto'; return true; }
      const pb = await tulis(sb.from('pembelian').insert({ motor_id: mm.id, sumber_id: rec.sumber_id, harga_beli: v.harga_beli || 0, biaya_transport: v.biaya_transport || 0, biaya_administrasi: v.biaya_administrasi || 0, biaya_lain: v.biaya_lain || 0, metode_pembayaran: v.metode_pembayaran, tanggal_beli: v.tanggal_beli || hariIni() }));
      if (pb) ok('Unit tersimpan.'); else toast('Unit tersimpan, tetapi data pembelian gagal. Lengkapi dari halaman unit.', 'err');
      location.hash = '#/unit/' + mm.id + '/foto';
    } else {
      if (!(await tulis(sb.from('motor').update(rec).eq('id', m.id), 'Perubahan disimpan.'))) return false;
      halUnit(m.id, S.tabUnit || 'info');
    }
    return true;
  }, { wide: true, onOpen: (sh, form) => {
    const sel = $('[name=sumber_id]', form); if (!sel) return;
    const a = $('[name=sumber_nama]', form).closest('.field'), b = $('[name=sumber_hp]', form).closest('.field');
    const t = () => { const on = sel.value === '__baru'; a.classList.toggle('hidden', !on); b.classList.toggle('hidden', !on); }; sel.onchange = t; t();
  } });
}

// ── Detail unit ──
const TAB_SEMUA = [['info', 'Info'], ['foto', 'Foto'], ['dokumen', 'Dokumen'], ['periksa', 'Pemeriksaan'], ['restorasi', 'Restorasi'], ['riwayat', 'Riwayat']];
const tabUnit = () => (isOwner() ? TAB_SEMUA : TAB_SEMUA.filter((t) => ['info', 'foto', 'dokumen', 'periksa'].includes(t[0])));
async function halUnit(id, tab) {
  tab = tabUnit().some((t) => t[0] === tab) ? tab : 'info'; S.tabUnit = tab;
  const p = shell('Detail unit', 'motor', { kembali: '#/motor' });
  const m = await q(sb.from('v_motor_ringkas').select('*').eq('id', id).maybeSingle());
  if (!m) { p.innerHTML = kosong('search_off', 'Unit tidak ditemukan.'); return; }
  $('.topbar .title').textContent = nmMotor(m);
  p.innerHTML = `<div class="row" style="gap:14px">${thumbMotor(m).replace('class="thumb"', 'class="thumb" style="width:72px;height:72px"')}<div class="grow"><h1>${esc(nmMotor(m))}</h1><div class="muted small">${esc(m.kode_unit)} · ${esc(m.nopol)} · ${esc(m.tahun)}</div><div class="mt-s row wrap">${badge(m.status)}${m.terverifikasi ? `<span class="badge ok">${ic('verified', 'sm')} Terverifikasi</span>` : ''}</div></div></div>
    <div class="tabs" id="u-tabs">${tabUnit().map((t) => `<button class="tab ${t[0] === tab ? 'active' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div><div id="u-body">${loading(2)}</div>`;
  $('#u-tabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) location.hash = `#/unit/${id}/${b.dataset.t}`; };
  const T = { info: tabInfo, foto: tabFoto, dokumen: tabDokumen, periksa: tabPeriksa, restorasi: tabResto, riwayat: tabRiwayat }[tab];
  await T(m, $('#u-body'));
}

async function tabInfo(m, box) {
  const [keu, beli, sumber] = await Promise.all([
    isOwner() ? q(sb.from('v_motor_keuangan').select('*').eq('motor_id', m.id).maybeSingle()) : null,
    isOwner() ? q(sb.from('pembelian').select('*').eq('motor_id', m.id).maybeSingle()) : null,
    isOwner() && m.sumber_id ? q(sb.from('sumber_motor').select('nama,hp').eq('id', m.sumber_id).maybeSingle(), { senyap: true }) : null
  ]);
  const kv = (a, b) => `<div class="kv"><span>${a}</span><span>${b == null || b === '' ? '—' : b}</span></div>`;
  const aksiJual = m.status === 'Ready' ? `<a class="btn accent" href="#/jual/${m.id}">${ic('sell')} Jual motor ini</a>` : '';
  box.innerHTML = `<div class="stack">
    <div class="row wrap">${aksiJual}<button class="btn ghost" data-a="edit">${ic('edit')} Ubah</button><button class="btn ghost" data-a="share">${ic('share')} Bagikan</button></div>
    ${m.status === 'Ready' ? `<div class="card"><div class="row between"><div><h3>Tampil di katalog publik</h3><div class="small muted">${m.tampil_katalog ? 'Pengunjung dapat melihat unit ini.' : 'Unit disembunyikan dari katalog.'}${m.tampil_katalog && !m.foto_utama_path ? ' <b>Belum ada foto utama.</b>' : ''}</div></div><label class="row"><input type="checkbox" id="u-kat" ${m.tampil_katalog ? 'checked' : ''} style="width:22px;min-height:22px"></label></div></div>` : ''}
    <div class="card"><h3>Spesifikasi</h3>${kv('Merk / tipe', esc(nmMotor(m)))}${kv('Tahun', esc(m.tahun))}${kv('Warna', esc(m.warna))}${kv('Kilometer', m.kilometer != null ? angka(m.kilometer) + ' km' : null)}${kv('Nomor polisi', esc(m.nopol))}${kv('No. rangka', esc(m.no_rangka))}${kv('No. mesin', esc(m.no_mesin))}${kv('Kelengkapan surat', esc(m.kelengkapan_surat))}${kv('Tanggal masuk', tgl(m.tanggal_masuk))}${kv('Lama tersimpan', m.hari_tersimpan != null ? m.hari_tersimpan + ' hari' : null)}${isOwner() ? kv('Penjual', sumber ? esc(sumber.nama) + (sumber.hp ? ' · ' + esc(sumber.hp) : '') : null) : ''}${kv('Harga jual', m.harga_jual ? '<b class="num">' + rp(m.harga_jual) + '</b>' : null)}</div>
    ${m.status !== 'Terjual' && m.status !== 'Booking' ? `<div class="card"><h3>Ubah status</h3><div class="chips mt-s">${['Masuk', 'Pemeriksaan', 'Restorasi', 'Ready'].map((s) => `<button class="chip ${s === m.status ? 'active' : ''}" data-st="${s}">${s}</button>`).join('')}</div></div>` : ''}
    ${isOwner() ? keuanganOwner(keu, beli) : ''}
    ${m.catatan ? `<div class="card"><h3>Catatan</h3><p style="white-space:pre-line;margin:4px 0 0">${esc(m.catatan)}</p></div>` : ''}
    ${isOwner() ? `<div class="right"><button class="btn danger sm" data-a="hapus">${ic('delete', 'sm')} Hapus unit</button></div>` : ''}</div>`;
  box.onclick = async (e) => {
    const b = e.target.closest('[data-a],[data-st]'); if (!b) return;
    if (b.dataset.st) { if (b.dataset.st === m.status) return; if (await tulis(sb.from('motor').update({ status: b.dataset.st }).eq('id', m.id), 'Status diubah.')) halUnit(m.id, 'info'); return; }
    const a = b.dataset.a;
    if (a === 'edit') formUnit(m);
    else if (a === 'share') bagikan(m);
    else if (a === 'beli') formPembelian(m, beli);
    else if (a === 'bukti-beli') buktiPembelian(m, beli);
    else if (a === 'lihat-bukti') pratinjau('motor-privat', beli.bukti_path, 'Bukti pembelian');
    else if (a === 'hapus') {
      if (!(await konfirmasi('Hapus unit?', `Unit ${nmMotor(m)} beserta foto, dokumen, pembelian, dan riwayat restorasinya akan dihapus permanen. Unit yang pernah terjual tidak dapat dihapus.`, 'Hapus', true))) return;
      const { error } = await sb.from('motor').delete().eq('id', m.id);
      if (error) return gagal(error); ok('Unit dihapus.'); location.hash = '#/motor';
    }
  };
  const kat = $('#u-kat', box);
  if (kat) kat.onchange = async () => { await tulis(sb.from('motor').update({ tampil_katalog: kat.checked }).eq('id', m.id), kat.checked ? 'Unit tampil di katalog.' : 'Unit disembunyikan.'); halUnit(m.id, 'info'); };
}
function keuanganOwner(k, b) {
  const kv = (a, v, t) => `<div class="kv ${t || ''}"><span>${a}</span><span class="num">${v}</span></div>`;
  if (!k) return `<div class="card"><h3>Keuangan unit</h3><p class="muted small">Data pembelian belum dicatat.</p><button class="btn accent sm" data-a="beli">Catat pembelian</button></div>`;
  return `<div class="card"><div class="row between"><h3>Keuangan unit</h3><button class="btn ghost sm" data-a="beli">${ic('edit', 'sm')} Ubah pembelian</button></div>
    ${kv('Harga beli', rp(k.harga_beli))}${kv('Transport', rp(k.biaya_transport))}${kv('Administrasi', rp(k.biaya_administrasi))}${kv('Biaya lain', rp(k.biaya_lain))}${kv('Biaya restorasi', rp(k.biaya_restorasi))}${kv('Total modal', rp(k.total_modal), 'total')}
    ${kv('Harga jual', k.harga_jual ? rp(k.harga_jual) : '—')}${kv('Estimasi untung', k.estimasi_untung != null ? rp(k.estimasi_untung) : '—')}${k.untung_aktual != null ? kv('Untung aktual', '<b>' + rp(k.untung_aktual) + '</b>') : ''}
    <div class="row mt-s">${b && b.bukti_path ? `<button class="btn ghost sm" data-a="lihat-bukti">${ic('receipt', 'sm')} Lihat bukti</button>` : ''}<button class="btn ghost sm" data-a="bukti-beli">${ic('upload', 'sm')} ${b && b.bukti_path ? 'Ganti' : 'Unggah'} bukti pembelian</button></div></div>`;
}
function formPembelian(m, b) {
  const F = [{ k: 'harga_beli', label: 'Harga beli (Rp)', type: 'rupiah', req: true, val: b && b.harga_beli }, { k: 'biaya_transport', label: 'Biaya transport', type: 'rupiah', val: b && b.biaya_transport }, { k: 'biaya_administrasi', label: 'Biaya administrasi', type: 'rupiah', val: b && b.biaya_administrasi }, { k: 'biaya_lain', label: 'Biaya lain', type: 'rupiah', val: b && b.biaya_lain },
    { k: 'metode_pembayaran', label: 'Metode pembayaran', type: 'select', opts: ['Tunai', 'Transfer'], val: (b && b.metode_pembayaran) || 'Tunai' }, { k: 'tanggal_beli', label: 'Tanggal beli', type: 'date', val: (b && b.tanggal_beli) || hariIni() }, { k: 'catatan', label: 'Catatan', type: 'textarea', val: b && b.catatan }];
  const ada = b && b.harga_beli != null;
  formSheet(ada ? 'Ubah pembelian' : 'Catat pembelian', F, async (v) => {
    const rec = { harga_beli: v.harga_beli || 0, biaya_transport: v.biaya_transport || 0, biaya_administrasi: v.biaya_administrasi || 0, biaya_lain: v.biaya_lain || 0, metode_pembayaran: v.metode_pembayaran, tanggal_beli: v.tanggal_beli || hariIni(), catatan: v.catatan };
    const { error } = ada ? await sb.from('pembelian').update(rec).eq('motor_id', m.id) : await sb.from('pembelian').insert({ motor_id: m.id, ...rec });
    if (error) { gagal(error); return false; } ok('Pembelian disimpan.'); halUnit(m.id, 'info'); return true;
  });
}
async function buktiPembelian(m, b) {
  const f = await pilihFile('image/*,application/pdf'); if (!f) return;
  await sibuk(null, async () => {
    const path = await unggah('motor-privat', `beli/${m.id}/${Date.now()}.${ekst(f)}`, f); if (!path) return;
    const { error } = await sb.from('pembelian').update({ bukti_path: path }).eq('motor_id', m.id);
    if (error) return gagal(error); ok('Bukti pembelian tersimpan.'); halUnit(m.id, 'info');
  });
}

// ── Tab Foto ──
async function tabFoto(m, box) {
  const fotos = (await q(sb.from('motor_foto').select('*').eq('motor_id', m.id))) || [], by = {}; fotos.forEach((f) => by[f.urutan] = f);
  const nama = { 1: 'Utama', 2: 'Kedua', 3: 'Ketiga', 4: 'Keempat', 5: 'Foto Berkas' };
  box.innerHTML = `<div class="stack"><div class="alert info">${ic('info')}<div>Foto 1–4 tampil di katalog publik (diberi watermark bila diaktifkan di Pengaturan). <b>Foto Berkas</b> (slot 5) bersifat privat, tanpa watermark, dan tidak pernah tampil di katalog. Foto dikompres otomatis.</div></div>
    <div class="slots">${[1, 2, 3, 4, 5].map((n) => `<button class="slot" data-n="${n}" aria-label="Foto ${nama[n]}">${by[n] ? `<img alt="" data-img="${n}" src="${n < 5 ? esc(urlPublik(by[n].path, Date.parse(by[n].updated_at) / 1000 | 0)) : ''}">` : `<div>${ic('add_a_photo')}<br>${nama[n]}</div>`}<span class="tag">${n === 5 ? 'Berkas' : n}</span></button>`).join('')}</div>
    <p class="xs muted">Ketuk slot untuk mengunggah/mengganti. ${isOwner() ? 'Ketuk lama… gunakan tombol Hapus pada pratinjau.' : ''}</p></div>`;
  if (by[5]) urlTertanda('motor-privat', by[5].path).then((u) => { const i = $('[data-img="5"]', box); if (i) i.src = u; }).catch(() => {});
  box.onclick = async (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return; const n = +b.dataset.n, ada = by[n];
    if (ada) {
      const sh = sheet('Foto ' + nama[n], '<div class="preview"><div class="spinner"></div></div>', { wide: true, noFocus: true, footer: `${isOwner() ? '<button class="btn danger" data-del>Hapus</button>' : ''}<button class="btn ghost" data-ganti>Ganti foto</button><button class="btn" data-ok>Tutup</button>` });
      try { const u = n < 5 ? urlPublik(ada.path, Date.now()) : await urlTertanda('motor-privat', ada.path); $('.preview', sh.el).innerHTML = `<img src="${esc(u)}" alt="">`; } catch (er) { gagal(er); }
      $('[data-ok]', sh.el).onclick = () => sh.close();
      $('[data-ganti]', sh.el).onclick = () => { sh.close(); ganti(n); };
      const d = $('[data-del]', sh.el); if (d) d.onclick = async () => {
        sh.close(); if (!(await konfirmasi('Hapus foto?', 'Foto ini akan dihapus permanen.', 'Hapus', true))) return;
        await sb.storage.from(ada.bucket).remove([ada.path]); const { error } = await sb.from('motor_foto').delete().eq('id', ada.id); if (error) return gagal(error); ok('Foto dihapus.'); halUnit(m.id, 'foto');
      };
    } else ganti(n);
  };
  async function ganti(n) {
    const f = await pilihFile('image/*'); if (!f) return;
    await sibuk(null, async () => {
      const bucket = n < 5 ? 'motor-foto-publik' : 'motor-privat', path = n < 5 ? `${m.id}/${n}.jpg` : `foto-berkas/${m.id}/5.jpg`;
      const hasil = await unggah(bucket, path, f, true, n < 5 ? await siapkanWatermark() : null); if (!hasil) return;
      const { error } = await sb.from('motor_foto').upsert({ motor_id: m.id, urutan: n, jenis: FOTO_JENIS[n], bucket, path, updated_at: new Date().toISOString() }, { onConflict: 'motor_id,urutan' });
      if (error) return gagal(error); ok('Foto tersimpan.'); halUnit(m.id, 'foto');
    });
  }
}

// ── Tab Dokumen ──
const JENIS_DOK = [['STNK', 'STNK'], ['BPKB', 'BPKB'], ['Faktur', 'Faktur'], ['Kwitansi_Pembelian', 'Kwitansi pembelian'], ['Lainnya', 'Dokumen lainnya']];
async function tabDokumen(m, box) {
  const dok = (await q(sb.from('motor_dokumen').select('*').eq('motor_id', m.id))) || [], by = {}; dok.forEach((d) => by[d.jenis] = d);
  box.innerHTML = `<div class="list">${JENIS_DOK.map(([j, lab]) => { const d = by[j] || {}; return `<div class="card flat row" style="gap:12px"><label class="row grow" style="gap:12px"><input type="checkbox" data-j="${j}" ${d.tersedia ? 'checked' : ''} style="width:22px;min-height:22px"><span><b>${lab}</b><br><span class="xs muted">${d.tersedia ? 'Tersedia' : 'Belum ada'}${d.path ? ' · ada berkas' : ''}</span></span></label>
    ${d.path ? `<button class="btn ghost sm" data-lihat="${j}">${ic('visibility', 'sm')}</button>` : ''}<button class="btn ghost sm" data-up="${j}">${ic('upload', 'sm')}</button></div>`; }).join('')}</div>`;
  const simpan = (j, patch) => sb.from('motor_dokumen').upsert({ motor_id: m.id, jenis: j, ...patch }, { onConflict: 'motor_id,jenis' });
  box.onchange = async (e) => { const c = e.target.closest('[data-j]'); if (!c) return; const { error } = await simpan(c.dataset.j, { tersedia: c.checked }); if (error) { gagal(error); c.checked = !c.checked; } else halUnit(m.id, 'dokumen'); };
  box.onclick = async (e) => {
    const l = e.target.closest('[data-lihat]'), u = e.target.closest('[data-up]');
    if (l) pratinjau('motor-privat', by[l.dataset.lihat].path, JENIS_DOK.find((x) => x[0] === l.dataset.lihat)[1]);
    if (u) {
      const j = u.dataset.up, f = await pilihFile('image/*,application/pdf'); if (!f) return;
      await sibuk(null, async () => { const path = await unggah('motor-privat', `dok/${m.id}/${j}-${Date.now()}.${ekst(f)}`, f); if (!path) return; const { error } = await simpan(j, { path, tersedia: true }); if (error) return gagal(error); ok('Dokumen diunggah.'); halUnit(m.id, 'dokumen'); });
    }
  };
}

// ── Tab Pemeriksaan ──
const KONDISI = ['Baik', 'Perlu Perbaikan', 'Rusak', 'Tidak Ada'];
async function tabPeriksa(m, box) {
  const [tpl, ada] = await Promise.all([q(sb.from('pemeriksaan_template').select('*').order('kategori').order('urutan')), q(sb.from('pemeriksaan').select('*').eq('motor_id', m.id))]);
  if (!tpl) return; const by = {}; (ada || []).forEach((r) => by[r.kategori + '|' + r.butir] = r);
  const extra = (ada || []).filter((r) => !tpl.some((t) => t.kategori === r.kategori && t.butir === r.butir));
  const semua = [...tpl.filter((t) => t.aktif).map((t) => ({ kategori: t.kategori, butir: t.butir })), ...extra.map((r) => ({ kategori: r.kategori, butir: r.butir }))];
  const grup = {}; semua.forEach((s) => (grup[s.kategori] = grup[s.kategori] || []).push(s));
  const terisi = semua.filter((s) => by[s.kategori + '|' + s.butir] && by[s.kategori + '|' + s.butir].kondisi).length;
  const lengkap = semua.length > 0 && terisi === semua.length;
  const kartuVerif = `<div class="card"><div class="row between"><div><h3>${ic('verified', 'sm')} Terverifikasi (Quality Check)</h3><div class="small muted">${m.terverifikasi ? 'Lencana tampil di katalog publik. Matikan bila kondisi motor berubah.' : lengkap ? 'Semua butir sudah diperiksa. Aktifkan agar lencana tampil di katalog publik.' : `Lengkapi ${semua.length - terisi} butir lagi untuk dapat mengaktifkan lencana.`}</div></div><label class="row"><input type="checkbox" id="u-verif" ${m.terverifikasi ? 'checked' : ''} ${lengkap || m.terverifikasi ? '' : 'disabled'} aria-label="Terverifikasi" style="width:22px;min-height:22px"></label></div></div>`;
  box.innerHTML = `<div class="stack">${kartuVerif}<div class="card flat"><div class="row between small"><span>Terisi ${terisi} dari ${semua.length} butir</span><span class="muted">${Math.round(terisi / Math.max(1, semua.length) * 100)}%</span></div><div class="progress mt-s"><i style="width:${terisi / Math.max(1, semua.length) * 100}%"></i></div></div>
    ${Object.entries(grup).map(([k, l]) => `<div class="card"><h3>${esc(k)}</h3><div class="stack mt-s">${l.map((s, i) => { const r = by[k + '|' + s.butir] || {}; return `<div class="field" data-k="${esc(k)}" data-b="${esc(s.butir)}"><label>${esc(s.butir)}</label><div class="row"><select data-kond style="flex:1.2"><option value="">— belum diperiksa —</option>${KONDISI.map((x) => `<option ${r.kondisi === x ? 'selected' : ''}>${x}</option>`).join('')}</select><input data-cat placeholder="Catatan" value="${esc(r.catatan || '')}" style="flex:1.5"></div></div>`; }).join('')}</div></div>`).join('')}</div>`;
  const simpan = async (f) => {
    const kond = $('[data-kond]', f).value || null, cat = $('[data-cat]', f).value.trim() || null;
    const { error } = await sb.from('pemeriksaan').upsert({ motor_id: m.id, kategori: f.dataset.k, butir: f.dataset.b, kondisi: kond, catatan: cat, tanggal: hariIni(), updated_at: new Date().toISOString() }, { onConflict: 'motor_id,kategori,butir' });
    if (error) gagal(error); else toast('Tersimpan', 'ok');
  };
  box.onchange = async (e) => {
    if (e.target.id === 'u-verif') { const c = e.target; if (await tulis(sb.from('motor').update({ terverifikasi: c.checked }).eq('id', m.id), c.checked ? 'Unit ditandai Terverifikasi.' : 'Tanda Terverifikasi dimatikan.')) { m.terverifikasi = c.checked; halUnit(m.id, 'periksa'); } else c.checked = !c.checked; return; }
    const f = e.target.closest('[data-k]'); if (f) simpan(f);
  };
}

// ── Tab Restorasi (pekerjaan + biaya) ──
const bolehHapus = () => isOwner();
async function tabResto(m, box) {
  const rep = (await q(sb.from('reparasi').select('*').eq('motor_id', m.id).order('created_at'))) || [];
  const ids = rep.map((r) => r.id);
  const biaya = ids.length ? (await q(isOwner() ? sb.from('reparasi_biaya').select('*').in('reparasi_id', ids).order('created_at') : sb.from('v_reparasi_biaya_ringkas').select('*').in('reparasi_id', ids).order('created_at'))) || [] : [];
  const total = biaya.reduce((a, b) => a + (b.subtotal || 0), 0);
  const selesai = rep.filter((r) => r.status === 'Selesai').length;
  box.innerHTML = `<div class="stack"><div class="row between"><div><b>${selesai}/${rep.length}</b> pekerjaan selesai${isOwner() ? ` · Total biaya <b class="num">${rp(total)}</b>` : ''}</div><button class="btn accent sm" data-a="tambah">${ic('add', 'sm')} Pekerjaan</button></div>
    ${rep.length ? `<div class="progress"><i style="width:${selesai / rep.length * 100}%"></i></div>` : ''}
    ${rep.length ? rep.map((r) => { const bl = biaya.filter((b) => b.reparasi_id === r.id), sub = bl.reduce((a, b) => a + (b.subtotal || 0), 0);
      return `<div class="card" data-r="${r.id}"><div class="row between"><div class="grow"><h3>${esc(r.nama_pekerjaan)}</h3><div class="xs muted">${r.mekanik ? 'Mekanik: ' + esc(r.mekanik) : 'Mekanik belum diisi'}${r.tanggal_mulai ? ' · mulai ' + tgl(r.tanggal_mulai) : ''}${r.tanggal_selesai ? ' · selesai ' + tgl(r.tanggal_selesai) : ''}</div></div>
      <select data-st style="width:auto;min-height:36px">${['Belum', 'Dikerjakan', 'Selesai'].map((s) => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      ${r.deskripsi ? `<p class="small" style="margin:6px 0 0;white-space:pre-line">${esc(r.deskripsi)}</p>` : ''}
      ${bl.length ? `<div class="mt-s">${bl.map((b) => `<div class="kv"><span>${esc(b.nama)} <span class="xs">(${esc(b.jenis)} × ${b.qty})</span></span><span>${isOwner() ? rp(b.subtotal) + ` <button class="icon-btn" style="width:28px;height:28px" data-delb="${b.id}" aria-label="Hapus biaya">${ic('close', 'sm')}</button>` : ''}</span></div>`).join('')}${isOwner() ? `<div class="kv total"><span>Subtotal</span><span class="num">${rp(sub)}</span></div>` : ''}</div>` : ''}
      <div class="row wrap mt-s"><button class="btn ghost sm" data-addb="${r.id}">${ic('add', 'sm')} Biaya</button><button class="btn ghost sm" data-edit="${r.id}">${ic('edit', 'sm')} Ubah</button>${bolehHapus() ? `<button class="btn danger sm" data-delr="${r.id}">${ic('delete', 'sm')}</button>` : ''}</div></div>`; }).join('') : kosong('build', 'Belum ada pekerjaan restorasi.')}</div>`;
  const muat = () => halUnit(m.id, 'restorasi');
  box.onchange = async (e) => {
    const s = e.target.closest('[data-st]'); if (!s) return; const id = s.closest('[data-r]').dataset.r, st = s.value, patch = { status: st };
    if (st === 'Dikerjakan') patch.tanggal_mulai = rep.find((r) => r.id === id).tanggal_mulai || hariIni();
    if (st === 'Selesai') { patch.tanggal_selesai = hariIni(); patch.tanggal_mulai = rep.find((r) => r.id === id).tanggal_mulai || hariIni(); } else patch.tanggal_selesai = null;
    const { error } = await sb.from('reparasi').update(patch).eq('id', id); if (error) return gagal(error); muat();
  };
  box.onclick = async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.a === 'tambah') formPekerjaan(m, null, muat);
    else if (t.dataset.edit) formPekerjaan(m, rep.find((r) => r.id === t.dataset.edit), muat);
    else if (t.dataset.addb) formBiaya(t.dataset.addb, muat);
    else if (t.dataset.delb) { if (await konfirmasi('Hapus biaya?', 'Item biaya ini akan dihapus.', 'Hapus', true)) { const { error } = await sb.from('reparasi_biaya').delete().eq('id', t.dataset.delb); if (error) gagal(error); else muat(); } }
    else if (t.dataset.delr) { if (await konfirmasi('Hapus pekerjaan?', 'Pekerjaan beserta semua biayanya akan dihapus.', 'Hapus', true)) { const { error } = await sb.from('reparasi').delete().eq('id', t.dataset.delr); if (error) gagal(error); else muat(); } }
  };
}
function formPekerjaan(m, r, selesai) {
  formSheet(r ? 'Ubah pekerjaan' : 'Tambah pekerjaan', [{ k: 'nama_pekerjaan', label: 'Nama pekerjaan', req: true, val: r && r.nama_pekerjaan, ph: 'Servis mesin' }, { k: 'mekanik', label: 'Mekanik', val: r && r.mekanik }, { k: 'deskripsi', label: 'Keterangan', type: 'textarea', val: r && r.deskripsi }], async (v) => {
    const { error } = r ? await sb.from('reparasi').update(v).eq('id', r.id) : await sb.from('reparasi').insert({ motor_id: m.id, ...v });
    if (error) { gagal(error); return false; } ok('Pekerjaan disimpan.'); selesai(); return true;
  });
}
function formBiaya(reparasiId, selesai) {
  formSheet('Tambah biaya', [{ k: 'jenis', label: 'Jenis', type: 'select', opts: ['Sparepart', 'Jasa'], val: 'Sparepart' }, { k: 'nama', label: 'Nama item / jasa', req: true }, { k: 'qty', label: 'Jumlah', type: 'number', req: true, val: 1, min: 1, inputmode: 'numeric' }, { k: 'harga_satuan', label: 'Harga satuan (Rp)', type: 'rupiah', req: true }, { k: 'catatan', label: 'Catatan', val: '' }], async (v) => {
    if (!(v.qty > 0)) { toast('Jumlah minimal 1.', 'err'); return false; }
    const { error } = await sb.from('reparasi_biaya').insert({ reparasi_id: reparasiId, ...v, harga_satuan: v.harga_satuan || 0 });
    if (error) { gagal(error); return false; } ok('Biaya ditambahkan.'); selesai(); return true;
  });
}

// ── Tab Riwayat ──
async function tabRiwayat(m, box) {
  const r = await q(sb.from('v_motor_riwayat').select('*').eq('motor_id', m.id).order('waktu', { ascending: false }).limit(50));
  box.innerHTML = r && r.length ? `<div class="list">${r.map((x) => `<div class="card flat row" style="gap:12px">${ic(x.aksi === 'INSERT' ? 'add_circle' : 'swap_horiz')}<div class="grow small">${x.aksi === 'INSERT' ? 'Unit dicatat masuk' : `Status <b>${esc(x.dari || '—')}</b> → <b>${esc(x.ke || '—')}</b>`}<div class="xs muted">${tglWaktu(x.waktu)}${x.oleh ? ' · ' + esc(x.oleh) : ''}</div></div></div>`).join('')}</div>` : kosong('history', 'Belum ada riwayat.');
}

// ── Halaman Restorasi (ringkasan seluruh unit) ──
async function halRestorasi() {
  const p = shell('Restorasi', 'restorasi');
  const [data, keu] = await Promise.all([q(sb.from('v_motor_ringkas').select('*').in('status', ['Masuk', 'Pemeriksaan', 'Restorasi']).order('tanggal_masuk')), isOwner() ? q(sb.from('v_motor_keuangan').select('motor_id,biaya_restorasi')) : null]);
  if (!data) { p.innerHTML = kosong('error', 'Data belum dapat dimuat.'); return; }
  const bk = {}; (keu || []).forEach((k) => bk[k.motor_id] = k.biaya_restorasi);
  const grup = (s) => data.filter((m) => m.status === s);
  p.innerHTML = `<div class="stack">${['Restorasi', 'Pemeriksaan', 'Masuk'].map((s) => `<div><h2 class="mb">${s} <span class="muted small">(${grup(s).length})</span></h2><div class="list">${grup(s).length ? grup(s).map((m) => `<a class="item" href="#/unit/${m.id}/${s === 'Pemeriksaan' ? 'periksa' : 'restorasi'}">${thumbMotor(m)}<div class="grow"><div class="t">${esc(nmMotor(m))}</div><div class="xs muted">${esc(m.kode_unit)} · ${m.hari_tersimpan} hari</div>
      <div class="row mt-s"><div class="progress grow"><i style="width:${m.pekerjaan_total ? m.pekerjaan_selesai / m.pekerjaan_total * 100 : 0}%"></i></div><span class="xs">${m.pekerjaan_selesai}/${m.pekerjaan_total}</span></div></div>${isOwner() ? `<div class="num small right">${rp(bk[m.id] || 0)}</div>` : ''}</a>`).join('') : '<div class="muted small">Tidak ada unit.</div>'}</div></div>`).join('')}</div>`;
}

// ───────────────────── 4. TRANSAKSI ─────────────────────
const sisaTagihan = (j) => (j.harga_akhir || 0) - (j.pembayaran || []).reduce((a, b) => a + (b.jumlah || 0), 0);
const SEL_JUAL = '*, motor:motor_id(id,merk,tipe,tahun,kode_unit,nopol,warna), pelanggan:pelanggan_id(id,nama,hp,alamat), pembayaran(id,jumlah)';

// Pemilih cepat (dipakai tombol + di sudut layar)
async function pilihDari(judul, label, opsi, onPilih) {
  if (!opsi.length) { toast('Tidak ada pilihan yang tersedia.', 'err'); return; }
  formSheet(judul, [{ k: 'x', label, type: 'select', opts: opsi, req: true }], async (v) => { await onPilih(v.x); return true; }, { simpan: 'Lanjut' });
}
async function aksiCepat(a) {
  if (a === 'unitBaru') return formUnit(null);
  if (a === 'jual') { location.hash = '#/jual'; return; }
  if (a === 'pelanggan') return formPelanggan(null, () => { if (location.hash.startsWith('#/pelanggan')) route(); });
  if (a === 'keluar') return formPengeluaran(() => { if (location.hash.startsWith('#/pengeluaran')) route(); });
  if (a === 'bayar') {
    const l = (await q(sb.from('penjualan').select(SEL_JUAL).in('status', ['Booking', 'Proses Leasing']).order('created_at', { ascending: false }))) || [];
    return pilihDari('Tambah pembayaran', 'Pilih penjualan', l.map((j) => [j.id, `${nmMotor(j.motor)} — ${j.pelanggan.nama} (sisa ${rp(sisaTagihan(j))})`]), (id) => { const j = l.find((x) => x.id === id); formBayar(j, () => { location.hash = '#/penjualan/' + id; if (location.hash === '#/penjualan/' + id) route(); }); });
  }
  if (a === 'resto') {
    const l = (await q(sb.from('motor').select('id,merk,tipe,kode_unit,status').in('status', ['Masuk', 'Pemeriksaan', 'Restorasi', 'Ready']).order('created_at', { ascending: false }))) || [];
    return pilihDari('Pekerjaan restorasi', 'Pilih unit motor', l.map((m) => [m.id, `${m.kode_unit} — ${nmMotor(m)} (${m.status})`]), (id) => formPekerjaan({ id }, null, () => { location.hash = '#/unit/' + id + '/restorasi'; route(); }));
  }
}

// ── Hub transaksi ──
async function halTransaksi() {
  const p = shell('Transaksi', 'transaksi');
  const F = S.filterJual || (S.filterJual = { s: 'Semua' });
  const l = await q(sb.from('penjualan').select(SEL_JUAL).order('created_at', { ascending: false }).limit(200));
  if (!l) { p.innerHTML = kosong('error', 'Data belum dapat dimuat.'); return; }
  const aks = [['two_wheeler', 'Unit baru', 'unitBaru'], ['sell', 'Jual motor', 'jual'], ['payments', 'Pembayaran', 'bayar'], ...(isOwner() ? [['build', 'Restorasi', 'resto'], ['receipt', 'Pengeluaran', 'keluar'], ['person_add', 'Pelanggan', 'pelanggan']] : [])];
  p.innerHTML = `<div class="stack"><div class="grid cat">${aks.map((x) => `<button class="card" data-a="${x[2]}" style="text-align:left;display:flex;flex-direction:column;gap:6px;color:var(--text)">${ic(x[0], 'lg')}<b>${x[1]}</b></button>`).join('')}</div>
    <h2>Penjualan</h2><div class="chips" id="j-chips">${['Semua', 'Booking', 'Proses Leasing', 'Lunas', 'Batal'].map((s) => `<button class="chip ${F.s === s ? 'active' : ''}" data-s="${s}">${s}</button>`).join('')}</div><div class="list" id="j-list"></div></div>`;
  const gambar = () => {
    const d = l.filter((j) => F.s === 'Semua' || j.status === F.s);
    $('#j-list').innerHTML = d.length ? d.map((j) => `<a class="item" href="#/penjualan/${j.id}"><div class="grow"><div class="t">${esc(nmMotor(j.motor))} <span class="muted small">${esc(j.motor.tahun)}</span></div><div class="small muted">${esc(j.pelanggan.nama)} · ${tgl(j.tanggal_jual)}</div><div class="row wrap mt-s">${badge(j.status)}<span class="badge">${esc(j.skema)}</span></div></div>
      <div class="right"><div class="num" style="font-weight:700">${rp(j.harga_akhir)}</div>${j.status !== 'Batal' && sisaTagihan(j) > 0 ? `<div class="xs" style="color:var(--danger)">sisa ${rp(sisaTagihan(j))}</div>` : ''}</div></a>`).join('') : kosong('receipt_long', 'Belum ada penjualan.');
  };
  p.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) aksiCepat(b.dataset.a); const c = e.target.closest('[data-s]'); if (c) { F.s = c.dataset.s; $$('#j-chips .chip').forEach((x) => x.classList.toggle('active', x === c)); gambar(); } };
  gambar();
}

// ── Form penjualan ──
async function halJual(motorId) {
  await halTransaksi(); history.replaceState(null, '', '#/transaksi');
  const [mt, pl] = await Promise.all([q(sb.from('motor').select('id,merk,tipe,tahun,kode_unit,nopol,harga_jual').eq('status', 'Ready').order('tanggal_masuk')), q(sb.from('pelanggan').select('id,nama,hp').order('nama'))]);
  if (!mt) return;
  if (!mt.length) { toast('Belum ada motor berstatus Ready yang bisa dijual.', 'err'); return; }
  const awal = mt.find((m) => m.id === motorId) || mt[0];
  const F = [
    { k: 'motor_id', label: 'Motor (status Ready)', type: 'select', req: true, opts: mt.map((m) => [m.id, `${m.kode_unit} — ${nmMotor(m)} ${m.tahun} (${m.nopol})`]), val: awal.id },
    { k: 'pelanggan_id', label: 'Pelanggan', type: 'select', req: true, opts: [['', '— pilih pelanggan —'], ...(pl || []).map((c) => [c.id, c.nama + (c.hp ? ' · ' + c.hp : '')]), ['__baru', '+ Pelanggan baru…']], val: '' },
    { k: 'p_nama', label: 'Nama pelanggan baru', val: '' }, { k: 'p_hp', label: 'No. HP', val: '', inputmode: 'tel' }, { k: 'p_alamat', label: 'Alamat', val: '' },
    { k: 'tanggal_jual', label: 'Tanggal jual', type: 'date', req: true, val: hariIni() },
    { k: 'harga_jual', label: 'Harga jual (Rp)', type: 'rupiah', req: true, val: awal.harga_jual }, { k: 'diskon', label: 'Diskon (Rp)', type: 'rupiah', val: 0 },
    { k: 'skema', label: 'Skema pembayaran', type: 'select', opts: ['Tunai', 'Kredit Leasing'], val: 'Tunai' }, { k: 'nama_leasing', label: 'Nama leasing', val: '', ph: 'FIF, Adira, BAF…' },
    { k: 'sales', label: 'Sales', val: S.profile.nama }, { k: 'catatan', label: 'Catatan', type: 'textarea', val: '' },
    { html: '<h3 style="margin-top:8px">Pembayaran pertama (opsional)</h3><div class="hint xs muted">Kosongkan jika belum ada uang masuk. Status penjualan dihitung otomatis dari total pembayaran.</div>' },
    { k: 'b_jenis', label: 'Jenis', type: 'select', opts: ['DP', 'Pelunasan', 'Cicilan', 'Pencairan Leasing'], val: 'DP' }, { k: 'b_jumlah', label: 'Jumlah (Rp)', type: 'rupiah' }, { k: 'b_metode', label: 'Metode', type: 'select', opts: ['Tunai', 'Transfer', 'QRIS', 'Leasing'], val: 'Tunai' }
  ];
  formSheet('Jual motor', F, async (v) => {
    if (!v.pelanggan_id) { toast('Pilih pelanggan.', 'err'); return false; }
    if (!(v.harga_jual > 0)) { toast('Harga jual harus lebih dari 0.', 'err'); return false; }
    if ((v.diskon || 0) > v.harga_jual) { toast('Diskon tidak boleh melebihi harga jual.', 'err'); return false; }
    if (v.skema === 'Kredit Leasing' && !v.nama_leasing) { toast('Nama leasing wajib diisi untuk kredit.', 'err'); return false; }
    let pid = v.pelanggan_id;
    if (pid === '__baru') {
      if (!v.p_nama) { toast('Nama pelanggan baru wajib diisi.', 'err'); return false; }
      const c = await q(sb.from('pelanggan').insert({ nama: v.p_nama, hp: v.p_hp, alamat: v.p_alamat }).select('id').single()); if (!c) return false; pid = c.id;
    }
    const j = await q(sb.from('penjualan').insert({ motor_id: v.motor_id, pelanggan_id: pid, tanggal_jual: v.tanggal_jual, harga_jual: v.harga_jual, diskon: v.diskon || 0, skema: v.skema, nama_leasing: v.skema === 'Kredit Leasing' ? v.nama_leasing : null, sales: v.sales, catatan: v.catatan }).select('id').single());
    if (!j) return false;
    if (v.b_jumlah > 0) { if (!(await tulis(sb.from('pembayaran').insert({ penjualan_id: j.id, jenis: v.b_jenis, jumlah: v.b_jumlah, metode: v.b_metode, tanggal: v.tanggal_jual })))) toast('Penjualan tersimpan, tetapi pembayaran gagal dicatat.', 'err'); }
    ok('Penjualan tersimpan.'); location.hash = '#/penjualan/' + j.id; return true;
  }, { wide: true, onOpen: (sh, form) => {
    const g = (n) => $('[name=' + n + ']', form), vis = (n, on) => g(n).closest('.field').classList.toggle('hidden', !on);
    const t1 = () => ['p_nama', 'p_hp', 'p_alamat'].forEach((n) => vis(n, g('pelanggan_id').value === '__baru')); g('pelanggan_id').onchange = t1; t1();
    const t2 = () => vis('nama_leasing', g('skema').value === 'Kredit Leasing'); g('skema').onchange = t2; t2();
    g('motor_id').onchange = () => { const m = mt.find((x) => x.id === g('motor_id').value); g('harga_jual').value = m && m.harga_jual ? angka(m.harga_jual) : ''; };
  } });
}

// ── Detail penjualan ──
async function halPenjualan(id) {
  const p = shell('Penjualan', 'transaksi', { kembali: '#/transaksi' });
  const [j, bayar, dok] = await Promise.all([
    q(sb.from('penjualan').select('*, motor:motor_id(id,merk,tipe,tahun,kode_unit,nopol,warna), pelanggan:pelanggan_id(id,nama,hp,alamat)').eq('id', id).maybeSingle()),
    q(sb.from('pembayaran').select('*').eq('penjualan_id', id).order('tanggal').order('created_at')),
    q(sb.from('dokumen_transaksi').select('*').eq('penjualan_id', id).order('created_at', { ascending: false }))
  ]);
  if (!j) { p.innerHTML = kosong('search_off', 'Penjualan tidak ditemukan.'); return; }
  const total = (bayar || []).reduce((a, b) => a + b.jumlah, 0), sisa = j.harga_akhir - total, aktif = j.status !== 'Batal';
  const kv = (a, b, c) => `<div class="kv ${c || ''}"><span>${a}</span><span>${b == null || b === '' ? '—' : b}</span></div>`;
  p.innerHTML = `<div class="stack"><div class="row between"><div><h1>${esc(nmMotor(j.motor))}</h1><div class="muted small">${esc(j.motor.kode_unit)} · ${esc(j.motor.nopol)}</div></div>${badge(j.status)}</div>
    ${j.status === 'Proses Leasing' ? `<div class="alert info">${ic('info')}<div>Penjualan kredit leasing: motor tercatat <b>Terjual</b>. Catat <b>Pencairan Leasing</b> hingga lunas.</div></div>` : ''}
    ${j.status === 'Booking' ? `<div class="alert">${ic('schedule')}<div>Belum lunas — motor berstatus <b>Booking</b> sampai pembayaran penuh.</div></div>` : ''}
    <div class="card"><h3>Ringkasan</h3>${kv('Pelanggan', `${isOwner() ? '<a href="#/pelanggan">' + esc(j.pelanggan.nama) + '</a>' : esc(j.pelanggan.nama)}${j.pelanggan.hp ? ' · ' + esc(j.pelanggan.hp) : ''}`)}${kv('Tanggal jual', tgl(j.tanggal_jual))}${kv('Skema', esc(j.skema) + (j.nama_leasing ? ' — ' + esc(j.nama_leasing) : ''))}${kv('Sales', esc(j.sales))}
      ${kv('Harga jual', '<span class="num">' + rp(j.harga_jual) + '</span>')}${j.diskon ? kv('Diskon', '<span class="num">− ' + rp(j.diskon) + '</span>') : ''}${kv('Harga akhir', '<span class="num">' + rp(j.harga_akhir) + '</span>', 'total')}${kv('Sudah dibayar', '<span class="num">' + rp(total) + '</span>')}${aktif ? kv('Sisa tagihan', `<b class="num" style="color:${sisa > 0 ? 'var(--danger)' : 'var(--ok)'}">${rp(sisa)}</b>`) : ''}
      ${j.catatan ? `<p class="small muted" style="white-space:pre-line">${esc(j.catatan)}</p>` : ''}<div class="progress mt-s"><i style="width:${Math.min(100, total / j.harga_akhir * 100)}%"></i></div></div>
    <div class="card"><div class="row between"><h3>Pembayaran</h3>${aktif && sisa > 0 ? `<button class="btn accent sm" data-a="bayar">${ic('add', 'sm')} Tambah</button>` : ''}</div>
      ${bayar && bayar.length ? `<div class="list mt-s">${bayar.map((b) => `<div class="card flat"><div class="row between"><div><b>${esc(b.jenis)}</b> <span class="muted small">· ${esc(b.metode)}</span><div class="xs muted">${tgl(b.tanggal)}${b.catatan ? ' · ' + esc(b.catatan) : ''}</div></div><div class="num" style="font-weight:700">${rp(b.jumlah)}</div></div>
        <div class="row wrap mt-s">${b.bukti_path ? `<button class="btn ghost sm" data-bukti="${esc(b.bukti_path)}">${ic('receipt', 'sm')} Bukti</button>` : ''}<button class="btn ghost sm" data-kw="${b.id}">${ic('description', 'sm')} Buat kuitansi</button></div></div>`).join('')}</div>` : '<p class="muted small">Belum ada pembayaran.</p>'}</div>
    <div class="card"><div class="row between"><h3>Dokumen</h3>${aktif ? `<button class="btn ghost sm" data-a="sjb">${ic('gavel', 'sm')} Surat jual-beli</button>` : ''}</div>
      ${dok && dok.length ? `<div class="list mt-s">${dok.map((d) => `<button class="item" data-pdf="${esc(d.path_pdf)}" data-nomor="${esc(d.nomor_dokumen)}">${ic('picture_as_pdf')}<div class="grow"><b>${esc(d.jenis)}</b><div class="xs muted">${esc(d.nomor_dokumen)} · ${tglWaktu(d.created_at)}</div></div>${ic('chevron_right')}</button>`).join('')}</div>` : '<p class="muted small">Belum ada dokumen dibuat.</p>'}</div>
    ${isOwner() && aktif ? `<div class="right"><button class="btn danger sm" data-a="batal">${ic('block', 'sm')} Batalkan penjualan</button></div>` : ''}</div>`;
  p.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'bayar') formBayar({ ...j, pembayaran: bayar }, () => halPenjualan(id));
    else if (b.dataset.bukti) pratinjau('motor-privat', b.dataset.bukti, 'Bukti pembayaran');
    else if (b.dataset.pdf) pratinjau('dokumen-pdf', b.dataset.pdf, b.dataset.nomor);
    else if (b.dataset.kw) buatPdf(b, { jenis: 'Kuitansi', penjualan_id: id, pembayaran_id: b.dataset.kw }, () => halPenjualan(id));
    else if (b.dataset.a === 'sjb') buatPdf(b, { jenis: 'Surat Jual-Beli', penjualan_id: id }, () => halPenjualan(id));
    else if (b.dataset.a === 'batal') {
      if (!(await konfirmasi('Batalkan penjualan?', 'Penjualan ditandai Batal dan motor kembali berstatus Ready. Riwayat pembayaran tetap tersimpan. Tindakan ini tidak dapat dibatalkan.', 'Batalkan penjualan', true))) return;
      if (await tulis(sb.from('penjualan').update({ status: 'Batal' }).eq('id', id), 'Penjualan dibatalkan.')) halPenjualan(id);
    }
  };
}

// Panggil Edge Function pembuat PDF
async function buatPdf(btn, body, selesai) {
  await sibuk(btn, async () => {
    const { data, error } = await sb.functions.invoke('buat-dokumen-pdf', { body });
    if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.pesan) m = j.pesan; } catch (e) {} return gagal(new Error(m)); }
    ok('Dokumen ' + data.nomor + ' dibuat.'); await selesai(); pratinjau('dokumen-pdf', data.path, data.nomor);
  });
}

// ── Form pembayaran ──
function formBayar(j, selesai) {
  const sisa = sisaTagihan(j);
  const F = [{ k: 'jenis', label: 'Jenis pembayaran', type: 'select', opts: ['DP', 'Cicilan', 'Pelunasan', 'Pencairan Leasing'], val: j.skema === 'Kredit Leasing' ? 'Pencairan Leasing' : 'Pelunasan' },
    { k: 'jumlah', label: 'Jumlah (Rp)', type: 'rupiah', req: true, val: sisa > 0 ? sisa : null, hint: `Sisa tagihan ${rp(sisa)}` }, { k: 'metode', label: 'Metode', type: 'select', opts: ['Tunai', 'Transfer', 'QRIS', 'Leasing'], val: j.skema === 'Kredit Leasing' ? 'Leasing' : 'Tunai' },
    { k: 'tanggal', label: 'Tanggal', type: 'date', req: true, val: hariIni() }, { k: 'catatan', label: 'Catatan', val: '' },
    { html: '<div class="field"><label for="b-file">Bukti pembayaran (opsional)</label><input type="file" id="b-file" accept="image/*,application/pdf"></div>' }];
  formSheet('Tambah pembayaran', F, async (v, sh) => {
    if (!(v.jumlah > 0)) { toast('Jumlah harus lebih dari 0.', 'err'); return false; }
    if (v.jumlah > sisa) { toast(`Jumlah melebihi sisa tagihan (${rp(sisa)}).`, 'err'); return false; }
    let path = null; const f = $('#b-file', sh.el).files[0];
    if (f) { path = await unggah('motor-privat', `bayar/${j.id}/${Date.now()}.${ekst(f)}`, f); if (!path) return false; }
    if (!(await tulis(sb.from('pembayaran').insert({ penjualan_id: j.id, jenis: v.jenis, jumlah: v.jumlah, metode: v.metode, tanggal: v.tanggal, catatan: v.catatan, bukti_path: path }), 'Pembayaran dicatat.'))) return false;
    selesai(); return true;
  });
}

// ───────────── 5. PELANGGAN · PENGELUARAN · DOKUMEN · LAPORAN ─────────────
// ── Pelanggan ──
function formPelanggan(c, selesai) {
  formSheet(c ? 'Ubah pelanggan' : 'Pelanggan baru', [{ k: 'nama', label: 'Nama', req: true, val: c && c.nama }, { k: 'hp', label: 'No. HP / WhatsApp', val: c && c.hp, inputmode: 'tel' }, { k: 'alamat', label: 'Alamat', type: 'textarea', val: c && c.alamat }, { k: 'catatan', label: 'Catatan', type: 'textarea', val: c && c.catatan }], async (v) => {
    if (!(await tulis(c ? sb.from('pelanggan').update(v).eq('id', c.id) : sb.from('pelanggan').insert(v), 'Pelanggan disimpan.'))) return false;
    if (selesai) selesai(); return true;
  });
}
async function halPelanggan() {
  const p = shell('Pelanggan', 'pelanggan', { aksi: `<button class="btn accent sm" id="pl-baru">${ic('add', 'sm')} Baru</button>` });
  const l = await q(sb.from('pelanggan').select('*').order('nama'));
  if (!l) { p.innerHTML = kosong('error', 'Data belum dapat dimuat.'); return; }
  p.innerHTML = `<div class="stack"><div class="search">${ic('search')}<input id="pl-cari" type="search" placeholder="Cari nama atau no. HP…"></div><div class="list" id="pl-list"></div></div>`;
  const gambar = () => { const c = $('#pl-cari').value.toLowerCase().trim(); const d = l.filter((x) => !c || (x.nama + ' ' + (x.hp || '')).toLowerCase().includes(c));
    $('#pl-list').innerHTML = d.length ? d.map((x) => `<button class="item" data-id="${x.id}"><div class="thumb" style="border-radius:50%">${ic('person')}</div><div class="grow"><div class="t">${esc(x.nama)}</div><div class="small muted">${esc(x.hp || 'Tanpa nomor HP')}</div></div>${ic('chevron_right')}</button>`).join('') : kosong('group', l.length ? 'Tidak ditemukan.' : 'Belum ada pelanggan.'); };
  $('#pl-cari').oninput = gambar; gambar();
  $('#pl-baru').onclick = () => formPelanggan(null, halPelanggan);
  $('#pl-list').onclick = async (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return; const c = l.find((x) => x.id === b.dataset.id);
    const js = (await q(sb.from('penjualan').select('id,tanggal_jual,harga_akhir,status,motor:motor_id(merk,tipe,tahun)').eq('pelanggan_id', c.id).order('tanggal_jual', { ascending: false }))) || [];
    const sh = sheet(c.nama, `<div class="stack"><div class="card flat">${c.hp ? `<div class="kv"><span>HP</span><span>${esc(c.hp)}</span></div>` : ''}${c.alamat ? `<div class="kv"><span>Alamat</span><span>${esc(c.alamat)}</span></div>` : ''}${c.catatan ? `<div class="kv"><span>Catatan</span><span>${esc(c.catatan)}</span></div>` : ''}</div>
      <h3>Riwayat pembelian</h3>${js.length ? `<div class="list">${js.map((j) => `<a class="item" href="#/penjualan/${j.id}" data-close><div class="grow"><b>${esc(nmMotor(j.motor))} ${esc(j.motor.tahun)}</b><div class="xs muted">${tgl(j.tanggal_jual)}</div></div><div class="right num small">${rp(j.harga_akhir)}<br>${badge(j.status)}</div></a>`).join('')}</div>` : '<p class="muted small">Belum pernah membeli.</p>'}</div>`,
      { noFocus: true, footer: `${c.hp ? `<a class="btn wa" href="${esc(waLink(c.hp))}" target="_blank" rel="noopener">${ic('chat', 'sm')} WhatsApp</a>` : ''}<button class="btn ghost" data-e>Ubah</button>${isOwner() ? '<button class="btn danger" data-d>Hapus</button>' : ''}` });
    sh.el.onclick = (ev) => { if (ev.target.closest('[data-close]')) sh.close(); };
    $('[data-e]', sh.el).onclick = () => { sh.close(); formPelanggan(c, halPelanggan); };
    const d = $('[data-d]', sh.el); if (d) d.onclick = async () => { if (!(await konfirmasi('Hapus pelanggan?', 'Pelanggan yang sudah pernah membeli tidak dapat dihapus.', 'Hapus', true))) return; sh.close(); if (await tulis(sb.from('pelanggan').delete().eq('id', c.id), 'Pelanggan dihapus.')) halPelanggan(); };
  };
}

// ── Pengeluaran operasional ──
const KAT_KELUAR = ['Listrik', 'Sewa', 'Iklan', 'Transport', 'Lainnya'];
function formPengeluaran(selesai) {
  formSheet('Catat pengeluaran', [{ k: 'kategori', label: 'Kategori', type: 'select', opts: KAT_KELUAR, val: 'Listrik' }, { k: 'tanggal', label: 'Tanggal', type: 'date', req: true, val: hariIni() }, { k: 'jumlah', label: 'Jumlah (Rp)', type: 'rupiah', req: true }, { k: 'deskripsi', label: 'Keterangan', val: '' },
    { html: '<div class="field"><label for="k-file">Bukti / nota (opsional)</label><input type="file" id="k-file" accept="image/*,application/pdf"></div>' }], async (v, sh) => {
    if (!(v.jumlah > 0)) { toast('Jumlah harus lebih dari 0.', 'err'); return false; }
    let path = null; const f = $('#k-file', sh.el).files[0];
    if (f) { path = await unggah('motor-privat', `keluar/${S.profile.id}/${Date.now()}.${ekst(f)}`, f); if (!path) return false; }
    if (!(await tulis(sb.from('pengeluaran_operasional').insert({ kategori: v.kategori, tanggal: v.tanggal, jumlah: v.jumlah, deskripsi: v.deskripsi, bukti_path: path }), 'Pengeluaran dicatat.'))) return false;
    if (selesai) selesai(); return true;
  });
}
async function halPengeluaran() {
  const p = shell('Pengeluaran', 'pengeluaran', { aksi: `<button class="btn accent sm" id="pg-baru">${ic('add', 'sm')} Catat</button>` });
  const bulan = S.bulanKeluar || hariIni().slice(0, 7); S.bulanKeluar = bulan;
  const dari = bulan + '-01', [y, m] = bulan.split('-').map(Number), sampai = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const l = await q(isOwner() ? sb.from('pengeluaran_operasional').select('*') .gte('tanggal', dari).lte('tanggal', sampai).order('tanggal', { ascending: false }) : sb.from('v_pengeluaran_ringkas').select('*').gte('tanggal', dari).lte('tanggal', sampai).order('tanggal', { ascending: false }));
  if (!l) { p.innerHTML = kosong('error', 'Data belum dapat dimuat.'); return; }
  const total = l.reduce((a, x) => a + (x.jumlah || 0), 0), per = {}; l.forEach((x) => per[x.kategori] = (per[x.kategori] || 0) + (x.jumlah || 0));
  p.innerHTML = `<div class="stack"><div class="field"><label for="pg-bln">Bulan</label><input type="month" id="pg-bln" value="${bulan}"></div>
    ${isOwner() ? `<div class="card"><div class="label muted small">Total pengeluaran</div><div class="num" style="font-size:24px;font-weight:800">${rp(total)}</div><div class="row wrap mt-s">${Object.entries(per).map(([k, v]) => `<span class="badge">${esc(k)} ${rp(v)}</span>`).join('')}</div></div>` : `<div class="alert info">${ic('info')}<div>Nominal pengeluaran hanya dapat dilihat pemilik. Anda tetap dapat mencatat pengeluaran baru.</div></div>`}
    <div class="list">${l.length ? l.map((x) => `<div class="item"><div class="thumb">${ic('receipt_long')}</div><div class="grow"><div class="t">${esc(x.kategori)}</div><div class="small muted">${esc(x.deskripsi || '—')} · ${tgl(x.tanggal)}</div></div><div class="right">${isOwner() ? `<div class="num" style="font-weight:700">${rp(x.jumlah)}</div>` : ''}<div class="row" style="justify-content:flex-end">${x.bukti_path && isOwner() ? `<button class="icon-btn" data-b="${esc(x.bukti_path)}" aria-label="Lihat bukti">${ic('attach_file', 'sm')}</button>` : ''}${isOwner() ? `<button class="icon-btn" data-del="${x.id}" aria-label="Hapus">${ic('delete', 'sm')}</button>` : ''}</div></div></div>`).join('') : kosong('receipt_long', 'Belum ada pengeluaran pada bulan ini.')}</div></div>`;
  $('#pg-bln').onchange = (e) => { S.bulanKeluar = e.target.value || bulan; halPengeluaran(); };
  $('#pg-baru').onclick = () => formPengeluaran(halPengeluaran);
  p.onclick = async (e) => { const b = e.target.closest('[data-b]'), d = e.target.closest('[data-del]'); if (b) pratinjau('motor-privat', b.dataset.b, 'Bukti pengeluaran'); if (d && (await konfirmasi('Hapus pengeluaran?', 'Catatan pengeluaran ini akan dihapus.', 'Hapus', true))) { if (await tulis(sb.from('pengeluaran_operasional').delete().eq('id', d.dataset.del), 'Dihapus.')) halPengeluaran(); } };
}

// ── Dokumen transaksi ──
async function halDokumen() {
  const p = shell('Dokumen', 'dokumen');
  const l = await q(sb.from('dokumen_transaksi').select('*, penjualan:penjualan_id(id, motor:motor_id(merk,tipe,tahun), pelanggan:pelanggan_id(nama))').order('created_at', { ascending: false }).limit(200));
  if (!l) { p.innerHTML = kosong('error', 'Data belum dapat dimuat.'); return; }
  p.innerHTML = `<div class="stack"><div class="alert info">${ic('info')}<div>Kuitansi dan surat jual-beli dibuat dari halaman <b>detail penjualan</b>.</div></div><div class="list">${l.length ? l.map((d) => `<button class="item" data-pdf="${esc(d.path_pdf)}" data-n="${esc(d.nomor_dokumen)}">${ic('picture_as_pdf', 'lg')}<div class="grow"><div class="t">${esc(d.nomor_dokumen)}</div><div class="small muted">${esc(d.jenis)} · ${d.penjualan ? esc(nmMotor(d.penjualan.motor)) + ' — ' + esc(d.penjualan.pelanggan.nama) : ''}</div><div class="xs muted">${tglWaktu(d.created_at)}</div></div>${ic('chevron_right')}</button>`).join('') : kosong('description', 'Belum ada dokumen.')}</div></div>`;
  p.onclick = (e) => { const b = e.target.closest('[data-pdf]'); if (b) pratinjau('dokumen-pdf', b.dataset.pdf, b.dataset.n); };
}

// ── Laporan ──
const Rp = (v) => rp(v), Tg = (v) => tgl(v);
const LAPORAN = [
  { id: 'stok', t: 'Stok motor aktif', i: 'inventory_2', run: async () => { const d = await q(sb.from('v_motor_ringkas').select('*').neq('status', 'Terjual').order('tanggal_masuk')); return d && { cols: [{ h: 'Kode', k: 'kode_unit' }, { h: 'Motor', f: (r) => nmMotor(r) }, { h: 'Tahun', k: 'tahun' }, { h: 'Nopol', k: 'nopol' }, { h: 'Status', k: 'status' }, { h: 'Hari', k: 'hari_tersimpan', n: 1 }, { h: 'Harga jual', k: 'harga_jual', f: (r) => rp(r.harga_jual), n: 1, sum: 1 }], rows: d }; } },
  { id: 'status', t: 'Rekap per status', i: 'donut_small', run: async () => { const d = await q(sb.from('v_motor_ringkas').select('status')); if (!d) return null; const c = {}; d.forEach((x) => c[x.status] = (c[x.status] || 0) + 1); return { cols: [{ h: 'Status', k: 'status' }, { h: 'Jumlah unit', k: 'n', n: 1, sum: 1 }], rows: STATUS_MOTOR.map((s) => ({ status: s, n: c[s] || 0 })) }; } },
  { id: 'jual', t: 'Penjualan', i: 'sell', periode: true, run: async (a, b) => { const d = await q(sb.from('penjualan').select('tanggal_jual,skema,harga_akhir,status,motor:motor_id(merk,tipe,tahun),pelanggan:pelanggan_id(nama)').gte('tanggal_jual', a).lte('tanggal_jual', b).order('tanggal_jual')); return d && { cols: [{ h: 'Tanggal', f: (r) => tgl(r.tanggal_jual) }, { h: 'Motor', f: (r) => nmMotor(r.motor) + ' ' + r.motor.tahun }, { h: 'Pelanggan', f: (r) => r.pelanggan.nama }, { h: 'Skema', k: 'skema' }, { h: 'Status', k: 'status' }, { h: 'Harga akhir', f: (r) => rp(r.harga_akhir), v: (r) => (r.status === 'Batal' ? 0 : r.harga_akhir), n: 1, sum: 1 }], rows: d }; } },
  { id: 'piutang', t: 'Sisa tagihan (belum lunas)', i: 'hourglass_top', run: async () => { const d = await q(sb.from('penjualan').select('tanggal_jual,harga_akhir,status,motor:motor_id(merk,tipe),pelanggan:pelanggan_id(nama,hp),pembayaran(jumlah)').in('status', ['Booking', 'Proses Leasing']).order('tanggal_jual')); return d && { cols: [{ h: 'Tanggal', f: (r) => tgl(r.tanggal_jual) }, { h: 'Motor', f: (r) => nmMotor(r.motor) }, { h: 'Pelanggan', f: (r) => r.pelanggan.nama + (r.pelanggan.hp ? ' (' + r.pelanggan.hp + ')' : '') }, { h: 'Status', k: 'status' }, { h: 'Harga akhir', f: (r) => rp(r.harga_akhir), v: (r) => r.harga_akhir, n: 1 }, { h: 'Sisa', f: (r) => rp(sisaTagihan(r)), v: (r) => sisaTagihan(r), n: 1, sum: 1 }], rows: d }; } },
  { id: 'simpan', t: 'Lama simpan unit', i: 'schedule', run: async () => { const d = await q(sb.from('v_motor_ringkas').select('*').neq('status', 'Terjual').order('hari_tersimpan', { ascending: false })); return d && { cols: [{ h: 'Kode', k: 'kode_unit' }, { h: 'Motor', f: (r) => nmMotor(r) }, { h: 'Status', k: 'status' }, { h: 'Tanggal masuk', f: (r) => tgl(r.tanggal_masuk) }, { h: 'Lama (hari)', k: 'hari_tersimpan', n: 1 }], rows: d }; } },
  { id: 'resto', t: 'Restorasi per unit', i: 'build', run: async () => { const [d, k] = await Promise.all([q(sb.from('v_motor_ringkas').select('*').gt('pekerjaan_total', 0).order('tanggal_masuk')), isOwner() ? q(sb.from('v_motor_keuangan').select('motor_id,biaya_restorasi')) : null]); if (!d) return null; const bk = {}; (k || []).forEach((x) => bk[x.motor_id] = x.biaya_restorasi); const cols = [{ h: 'Kode', k: 'kode_unit' }, { h: 'Motor', f: (r) => nmMotor(r) }, { h: 'Status', k: 'status' }, { h: 'Pekerjaan selesai', f: (r) => r.pekerjaan_selesai + '/' + r.pekerjaan_total }]; if (isOwner()) cols.push({ h: 'Biaya restorasi', f: (r) => rp(bk[r.id] || 0), v: (r) => bk[r.id] || 0, n: 1, sum: 1 }); return { cols, rows: d }; } },
  { id: 'beli', t: 'Pembelian unit', i: 'shopping_cart', owner: true, periode: true, run: async (a, b) => { const d = await q(sb.from('pembelian').select('*, motor:motor_id(merk,tipe,tahun,kode_unit)').gte('tanggal_beli', a).lte('tanggal_beli', b).order('tanggal_beli')); return d && { cols: [{ h: 'Tanggal', f: (r) => tgl(r.tanggal_beli) }, { h: 'Unit', f: (r) => r.motor.kode_unit + ' ' + nmMotor(r.motor) }, { h: 'Metode', k: 'metode_pembayaran' }, { h: 'Harga beli', f: (r) => rp(r.harga_beli), v: (r) => r.harga_beli, n: 1, sum: 1 }, { h: 'Biaya lain', f: (r) => rp(r.biaya_transport + r.biaya_administrasi + r.biaya_lain), v: (r) => r.biaya_transport + r.biaya_administrasi + r.biaya_lain, n: 1, sum: 1 }], rows: d }; } },
  { id: 'laba', t: 'Laba per unit terjual', i: 'trending_up', owner: true, periode: true, run: async (a, b) => { const d = await q(sb.from('v_motor_keuangan').select('*').in('status_penjualan', ['Lunas', 'Proses Leasing']).gte('tanggal_jual', a).lte('tanggal_jual', b).order('tanggal_jual')); return d && { cols: [{ h: 'Tgl jual', f: (r) => tgl(r.tanggal_jual) }, { h: 'Unit', f: (r) => r.kode_unit + ' ' + nmMotor(r) }, { h: 'Modal', f: (r) => rp(r.total_modal), v: (r) => r.total_modal, n: 1, sum: 1 }, { h: 'Harga akhir', f: (r) => rp(r.harga_akhir), v: (r) => r.harga_akhir, n: 1, sum: 1 }, { h: 'Untung', f: (r) => rp(r.untung_aktual), v: (r) => r.untung_aktual, n: 1, sum: 1 }], rows: d }; } },
  { id: 'keluar', t: 'Pengeluaran operasional', i: 'receipt_long', owner: true, periode: true, run: async (a, b) => { const d = await q(sb.from('pengeluaran_operasional').select('*').gte('tanggal', a).lte('tanggal', b).order('tanggal')); return d && { cols: [{ h: 'Tanggal', f: (r) => tgl(r.tanggal) }, { h: 'Kategori', k: 'kategori' }, { h: 'Keterangan', k: 'deskripsi' }, { h: 'Jumlah', f: (r) => rp(r.jumlah), v: (r) => r.jumlah, n: 1, sum: 1 }], rows: d }; } }
];
const selCol = (c, r) => (c.f ? c.f(r) : (r[c.k] == null ? '—' : r[c.k]));
const nilaiCol = (c, r) => (c.v ? c.v(r) : r[c.k]) || 0;

async function halLaporan() {
  const p = shell('Laporan', 'laporan');
  const daftar = LAPORAN.filter((r) => !r.owner || isOwner());
  p.innerHTML = `<div class="stack"><div class="grid cat">${daftar.map((r) => `<button class="card" data-r="${r.id}" style="text-align:left;display:flex;flex-direction:column;gap:6px;color:var(--text)">${ic(r.i, 'lg')}<b>${esc(r.t)}</b>${r.periode ? '<span class="xs muted">per periode</span>' : ''}</button>`).join('')}</div>${!isOwner() ? '<div class="alert info">' + ic('info') + '<div>Laporan keuangan (pembelian, laba, pengeluaran) hanya tersedia untuk pemilik.</div></div>' : ''}</div>`;
  p.onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) laporanSheet(LAPORAN.find((r) => r.id === b.dataset.r)); };
}
function laporanSheet(R) {
  const dari = awalBulan(), sampai = hariIni();
  const sh = sheet(R.t, `${R.periode ? `<div class="row wrap mb"><div class="field grow"><label>Dari</label><input type="date" id="lp-a" value="${dari}"></div><div class="field grow"><label>Sampai</label><input type="date" id="lp-b" value="${sampai}"></div></div>` : ''}<div id="lp-isi">${loading(2)}</div>`, { wide: true, noFocus: true, footer: `<button class="btn ghost" data-csv>${ic('table', 'sm')} CSV</button><button class="btn accent" data-pdf>${ic('picture_as_pdf', 'sm')} Unduh PDF</button>` });
  let hasil = null;
  const muat = async () => {
    $('#lp-isi', sh.el).innerHTML = loading(2);
    const a = R.periode ? $('#lp-a', sh.el).value : null, b = R.periode ? $('#lp-b', sh.el).value : null;
    hasil = await R.run(a, b); if (!hasil) { $('#lp-isi', sh.el).innerHTML = kosong('error', 'Laporan gagal dimuat.'); return; }
    const sums = hasil.cols.map((c) => c.sum ? hasil.rows.reduce((t, r) => t + (Number(nilaiCol(c, r)) || 0), 0) : null);
    const fmtSum = (c, v) => (c.h === 'Jumlah unit' ? angka(v) : rp(v));
    hasil.sums = sums; hasil.sumTxt = hasil.cols.map((c, i) => (sums[i] == null ? '' : fmtSum(c, sums[i])));
    $('#lp-isi', sh.el).innerHTML = hasil.rows.length ? `<div class="tbl-wrap"><table><thead><tr>${hasil.cols.map((c) => `<th class="${c.n ? 'n' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${hasil.rows.map((r) => `<tr>${hasil.cols.map((c) => `<td class="${c.n ? 'n' : ''}">${esc(selCol(c, r))}</td>`).join('')}</tr>`).join('')}</tbody>${sums.some((s) => s != null) ? `<tfoot><tr>${hasil.cols.map((c, i) => `<th class="${c.n ? 'n' : ''}">${i === 0 ? 'Total' : esc(hasil.sumTxt[i])}</th>`).join('')}</tr></tfoot>` : ''}</table></div><p class="xs muted">${hasil.rows.length} baris</p>` : kosong('inbox', 'Tidak ada data pada periode ini.');
  };
  if (R.periode) { $('#lp-a', sh.el).onchange = muat; $('#lp-b', sh.el).onchange = muat; }
  muat();
  const nama = () => 'laporan-' + R.id + '-' + hariIni();
  $('[data-csv]', sh.el).onclick = () => { if (!hasil || !hasil.rows.length) return toast('Tidak ada data.', 'err'); const baris = [hasil.cols.map((c) => c.h), ...hasil.rows.map((r) => hasil.cols.map((c) => selCol(c, r)))]; unduhBerkas(nama() + '.csv', '﻿' + baris.map((b) => b.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n'), 'text/csv;charset=utf-8'); };
  $('[data-pdf]', sh.el).onclick = () => {
    if (!hasil || !hasil.rows.length) return toast('Tidak ada data.', 'err');
    if (!window.jspdf) return toast('Pustaka PDF belum termuat. Periksa koneksi internet.', 'err');
    const doc = new window.jspdf.jsPDF({ orientation: hasil.cols.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const nm = (S.usaha && S.usaha.nama_usaha) || 'Showroom Motor';
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(nm, 40, 40); doc.setFontSize(11); doc.text(R.t, 40, 58); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text((R.periode ? 'Periode ' + tgl($('#lp-a', sh.el).value) + ' s.d. ' + tgl($('#lp-b', sh.el).value) + ' · ' : '') + 'Dicetak ' + tglWaktu(new Date().toISOString()), 40, 72);
    const kosongPdf = (x) => String(x).replace(/—/g, '-');
    doc.autoTable({ startY: 84, head: [hasil.cols.map((c) => c.h)], body: hasil.rows.map((r) => hasil.cols.map((c) => kosongPdf(selCol(c, r)))), foot: hasil.sums.some((s) => s != null) ? [hasil.cols.map((c, i) => (i === 0 ? 'Total' : hasil.sumTxt[i]))] : undefined,
      styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [20, 40, 75] }, footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' }, columnStyles: Object.fromEntries(hasil.cols.map((c, i) => [i, c.n ? { halign: 'right' } : {}])) });
    doc.save(nama() + '.pdf');
  };
}

// ───────────────────── 6. PENGGUNA · LOG · PENGATURAN ─────────────────────
async function panggilFn(nama, body) {
  const { data, error } = await sb.functions.invoke(nama, { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.pesan) m = j.pesan; } catch (e) {} gagal(new Error(m)); return null; }
  return data;
}

// ── Pengguna (owner) ──
async function halUser() {
  const p = shell('Pengguna', 'user', { aksi: `<button class="btn accent sm" id="us-baru">${ic('person_add', 'sm')} Tambah</button>` });
  const d = await panggilFn('kelola-user', { aksi: 'list' });
  if (!d) { p.innerHTML = kosong('error', 'Daftar pengguna belum dapat dimuat. Pastikan Edge Function kelola-user sudah di-deploy.'); return; }
  const l = d.users || [];
  p.innerHTML = `<div class="stack"><div class="alert info">${ic('info')}<div><b>Owner</b> punya akses penuh. <b>Admin</b> hanya dapat mencatat & melihat data operasional, tanpa angka keuangan.</div></div><div class="list">${l.map((u) => `<button class="item" data-id="${u.id}"><div class="thumb" style="border-radius:50%">${ic(u.role === 'owner' ? 'shield_person' : 'person')}</div><div class="grow"><div class="t">${esc(u.nama || u.email)}</div><div class="small muted">${esc(u.email)}</div><div class="row mt-s">${badge(u.role === 'owner' ? 'Owner' : 'Admin').replace('badge ', 'badge ' + (u.role === 'owner' ? 'Booking ' : 'Masuk '))}${u.aktif ? '' : '<span class="badge bad">Nonaktif</span>'}</div></div>${ic('chevron_right')}</button>`).join('')}</div></div>`;
  $('#us-baru').onclick = () => formSheet('Tambah pengguna', [{ k: 'email', label: 'Email', type: 'email', req: true }, { k: 'nama', label: 'Nama', req: true }, { k: 'password', label: 'Kata sandi awal (min. 8 karakter)', type: 'text', req: true }, { k: 'role', label: 'Peran', type: 'select', opts: [['admin', 'Admin'], ['owner', 'Owner']], val: 'admin' }], async (v) => {
    if (v.password.length < 8) { toast('Kata sandi minimal 8 karakter.', 'err'); return false; }
    const r = await panggilFn('kelola-user', { aksi: 'buat', ...v }); if (!r) return false; ok('Pengguna dibuat.'); halUser(); return true;
  });
  p.onclick = (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return; const u = l.find((x) => x.id === b.dataset.id), diri = u.id === S.profile.id;
    const sh = sheet(u.nama || u.email, `<div class="stack"><div class="card flat"><div class="kv"><span>Email</span><span>${esc(u.email)}</span></div><div class="kv"><span>Peran</span><span>${esc(u.role)}</span></div><div class="kv"><span>Terakhir masuk</span><span>${u.last_sign_in_at ? tglWaktu(u.last_sign_in_at) : '—'}</span></div></div>
      <div class="field"><label>Nama</label><input id="us-nama" value="${esc(u.nama)}"></div>${diri ? '' : `<div class="field"><label>Peran</label><select id="us-role"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option><option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option></select></div>`}</div>`,
      { noFocus: true, footer: `<button class="btn" data-s>Simpan</button><button class="btn ghost" data-r>Reset sandi</button>${diri ? '' : `<button class="btn danger" data-a>${u.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>`}` });
    $('[data-s]', sh.el).onclick = async (ev) => { const r = await sibuk(ev.target, () => panggilFn('kelola-user', { aksi: 'ubah', id: u.id, nama: $('#us-nama', sh.el).value.trim(), role: diri ? u.role : $('#us-role', sh.el).value })); if (r) { sh.close(); ok('Disimpan.'); halUser(); } };
    $('[data-r]', sh.el).onclick = () => { sh.close(); formSheet('Reset kata sandi', [{ k: 'password', label: 'Kata sandi baru (min. 8 karakter)', type: 'text', req: true }], async (v) => { if (v.password.length < 8) { toast('Minimal 8 karakter.', 'err'); return false; } const r = await panggilFn('kelola-user', { aksi: 'reset', id: u.id, password: v.password }); if (!r) return false; ok('Kata sandi diganti.'); return true; }); };
    const a = $('[data-a]', sh.el); if (a) a.onclick = async () => { if (!(await konfirmasi(u.aktif ? 'Nonaktifkan akun?' : 'Aktifkan akun?', u.aktif ? 'Pengguna tidak dapat masuk lagi sampai diaktifkan kembali.' : 'Pengguna dapat masuk kembali.', 'Ya', u.aktif))) return; const r = await panggilFn('kelola-user', { aksi: 'aktif', id: u.id, aktif: !u.aktif }); if (r) { sh.close(); halUser(); } };
  };
}

// ── Log aktivitas (owner) ──
async function halLog() {
  const p = shell('Log Aktivitas', 'log'); const F = S.logF || (S.logF = { tabel: '', n: 50 });
  let qy = sb.from('activity_log').select('*, user:user_id(nama)').order('waktu', { ascending: false }).limit(F.n); if (F.tabel) qy = qy.eq('tabel', F.tabel);
  const l = await q(qy); if (!l) { p.innerHTML = kosong('error', 'Log belum dapat dimuat.'); return; }
  const ikon = { INSERT: 'add_circle', UPDATE: 'edit', DELETE: 'delete', LOGIN: 'login' };
  p.innerHTML = `<div class="stack"><div class="field"><label>Tabel</label><select id="lg-t"><option value="">Semua</option>${['motor', 'pembelian', 'penjualan', 'pembayaran', 'reparasi', 'reparasi_biaya', 'pelanggan', 'pengeluaran_operasional', 'profiles', 'pengaturan', 'auth'].map((t) => `<option ${F.tabel === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="list">${l.length ? l.map((x) => `<button class="item" data-id="${x.id}">${ic(ikon[x.aksi] || 'circle')}<div class="grow"><div class="small"><b>${esc(x.aksi)}</b> ${esc(x.tabel || '')}</div><div class="xs muted">${esc(x.ringkasan || '')}</div><div class="xs muted">${tglWaktu(x.waktu)} · ${esc((x.user && x.user.nama) || 'sistem')}</div></div></button>`).join('') : kosong('history', 'Belum ada aktivitas.')}</div>${l.length >= F.n ? '<button class="btn ghost block" id="lg-more">Muat lebih banyak</button>' : ''}</div>`;
  $('#lg-t').onchange = (e) => { F.tabel = e.target.value; F.n = 50; halLog(); };
  const mo = $('#lg-more'); if (mo) mo.onclick = () => { F.n += 50; halLog(); };
  p.onclick = (e) => { const b = e.target.closest('[data-id]'); if (!b) return; const x = l.find((y) => y.id === b.dataset.id); sheet('Detail perubahan', `<div class="stack"><div class="small">${esc(x.aksi)} ${esc(x.tabel || '')} · ${tglWaktu(x.waktu)}</div>${x.data_lama ? `<div><h3>Sebelum</h3><pre class="small" style="white-space:pre-wrap;word-break:break-all">${esc(JSON.stringify(x.data_lama, null, 2))}</pre></div>` : ''}${x.data_baru ? `<div><h3>Sesudah</h3><pre class="small" style="white-space:pre-wrap;word-break:break-all">${esc(JSON.stringify(x.data_baru, null, 2))}</pre></div>` : ''}</div>`, { noFocus: true, wide: true }); };
}

// ── Pengaturan ──
// ── Tampilan katalog publik (logo & banner) — hanya owner ──
const MAKS_BANNER = 5;
const bacaBanner = (cfg) => { try { const a = JSON.parse(cfg.banner_slides || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const hapusFilePublik = (path) => path ? sb.storage.from('motor-foto-publik').remove([path]).catch(() => {}) : null;   // best-effort
async function unggahTampilan(prefix, file, png) {
  try {
    if (!/^image\//.test(file.type)) throw new Error('Pilih file gambar (JPG, PNG, atau WebP).');
    const blob = await kompres(file, png ? 400 : 1600, 0.85, png ? 'image/png' : 'image/jpeg');
    const path = `${prefix}/${Date.now()}.${png ? 'png' : 'jpg'}`;
    const { error } = await sb.storage.from('motor-foto-publik').upload(path, blob, { contentType: png ? 'image/png' : 'image/jpeg' });
    if (error) throw error;
    return path;
  } catch (e) { gagal(e); return null; }
}
const simpanBanner = (list) => tulis(sb.from('pengaturan').upsert([{ key: 'banner_slides', value: JSON.stringify(list) }], { onConflict: 'key' }));
function kartuKatalogHtml(cfg) {
  const list = bacaBanner(cfg);
  return `<div class="card stack"><div><h3>Tampilan katalog publik</h3><p class="small muted" style="margin:4px 0 0">Logo dan banner geser (slider) di halaman katalog.</p></div>
    <div class="row" style="gap:12px"><span class="pub-logo-prev">${cfg.logo_path ? `<img src="${esc(urlPublik(cfg.logo_path))}" alt="Logo">` : ic('two_wheeler')}</span>
      <div class="grow"><b>Logo</b><div class="xs muted">Tampil di sebelah kiri nama showroom. Disarankan PNG persegi/transparan.</div></div></div>
    <div class="row wrap"><button class="btn ghost sm" id="lg-up">${ic('upload', 'sm')} ${cfg.logo_path ? 'Ganti logo' : 'Unggah logo'}</button>${cfg.logo_path ? `<button class="btn ghost sm" id="lg-del">${ic('delete', 'sm')} Hapus</button>` : ''}</div>
    <hr class="sep"><div class="row between"><div><b>Watermark foto</b> <span class="badge ${cfg.watermark_aktif === '0' ? '' : 'ok'}">${cfg.watermark_aktif === '0' ? 'Mati' : 'Aktif'}</span><div class="xs muted">Logo + teks transparan di tengah foto 1–4 saat diunggah. Foto yang sudah ada perlu diunggah ulang.</div></div><button class="btn ghost sm" id="wm-ubah">${ic('edit', 'sm')} Ubah</button></div>
    <hr class="sep"><div class="row between"><div><b>Media sosial</b><div class="xs muted">${['instagram', 'facebook', 'tiktok', 'youtube'].filter((k) => cfg['sosmed_' + k]).map((k) => NAMA_SOSMED[k]).join(', ') || 'Belum diisi. Tampil sebagai ikon di footer katalog.'}</div></div><button class="btn ghost sm" id="ss-ubah">${ic('edit', 'sm')} Ubah</button></div>
    <hr class="sep"><div class="row between"><div><b>Banner</b> <span class="xs muted">(${list.length}/${MAKS_BANNER})</span><div class="xs muted">Ukuran ideal 1600×800 px (rasio 2:1). Bila kosong, tampil banner bawaan.</div></div>
      <button class="btn accent sm" id="bn-add" ${list.length >= MAKS_BANNER ? 'disabled' : ''}>${ic('add', 'sm')} Banner</button></div>
    ${list.length ? `<div class="list">${list.map((b, i) => `<div class="item bn-row" data-i="${i}"><span class="bn-th">${b.path ? `<img src="${esc(urlPublik(b.path))}" alt="">` : ic('image')}</span><div class="grow"><div class="t">${esc(b.judul || b.label || 'Banner ' + (i + 1))}</div><div class="xs muted">${esc(b.sub || (b.path ? 'Gambar' : 'Teks saja'))}</div></div>
      <div class="row bn-act" style="gap:2px"><button class="icon-btn" data-a="naik" aria-label="Naik" ${i === 0 ? 'disabled' : ''}>${ic('arrow_upward')}</button><button class="icon-btn" data-a="turun" aria-label="Turun" ${i === list.length - 1 ? 'disabled' : ''}>${ic('arrow_downward')}</button><button class="icon-btn" data-a="ubah" aria-label="Ubah">${ic('edit')}</button><button class="icon-btn" data-a="hapus" aria-label="Hapus">${ic('delete')}</button></div></div>`).join('')}</div>` : ''}</div>`;
}
function pasangKartuKatalog(cfg) {
  const list = bacaBanner(cfg);
  $('#lg-up').onclick = async () => {
    const f = await pilihFile('image/*'); if (!f) return;
    await sibuk($('#lg-up'), async () => {
      const path = await unggahTampilan('logo', f, true); if (!path) return;
      if (!(await tulis(sb.from('pengaturan').upsert([{ key: 'logo_path', value: path }], { onConflict: 'key' }), 'Logo disimpan.'))) { hapusFilePublik(path); return; }
      hapusFilePublik(cfg.logo_path); if (S.usaha) S.usaha.logo = path; terapkanFavicon(S.usaha); halPengaturan();
    });
  };
  const ld = $('#lg-del'); if (ld) ld.onclick = async () => {
    if (!(await konfirmasi('Hapus logo?', 'Logo diganti ikon motor bawaan.', 'Hapus', true))) return;
    if (await tulis(sb.from('pengaturan').upsert([{ key: 'logo_path', value: '' }], { onConflict: 'key' }), 'Logo dihapus.')) { hapusFilePublik(cfg.logo_path); if (S.usaha) S.usaha.logo = ''; terapkanFavicon(S.usaha); halPengaturan(); }
  };
  const formBanner = (idx) => {
    const b = idx == null ? {} : list[idx]; let berkas = null, lepas = false;
    formSheet(idx == null ? 'Tambah banner' : 'Ubah banner', [
      { html: `<div class="field"><label>Gambar banner</label><div class="bn-prev" id="bn-prev">${b.path ? `<img src="${esc(urlPublik(b.path))}" alt="">` : `<span class="muted small">Belum ada gambar</span>`}</div><div class="row wrap mt-s"><button type="button" class="btn ghost sm" id="bn-pilih">${ic('upload', 'sm')} Pilih gambar</button>${b.path ? `<button type="button" class="btn ghost sm" id="bn-lepas">Tanpa gambar</button>` : ''}</div><span class="hint">Rasio 2:1 (mis. 1600×800). Bagian tepi bisa terpotong di layar sempit.</span></div>` },
      { k: 'label', label: 'Label kecil (opsional)', val: b.label, max: 30, ph: 'Mis. Promo Bulan Ini' },
      { k: 'judul', label: 'Judul (opsional)', val: b.judul, max: 60, ph: 'Mis. Kualitas Terbaik, Harga Bersahabat' },
      { k: 'sub', label: 'Teks pendukung (opsional)', val: b.sub, max: 100, ph: 'Mis. Temukan motor impianmu dengan mudah.' }
    ], async (v) => {
      let path = lepas ? '' : (b.path || '');
      if (berkas) { path = await unggahTampilan('banner', berkas, false); if (!path) return false; }
      const e = { path: path || undefined, label: v.label || undefined, judul: v.judul || undefined, sub: v.sub || undefined };
      if (!e.path && !e.label && !e.judul && !e.sub) { toast('Isi gambar atau minimal satu teks.', 'err'); return false; }
      const baru = list.slice(); if (idx == null) baru.push(e); else baru[idx] = e;
      if (!(await simpanBanner(baru))) { if (berkas) hapusFilePublik(path); return false; }
      if ((berkas || lepas) && b.path) hapusFilePublik(b.path);
      ok('Banner disimpan.'); halPengaturan(); return true;
    }, { onOpen: (sh) => {
      $('#bn-pilih', sh.el).onclick = async () => { const f = await pilihFile('image/*'); if (!f) return; berkas = f; lepas = false; const u = URL.createObjectURL(f); $('#bn-prev', sh.el).innerHTML = `<img src="${u}" alt="">`; };
      const l = $('#bn-lepas', sh.el); if (l) l.onclick = () => { lepas = true; berkas = null; $('#bn-prev', sh.el).innerHTML = '<span class="muted small">Tanpa gambar</span>'; };
    } });
  };
  $('#wm-ubah').onclick = () => formSheet('Watermark foto', [
    { k: 'watermark_aktif', label: 'Aktifkan watermark pada foto yang diunggah', type: 'checkbox', val: cfg.watermark_aktif !== '0' },
    { k: 'watermark_teks', label: 'Teks watermark', val: cfg.watermark_teks, max: 40, ph: cfg.nama_usaha || 'Nama showroom', hint: 'Kosongkan untuk memakai nama showroom. Logo diambil dari logo di atas (bila sudah diunggah).' }
  ], async (v) => {
    const rows = [{ key: 'watermark_aktif', value: v.watermark_aktif ? '1' : '0' }, { key: 'watermark_teks', value: v.watermark_teks || '' }];
    if (!(await tulis(sb.from('pengaturan').upsert(rows, { onConflict: 'key' }), 'Pengaturan watermark disimpan.'))) return false; halPengaturan(); return true;
  });
  $('#ss-ubah').onclick = () => formSheet('Media sosial', ['instagram', 'facebook', 'tiktok', 'youtube'].map((k) => ({ k: 'sosmed_' + k, label: NAMA_SOSMED[k], val: cfg['sosmed_' + k], max: 200, ph: k === 'facebook' ? 'namahalaman atau https://…' : '@namaakun atau https://…' })).concat([{ html: '<span class="hint">Isi nama akun atau tautan lengkap. Kosongkan untuk menyembunyikan. Tombol WhatsApp memakai nomor showroom.</span>' }]), async (v) => {
    const rows = Object.entries(v).map(([key, value]) => ({ key, value: value == null ? '' : String(value).trim() }));
    if (!(await tulis(sb.from('pengaturan').upsert(rows, { onConflict: 'key' }), 'Media sosial disimpan.'))) return false; halPengaturan(); return true;
  });
  $('#bn-add').onclick = () => formBanner(null);
  const box = $('#bn-add').closest('.card');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const i = +b.closest('[data-i]').dataset.i, a = b.dataset.a;
    if (a === 'ubah') return formBanner(i);
    if (a === 'hapus') { if (!(await konfirmasi('Hapus banner?', 'Banner ini tidak lagi tampil di katalog.', 'Hapus', true))) return; const baru = list.filter((_, k) => k !== i); if (await simpanBanner(baru)) { ok('Banner dihapus.'); hapusFilePublik(list[i].path); halPengaturan(); } return; }
    const j = a === 'naik' ? i - 1 : i + 1; if (j < 0 || j >= list.length) return;
    const baru = list.slice(); [baru[i], baru[j]] = [baru[j], baru[i]]; if (await simpanBanner(baru)) halPengaturan();
  };
}

async function halPengaturan() {
  const p = shell('Pengaturan', 'pengaturan');
  const cfg = {}; (await q(sb.from('pengaturan').select('*')) || []).forEach((r) => cfg[r.key] = r.value);
  p.innerHTML = `<div class="stack">
    <div class="card"><h3>Tampilan</h3><div class="chips mt-s" id="pg-tema">${[['auto', 'Ikuti perangkat'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => `<button class="chip ${S.tema === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div></div>
    <div class="card"><h3>Profil saya</h3><div class="kv"><span>Peran</span><span>${isOwner() ? 'Owner' : 'Admin'}</span></div><div class="row wrap mt-s"><button class="btn ghost sm" id="pf-nama">${ic('edit', 'sm')} Ubah nama</button><button class="btn ghost sm" id="pf-pass">${ic('key', 'sm')} Ganti kata sandi</button></div></div>
    ${isOwner() ? `<div class="card"><h3>Identitas usaha</h3><div class="kv"><span>Nama usaha</span><span>${esc(cfg.nama_usaha)}</span></div><div class="kv"><span>Alamat</span><span>${esc(cfg.alamat_usaha || '—')}</span></div><div class="kv"><span>WhatsApp showroom</span><span>${esc(cfg.wa_sorum || '—')}</span></div><div class="kv"><span>Singkatan (kode unit & nomor kuitansi)</span><span>${esc(cfg.kode_prefix || 'MTR')}</span></div><div class="kv"><span>Batas hari simpan</span><span>${esc(cfg.batas_hari_simpan)} hari</span></div><button class="btn ghost sm mt-s" id="pf-usaha">${ic('edit', 'sm')} Ubah</button></div>
    ${kartuKatalogHtml(cfg)}
    <div class="card"><h3>Template pemeriksaan</h3><p class="small muted" style="margin:4px 0 8px">Butir checklist yang muncul pada tab Pemeriksaan setiap unit.</p><button class="btn ghost sm" id="pf-tpl">${ic('checklist', 'sm')} Kelola template</button></div>` : ''}
    <button class="btn danger block" id="pf-out">${ic('logout')} Keluar</button></div>`;
  $('#pg-tema').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { aturTema(b.dataset.t); $$('#pg-tema .chip').forEach((c) => c.classList.toggle('active', c === b)); } };
  $('#pf-out').onclick = keluar;
  $('#pf-nama').onclick = () => formSheet('Ubah nama', [{ k: 'nama', label: 'Nama', req: true, val: S.profile.nama }], async (v) => { if (!(await tulis(sb.from('profiles').update({ nama: v.nama }).eq('id', S.profile.id), 'Nama diperbarui.'))) return false; S.profile.nama = v.nama; return true; });
  $('#pf-pass').onclick = () => formSheet('Ganti kata sandi', [{ k: 'p1', label: 'Kata sandi baru (min. 8 karakter)', type: 'password', req: true }, { k: 'p2', label: 'Ulangi kata sandi', type: 'password', req: true }], async (v) => { if (v.p1.length < 8) { toast('Minimal 8 karakter.', 'err'); return false; } if (v.p1 !== v.p2) { toast('Kata sandi tidak sama.', 'err'); return false; } const { error } = await sb.auth.updateUser({ password: v.p1 }); if (error) { gagal(error); return false; } ok('Kata sandi diganti.'); return true; });
  if (isOwner()) {
    $('#pf-usaha').onclick = () => formSheet('Identitas usaha', [{ k: 'nama_usaha', label: 'Nama usaha', req: true, val: cfg.nama_usaha }, { k: 'alamat_usaha', label: 'Alamat', type: 'textarea', val: cfg.alamat_usaha }, { k: 'kode_prefix', label: 'Singkatan showroom (2–6 huruf/angka)', val: cfg.kode_prefix || 'MTR', ph: 'MTR', hint: 'Dipakai pada kode unit (MTR-0001) dan nomor kuitansi. Perubahan hanya berlaku untuk nomor baru.' }, { k: 'wa_sorum', label: 'Nomor WhatsApp showroom', val: cfg.wa_sorum, ph: '+62812…', inputmode: 'tel', hint: 'Dipakai tombol WhatsApp di katalog publik.' }, { k: 'batas_hari_simpan', label: 'Batas hari simpan (peringatan)', type: 'number', val: cfg.batas_hari_simpan, min: 1, inputmode: 'numeric' }], async (v) => {
      v.kode_prefix = String(v.kode_prefix || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
      if (v.kode_prefix.length < 2) { toast('Singkatan minimal 2 huruf/angka.', 'err'); return false; }
      const rows = Object.entries(v).map(([key, value]) => ({ key, value: value == null ? '' : String(value) }));
      if (!(await tulis(sb.from('pengaturan').upsert(rows, { onConflict: 'key' }), 'Pengaturan disimpan.'))) return false; S.usaha = null; halPengaturan(); return true;
    });
    pasangKartuKatalog(cfg);
    $('#pf-tpl').onclick = async () => {
      const t = (await q(sb.from('pemeriksaan_template').select('*').order('kategori').order('urutan'))) || [];
      const sh = sheet('Template pemeriksaan', `<p class="xs muted" style="margin:0 0 8px">Centang <b>Tampilkan</b> agar butir muncul di tab Pemeriksaan unit. Butir yang tidak dicentang disembunyikan dan tidak dihitung untuk Terverifikasi.</p><div class="list">${t.map((x) => `<div class="row card flat"><label class="row" style="gap:8px;flex:0 0 auto" title="Tampilkan"><input type="checkbox" data-akt="${x.id}" ${x.aktif ? 'checked' : ''} aria-label="Tampilkan ${esc(x.butir)}" style="width:22px;min-height:22px"></label><div class="grow small" style="${x.aktif ? '' : 'opacity:.55'}"><b>${esc(x.kategori)}</b> · ${esc(x.butir)}</div><button class="icon-btn" data-e="${x.id}" aria-label="Ubah">${ic('edit', 'sm')}</button><button class="icon-btn" data-d="${x.id}" aria-label="Hapus">${ic('delete', 'sm')}</button></div>`).join('')}</div>`, { noFocus: true, wide: true, footer: '<button class="btn accent" data-add>Tambah butir</button>' });
      sh.el.onchange = async (e) => { const c = e.target.closest('[data-akt]'); if (!c) return; if (await tulis(sb.from('pemeriksaan_template').update({ aktif: c.checked }).eq('id', c.dataset.akt))) { const it = t.find((x) => x.id === c.dataset.akt); if (it) it.aktif = c.checked; c.closest('.card').querySelector('.grow').style.opacity = c.checked ? '' : '.55'; } else c.checked = !c.checked; };
      const sunting = (e) => { const b = e.target.closest('[data-e]'); if (!b) return false; const x = t.find((r) => r.id === b.dataset.e); sh.close(); formSheet('Ubah butir', [{ k: 'kategori', label: 'Kategori', req: true, val: x.kategori }, { k: 'butir', label: 'Butir pemeriksaan', req: true, val: x.butir }], async (v) => { const kat = v.kategori.trim(), but = v.butir.trim(); if (!(await tulis(sb.from('pemeriksaan_template').update({ kategori: kat, butir: but }).eq('id', x.id), 'Butir diperbarui.'))) return false; if (kat !== x.kategori || but !== x.butir) await tulis(sb.from('pemeriksaan').update({ kategori: kat, butir: but }).eq('kategori', x.kategori).eq('butir', x.butir)); $('#pf-tpl').click(); return true; }); return true; };
      sh.el.onclick = async (e) => { if (sunting(e)) return; const d = e.target.closest('[data-d]'); if (d && (await konfirmasi('Hapus butir?', 'Butir dihapus dari template (hasil pemeriksaan unit yang sudah terisi tetap tersimpan).', 'Hapus', true))) { if (await tulis(sb.from('pemeriksaan_template').delete().eq('id', d.dataset.d))) { sh.close(); $('#pf-tpl').click(); } } };
      $('[data-add]', sh.el).onclick = () => { sh.close(); formSheet('Tambah butir', [{ k: 'kategori', label: 'Kategori', req: true, ph: 'Mesin' }, { k: 'butir', label: 'Butir pemeriksaan', req: true }], async (v) => { if (!(await tulis(sb.from('pemeriksaan_template').insert({ ...v, urutan: 99 }), 'Butir ditambahkan.'))) return false; $('#pf-tpl').click(); return true; }); };
    };
  }
}

// ───────────────────── 7. ROUTER & BOOT ─────────────────────
function parseHash() {
  const h = location.hash.replace(/^#\/?/, ''), [path, qs] = h.split('?');
  return { seg: path.split('/').filter(Boolean).map(decodeURIComponent), params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
let _rid = 0;
async function route() {
  const rid = ++_rid, { seg, params } = parseHash(), a = seg[0];
  window.scrollTo(0, 0);
  try {
    // Halaman publik
    if (!a) return await halKatalog();
    if (a === 'motor' && seg[1]) return await halDetailPublik(seg[1]);
    if (a === 'masuk') { if (S.profile) { location.hash = rumah(); return; } if (!S.usaha) { const u = await q(sb.rpc('rpc_publik_config'), { senyap: true }); if (u) { S.usaha = u; terapkanFavicon(u); } if (rid !== _rid) return; } return halLogin(); }
    // Halaman terautentikasi
    if (!S.profile) { await muatProfil(); if (rid !== _rid) return; }
    if (!S.profile) { location.hash = '#/masuk'; return; }
    if (!S.usaha) { const u = await q(sb.rpc('rpc_publik_config'), { senyap: true }); if (u) { S.usaha = u; terapkanFavicon(u); } }
    if (rid !== _rid) return;
    if (!isOwner() && !HAL_ADMIN.includes(a)) { location.hash = rumah(); return; }
    switch (a) {
      case 'dashboard': return await halDashboard();
      case 'motor': return await halMotor(params);
      case 'unit': return await halUnit(seg[1], seg[2]);
      case 'restorasi': return await halRestorasi();
      case 'transaksi': return await halTransaksi();
      case 'jual': return await halJual(seg[1]);
      case 'penjualan': return await halPenjualan(seg[1]);
      case 'pelanggan': return await halPelanggan();
      case 'pengeluaran': return await halPengeluaran();
      case 'dokumen': return await halDokumen();
      case 'laporan': return await halLaporan();
      case 'user': return await halUser();
      case 'log': return await halLog();
      case 'pengaturan': return await halPengaturan();
      default: location.hash = rumah();
    }
  } catch (e) {
    console.error(e);
    app().innerHTML = `<div class="login"><div class="box card center">${kosong('error', 'Terjadi kesalahan saat memuat halaman.')}<p class="small muted">${esc(pesanError(e))}</p><a class="btn" href="#/">Ke beranda</a></div></div>`;
  }
}
window.addEventListener('hashchange', route);

// Pantau perubahan sesi. JANGAN memanggil Supabase (await) langsung di dalam callback ini.
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') setTimeout(() => { S.profile = null; S.session = null; const a = parseHash().seg[0]; if (a && a !== 'masuk' && a !== 'motor') location.hash = '#/masuk'; }, 0);
});

(async function mulai() {
  if (!CFG.SUPABASE_URL || /GANTI-DENGAN/.test(CFG.SUPABASE_URL)) {
    app().innerHTML = `<div class="login"><div class="box card">${kosong('settings', 'Konfigurasi belum diisi. Buka config.js lalu isi SUPABASE_URL dan SUPABASE_ANON_KEY.')}</div></div>`; return;
  }
  terapkanTema();
  await muatProfil();
  route();
})();
