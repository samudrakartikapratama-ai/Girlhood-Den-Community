// Riset Pasar: data TikTok Shop Indonesia dari Kalodata Open API untuk tim KOL (cari creator) dan BD (cari brand).
// Tanpa AI: hanya mengambil data. Biaya dipotong dari kredit Kalodata, jadi ada cache, batas harian per orang, dan catatan pemakaian.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KALO_KEY = Deno.env.get("KALODATA_API_KEY") || "";
const KALO = "https://www.kalodata.com/openapi/v1";
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "origin",
});
const DASAR = { region: "ID", language: "id-ID", currency: "IDR" };
// kategori Kalodata untuk Indonesia (dicek 26 Nov 2026 lewat searchByKeyword)
const KATEGORI: Record<string, string> = { "848776": "Skincare", "848648": "Makeup", "856208": "Parfum" };
const RENTANG = ["last7Day", "last30Day", "last90Day"];
const URUT = {
  creator: ["revenue", "revenue_growth_rate", "creator_followers", "live_revenue", "video_revenue"],
  toko: ["revenue", "revenue_growth_rate", "affiliate_revenue", "sales_volumn"],
  video: ["revenue", "views", "revenue_growth_rate"], // urut ads_roas tidak dipakai: ROAS dibatasi 20 dan isinya video ber-GMV kecil
};
const JAM_CACHE = { rank: 24, detail: 72 };

function idSesi(jwt: string): string | null {
  try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id || null; } catch { return null; }
}
async function staffDari(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: s } = await db.from("internal_staff").select("id, nama").eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
  if (!s) return null;
  const sesi = idSesi(jwt);
  const { data: sah } = sesi ? await db.rpc("aura_sesi_sah", { p_sesi: sesi, p_staff: s.id }) : { data: false };
  if (sah !== true) return null;
  const { data: cfg } = await db.from("app_config").select("key, value").in("key", ["kantor_ceo", "kantor_coo", "riset_akses", "riset_batas"]);
  const nilai = (k: string) => (cfg || []).find((c) => c.key === k)?.value;
  const pimpinan = [nilai("kantor_ceo"), nilai("kantor_coo")].includes(s.id);
  let akses: string[] = [];
  try { akses = JSON.parse(String(nilai("riset_akses") || "[]")); } catch { /* kosong */ }
  return { id: s.id as string, nama: s.nama as string, pimpinan, boleh: pimpinan || akses.includes(s.id), akses, batas: Number.isFinite(Number(nilai("riset_batas"))) ? Number(nilai("riset_batas")) : 3 };
}

class Galat extends Error { constructor(public kode: string, public st = 400) { super(kode); } }

async function kalo(path: string, body: unknown, method = "POST") {
  if (!KALO_KEY) throw new Galat("KUNCI_KOSONG", 500);
  let r: Response | null = null;
  // Kalodata membalas HTTP 554 tanpa isi kalau dipanggil beruntun terlalu cepat: tunggu lalu ulang (maks 2x)
  for (let coba = 0; coba < 3; coba++) {
    if (coba) await new Promise((s) => setTimeout(s, 1500 * coba));
    r = await fetch(KALO + path, { method, headers: { "Content-Type": "application/json;charset=UTF-8", "secret-key": KALO_KEY }, body: method === "GET" ? undefined : JSON.stringify(body) });
    if (r.status !== 554 && r.status < 500) break;
  }
  const j = await r!.json().catch(() => null);
  if (j?.success) return j.data;
  const pesan = String(j?.message || "");
  console.error("kalodata", r!.status, j?.code, pesan);
  if (/insufficient|balance|point|credit|余额|积分/i.test(pesan)) throw new Galat("SALDO_HABIS", 402);
  if (/key/i.test(pesan)) throw new Galat("KUNCI_DITOLAK", 500);
  throw new Galat("KALODATA_GAGAL", 502);
}

// kredit yang dipakai hari ini (WIB) oleh satu orang, hanya panggilan yang benar-benar ke Kalodata
async function pakaiHariIni(staffId: string) {
  const mulai = new Date(Date.now() + 7 * 3600e3); mulai.setUTCHours(0, 0, 0, 0);
  const { data } = await db.from("riset_pakai").select("kredit").eq("staff_id", staffId).eq("dari_cache", false).gte("dibuat_at", new Date(mulai.getTime() - 7 * 3600e3).toISOString());
  return (data || []).reduce((a, x) => a + Number(x.kredit), 0);
}

// ambil dari cache kalau masih segar, kalau tidak panggil Kalodata lalu simpan; semua dicatat ke riset_pakai
async function ambil(staff: any, aksi: string, jenis: keyof typeof JAM_CACHE, path: string, body: any, kredit: number) {
  const kunci = path + "|" + JSON.stringify(body);
  const { data: c } = await db.from("riset_cache").select("data, dibuat_at").eq("kunci", kunci).maybeSingle();
  if (c && Date.now() - new Date(c.dibuat_at).getTime() < JAM_CACHE[jenis] * 3600e3) {
    await db.from("riset_pakai").insert({ staff_id: staff.id, aksi, kredit: 0, dari_cache: true });
    return { data: c.data, dari_cache: true, diambil_at: c.dibuat_at };
  }
  if (!staff.pimpinan && (await pakaiHariIni(staff.id)) + kredit > staff.batas + 1e-9) throw new Galat("BATAS_HARIAN", 429);
  const data = await kalo(path, body);
  const sekarang = new Date().toISOString();
  await Promise.all([
    db.from("riset_cache").upsert({ kunci, data, dibuat_at: sekarang }),
    db.from("riset_pakai").insert({ staff_id: staff.id, aksi, kredit, dari_cache: false }),
  ]);
  return { data, dari_cache: false, diambil_at: sekarang };
}

const angka = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// Kalodata wajib "min-max" dengan dua ujung angka dan menolak ujung atas yang terlalu besar ("End value exceeds limit")
const rentang = (v: unknown, atas: number) => {
  const m = String(v || "").trim().match(/^(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return undefined;
  return `${m[1] || 0}-${Math.min(Number(m[2] || atas), atas)}`;
};
const pilih = <T,>(v: unknown, daftar: readonly T[], awal: T) => (daftar.includes(v as T) ? (v as T) : awal);
const kategoriIds = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => KATEGORI[x]).slice(0, 3) : []);

Deno.serve(async (req) => {
  const o = req.headers.get("origin") || "";
  const h = { ...cors(o), "content-type": "application/json" };
  const balas = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o) });
  let b: any = {};
  try { b = await req.json(); } catch { return balas({ galat: "FORMAT" }, 400); }
  const staff = await staffDari(req);
  if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
  if (!staff.boleh) return balas({ galat: "TANPA_AKSES" }, 403);

  try {
    if (b.aksi === "cek") return balas({ ok: true }); // dipakai Aura untuk menampilkan tab, tanpa memanggil Kalodata

    if (b.aksi === "status") {
      const [saldo, dipakai, { data: incaran }, staffList] = await Promise.all([
        kalo("/credit/balance", {}, "GET").catch(() => null),
        pakaiHariIni(staff.id),
        db.from("riset_incaran").select("*").order("diubah_at", { ascending: false }).limit(300),
        staff.pimpinan ? db.from("internal_staff").select("id, nama").eq("is_active", true).order("nama").then((r) => r.data) : Promise.resolve(null),
      ]);
      let pemakaian = null;
      if (staff.pimpinan) {
        const sejak = new Date(Date.now() - 30 * 864e5).toISOString();
        const { data } = await db.from("riset_pakai").select("staff_id, kredit, dari_cache").gte("dibuat_at", sejak);
        const per: Record<string, { kredit: number; panggil: number; cache: number }> = {};
        for (const x of data || []) { const p = (per[x.staff_id] ||= { kredit: 0, panggil: 0, cache: 0 }); p.kredit += Number(x.kredit); x.dari_cache ? p.cache++ : p.panggil++; }
        pemakaian = per;
      }
      return balas({ kategori: KATEGORI, pimpinan: staff.pimpinan, saldo: saldo?.totalRemain ?? null, dipakai_hari_ini: dipakai, batas: staff.batas, incaran, staff: staffList, akses: staff.pimpinan ? staff.akses : undefined, pemakaian });
    }

    if (b.aksi === "creator-cari") {
      const body: any = { ...DASAR, date_range: pilih(b.rentang, RENTANG, "last30Day"), page_number: Math.min(5, Math.max(1, Number(b.halaman) || 1)), page_size: 20,
        sort_field: { field: pilih(b.urut, URUT.creator, "revenue"), type: "DESC" }, creator_type: "INDEPENDENT" };
      const kat = kategoriIds(b.kategori); if (kat.length) body.category_ids = kat;
      const f = rentang(b.follower, 100_000_000); if (f) body.followers_range = f;
      const g = rentang(b.gmv, 10_000_000_000); if (g) body.revenue_range = g;
      if (b.kata) body.keyword = String(b.kata).slice(0, 40);
      return balas(await ambil(staff, "creator-cari", "rank", "/tiktok/creator/rank", body, 0.1));
    }

    // cari creator lewat @username (semua jenis creator, termasuk yang sudah di MCN lain); hasil yang handle-nya persis dinaikkan ke atas
    if (b.aksi === "creator-username") {
      const nama = String(b.username || "").trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9._]{2,40}$/.test(nama)) throw new Galat("USERNAME_SALAH");
      const body = { ...DASAR, date_range: pilih(b.rentang, RENTANG, "last30Day"), page_number: 1, page_size: 10, sort_field: { field: "revenue", type: "DESC" }, keyword: nama };
      const hsl: any = await ambil(staff, "creator-username", "rank", "/tiktok/creator/rank", body, 0.1);
      const persis = (x: any) => String(x.creator_handle || "").replace(/^@/, "").toLowerCase() === nama;
      return balas({ ...hsl, data: [...(hsl.data || [])].sort((a: any, c: any) => Number(persis(c)) - Number(persis(a))) });
    }

    if (b.aksi === "creator-detail") {
      const id = String(b.id || "");
      if (!/^\d+$/.test(id)) throw new Galat("ID_SALAH");
      return balas(await ambil(staff, "creator-detail", "detail", "/tiktok/creator/detail", { ...DASAR, date_range: "last30Day", creator_id: id, need_extra: true }, 0.1));
    }

    if (b.aksi === "toko-cari") {
      const body: any = { ...DASAR, date_range: pilih(b.rentang, RENTANG, "last30Day"), page_number: Math.min(5, Math.max(1, Number(b.halaman) || 1)), page_size: 20,
        sort_field: { field: pilih(b.urut, URUT.toko, "revenue"), type: "DESC" } };
      const kat = kategoriIds(b.kategori); if (kat.length) body.category_ids = kat;
      if (b.kata) body.keyword = String(b.kata).slice(0, 40);
      return balas(await ambil(staff, "toko-cari", "rank", "/tiktok/shop/rank", body, 0.1));
    }

    if (b.aksi === "video-cari") {
      const body: any = { ...DASAR, date_range: pilih(b.rentang, RENTANG, "last30Day"), page_number: Math.min(5, Math.max(1, Number(b.halaman) || 1)), page_size: 20,
        sort_field: { field: pilih(b.urut, URUT.video, "revenue"), type: "DESC" }, need_extra: true };
      const kat = kategoriIds(b.kategori); if (kat.length) body.category_ids = kat;
      if (b.kata) body.keyword = String(b.kata).slice(0, 40);
      return balas(await ambil(staff, "video-cari", "rank", "/tiktok/video/rank", body, 0.1));
    }

    if (b.aksi === "incaran-simpan") {
      const jenis = pilih(b.jenis, ["creator", "toko"] as const, "creator");
      const id = String(b.id || "");
      if (!/^\d+$/.test(id)) throw new Galat("ID_SALAH");
      const { data: ada } = await db.from("riset_incaran").select("id, oleh").eq("jenis", jenis).eq("kalo_id", id).maybeSingle();
      if (ada) return balas({ ok: true, sudah_ada: true, id: ada.id });
      const { data, error } = await db.from("riset_incaran").insert({ jenis, kalo_id: id, nama: String(b.nama || "").slice(0, 120), handle: String(b.handle || "").slice(0, 80), data: b.data && typeof b.data === "object" ? b.data : null, oleh: staff.id }).select("id").single();
      if (error) throw error;
      return balas({ ok: true, id: data.id });
    }

    if (b.aksi === "incaran-ubah") {
      const ubah: any = { diubah_at: new Date().toISOString() };
      if (["baru", "dihubungi", "bergabung", "tolak"].includes(b.status)) ubah.status = b.status;
      if (b.catatan !== undefined) ubah.catatan = String(b.catatan).slice(0, 1000);
      await db.from("riset_incaran").update(ubah).eq("id", b.id);
      return balas({ ok: true });
    }

    if (b.aksi === "atur") {
      if (!staff.pimpinan) throw new Galat("KHUSUS_PIMPINAN", 403);
      const ops = [];
      if (Array.isArray(b.akses)) ops.push(db.from("app_config").upsert({ key: "riset_akses", value: JSON.stringify(b.akses.map(String).slice(0, 50)) }));
      if (b.batas !== undefined) { const n = angka(b.batas); if (n === null || n < 0 || n > 100) throw new Galat("BATAS_SALAH"); ops.push(db.from("app_config").upsert({ key: "riset_batas", value: String(n) })); }
      await Promise.all(ops);
      return balas({ ok: true });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    if (e instanceof Galat) return balas({ galat: e.kode }, e.st);
    console.error("riset", e);
    return balas({ galat: "GAGAL" }, 500);
  }
});
