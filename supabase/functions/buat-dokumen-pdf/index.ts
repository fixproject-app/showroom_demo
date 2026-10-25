// ============================================================
// buat-dokumen-pdf — membuat Kuitansi / Surat Jual-Beli (PDF),
// menyimpannya di bucket privat "dokumen-pdf" dan mencatatnya di tabel dokumen_transaksi.
// Boleh dipanggil owner & admin aktif.
// Deploy:  supabase functions deploy buat-dokumen-pdf --no-verify-jwt
// ============================================================
import { adminClient, corsHeaders, json, wajibStaf } from "../_shared/cors.ts";
import { buatKuitansi, buatSuratJualBeli, tglIndo, type DataJual } from "./pdf.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const me = await wajibStaf(req, admin);
    const { jenis, penjualan_id, pembayaran_id } = await req.json();
    if (!["Kuitansi", "Surat Jual-Beli"].includes(jenis)) return json({ pesan: "Jenis dokumen tidak dikenal." }, 400);
    if (!penjualan_id) return json({ pesan: "penjualan_id wajib diisi." }, 400);
    if (jenis === "Kuitansi" && !pembayaran_id) return json({ pesan: "Pilih pembayaran untuk kuitansi." }, 400);

    const { data: j, error: e1 } = await admin.from("penjualan")
      .select("*, motor:motor_id(*), pelanggan:pelanggan_id(*), pembayaran(id,tanggal,jenis,jumlah,metode,created_at)").eq("id", penjualan_id).maybeSingle();
    if (e1) throw e1;
    if (!j) return json({ pesan: "Penjualan tidak ditemukan." }, 404);
    if (j.status === "Batal") return json({ pesan: "Penjualan sudah dibatalkan." }, 400);
    if (jenis === "Kuitansi" && !j.pembayaran.some((p: { id: string }) => p.id === pembayaran_id)) return json({ pesan: "Pembayaran tidak ditemukan." }, 404);

    const { data: cfgRows } = await admin.from("pengaturan").select("key,value").in("key", ["nama_usaha", "alamat_usaha", "wa_sorum", "logo_path"]);
    const cfg: Record<string, string> = {}; (cfgRows || []).forEach((r) => cfg[r.key] = r.value || "");

    // Logo usaha (bucket publik) — gagal diunduh tidak menggagalkan dokumen.
    let logo: Uint8Array | null = null;
    if (cfg.logo_path) {
      try { const { data: blob } = await admin.storage.from("motor-foto-publik").download(cfg.logo_path); if (blob) logo = new Uint8Array(await blob.arrayBuffer()); } catch (_) { logo = null; }
    }

    const { data: nomor, error: e2 } = await admin.rpc("rpc_nomor_dokumen", { p_jenis: jenis });
    if (e2) throw e2;

    const data: DataJual = {
      usaha: { nama_usaha: cfg.nama_usaha || "Showroom Motor", alamat_usaha: cfg.alamat_usaha || "", wa_sorum: cfg.wa_sorum || "", logo },
      nomor, tanggalCetak: tglIndo(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })),
      penjualan: j, motor: j.motor, pelanggan: j.pelanggan,
      pembayaran: [...j.pembayaran].sort((a, b) => (a.tanggal + a.created_at).localeCompare(b.tanggal + b.created_at)),
    };
    const pdf = jenis === "Kuitansi" ? await buatKuitansi(data, pembayaran_id) : await buatSuratJualBeli(data);

    const path = `${nomor.split("/")[2]}/${String(nomor).replace(/\//g, "-")}.pdf`;
    const { error: e3 } = await admin.storage.from("dokumen-pdf").upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (e3) throw e3;
    const { data: baris, error: e4 } = await admin.from("dokumen_transaksi")
      .insert({ penjualan_id, pembayaran_id: jenis === "Kuitansi" ? pembayaran_id : null, jenis, nomor_dokumen: nomor, path_pdf: path, dibuat_oleh: me.user.id }).select("id").single();
    if (e4) throw e4;
    return json({ id: baris.id, nomor, path });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ pesan: (e as Error).message || "Gagal membuat dokumen." }, 500);
  }
});
