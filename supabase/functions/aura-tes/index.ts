// Tes tim di Aura: gaya kerja, logika & angka, studi kasus. Ada batas waktu per bagian (dicatat di server).
// Peserta hanya melihat soal; kunci & skor hanya untuk pimpinan (CEO/COO) dan dikirim ke Lark skp & Gabriella.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ARTI_GAYA, Bagian, JUDUL, KASUS, LOGIKA, nilaiGaya, nilaiLogika, RUBRIK, soalUntukKlien, URUTAN, WAKTU } from "./soal.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const LARK = "https://open.larksuite.com";
const LARK_ID = Deno.env.get("LARK_APP_ID") || "cli_aa5449215938df0a";
const LARK_SECRET = Deno.env.get("LARK_APP_SECRET") || "";
const LONGGAR = 60; // detik toleransi jaringan
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "origin",
});

// Aura hanya menerima sesi yang dibuka lewat Face ID / sidik jari (bukan kode staff)
function idSesi(jwt: string): string | null {
  try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id || null; } catch { return null; }
}
async function sesiSah(jwt: string, staffId: string) {
  const sesi = idSesi(jwt);
  if (!sesi) return false;
  const { data } = await db.rpc("aura_sesi_sah", { p_sesi: sesi, p_staff: staffId });
  return data === true;
}

async function staffDari(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: s } = await db.from("internal_staff").select("id, nama").eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
  if (!s || !(await sesiSah(jwt, s.id))) return null;
  const { data: cfg } = await db.from("app_config").select("key, value").in("key", ["kantor_ceo", "kantor_coo"]);
  return { id: s.id as string, nama: s.nama as string, pimpinan: (cfg || []).some((c) => c.value === s.id) };
}

async function kirimLark(teks: string) {
  try {
    const { data: cfg } = await db.from("app_config").select("value").eq("key", "aura_rekap_penerima").maybeSingle();
    const daftar: { open_id: string }[] = JSON.parse(String(cfg?.value || "[]"));
    const t = await fetch(LARK + "/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: LARK_ID, app_secret: LARK_SECRET }) }).then((r) => r.json());
    for (const p of daftar) {
      await fetch(LARK + "/open-apis/im/v1/messages?receive_id_type=open_id", {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8", authorization: "Bearer " + t.tenant_access_token },
        body: JSON.stringify({ receive_id: p.open_id, msg_type: "text", content: JSON.stringify({ text: teks.slice(0, 3800) }) }),
      });
    }
  } catch (e) { console.error("lark", e); }
}

function statusBagian(s: any) {
  const now = Date.now();
  const out: Record<string, any> = {};
  for (const b of URUTAN) {
    const m = s.mulai?.[b], sel = s.selesai?.[b];
    out[b] = sel ? { status: "selesai" } : m ? { status: "jalan", sisa: Math.max(0, Math.round((Date.parse(m) + WAKTU[b] * 1000 - now) / 1000)) } : { status: "belum", waktu: WAKTU[b] };
  }
  return out;
}

async function nilaiKasus(jawab: Record<string, string>) {
  const isi = KASUS.map((k) => `### ${k.id} · ${k.judul}\nSOAL:\n${k.teks}\n\nJAWABAN PESERTA:\n${(jawab?.[k.id] || "(kosong)").slice(0, 6000)}`).join("\n\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5", max_tokens: 2000,
      system: "Kamu penilai asesmen rekrutmen yang ketat dan adil untuk agensi MCN TikTok (Girlhood Den). Nilai hanya dari isi jawaban, jangan murah hati.\n\n" + RUBRIK,
      messages: [{ role: "user", content: isi + '\n\nBalas HANYA JSON valid: {"k1":{"struktur":n,"data":n,"akar_masalah":n,"opsi":n,"eksekusi":n,"catatan":"1-2 kalimat"},"k2":{...},"k3":{...},"tanda_bahaya":["..."],"kekuatan":["..."]}' }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Claude " + r.status);
  const teks = (j.content || []).map((b: any) => b.text || "").join("");
  const hasil = JSON.parse(teks.slice(teks.indexOf("{"), teks.lastIndexOf("}") + 1));
  let total = 0, n = 0;
  for (const k of KASUS) for (const d of ["struktur", "data", "akar_masalah", "opsi", "eksekusi"]) { total += Number(hasil[k.id]?.[d]) || 0; n++; }
  hasil.rata = Math.round((total / n) * 10) / 10;
  return hasil;
}

async function ringkasan(nama: string, peran: string, gaya: any, logika: any, kasus: any, catatan: any) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5", max_tokens: 600,
      system: "Kamu membantu CEO Girlhood Den (MCN TikTok affiliate beauty) membaca hasil tes karyawan baru. Bahasa Indonesia sehari-hari, lugas, tanpa markdown. Prinsip CEO: karyawan wajib bawa opsi, sense of business, keputusan logis dan sistematis.",
      messages: [{ role: "user", content: `Karyawan: ${nama} (${peran}).\nGaya kerja: ${JSON.stringify(gaya)}\nLogika: ${JSON.stringify(logika)}\nStudi kasus: ${JSON.stringify(kasus)}\nCatatan pengerjaan: ${JSON.stringify(catatan)}\n\nTulis maksimal 5 kalimat: karakter kerjanya, ketajaman insting bisnisnya, risiko terbesar untuk perannya, dan cara terbaik CEO mengelolanya.` }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  return (j.content || []).map((b: any) => b.text || "").join("").trim();
}

async function selesaikan(sesiId: string) {
  const { data: s } = await db.from("aura_tes_sesi").select("*, internal_staff!aura_tes_sesi_staff_id_fkey(nama)").eq("id", sesiId).single();
  if (!s || s.status === "selesai") return;
  const gaya = nilaiGaya(s.jawaban?.gaya || {});
  const logika = nilaiLogika(s.jawaban?.logika || {});
  let kasus: any = null;
  try { kasus = await nilaiKasus(s.jawaban?.kasus || {}); } catch (e) { kasus = { galat: String((e as Error)?.message || e) }; }
  const catatan: Record<string, any> = {};
  for (const b of URUTAN) {
    const m = Date.parse(s.mulai?.[b]), sel = Date.parse(s.selesai?.[b]);
    catatan[b] = { menit: Math.round((sel - m) / 6000) / 10, terlambat: sel - m > (WAKTU[b] + LONGGAR) * 1000, keluar_halaman: s.jawaban?.[b + "_keluar"] || 0 };
  }
  const nama = s.internal_staff?.nama || "?";
  const { data: p } = await db.from("aura_staff").select("peran_kerja").eq("staff_id", s.staff_id).maybeSingle();
  const peran = p?.peran_kerja || "tim internal";
  const kesimpulan = await ringkasan(nama, peran, gaya, logika, kasus, catatan).catch(() => "");
  const skor = { gaya, logika, kasus, catatan, kesimpulan };
  await db.from("aura_tes_sesi").update({ skor, status: "selesai", selesai_at: new Date().toISOString() }).eq("id", sesiId);
  const g = gaya.skor;
  await kirimLark(`Hasil tes ${nama} (${peran}) — rahasia, hanya untuk skp & Gabriella\n\n`
    + `Gaya kerja: ${gaya.utama}/${gaya.kedua} (D ${g.D}, I ${g.I}, S ${g.S}, C ${g.C})\n${ARTI_GAYA[gaya.utama as "D"]}\n\n`
    + `Logika & angka: ${logika.benar}/${logika.total} benar, skor berbobot ${logika.persen_berbobot}% (${logika.kategori})\n`
    + `Studi kasus: rata-rata ${kasus?.rata ?? "-"}/5 (3 = setara lulusan baru yang baik, 4 = profesional berpengalaman)\n\n`
    + `Pengerjaan: ` + URUTAN.map((b) => `${b} ${catatan[b].menit} mnt${catatan[b].terlambat ? " (lewat waktu)" : ""}${catatan[b].keluar_halaman ? `, keluar halaman ${catatan[b].keluar_halaman}×` : ""}`).join(" · ")
    + (kesimpulan ? `\n\n${kesimpulan}` : "") + `\n\nRincian lengkap: girlhoodden.com/aura → Tes`);
}

Deno.serve(async (req) => {
  const o = req.headers.get("origin") || "";
  const h = { ...cors(o), "content-type": "application/json" };
  const balas = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o) });
  const staff = await staffDari(req);
  if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
  let b: any = {};
  try { b = await req.json(); } catch { return balas({ galat: "FORMAT" }, 400); }

  try {
    const sesiSaya = async () => (await db.from("aura_tes_sesi").select("*").eq("staff_id", staff.id).neq("status", "selesai").order("dibuat_at", { ascending: false }).limit(1).maybeSingle()).data;

    if (b.aksi === "status") {
      const s = await sesiSaya();
      const out: any = { pimpinan: staff.pimpinan, sesi: s ? { id: s.id, bagian: statusBagian(s) } : null, judul: JUDUL };
      if (staff.pimpinan) {
        const { data: semua } = await db.from("aura_tes_sesi").select("id, staff_id, status, dibuat_at, selesai_at, skor, mulai, selesai").order("dibuat_at", { ascending: false }).limit(50);
        const { data: orang } = await db.from("internal_staff").select("id, nama").eq("is_active", true).order("nama");
        out.daftar = (semua || []).map((x) => ({ ...x, nama: (orang || []).find((p) => p.id === x.staff_id)?.nama || "?", bagian: statusBagian(x) }));
        out.orang = orang;
      }
      return balas(out);
    }

    if (b.aksi === "buat") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const { data, error } = await db.from("aura_tes_sesi").insert({ staff_id: b.staff_id, dibuat_oleh: staff.id }).select("id").single();
      if (error) throw error;
      return balas({ id: data.id });
    }

    // Rincian jawaban untuk dinilai pimpinan (jawaban kasus apa adanya, logika benar/salah per soal)
    if (b.aksi === "detail") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const { data: s } = await db.from("aura_tes_sesi").select("*").eq("id", b.id).single();
      if (!s) return balas({ galat: "TIDAK_ADA" }, 404);
      const jl = s.jawaban?.logika || {};
      return balas({
        kasus: KASUS.map((k) => ({ ...k, jawaban: s.jawaban?.kasus?.[k.id] || "" })),
        logika: LOGIKA.map((q) => ({ id: q.id, level: q.level, jenis: q.jenis, tanya: q.tanya, dipilih: (q.opsi.find((o) => o[0] === jl[q.id]) || [])[1] || "", kunci: (q.opsi.find((o) => o[0] === q.kunci) || [])[1], benar: jl[q.id] === q.kunci })),
        skp: s.skor?.skp || null,
      });
    }
    if (b.aksi === "nilai") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const { data: s } = await db.from("aura_tes_sesi").select("skor").eq("id", b.id).single();
      if (!s?.skor) return balas({ galat: "BELUM_SELESAI" }, 409);
      const skp = { keputusan: String(b.keputusan || ""), kasus: Number(b.kasus) || null, catatan: String(b.catatan || "").slice(0, 3000), oleh: staff.nama, at: new Date().toISOString() };
      await db.from("aura_tes_sesi").update({ skor: { ...s.skor, skp } }).eq("id", b.id);
      return balas({ ok: true });
    }

    if (b.aksi === "hapus") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      await db.from("aura_tes_sesi").delete().eq("id", b.id);
      return balas({ ok: true });
    }

    if (b.aksi === "mulai" || b.aksi === "simpan" || b.aksi === "kirim") {
      const bagian = b.bagian as Bagian;
      if (!URUTAN.includes(bagian)) return balas({ galat: "BAGIAN" }, 400);
      const s = await sesiSaya();
      if (!s) return balas({ galat: "TIDAK_ADA_TES" }, 404);
      const urutKe = URUTAN.indexOf(bagian);
      if (urutKe > 0 && !s.selesai?.[URUTAN[urutKe - 1]]) return balas({ galat: "URUTAN" }, 400);
      if (s.selesai?.[bagian]) return balas({ galat: "SUDAH_SELESAI" }, 409);

      if (b.aksi === "mulai") {
        const mulai = s.mulai?.[bagian] || new Date().toISOString();
        if (!s.mulai?.[bagian]) await db.from("aura_tes_sesi").update({ mulai: { ...s.mulai, [bagian]: mulai }, status: "jalan" }).eq("id", s.id);
        const sisa = Math.max(0, Math.round((Date.parse(mulai) + WAKTU[bagian] * 1000 - Date.now()) / 1000));
        return balas({ bagian, soal: soalUntukKlien(bagian), sisa, waktu: WAKTU[bagian], draf: s.jawaban?.[bagian] || {}, ...JUDUL[bagian] });
      }

      if (!s.mulai?.[bagian]) return balas({ galat: "BELUM_MULAI" }, 400);
      const jawaban = { ...s.jawaban, [bagian]: b.jawaban || {}, [bagian + "_keluar"]: Number(b.keluar) || 0 };
      const upd: any = { jawaban };
      if (b.aksi === "kirim") upd.selesai = { ...s.selesai, [bagian]: new Date().toISOString() };
      else if (Date.now() > Date.parse(s.mulai[bagian]) + (WAKTU[bagian] + LONGGAR) * 1000) return balas({ galat: "WAKTU_HABIS" }, 409);
      await db.from("aura_tes_sesi").update(upd).eq("id", s.id);
      if (b.aksi === "kirim" && bagian === "kasus") {
        const kerja = selesaikan(s.id).catch((e) => console.error("nilai", e));
        // @ts-ignore
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(kerja); else await kerja;
        return balas({ ok: true, selesai: true });
      }
      return balas({ ok: true });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    console.error("aura-tes", e);
    return balas({ galat: "GAGAL" }, 500);
  }
});
