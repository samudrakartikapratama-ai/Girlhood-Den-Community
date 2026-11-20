// Aura (dulu Jarvis) passkey: daftar dan masuk pakai Face ID / sidik jari (WebAuthn).
// Aksi: daftar-opsi, daftar-cek (butuh sesi internal), masuk-opsi, masuk-cek (tanpa sesi).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.2.2";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.2.2/helpers";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const KUNCI = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const TANPA_SESI = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_SB, KUNCI, TANPA_SESI);

// origin yang boleh -> RP ID. localhost hanya untuk uji lokal (kredensialnya terikat ke localhost, tidak berlaku di .com).
const ORIGIN: Record<string, string> = {
  "https://girlhoodden.com": "girlhoodden.com",
  "https://www.girlhoodden.com": "girlhoodden.com",
  "http://localhost:8777": "localhost",
};
const BATAS_CHALLENGE_MS = 5 * 60 * 1000;

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": ORIGIN[origin] ? origin : "https://girlhoodden.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function staffDariSesi(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const { data: s } = await admin.from("internal_staff").select("id, nama, auth_user_id")
    .eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
  return s;
}

async function ambilChallenge(id: string, jenis: string) {
  const { data } = await admin.from("jarvis_challenges").delete().eq("id", id).eq("jenis", jenis).select().maybeSingle();
  if (!data || Date.now() - new Date(data.created_at).getTime() > BATAS_CHALLENGE_MS) return null;
  return data;
}

// id sesi (klaim session_id) dari access token
function idSesi(jwt: string): string | null {
  try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id || null; } catch { return null; }
}

// Sesi dibuat lewat token magic link di server: password staff tidak diubah.
async function buatSesi(authUserId: string) {
  const { data: u } = await admin.auth.admin.getUserById(authUserId);
  if (!u.user?.email) return null;
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error || !link.properties?.hashed_token) return null;
  const { data: v } = await createClient(URL_SB, ANON, TANPA_SESI).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  return v.session;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const h = { ...cors(origin), "Content-Type": "application/json" };
  const balas = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  const rpID = ORIGIN[origin];
  if (!rpID) return balas({ galat: "ORIGIN" }, 403);

  try {
    const { aksi, id, jawaban, perangkat } = await req.json();
    await admin.from("jarvis_challenges").delete().lt("created_at", new Date(Date.now() - BATAS_CHALLENGE_MS).toISOString());

    if (aksi === "daftar-opsi") {
      const staff = await staffDariSesi(req);
      if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
      const { data: ada } = await admin.from("jarvis_passkeys").select("id, transports").eq("staff_id", staff.id);
      const opsi = await generateRegistrationOptions({
        rpName: "Aura Girlhood Den",
        rpID,
        userName: staff.nama,
        userDisplayName: staff.nama,
        userID: new TextEncoder().encode(staff.id),
        attestationType: "none",
        excludeCredentials: (ada || []).map((k) => ({ id: k.id, transports: k.transports || undefined })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      });
      const { data: c } = await admin.from("jarvis_challenges")
        .insert({ challenge: opsi.challenge, jenis: "daftar", staff_id: staff.id }).select("id").single();
      return balas({ id: c!.id, opsi });
    }

    if (aksi === "daftar-cek") {
      const staff = await staffDariSesi(req);
      if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
      const c = await ambilChallenge(id, "daftar");
      if (!c || c.staff_id !== staff.id) return balas({ galat: "KEDALUWARSA" }, 400);
      const hasil = await verifyRegistrationResponse({
        response: jawaban, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      });
      if (!hasil.verified || !hasil.registrationInfo) return balas({ galat: "GAGAL" }, 400);
      const k = hasil.registrationInfo.credential;
      const { error } = await admin.from("jarvis_passkeys").insert({
        id: k.id, staff_id: staff.id, public_key: isoBase64URL.fromBuffer(k.publicKey), counter: k.counter,
        transports: k.transports || null, perangkat: String(perangkat || "").slice(0, 120) || null,
      });
      if (error) return balas({ galat: "SIMPAN" }, 500);
      return balas({ ok: true });
    }

    if (aksi === "masuk-opsi") {
      const opsi = await generateAuthenticationOptions({ rpID, userVerification: "required" });
      const { data: c } = await admin.from("jarvis_challenges").insert({ challenge: opsi.challenge, jenis: "masuk" }).select("id").single();
      return balas({ id: c!.id, opsi });
    }

    if (aksi === "masuk-cek") {
      const c = await ambilChallenge(id, "masuk");
      if (!c) return balas({ galat: "KEDALUWARSA" }, 400);
      const { data: k } = await admin.from("jarvis_passkeys")
        .select("id, staff_id, public_key, counter, transports, internal_staff!inner(id, nama, auth_user_id, is_active)")
        .eq("id", jawaban?.id).maybeSingle();
      // deno-lint-ignore no-explicit-any
      const s = k && (k as any).internal_staff;
      if (!k || !s?.is_active || !s.auth_user_id) return balas({ galat: "TIDAK_DIKENAL" }, 401);
      const hasil = await verifyAuthenticationResponse({
        response: jawaban, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: k.id, publicKey: isoBase64URL.toBuffer(k.public_key), counter: Number(k.counter), transports: k.transports || undefined },
      });
      if (!hasil.verified) return balas({ galat: "GAGAL" }, 401);
      await admin.from("jarvis_passkeys").update({ counter: hasil.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", k.id);
      const sesi = await buatSesi(s.auth_user_id);
      if (!sesi) return balas({ galat: "SESI" }, 500);
      // tandai sesi ini dibuka lewat Face ID: Aura hanya menerima sesi seperti ini
      const sesiId = idSesi(sesi.access_token);
      const { error: eCatat } = await admin.rpc("aura_catat_sesi_passkey", { p_sesi: sesiId, p_staff: s.id });
      if (!sesiId || eCatat) return balas({ galat: "SESI" }, 500);
      return balas({ nama: s.nama, sesi: { access_token: sesi.access_token, refresh_token: sesi.refresh_token } });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    return balas({ galat: "SALAH", pesan: String((e as Error)?.message || e).slice(0, 200) }, 400);
  }
});
