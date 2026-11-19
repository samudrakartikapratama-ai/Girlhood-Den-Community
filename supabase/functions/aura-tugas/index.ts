// Jadwal kerja harian Aura (dipanggil cron database, kunci rahasia dari Vault):
//  pagi   08.00 WIB  buat tugas dari data + kirim DM Lark ke tiap orang (KPI + tugas hari ini)
//  ingat  16.25 WIB  ingatkan yang belum setor
//  rekap  17.00 WIB  rekap ke skp & Gabriella: siapa setor, tugas selesai, opsi, progres KPI
//  senin  08.30 WIB  (Senin) daftar brand yang tidak merespons request sampel ke skp & AE
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LARK = "https://open.larksuite.com";
const LARK_ID = Deno.env.get("LARK_APP_ID") || "cli_aa5449215938df0a";
const LARK_SECRET = Deno.env.get("LARK_APP_SECRET") || "";
const URL_AURA = "girlhoodden.com/aura";

const rp = (n: number) => n >= 1e9 ? "Rp" + (n / 1e9).toFixed(2).replace(".", ",") + " M" : n >= 1e6 ? "Rp" + Math.round(n / 1e6) + " jt" : "Rp" + Math.round(n || 0).toLocaleString("id-ID");
const hariIni = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

let token: { t: string; sampai: number } | null = null;
async function lark(method: string, path: string, body?: unknown) {
  if (!token || token.sampai < Date.now() + 60_000) {
    const j = await fetch(LARK + "/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: LARK_ID, app_secret: LARK_SECRET }) }).then((r) => r.json());
    if (j.code !== 0) throw new Error("token Lark gagal: " + j.msg);
    token = { t: j.tenant_access_token, sampai: Date.now() + (j.expire - 60) * 1000 };
  }
  const j = await fetch(LARK + path, { method, headers: { "content-type": "application/json; charset=utf-8", authorization: "Bearer " + token.t }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  if (j.code !== 0) throw new Error(path.split("?")[0] + " gagal: " + j.code + " " + j.msg);
  return j.data || {};
}

// Kirim sekali per (jenis, tanggal, penerima): dicatat di kantor_lark_log dengan event_id unik.
async function kirim(jenis: string, openId: string, nama: string, teks: string) {
  const { data: log } = await db.from("kantor_lark_log").insert({
    event_id: `aura-${jenis}-${hariIni()}-${openId}`, chat_type: "p2p", pertanyaan: `[aura ${jenis} otomatis]`, jawaban: teks,
  }).select("id").maybeSingle();
  if (!log) return `${nama}: dilewati (sudah terkirim)`;
  try {
    const m = await lark("POST", "/open-apis/im/v1/messages?receive_id_type=open_id", { receive_id: openId, msg_type: "text", content: JSON.stringify({ text: teks.slice(0, 3800) }) });
    await db.from("kantor_lark_log").update({ chat_id: m.chat_id }).eq("id", log.id);
    return `${nama}: terkirim`;
  } catch (e) {
    await db.from("kantor_lark_log").update({ galat: String((e as Error)?.message || e).slice(0, 300) }).eq("id", log.id);
    return `${nama}: gagal (${String((e as Error)?.message || e).slice(0, 80)})`;
  }
}

// Satu baris ringkas per item data tugas
function baris(x: any): string {
  const nama = x.username ? "@" + x.username : x.brand || x.nama || "";
  const info: string[] = [];
  if (x.nama && x.username) info.push(x.nama);
  if (x.brand && x.nama) info.push(x.brand);
  if (x.gmv7_jt !== undefined) info.push(`7 hari ${x.gmv7_jt} jt (sebelumnya ${x.gmv_sebelum_jt} jt)`);
  if (x.hari_tidak_jualan !== undefined) info.push(`${x.hari_tidak_jualan} hari tidak jualan, 30 hari ${x.gmv30_jt} jt`);
  if (x.hari_sejak_terima !== undefined) info.push(`sampel sampai ${x.hari_sejak_terima} hari lalu`);
  if (x.menunggu !== undefined) info.push(`${x.menunggu} request menunggu, terlama ${x.paling_lama_hari} hari${x.pic_nama ? ", PIC " + x.pic_nama : ""}`);
  if (x.jumlah !== undefined) info.push(`${x.jumlah} sampel belum ada info kirim`);
  if (x.sudah_tutorial === false) info.push("belum tutorial");
  return "   • " + nama + (info.length ? " — " + info.join(", ") : "");
}

async function orangAktif() {
  const { data } = await db.from("aura_staff").select("staff_id, jalur, lark_open_id, kpi_target, internal_staff!inner(nama, is_active)").eq("aktif_tugas", true);
  return (data || []).filter((x: any) => x.internal_staff?.is_active && x.lark_open_id).map((x: any) => ({ ...x, nama: x.internal_staff.nama }));
}

async function kpiTeks(o: any): Promise<string> {
  if (o.jalur === "ae") {
    const awal = hariIni().slice(0, 8) + "01";
    const { data } = await db.from("kantor_endorse").select("nilai").gte("tanggal", awal);
    const total = (data || []).reduce((s: number, r: any) => s + Number(r.nilai || 0), 0);
    return `Endorse bulan ini: ${rp(total)}${o.kpi_target ? ` dari target ${rp(o.kpi_target)}` : ""}.`;
  }
  const { data: k } = await db.rpc("aura_kpi", { p_staff: o.staff_id });
  if (!k || !k.target) return "";
  const status = k.proyeksi >= k.target ? "ON TRACK" : "DI BAWAH TARGET";
  return `KPI GMV kamu bulan ini: ${rp(k.aktual)} dari ${rp(k.target)} (${k.persen}%). Proyeksi akhir bulan ${rp(k.proyeksi)} → ${status}. Perlu ${rp(k.perlu_per_hari)}/hari.`;
}

async function pagi() {
  const tgl = hariIni();
  const { data: n, error } = await db.rpc("aura_buat_tugas", { p_tanggal: tgl });
  if (error) throw new Error("buat tugas: " + error.message);
  if (!n && ![1, 2, 3, 4, 5].includes(new Date(tgl + "T12:00:00+07:00").getUTCDay())) return ["akhir pekan"];
  const hasil: string[] = [];
  for (const o of await orangAktif()) {
    const { data: tugas } = await db.from("aura_tugas").select("urut, judul, detail, data").eq("staff_id", o.staff_id).eq("tanggal", tgl).order("urut");
    if (!tugas?.length) continue;
    const kpi = await kpiTeks(o);
    const isi = tugas.map((t: any, i: number) => `${i + 1}) ${t.judul}\n   ${t.detail}` + ((t.data || []).length ? "\n" + t.data.map(baris).join("\n") : "")).join("\n\n");
    const teks = `Aura · Pagi ${o.nama}!\n\n${kpi ? kpi + "\n\n" : ""}TUGAS HARI INI\n\n${isi}\n\nJam 16.30 setor ke Aura (${URL_AURA}): ceritakan hasil tiap tugas, kendalanya, dan OPSI solusimu. Boleh lewat suara.`;
    hasil.push(await kirim("pagi", o.lark_open_id, o.nama, teks));
  }
  return hasil;
}

async function ingat() {
  const tgl = hariIni(), hasil: string[] = [];
  for (const o of await orangAktif()) {
    const { data: t } = await db.from("aura_tugas").select("dilapor_at").eq("staff_id", o.staff_id).eq("tanggal", tgl);
    if (!t?.length) continue;
    const belum = t.filter((x: any) => !x.dilapor_at).length;
    if (!belum) continue;
    hasil.push(await kirim("ingat", o.lark_open_id, o.nama, `Aura · ${o.nama}, waktunya setor. Masih ${belum} dari ${t.length} tugas hari ini belum dilaporkan.\nBuka ${URL_AURA} → ngomong ke Aura atau tab Tugas. Rekap dikirim ke skp & Bu Gabriella jam 17.00.`));
  }
  return hasil;
}

async function penerimaPimpinan(): Promise<{ nama: string; open_id: string }[]> {
  const { data } = await db.from("app_config").select("value").eq("key", "aura_rekap_penerima").maybeSingle();
  return JSON.parse(String(data?.value || "[]"));
}

async function rekap() {
  const tgl = hariIni(), bagian: string[] = [];
  for (const o of await orangAktif()) {
    const { data: t } = await db.from("aura_tugas").select("urut, judul, status, hasil, kendala, opsi, dilapor_at").eq("staff_id", o.staff_id).eq("tanggal", tgl).order("urut");
    if (!t?.length) continue;
    const lapor = t.filter((x: any) => x.dilapor_at), selesai = t.filter((x: any) => x.status === "selesai"), opsi = t.filter((x: any) => (x.opsi || "").trim());
    const kpi = await kpiTeks(o);
    let s = `${lapor.length ? "✅" : "❌"} ${o.nama}: ${lapor.length ? `setor ${lapor.length}/${t.length} tugas, selesai ${selesai.length}, bawa opsi ${opsi.length}` : "BELUM SETOR"}`;
    if (kpi) s += `\n   ${kpi.replace(/^KPI GMV kamu/, "KPI")}`;
    for (const x of t.filter((x: any) => x.dilapor_at)) {
      s += `\n   ${x.urut}. ${x.judul} → ${x.status}${x.hasil ? ": " + String(x.hasil).slice(0, 160) : ""}${x.kendala ? " | kendala: " + String(x.kendala).slice(0, 120) : ""}${x.opsi ? " | opsi: " + String(x.opsi).slice(0, 160) : ""}`;
    }
    bagian.push(s);
  }
  if (!bagian.length) return ["tidak ada tugas hari ini"];
  const teks = `Aura · Rekap kerja ${tgl}\n\n${bagian.join("\n\n")}\n\nRincian: ${URL_AURA} → Tugas`;
  const hasil: string[] = [];
  for (const p of await penerimaPimpinan()) hasil.push(await kirim("rekap", p.open_id, p.nama, teks));
  return hasil;
}

async function senin() {
  const { data } = await db.rpc("aura_brand_diam");
  const daftar = (data || []) as any[];
  const isi = daftar.length
    ? daftar.map((b, i) => `${i + 1}) ${b.brand}: ${b.diabaikan} request hangus/menunggu dari ${b.total} (7 hari terakhir)${b.pic_nama ? ", PIC " + b.pic_nama : ""}`).join("\n")
    : "Tidak ada brand yang mengabaikan request minggu lalu.";
  const teks = `Aura · Brand yang tidak merespons request sampel (7 hari terakhir)\n\n${isi}\n\nAE: hubungi PIC-nya minggu ini, minta approve/tolak dengan alasan, dan tawarkan aturan approve otomatis.`;
  const penerima = [...await penerimaPimpinan()].filter((p) => /skp/i.test(p.nama));
  const { data: ae } = await db.from("aura_staff").select("lark_open_id, internal_staff!inner(nama, is_active)").eq("jalur", "ae");
  for (const a of (ae || []) as any[]) if (a.lark_open_id && a.internal_staff?.is_active) penerima.push({ nama: a.internal_staff.nama, open_id: a.lark_open_id });
  const hasil: string[] = [];
  for (const p of penerima) hasil.push(await kirim("senin", p.open_id, p.nama, teks));
  return hasil;
}

Deno.serve(async (req) => {
  const kunci = req.headers.get("x-kantor-kunci");
  const { data: ok } = kunci ? await db.rpc("kantor_cek_kunci_olah", { p_kunci: kunci }) : { data: false };
  if (ok !== true) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const kerja: Record<string, () => Promise<string[]>> = { pagi, ingat, rekap, senin };
  if (!kerja[b.jenis]) return new Response("bad", { status: 400 });
  try { return new Response(JSON.stringify({ ok: true, hasil: await kerja[b.jenis]() }), { headers: { "content-type": "application/json" } }); }
  catch (e) { console.error(b.jenis, e); return new Response(JSON.stringify({ ok: false, galat: String((e as Error)?.message || e) }), { status: 500 }); }
});
