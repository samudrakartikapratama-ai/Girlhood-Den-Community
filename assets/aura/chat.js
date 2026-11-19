// Chat Aura + suara (bicara ke Aura dengan mic, Aura menjawab dengan suara).
// Dipanggil dari aura.html: Aura.mulai({ sb, url, anon, nama }).
(function () {
  const $ = id => document.getElementById(id);
  const A = window.Aura = window.Aura || {};
  let cfg = null, sibuk = false, modeSuara = false;

  // ---------- server ----------
  async function panggil(isi) {
    const { data } = await cfg.sb.auth.getSession();
    const h = { 'Content-Type': 'application/json', apikey: cfg.anon };
    if (data.session) h.Authorization = 'Bearer ' + data.session.access_token;
    const r = await fetch(cfg.url + '/functions/v1/aura', { method: 'POST', headers: h, body: JSON.stringify(isi) });
    const j = await r.json().catch(() => ({ galat: 'JARINGAN' }));
    if (!r.ok) throw Object.assign(new Error(j.galat || 'GAGAL'), { data: j });
    return j;
  }

  // ---------- tampilan pesan ----------
  function tambah(peran, teks, opsi = {}) {
    const box = $('percakapan');
    box.classList.remove('hidden');
    const el = document.createElement('div');
    el.className = 'msg ' + (peran === 'user' ? 'saya' : 'aura') + (opsi.sementara ? ' sementara' : '');
    el.textContent = teks;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }
  A.tambahPesan = tambah;

  function infoKuota(k, jam) {
    const el = $('info-chat');
    if (jam && jam.tutup) { el.textContent = 'Aura melayani tim sampai jam 17.00. Sampai besok!'; kunci(true); return; }
    kunci(false);
    if (k) el.textContent = k.pakai >= k.batas ? 'Jatah chat hari ini habis (' + k.batas + '). Minta tambahan ke skp lewat Kantor AI.' : 'Sisa ' + (k.batas - k.pakai) + ' chat hari ini';
  }
  function kunci(ya) {
    $('chat-isi').disabled = ya; $('btn-kirim').disabled = ya; $('btn-mic').disabled = ya;
    $('chat-isi').placeholder = ya ? 'Aura sedang istirahat' : 'Tanya Aura…';
  }

  const PESAN_GALAT = {
    TUTUP: 'Aura melayani tim sampai jam 17.00. Lanjut besok ya.',
    KUOTA: 'Jatah chat hari ini sudah habis. Minta tambahan ke skp lewat Kantor AI.',
    PENUH: 'Aura sedang ramai sekali hari ini. Coba lagi sebentar lagi.',
    SALDO: 'Saldo API Aura habis. skp perlu mengisi ulang di console.anthropic.com.',
    BUKAN_INTERNAL: 'Sesi kamu habis. Keluar lalu masuk lagi.',
  };

  async function kirim(teks, lewatSuara) {
    teks = (teks || '').trim();
    if (!teks || sibuk) return;
    sibuk = true; modeSuara = !!lewatSuara;
    tambah('user', teks);
    $('chat-isi').value = '';
    const tunggu = tambah('aura', 'Aura sedang berpikir…', { sementara: true });
    if (window.orbEnergi) orbEnergi(1);
    try {
      const j = await panggil({ aksi: 'chat', pesan: teks, suara: modeSuara });
      tunggu.remove();
      tambah('aura', j.jawab.isi);
      infoKuota(j.kuota);
      if (modeSuara) ucap(j.jawab.isi);
    } catch (e) {
      tunggu.remove();
      const t = PESAN_GALAT[e.message] || 'Aura gagal menjawab. Coba lagi sebentar lagi.';
      tambah('aura', t);
      if (e.data && (e.data.kuota || e.data.jam)) infoKuota(e.data.kuota, e.data.jam);
      if (modeSuara) ucap(t);
    } finally {
      sibuk = false;
      if (window.orbEnergi && !speechSynthesis.speaking) orbEnergi(0);
    }
  }
  A.kirim = kirim;

  // ---------- suara keluar (Aura bicara) ----------
  let suaraId = null;
  function pilihSuara() {
    const v = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    suaraId = v.find(x => /^id/i.test(x.lang) && /female|wanita|damayanti|gadis/i.test(x.name)) || v.find(x => /^id/i.test(x.lang)) || null;
  }
  if (window.speechSynthesis) { pilihSuara(); speechSynthesis.onvoiceschanged = pilihSuara; }
  function ucap(teks) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const bersih = teks.replace(/[*_#|>`]/g, '').replace(/\n+/g, '. ');
    const u = new SpeechSynthesisUtterance(bersih);
    u.lang = 'id-ID'; if (suaraId) u.voice = suaraId; u.rate = 1.03;
    u.onstart = () => window.orbEnergi && orbEnergi(0.8);
    u.onend = u.onerror = () => window.orbEnergi && orbEnergi(0);
    speechSynthesis.speak(u);
  }
  A.ucap = ucap;
  A.diam = () => window.speechSynthesis && speechSynthesis.cancel();

  // ---------- suara masuk (bicara ke Aura) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rek = null, mendengar = false;
  function dengar() {
    if (!SR || mendengar || sibuk || $('btn-mic').disabled) return false;
    A.diam();
    rek = new SR(); rek.lang = 'id-ID'; rek.interimResults = true; rek.continuous = false;
    let akhir = '';
    rek.onstart = () => { mendengar = true; $('btn-mic').classList.add('aktif'); $('chat-isi').placeholder = 'Aura mendengarkan…'; window.orbEnergi && orbEnergi(0.6); if (A.saatMendengar) A.saatMendengar(true); };
    rek.onresult = ev => {
      let sementara = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) akhir += ev.results[i][0].transcript; else sementara += ev.results[i][0].transcript;
      }
      $('chat-isi').value = (akhir + ' ' + sementara).trim();
    };
    rek.onerror = ev => { if (ev.error === 'not-allowed') $('info-chat').textContent = 'Izinkan mikrofon di browser supaya bisa bicara dengan Aura.'; };
    rek.onend = () => {
      mendengar = false; $('btn-mic').classList.remove('aktif'); $('chat-isi').placeholder = 'Tanya Aura…';
      if (window.orbEnergi && !sibuk) orbEnergi(0);
      if (A.saatMendengar) A.saatMendengar(false);
      const t = ($('chat-isi').value || akhir).trim();
      if (t) kirim(t, true);
    };
    try { rek.start(); } catch (e) { return false; }
    return true;
  }
  A.dengar = dengar;

  // ---------- pasang ----------
  A.mulai = async function (c) {
    cfg = c;
    if (!SR) $('btn-mic').classList.add('hidden');
    $('form-chat').onsubmit = ev => { ev.preventDefault(); kirim($('chat-isi').value, false); };
    $('btn-mic').onclick = () => { if (mendengar && rek) rek.stop(); else dengar(); };
    try {
      const j = await panggil({ aksi: 'riwayat' });
      $('percakapan').innerHTML = '';
      (j.pesan || []).forEach(p => tambah(p.peran === 'assistant' ? 'aura' : 'user', p.isi));
      if (!(j.pesan || []).length) $('percakapan').classList.add('hidden');
      infoKuota(j.kuota, j.jam);
    } catch (e) {
      $('info-chat').textContent = 'Riwayat chat belum bisa dimuat.';
    }
  };
})();
