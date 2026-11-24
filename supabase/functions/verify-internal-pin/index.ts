import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!, KUNCI = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const TANPA_SESI = { auth: { persistSession: false, autoRefreshToken: false } };
// Client admin tidak boleh dipakai untuk login: sesi staff akan menempel dan query berikutnya berjalan sebagai staff itu.
const supabaseAdmin = createClient(URL_SB, KUNCI, TANPA_SESI);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function randomPassword() {
  return crypto.randomUUID() + crypto.randomUUID();
}

// Sesi dibuat lewat token magic link di server. Password tidak diganti, jadi sesi lain
// milik staff yang sama (mis. website dan Aura di perangkat lain) tidak ikut terputus.
async function buatSesi(email: string) {
  const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) return null;
  const { data: v } = await createClient(URL_SB, ANON, TANPA_SESI).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  return v.session;
}

const attempts: Record<string, { count: number; resetAt: number }> = {};
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const corsH = corsHeaders;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsH });

  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const record = attempts[ip];

  if (record && record.resetAt > now && record.count >= MAX_ATTEMPTS) {
    const waitSec = Math.ceil((record.resetAt - now) / 1000);
    return new Response(
      JSON.stringify({ valid: false, error: "Terlalu banyak percobaan gagal. Coba lagi dalam " + waitSec + " detik." }),
      { status: 429, headers: { ...corsH, "Content-Type": "application/json" } }
    );
  }

  try {
    const { pin } = await req.json();
    const kode = (pin || "").trim();

    // Cari staff berdasarkan kode login masing-masing (bukan PIN bersama lagi)
    const { data: staff } = await supabaseAdmin
      .from("internal_staff")
      .select("id, nama, auth_user_id, is_active")
      .eq("kode_login", kode)
      .eq("is_active", true)
      .maybeSingle();

    if (!staff) {
      if (!record || record.resetAt <= now) { attempts[ip] = { count: 1, resetAt: now + WINDOW_MS }; }
      else { record.count++; }
      return new Response(JSON.stringify({ valid: false, error: "Kode salah." }), {
        status: 200, headers: { ...corsH, "Content-Type": "application/json" }
      });
    }

    delete attempts[ip];

    const staffEmail = "internal-" + staff.id + "@internal.girlhoodden.app";
    let authUserId = staff.auth_user_id;

    if (!authUserId) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: staffEmail, password: randomPassword(), email_confirm: true
      });
      if (createError || !created.user) {
        return new Response(JSON.stringify({ valid: false, error: "Gagal membuat sesi (create)." }), {
          status: 500, headers: { ...corsH, "Content-Type": "application/json" }
        });
      }
      authUserId = created.user.id;
      await supabaseAdmin.from("internal_staff").update({ auth_user_id: authUserId }).eq("id", staff.id);
    }

    const { data: u } = await supabaseAdmin.auth.admin.getUserById(authUserId);
    const sesi = u.user?.email ? await buatSesi(u.user.email) : null;
    if (!sesi) {
      return new Response(JSON.stringify({ valid: false, error: "Gagal membuat sesi (sign-in)." }), {
        status: 500, headers: { ...corsH, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      valid: true,
      nama: staff.nama,
      session: { access_token: sesi.access_token, refresh_token: sesi.refresh_token }
    }), { headers: { ...corsH, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ valid: false, error: "Request tidak valid." }), {
      status: 400, headers: { ...corsH, "Content-Type": "application/json" }
    });
  }
});
