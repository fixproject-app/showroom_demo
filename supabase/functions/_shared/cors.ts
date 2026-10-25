// Pembantu bersama untuk semua Edge Function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Klien dengan service role (melewati RLS). HANYA dipakai di dalam Edge Function.
export const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// Fungsi dideploy dengan --no-verify-jwt, jadi token diperiksa sendiri di sini.
// Mengembalikan { user, role } bila pemanggil adalah staf aktif; selain itu melempar Response.
export async function wajibStaf(req: Request, admin = adminClient()) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw json({ pesan: "Belum masuk." }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw json({ pesan: "Sesi tidak valid. Silakan masuk kembali." }, 401);
  const { data: prof } = await admin.from("profiles").select("role,aktif,nama").eq("id", data.user.id).maybeSingle();
  if (!prof || !prof.aktif) throw json({ pesan: "Akun tidak aktif." }, 403);
  return { user: data.user, role: prof.role as "owner" | "admin", nama: prof.nama as string };
}
