// ============================================================
// kelola-user — hanya untuk OWNER.
// Membuat akun, mengubah nama/peran, reset kata sandi, aktif/nonaktif.
// Menggunakan service role, karena role & aktif tidak bisa diubah dari browser.
// Deploy:  supabase functions deploy kelola-user --no-verify-jwt
// ============================================================
import { adminClient, corsHeaders, json, wajibStaf } from "../_shared/cors.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const me = await wajibStaf(req, admin);
    if (me.role !== "owner") return json({ pesan: "Hanya pemilik yang boleh mengelola pengguna." }, 403);

    const b = await req.json();

    if (b.aksi === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) throw error;
      const { data: profs } = await admin.from("profiles").select("id,nama,role,aktif");
      const peta = new Map((profs || []).map((p) => [p.id, p]));
      const users = data.users.map((u) => {
        const p = peta.get(u.id);
        return { id: u.id, email: u.email, nama: p?.nama ?? "", role: p?.role ?? "admin", aktif: p?.aktif ?? true, last_sign_in_at: u.last_sign_in_at };
      }).sort((a, z) => (a.role === z.role ? (a.nama || "").localeCompare(z.nama || "") : a.role === "owner" ? -1 : 1));
      return json({ users });
    }

    if (b.aksi === "buat") {
      const email = String(b.email || "").trim().toLowerCase(), nama = String(b.nama || "").trim(), password = String(b.password || "");
      const role = b.role === "owner" ? "owner" : "admin";
      if (!EMAIL.test(email)) return json({ pesan: "Format email tidak valid." }, 400);
      if (!nama) return json({ pesan: "Nama wajib diisi." }, 400);
      if (password.length < 8) return json({ pesan: "Kata sandi minimal 8 karakter." }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nama } });
      if (error) return json({ pesan: /already|registered/i.test(error.message) ? "Email sudah terdaftar." : error.message }, 400);
      // Trigger handle_new_user sudah membuat profil (peran admin). Sesuaikan peran/nama bila perlu.
      const { error: e2 } = await admin.from("profiles").upsert({ id: data.user.id, nama, role, aktif: true });
      if (e2) throw e2;
      return json({ id: data.user.id });
    }

    const id = String(b.id || "");
    if (!id) return json({ pesan: "ID pengguna wajib diisi." }, 400);

    if (b.aksi === "ubah") {
      const nama = String(b.nama || "").trim(), role = b.role === "owner" ? "owner" : "admin";
      if (!nama) return json({ pesan: "Nama wajib diisi." }, 400);
      if (role !== "owner") { // jangan sampai tidak ada owner aktif
        const { data: owners } = await admin.from("profiles").select("id").eq("role", "owner").eq("aktif", true);
        if ((owners || []).every((o) => o.id === id)) return json({ pesan: "Harus ada minimal satu owner aktif." }, 400);
      }
      const { error } = await admin.from("profiles").update({ nama, role }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (b.aksi === "reset") {
      const password = String(b.password || "");
      if (password.length < 8) return json({ pesan: "Kata sandi minimal 8 karakter." }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) throw error;
      return json({ ok: true });
    }

    if (b.aksi === "aktif") {
      const aktif = !!b.aktif;
      if (id === me.user.id) return json({ pesan: "Anda tidak dapat menonaktifkan akun sendiri." }, 400);
      const { error } = await admin.from("profiles").update({ aktif }).eq("id", id);
      if (error) throw error;
      // Blokir juga di Auth agar sesi baru tidak bisa dibuat
      await admin.auth.admin.updateUserById(id, { ban_duration: aktif ? "none" : "876000h" });
      return json({ ok: true });
    }

    return json({ pesan: "Aksi tidak dikenal." }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ pesan: (e as Error).message || "Terjadi kesalahan di server." }, 500);
  }
});
