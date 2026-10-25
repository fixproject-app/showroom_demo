// Pembuat PDF kuitansi & surat jual-beli (pdf-lib, font standar Helvetica).
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

export interface Usaha { nama_usaha: string; alamat_usaha: string; wa_sorum: string; logo?: Uint8Array | null }
export interface DataJual {
  usaha: Usaha; nomor: string; tanggalCetak: string;
  penjualan: { tanggal_jual: string; harga_jual: number; diskon: number; harga_akhir: number; skema: string; nama_leasing: string | null; sales: string | null; status: string };
  motor: { merk: string; tipe: string; tahun: number; warna: string | null; nopol: string; no_rangka: string | null; no_mesin: string | null; kilometer: number | null; kode_unit: string };
  pelanggan: { nama: string; hp: string | null; alamat: string | null };
  pembayaran: { id: string; tanggal: string; jenis: string; jumlah: number; metode: string }[];
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const tglIndo = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-").map(Number); return `${dd} ${BULAN[m - 1]} ${y}`; };
export const rupiah = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
// Font standar hanya mendukung Latin-1: ganti karakter lain agar tidak melempar error
const aman = (s: unknown) => String(s ?? "").replace(/[\u2013\u2014]/g, "-").replace(/[\u2022\u00B7]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, "...").replace(/[\r\t]+/g, " ").replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");

const SAT = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
export function terbilang(n: number): string {
  n = Math.floor(n);
  if (n === 0) return "nol";
  const t = (x: number): string => {
    if (x < 12) return SAT[x];
    if (x < 20) return t(x - 10) + " belas";
    if (x < 100) return t(Math.floor(x / 10)) + " puluh" + (x % 10 ? " " + t(x % 10) : "");
    if (x < 200) return "seratus" + (x - 100 ? " " + t(x - 100) : "");
    if (x < 1000) return t(Math.floor(x / 100)) + " ratus" + (x % 100 ? " " + t(x % 100) : "");
    if (x < 2000) return "seribu" + (x - 1000 ? " " + t(x - 1000) : "");
    if (x < 1e6) return t(Math.floor(x / 1e3)) + " ribu" + (x % 1e3 ? " " + t(x % 1e3) : "");
    if (x < 1e9) return t(Math.floor(x / 1e6)) + " juta" + (x % 1e6 ? " " + t(x % 1e6) : "");
    if (x < 1e12) return t(Math.floor(x / 1e9)) + " miliar" + (x % 1e9 ? " " + t(x % 1e9) : "");
    return t(Math.floor(x / 1e12)) + " triliun" + (x % 1e12 ? " " + t(x % 1e12) : "");
  };
  return t(n);
}
const kapital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Penulis teks dengan pembungkusan baris & halaman otomatis
class Penulis {
  y: number; constructor(public doc: PDFDocument, public page: PDFPage, public f: PDFFont, public fb: PDFFont, public M = 50) { this.y = page.getHeight() - M; }
  get lebar() { return this.page.getWidth() - 2 * this.M; }
  cek(h: number) { if (this.y - h < this.M) { this.page = this.doc.addPage([595.28, 841.89]); this.y = this.page.getHeight() - this.M; } }
  bungkus(teks: string, ukuran: number, font: PDFFont, lebar: number): string[] {
    const hasil: string[] = [];
    for (const para of aman(teks).split("\n")) {
      let baris = "";
      for (const kata of para.split(" ")) {
        const coba = baris ? baris + " " + kata : kata;
        if (font.widthOfTextAtSize(coba, ukuran) > lebar && baris) { hasil.push(baris); baris = kata; } else baris = coba;
      }
      hasil.push(baris);
    }
    return hasil;
  }
  teks(t: string, o: { ukuran?: number; bold?: boolean; x?: number; lebar?: number; rata?: "kiri" | "tengah" | "kanan"; warna?: [number, number, number]; jarak?: number } = {}) {
    const u = o.ukuran ?? 10, font = o.bold ? this.fb : this.f, x0 = o.x ?? this.M, lb = o.lebar ?? (this.lebar - (x0 - this.M)), lh = u * 1.4;
    for (const b of this.bungkus(t, u, font, lb)) {
      this.cek(lh);
      const w = font.widthOfTextAtSize(b, u);
      const x = o.rata === "tengah" ? x0 + (lb - w) / 2 : o.rata === "kanan" ? x0 + lb - w : x0;
      this.page.drawText(b, { x, y: this.y - u, size: u, font, color: o.warna ? rgb(...o.warna) : rgb(0.06, 0.09, 0.16) });
      this.y -= lh;
    }
    this.y -= o.jarak ?? 0;
  }
  garis(tebal = 0.8, warna: [number, number, number] = [0.8, 0.84, 0.9]) { this.cek(8); this.page.drawLine({ start: { x: this.M, y: this.y - 4 }, end: { x: this.M + this.lebar, y: this.y - 4 }, thickness: tebal, color: rgb(...warna) }); this.y -= 10; }
  baris2(label: string, nilai: string, lw = 150) {
    const ls = this.bungkus(nilai, 10, this.f, this.lebar - lw - 10); this.cek(ls.length * 14);
    this.page.drawText(aman(label), { x: this.M, y: this.y - 10, size: 10, font: this.f, color: rgb(0.39, 0.45, 0.55) });
    this.page.drawText(":", { x: this.M + lw - 6, y: this.y - 10, size: 10, font: this.f });
    for (const l of ls) { this.page.drawText(l, { x: this.M + lw, y: this.y - 10, size: 10, font: this.fb }); this.y -= 14; }
  }
}
async function mulai() {
  const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]); return new Penulis(doc, page, f, fb);
}
// Sematkan logo (PNG/JPEG, deteksi dari byte awal). Format lain / rusak → null (kop tanpa logo).
async function sematkanLogo(doc: PDFDocument, b?: Uint8Array | null) {
  if (!b || b.length < 8) return null;
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return await doc.embedPng(b);
    if (b[0] === 0xff && b[1] === 0xd8) return await doc.embedJpg(b);
  } catch (_) { /* abaikan, pakai kop teks */ }
  return null;
}
async function kop(w: Penulis, u: Usaha) {
  w.page.drawRectangle({ x: 0, y: w.page.getHeight() - 8, width: w.page.getWidth(), height: 8, color: rgb(0.078, 0.157, 0.294) });
  const img = await sematkanLogo(w.doc, u.logo);
  const y0 = w.y; let x = w.M, lebar = w.lebar;
  if (img) {
    const tMax = 56, lMax = 120, sk = Math.min(tMax / img.height, lMax / img.width), lw = img.width * sk, lh = img.height * sk;
    w.page.drawImage(img, { x: w.M, y: y0 - lh, width: lw, height: lh });
    x = w.M + lw + 14; lebar = w.lebar - lw - 14;
    w.y = y0 - Math.max(0, (lh - 46) / 2); // teks rata tengah vertikal terhadap logo
  }
  const opsi = img ? { x, lebar } : {};
  w.teks(u.nama_usaha, { ukuran: 16, bold: true, warna: [0.078, 0.157, 0.294], ...opsi });
  if (u.alamat_usaha) w.teks(u.alamat_usaha, { ukuran: 9, warna: [0.39, 0.45, 0.55], ...opsi });
  if (u.wa_sorum) w.teks("WhatsApp: " + u.wa_sorum, { ukuran: 9, warna: [0.39, 0.45, 0.55], ...opsi });
  if (img) w.y = Math.min(w.y, y0 - Math.min(56, img.height * Math.min(56 / img.height, 120 / img.width)) - 2);
  w.garis(1.5, [0.078, 0.157, 0.294]);
}
const namaMotor = (m: DataJual["motor"]) => `${m.merk} ${m.tipe} ${m.tahun}${m.warna ? " (" + m.warna + ")" : ""}`;
function blokMotor(w: Penulis, m: DataJual["motor"]) {
  w.baris2("Motor", namaMotor(m)); w.baris2("Nomor polisi", m.nopol);
  if (m.no_rangka) w.baris2("Nomor rangka", m.no_rangka); if (m.no_mesin) w.baris2("Nomor mesin", m.no_mesin);
  if (m.kilometer != null) w.baris2("Kilometer", m.kilometer.toLocaleString("id-ID") + " km");
}

export async function buatKuitansi(d: DataJual, pembayaranId: string): Promise<Uint8Array> {
  const p = d.pembayaran.find((x) => x.id === pembayaranId); if (!p) throw new Error("Pembayaran tidak ditemukan.");
  const w = await mulai(); await kop(w, d.usaha);
  w.teks("KUITANSI", { ukuran: 20, bold: true, rata: "tengah" }); w.teks("No. " + d.nomor, { ukuran: 10, rata: "tengah", jarak: 14 });
  w.baris2("Telah terima dari", d.pelanggan.nama); if (d.pelanggan.alamat) w.baris2("Alamat", d.pelanggan.alamat);
  w.baris2("Uang sejumlah", kapital(terbilang(p.jumlah)) + " Rupiah");
  w.baris2("Untuk pembayaran", `${p.jenis} pembelian motor (${p.metode})`); blokMotor(w, d.motor); w.baris2("Tanggal bayar", tglIndo(p.tanggal));
  w.y -= 8; w.garis();
  const totalSd = d.pembayaran.filter((x) => x.tanggal < p.tanggal || (x.tanggal === p.tanggal && x.id <= p.id)).reduce((a, x) => a + x.jumlah, 0);
  w.baris2("Harga akhir motor", rupiah(d.penjualan.harga_akhir)); w.baris2("Total dibayar s.d. kuitansi", rupiah(totalSd));
  w.baris2("Sisa tagihan", rupiah(Math.max(0, d.penjualan.harga_akhir - totalSd)));
  w.y -= 14;
  w.cek(110); const y0 = w.y;
  w.page.drawRectangle({ x: w.M, y: y0 - 44, width: 230, height: 44, borderColor: rgb(0.078, 0.157, 0.294), borderWidth: 1.5 });
  w.page.drawText(rupiah(p.jumlah), { x: w.M + 12, y: y0 - 30, size: 18, font: w.fb, color: rgb(0.078, 0.157, 0.294) });
  const xk = w.M + w.lebar - 170;
  w.page.drawText("Hormat kami,", { x: xk, y: y0 - 6, size: 10, font: w.f });
  w.page.drawLine({ start: { x: xk, y: y0 - 80 }, end: { x: xk + 160, y: y0 - 80 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
  w.page.drawText(aman(d.usaha.nama_usaha), { x: xk, y: y0 - 92, size: 9, font: w.fb });
  w.y = y0 - 110;
  w.teks("Dicetak " + d.tanggalCetak + ". Dokumen ini sah sebagai bukti pembayaran setelah ditandatangani.", { ukuran: 8, warna: [0.39, 0.45, 0.55] });
  return await w.doc.save();
}

export async function buatSuratJualBeli(d: DataJual): Promise<Uint8Array> {
  const w = await mulai(); await kop(w, d.usaha);
  w.teks("SURAT PERJANJIAN JUAL BELI KENDARAAN BERMOTOR", { ukuran: 13, bold: true, rata: "tengah" }); w.teks("No. " + d.nomor, { ukuran: 10, rata: "tengah", jarak: 12 });
  w.teks(`Pada hari ini, tanggal ${tglIndo(d.penjualan.tanggal_jual)}, para pihak yang bertanda tangan di bawah ini:`, { jarak: 6 });
  w.teks("PIHAK PERTAMA (Penjual)", { bold: true }); w.baris2("Nama usaha", d.usaha.nama_usaha); if (d.usaha.alamat_usaha) w.baris2("Alamat", d.usaha.alamat_usaha); w.y -= 6;
  w.teks("PIHAK KEDUA (Pembeli)", { bold: true }); w.baris2("Nama", d.pelanggan.nama); if (d.pelanggan.alamat) w.baris2("Alamat", d.pelanggan.alamat); if (d.pelanggan.hp) w.baris2("No. HP", d.pelanggan.hp); w.y -= 6;
  w.teks("Kedua pihak sepakat melakukan jual beli kendaraan bermotor dengan ketentuan sebagai berikut:", { jarak: 6 });
  w.teks("Pasal 1 — Objek Jual Beli", { bold: true }); blokMotor(w, d.motor); w.y -= 6;
  const j = d.penjualan, kredit = j.skema === "Kredit Leasing";
  w.teks("Pasal 2 — Harga & Pembayaran", { bold: true });
  w.baris2("Harga jual", rupiah(j.harga_jual)); if (j.diskon) w.baris2("Diskon", "- " + rupiah(j.diskon)); w.baris2("Harga akhir", rupiah(j.harga_akhir) + " (" + kapital(terbilang(j.harga_akhir)) + " Rupiah)");
  w.baris2("Skema", kredit ? `Kredit melalui ${j.nama_leasing || "leasing"}` : "Tunai");
  if (d.pembayaran.length) { w.y -= 4; w.teks("Pembayaran yang telah diterima:", { ukuran: 10 }); for (const p of d.pembayaran) w.teks(`• ${tglIndo(p.tanggal)} — ${p.jenis} (${p.metode}): ${rupiah(p.jumlah)}`, { x: w.M + 12 }); }
  const dibayar = d.pembayaran.reduce((a, x) => a + x.jumlah, 0);
  w.baris2("Sisa pembayaran", rupiah(Math.max(0, j.harga_akhir - dibayar))); w.y -= 6;
  const pasal = [
    ["Pasal 3 — Serah Terima", "Kendaraan diserahkan kepada Pihak Kedua dalam kondisi sebagaimana adanya yang telah diperiksa dan disetujui Pihak Kedua pada saat transaksi. Dokumen kendaraan diserahkan sesuai kelengkapan yang disepakati setelah pembayaran dinyatakan lunas" + (kredit ? " dan/atau sesuai ketentuan perusahaan pembiayaan." : ".")],
    ["Pasal 4 — Jaminan", "Pihak Pertama menjamin bahwa kendaraan tersebut bukan merupakan objek sengketa dan bebas dari tunggakan yang menjadi kewajiban Pihak Pertama pada saat serah terima."],
    ["Pasal 5 — Balik Nama & Pajak", "Pengurusan balik nama dan kewajiban pajak kendaraan setelah serah terima menjadi tanggung jawab Pihak Kedua, kecuali disepakati lain secara tertulis."],
    ["Pasal 6 — Penyelesaian Perselisihan", "Perselisihan diselesaikan secara musyawarah. Bila tidak tercapai, para pihak sepakat menempuh jalur hukum yang berlaku."],
  ];
  for (const [jd, isi] of pasal) { w.teks(jd, { bold: true }); w.teks(isi, { jarak: 6 }); }
  w.teks("Demikian perjanjian ini dibuat dalam rangkap dua dan ditandatangani oleh kedua pihak.", { jarak: 10 });
  w.cek(120); const y0 = w.y, xk = w.M + w.lebar - 160;
  w.page.drawText("Pihak Pertama", { x: w.M, y: y0 - 10, size: 10, font: w.f }); w.page.drawText("Pihak Kedua", { x: xk, y: y0 - 10, size: 10, font: w.f });
  w.page.drawLine({ start: { x: w.M, y: y0 - 80 }, end: { x: w.M + 150, y: y0 - 80 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) }); w.page.drawLine({ start: { x: xk, y: y0 - 80 }, end: { x: xk + 150, y: y0 - 80 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
  w.page.drawText(aman(d.usaha.nama_usaha), { x: w.M, y: y0 - 92, size: 9, font: w.fb }); w.page.drawText(aman(d.pelanggan.nama), { x: xk, y: y0 - 92, size: 9, font: w.fb });
  w.y = y0 - 112; w.teks("Dicetak " + d.tanggalCetak + ". Draf standar — sesuaikan dengan kebutuhan hukum usaha Anda bila diperlukan.", { ukuran: 8, warna: [0.39, 0.45, 0.55] });
  return await w.doc.save();
}
