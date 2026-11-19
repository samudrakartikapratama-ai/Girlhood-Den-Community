// Aura: mode suara (bawaan: hanya kamu dan orb, Aura menyapa & bertanya duluan, lalu bergantian bicara-dengar)
// dan mode ketik (chat biasa). Dipanggil dari aura.html: Aura.mulai({ sb, url, anon, nama }).
(function () {
  const $ = id => document.getElementById(id);
  const A = window.Aura = window.Aura || {};
  let cfg = null, sibuk = false, keadaan = 'diam'; // diam | bicara | dengar | pikir
  let sapaanTertunda = null;

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
  const PESAN_GALAT = {
    TUTUP: 'Aku melayani tim sampai jam 17.00. Lanjut besok ya.',
    KUOTA: 'Jatah chat hari ini sudah habis. Minta tambahan ke skp lewat Kantor AI.',
    PENUH: 'Aku sedang ramai sekali hari ini. Coba lagi sebentar lagi.',
    SALDO: 'Saldo API Aura habis. skp perlu mengisi ulang di console.anthropic.com.',
    BUKAN_INTERNAL: 'Sesi kamu habis. Keluar lalu masuk lagi.',
  };

  // ---------- mode ----------
  const suaraMode = () => document.body.classList.contains('mode-suara');
  function setMode(m) {
    document.body.classList.toggle('mode-suara', m === 'suara');
    $('ruang-ketik').classList.toggle('hidden', m === 'suara');
    $('ruang-suara').classList.toggle('hidden', m !== 'suara');
    try { localStorage.setItem('aura-mode', m); } catch (e) {}
    if (m !== 'suara') { berhentiDengar(); A.diam(); setKeadaan('diam'); }
  }
  A.setMode = setMode;

  function setKeadaan(k, teks) {
    keadaan = k;
    const st = { diam: A.tepukAktif ? 'Ketuk Aura atau tepuk 2× untuk bicara' : 'Ketuk Aura untuk bicara', bicara: 'Aura bicara · ketuk untuk menyela', dengar: 'Aku mendengarkan…', pikir: 'Aura berpikir…' };
    $('status-suara').textContent = teks || st[k];
    document.body.dataset.aura = k;
    if (window.orbEnergi) orbEnergi(k === 'pikir' ? 1 : k === 'bicara' ? 0.8 : k === 'dengar' ? 0.55 : 0);
  }

  // ---------- log ketik ----------
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
    if (jam && jam.tutup) { el.textContent = 'Aura melayani tim sampai jam 17.00. Sampai besok!'; return; }
    if (k) el.textContent = k.pakai >= k.batas ? 'Jatah chat hari ini habis (' + k.batas + ').' : 'Sisa ' + (k.batas - k.pakai) + ' chat hari ini';
  }

  // ---------- Aura bicara ----------
  let suaraId = null;
  function pilihSuara() {
    const v = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    suaraId = v.find(x => /^id/i.test(x.lang) && /damayanti|female|wanita|gadis/i.test(x.name)) || v.find(x => /^id/i.test(x.lang)) || null;
  }
  if (window.speechSynthesis) { pilihSuara(); speechSynthesis.onvoiceschanged = pilihSuara; }
  const bolehBicara = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;

  // ucap(teks, lanjutDengar): tampilkan teks besar + bacakan; setelah selesai, kalau mode suara, langsung mendengarkan.
  function ucap(teks, lanjutDengar = true) {
    $('kata-aura').textContent = teks;
    $('kata-saya').textContent = '';
    if (!window.speechSynthesis || !bolehBicara()) {
      sapaanTertunda = teks; setKeadaan('diam', 'Ketuk Aura untuk mendengar');
      return;
    }
    sapaanTertunda = null;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(teks.replace(/[*_#|>`]/g, '').replace(/\n+/g, '. '));
    u.lang = 'id-ID'; if (suaraId) u.voice = suaraId; u.rate = 1.03;
    u.onstart = () => setKeadaan('bicara');
    u.onend = () => { if (keadaan !== 'bicara') return; setKeadaan('diam'); if (lanjutDengar && suaraMode()) setTimeout(dengar, 250); };
    u.onerror = () => { if (keadaan === 'bicara') setKeadaan('diam'); };
    speechSynthesis.speak(u);
  }
  A.ucap = ucap;
  A.diam = () => { if (window.speechSynthesis) speechSynthesis.cancel(); };

  // ---------- kirim pertanyaan ----------
  async function kirim(teks, lewatSuara) {
    teks = (teks || '').trim();
    if (!teks || sibuk) return;
    sibuk = true;
    tambah('user', teks);
    $('chat-isi').value = '';
    const tunggu = lewatSuara ? null : tambah('aura', 'Aura sedang berpikir…', { sementara: true });
    setKeadaan('pikir');
    try {
      const j = await panggil({ aksi: 'chat', pesan: teks, suara: !!lewatSuara });
      if (tunggu) tunggu.remove();
      tambah('aura', j.jawab.isi);
      infoKuota(j.kuota);
      setKeadaan('diam');
      if (lewatSuara) ucap(j.jawab.isi);
    } catch (e) {
      if (tunggu) tunggu.remove();
      const t = PESAN_GALAT[e.message] || 'Maaf, aku gagal menjawab. Coba lagi sebentar lagi.';
      tambah('aura', t);
      if (e.data) infoKuota(e.data.kuota, e.data.jam);
      setKeadaan('diam');
      if (lewatSuara) ucap(t, false);
    } finally { sibuk = false; }
  }
  A.kirim = kirim;

  // ---------- kamu bicara ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rek = null;
  function berhentiDengar() { if (rek) { try { rek.abort(); } catch (e) {} rek = null; } }
  function dengar() {
    if (!SR) { setKeadaan('diam', 'Browser ini belum bisa mendengar. Pakai Chrome atau Safari, atau ketik saja.'); return false; }
    if (sibuk || keadaan === 'dengar') return false;
    A.diam();
    rek = new SR(); rek.lang = 'id-ID'; rek.interimResults = true; rek.continuous = false;
    let akhir = '', sementara = '';
    rek.onstart = () => { setKeadaan('dengar'); $('kata-saya').textContent = ''; if (A.saatMendengar) A.saatMendengar(true); };
    rek.onresult = ev => {
      sementara = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) akhir += ev.results[i][0].transcript; else sementara += ev.results[i][0].transcript;
      }
      $('kata-saya').textContent = (akhir + ' ' + sementara).trim();
    };
    rek.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') setKeadaan('diam', 'Izinkan mikrofon di browser supaya aku bisa mendengar.'); };
    rek.onend = () => {
      rek = null;
      if (A.saatMendengar) A.saatMendengar(false);
      const t = (akhir || sementara).trim();
      if (keadaan === 'dengar') setKeadaan('diam');
      if (t) kirim(t, true);
    };
    try { rek.start(); } catch (e) { return false; }
    return true;
  }
  A.dengar = dengar;

  // ---------- orb sebagai tombol ----------
  function ketukOrb() {
    if (!suaraMode()) { setMode('suara'); }
    if (keadaan === 'bicara') { A.diam(); setKeadaan('diam'); dengar(); return; }
    if (keadaan === 'dengar') { if (rek) rek.stop(); return; }
    if (keadaan === 'pikir') return;
    if (sapaanTertunda) { ucap(sapaanTertunda); return; }
    dengar();
  }
  A.panggil = () => { if (keadaan === 'diam' && !sibuk) ketukOrb(); };

  // Aura membuka percakapan
  async function sapa() {
    setKeadaan('pikir', 'Aura bersiap…');
    try {
      const j = await panggil({ aksi: 'sapa' });
      if (j.baru) tambah('aura', j.teks);
      setKeadaan('diam');
      ucap(j.teks, !j.tutup);
    } catch (e) {
      setKeadaan('diam');
      ucap('Halo ' + cfg.nama + '. Aku Aura. Ada yang mau dibahas?', true);
    }
  }
  A.sapa = sapa;

  // ---------- pasang ----------
  let terpasang = false;
  A.mulai = async function (c) {
    cfg = c;
    if (!terpasang) {
      terpasang = true;
      $('orb-tombol').onclick = ketukOrb;
      $('ke-ketik').onclick = () => setMode('ketik');
      $('btn-mic').onclick = () => { setMode('suara'); dengar(); };
      $('form-chat').onsubmit = ev => { ev.preventDefault(); kirim($('chat-isi').value, false); };
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && suaraMode()) setMode('ketik'); });
    }
    let m = 'suara'; try { m = localStorage.getItem('aura-mode') || 'suara'; } catch (e) {}
    setMode(m);
    try {
      const j = await panggil({ aksi: 'riwayat' });
      $('percakapan').innerHTML = '';
      (j.pesan || []).forEach(p => tambah(p.peran === 'assistant' ? 'aura' : 'user', p.isi));
      if (!(j.pesan || []).length) $('percakapan').classList.add('hidden');
      infoKuota(j.kuota, j.jam);
    } catch (e) { $('info-chat').textContent = 'Riwayat chat belum bisa dimuat.'; }
    if (suaraMode() && !c.tundaSapa) sapa();
  };
})();
