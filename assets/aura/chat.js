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
    if (m !== 'suara') { akhiriSesi(); A.diam(); }
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
    u.onend = () => { if (keadaan !== 'bicara') return; setKeadaan('diam'); if (lanjutDengar && suaraMode()) { sesi = true; terakhirSuara = Date.now(); setTimeout(jalankanDengar, 250); } else if (!lanjutDengar) akhiriSesi(); };
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

  // ---------- kamu bicara: sesi ngobrol, mic tetap menyala sampai kamu mengetuk orb ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // nama yang sering salah tangkap oleh pengenal suara browser
  const KOREKSI = [
    [/\b(girl ?hood ?(den|then|dan)|golden ?(den|then|dan)|gold ?in ?den|gol ?den ?den|gerl ?hud ?den|golden|gold in|gol den|girl ?hood|gerl ?hud)\b/gi, 'Girlhood Den'],
    [/\b(kimi|kime|kim)\b/gi, 'KIME'], [/\bhana ?su[iy]\b/gi, 'Hanasui'], [/\bsatur ?nine?\b/gi, 'Saturnine'],
    [/\bfast ?moss\b/gi, 'FastMoss'], [/\b(ge em ve|gmf|gm v)\b/gi, 'GMV'], [/\bskin ?(seribu|1000) ?(empat|4)\b/gi, 'SKIN1004'],
  ];
  const koreksi = t => KOREKSI.reduce((a, [r, g]) => a.replace(r, g), t);
  let rek = null, sesi = false, kumpul = '', sementara = '', jeda = 0, terakhirSuara = 0;
  const SEPI_MS = 90000;

  function berhentiDengar() { const r = rek; rek = null; clearTimeout(jeda); if (r) { try { r.abort(); } catch (e) {} } }
  function akhiriSesi(teks) { sesi = false; berhentiDengar(); kumpul = sementara = ''; if (A.saatMendengar) A.saatMendengar(false); setKeadaan('diam', teks); }
  function mulaiSesi() {
    if (!SR) { setKeadaan('diam', 'Browser ini belum bisa mendengar. Pakai Chrome atau Safari, atau ketik saja.'); return false; }
    sesi = true; terakhirSuara = Date.now(); jalankanDengar(); return true;
  }
  function kirimKumpulan() {
    const t = koreksi((kumpul + ' ' + sementara).replace(/\s+/g, ' ').trim());
    kumpul = sementara = '';
    if (!t) return;
    berhentiDengar();
    $('kata-saya').textContent = t;
    kirim(t, true);
  }
  function jalankanDengar() {
    if (!sesi || sibuk || keadaan === 'bicara' || rek) return;
    const r = rek = new SR(); r.lang = 'id-ID'; r.interimResults = true; r.continuous = true;
    r.onstart = () => { if (rek !== r) return; setKeadaan('dengar'); if (A.saatMendengar) A.saatMendengar(true); };
    r.onresult = ev => {
      if (rek !== r) return;
      sementara = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) kumpul += ev.results[i][0].transcript + ' '; else sementara += ev.results[i][0].transcript;
      }
      terakhirSuara = Date.now();
      $('kata-saya').textContent = koreksi((kumpul + sementara).trim());
      clearTimeout(jeda);
      // kirim setelah kamu berhenti bicara sebentar
      jeda = setTimeout(kirimKumpulan, sementara ? 2200 : 1100);
    };
    r.onerror = ev => {
      if (rek !== r) return;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') akhiriSesi('Izinkan mikrofon di browser supaya aku bisa mendengar.');
    };
    r.onend = () => {
      if (rek !== r) return; // dihentikan sengaja
      rek = null;
      if (!sesi || sibuk || keadaan === 'bicara') return;
      if (Date.now() - terakhirSuara > SEPI_MS) { akhiriSesi('Sepi, jadi aku berhenti mendengar. Ketuk Aura atau tepuk 2× untuk lanjut.'); return; }
      setTimeout(jalankanDengar, 120); // browser memutus mic sendiri: sambung lagi
    };
    try { r.start(); } catch (e) { rek = null; }
  }
  A.dengar = () => { setMode('suara'); return mulaiSesi(); };

  // ---------- orb sebagai tombol ----------
  function ketukOrb() {
    if (!suaraMode()) setMode('suara');
    if (keadaan === 'bicara') { A.diam(); setKeadaan('diam'); mulaiSesi(); return; }
    if (sesi && (keadaan === 'dengar' || rek)) { akhiriSesi('Ketuk Aura atau tepuk 2× untuk bicara lagi'); return; }
    if (keadaan === 'pikir') return;
    if (sapaanTertunda) { ucap(sapaanTertunda); return; }
    mulaiSesi();
  }
  A.panggil = () => { if (keadaan === 'diam' && !sibuk && !sesi) ketukOrb(); };

  // Aura membuka percakapan
  async function sapa() {
    if (!suaraMode() || sesi || keadaan !== 'diam') return;
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
      $('btn-mic').onclick = () => A.dengar();
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
