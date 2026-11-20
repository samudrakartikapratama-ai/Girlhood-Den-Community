// Video onboarding di Aura. Video disimpan di bucket privat "aura-onboarding";
// hanya staf internal aktif yang mendapat link sementara (berlaku 6 jam).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "origin",
});

// Urutan tonton. Video tanpa berkas = belum dibuat.
const VIDEO = [
  { no: 1, judul: "Alur uang", isi: "Dari mana uang kita datang dan bagaimana sampai ke kamu", berkas: "video-1" },
  { no: 2, judul: "Website sisi creator", isi: "Cara creator memilih produk, request sampel, dan posting", berkas: null },
  { no: 3, judul: "Peran, KPI, dan alatmu", isi: "Tiga divisi KOL, target, bonus, Aura, dan Kantor AI", berkas: "video-3" },
  { no: 4, judul: "Website sisi brand & internal", isi: "Cara brand dan tim KOL memakai website", berkas: null },
  { no: 5, judul: "Budaya kerja", isi: "Integritas, transparan, adil, fun, dan inisiatif", berkas: "video-5" },
];
const JAM = 6 * 3600;

async function staf(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: s } = await db.from("internal_staff").select("id").eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
  return s;
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin") || "");
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  const json = (x: unknown, status = 200) => Response.json(x, { status, headers: h });
  if (!(await staf(req))) return json({ galat: "BUKAN_INTERNAL" }, 401);
  const ada = VIDEO.filter((v) => v.berkas).flatMap((v) => [v.berkas + ".mp4", v.berkas + ".jpg"]);
  const { data, error } = await db.storage.from("aura-onboarding").createSignedUrls(ada, JAM);
  if (error) return json({ galat: "GAGAL" }, 500);
  const url = Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
  return json({
    video: VIDEO.map((v) => ({ no: v.no, judul: v.judul, isi: v.isi, video: v.berkas ? url[v.berkas + ".mp4"] || null : null, sampul: v.berkas ? url[v.berkas + ".jpg"] || null : null })),
  });
});
