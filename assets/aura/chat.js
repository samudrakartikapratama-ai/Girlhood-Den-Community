// Aura: mode suara (bawaan) dan mode ketik.
// Mode suara: Aura TIDUR (orb redup) -> tepuk 2× / ketuk orb -> BANGUN, menyapa, lalu ngobrol bergantian
// (Aura bicara -> mendengarkan -> menjawab ...). Ketuk orb atau sepi 90 detik -> tidur lagi.
// Dipanggil dari aura.html: Aura.mulai({ sb, url, anon, nama }).
(function () {
  const $ = id => document.getElementById(id);
  const A = window.Aura = window.Aura || {};
  let cfg = null, sibuk = false, keadaan = 'tidur'; // tidur | bicara | dengar | pikir | diam
  let sesi = false, terakhirSuara = 0, sudahSapaHariIni = false, pakaiServerDengar = true;
  const SEPI_MS = 90000;

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
    BUKAN_INTERNAL: 'Sesimu berakhir. Masuk lagi pakai Face ID.',
    LAMPIRAN_BESAR: 'File terlalu besar. Maksimal sekitar 9 MB.',
    LAMPIRAN_TIPE: 'Jenis file ini belum bisa dibaca. Pakai foto, PDF, Excel, CSV, atau Word.',
  };

  // ---------- tampilan ----------
  const suaraMode = () => document.body.classList.contains('mode-suara');
  const STATUS = {
    tidur: 'Tepuk 2× atau ketuk Aura untuk membangunkan',
    diam: 'Ketuk Aura untuk bicara',
    bicara: 'Ketuk untuk menyela',
    dengar: 'Aku mendengarkan',
    pikir: 'Sebentar',
  };
  function setKeadaan(k, teks) {
    keadaan = k;
    $('status-suara').textContent = teks || STATUS[k];
    document.body.dataset.aura = k;
    if (window.orbEnergi) orbEnergi(k === 'pikir' ? 1 : k === 'bicara' ? 0.8 : k === 'dengar' ? 0.5 : 0);
  }
  function teksAura(t) { const b = $('kata-aura'); b.classList.remove('dibaca'); b.textContent = t || ''; }
  function tampilJawaban(daftar) {
    const box = $('kata-aura'); box.textContent = ''; box.classList.add('dibaca');
    return daftar.map(k => { const sp = document.createElement('span'); sp.textContent = k + ' '; box.appendChild(sp); return sp; });
  }
  function teksSaya(t) { $('kata-saya').textContent = t || ''; }

  function setMode(m) {
    document.body.classList.toggle('mode-suara', m === 'suara');
    $('ruang-ketik').classList.toggle('hidden', m === 'suara');
    $('ruang-suara').classList.toggle('hidden', m !== 'suara');
    try { localStorage.setItem('aura-mode', m); } catch (e) {}
    if (m === 'suara') tidur(); else { akhiriSesi(); A.diam(); A.telinga && A.telinga('mati'); }
  }
  A.setMode = setMode;

  // ---------- log ketik ----------
  function tambah(peran, teks, opsi = {}) {
    const box = $('percakapan');
    box.classList.remove('hidden');
    const el = document.createElement('div');
    el.className = 'msg ' + (peran === 'user' ? 'saya' : 'aura') + (opsi.sementara ? ' sementara' : '');
    if (opsi.lampiran) { const f = document.createElement('span'); f.className = 'berkas'; f.textContent = 'Lampiran: ' + opsi.lampiran; el.appendChild(f); }
    el.appendChild(document.createTextNode(teks));
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

  // ---------- Aura bicara: suara browser terbaik, dibacakan per kalimat (teks tampil per kalimat) ----------
  let suaraPilihan = null;
  function pilihSuara() {
    const v = ((window.speechSynthesis && speechSynthesis.getVoices()) || []).filter(x => /^id/i.test(x.lang));
    const skor = x => (/natural|neural|online/i.test(x.name) ? 4 : 0) + (/google/i.test(x.name) ? 3 : 0) + (/microsoft/i.test(x.name) ? 2 : 0) + (/enhanced|premium/i.test(x.name) ? 2 : 0) - (/damayanti/i.test(x.name) && !/enhanced|premium/i.test(x.name) ? 1 : 0);
    suaraPilihan = v.sort((a, b) => skor(b) - skor(a))[0] || null;
  }
  if (window.speechSynthesis) { pilihSuara(); speechSynthesis.onvoiceschanged = pilihSuara; }
  const bolehBicara = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
  const kalimat = t => (t.replace(/[*_#|>`]/g, '').replace(/\s*\n+\s*/g, ' ').match(/(?:[^.!?]|[.,](?=\d))+[.!?]*/g) || []).map(s => s.trim()).filter(Boolean);
  let antrian = [], tertunda = null, giliran = 0;

  // ucap(teks, sesudah): tampilkan & bacakan kalimat demi kalimat; sesudah() dipanggil setelah selesai.
  function ucap(teks, sesudah) {
    A.diam();
    antrian = kalimat(teks);
    if (!antrian.length) { sesudah && sesudah(); return; }
    if (!window.speechSynthesis || !bolehBicara()) {
      // browser belum mengizinkan suara: tampilkan teksnya, suara menyusul setelah diketuk
      teksAura(teks); tertunda = { teks, sesudah }; setKeadaan('diam', 'Ketuk Aura supaya aku bisa bersuara');
      return;
    }
    tertunda = null;
    A.telinga && A.telinga('jeda');
    setKeadaan('bicara');
    const id = giliran;
    const bagian = tampilJawaban(antrian);
    let ke = -1;
    const berikut = () => {
      if (id !== giliran || keadaan !== 'bicara') return;
      const s = antrian.shift();
      if (bagian[ke]) bagian[ke].classList.replace('kini', 'lewat');
      if (!s) { $('kata-aura').classList.remove('dibaca'); sesudah && sesudah(); return; }
      ke++;
      if (bagian[ke]) { bagian[ke].classList.add('kini'); bagian[ke].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      const u = new SpeechSynthesisUtterance(s);
      u.lang = 'id-ID'; if (suaraPilihan) u.voice = suaraPilihan;
      u.rate = suaraPilihan && /google|natural|online/i.test(suaraPilihan.name) ? 1.08 : 1.15;
      u.onend = berikut;
      u.onerror = berikut;
      speechSynthesis.speak(u);
    };
    berikut();
  }
  A.ucap = ucap;
  A.diam = () => { giliran++; antrian = []; $('kata-aura').classList.remove('dibaca'); if (window.speechSynthesis) speechSynthesis.cancel(); };

  // ---------- lampiran: foto & PDF dikirim apa adanya; Excel/CSV/Word diubah jadi teks di browser ----------
  let lampiran = null; // { nama, tipe, data }
  const skrip = {};
  const muatSkrip = src => skrip[src] || (skrip[src] = new Promise((ok, gagal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete skrip[src]; gagal(new Error('SKRIP')); }; document.head.appendChild(s); }));
  const keBase64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  const MAKS_FILE = 9.5 * 1024 * 1024, MAKS_TEKS = 150000;

  async function fotoKecil(file) {
    // foto besar dikecilkan (sisi terpanjang 1600 px) supaya cepat terkirim dan tetap terbaca
    const img = await createImageBitmap(file);
    const skala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * skala); c.height = Math.round(img.height * skala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.86));
  }
  async function siapkanLampiran(file) {
    const n = file.name.toLowerCase();
    if (file.type.startsWith('image/')) return { tipe: 'image/jpeg', data: await keBase64(await fotoKecil(file)) };
    if (n.endsWith('.pdf')) { if (file.size > MAKS_FILE) throw new Error('LAMPIRAN_BESAR'); return { tipe: 'application/pdf', data: await keBase64(file) }; }
    if (/\.(xlsx|xls|csv)$/.test(n)) {
      await muatSkrip('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const wb = XLSX.read(await file.arrayBuffer());
      const teks = wb.SheetNames.map(s => '### Sheet: ' + s + '\n' + XLSX.utils.sheet_to_csv(wb.Sheets[s], { blankrows: false })).join('\n\n');
      return { tipe: 'text/plain', data: teks.slice(0, MAKS_TEKS) };
    }
    if (n.endsWith('.docx')) {
      await muatSkrip('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
      const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return { tipe: 'text/plain', data: r.value.slice(0, MAKS_TEKS) };
    }
    if (/\.(txt|md)$/.test(n)) return { tipe: 'text/plain', data: (await file.text()).slice(0, MAKS_TEKS) };
    throw new Error('LAMPIRAN_TIPE');
  }
  function tampilLampiran() {
    $('lampiran-pilih').classList.toggle('hidden', !lampiran);
    $('lampiran-nama').textContent = lampiran ? lampiran.nama : '';
    $('chat-isi').placeholder = lampiran ? 'Tanya soal file ini (boleh kosong)…' : 'Tanya Aura…';
  }
  async function pilihLampiran(file) {
    if (!file) return;
    $('lampiran-pilih').classList.remove('hidden'); $('lampiran-nama').textContent = 'Menyiapkan ' + file.name + '…';
    try { lampiran = { nama: file.name, ...(await siapkanLampiran(file)) }; }
    catch (e) { lampiran = null; $('info-chat').textContent = PESAN_GALAT[e.message] || 'File tidak bisa dibaca. Coba simpan ulang sebagai PDF.'; }
    tampilLampiran();
    $('chat-isi').focus();
  }

  // ---------- percakapan ----------
  async function kirim(teks, lewatSuara) {
    teks = (teks || '').trim();
    const file = lewatSuara ? null : lampiran;
    if ((!teks && !file) || sibuk) return;
    sibuk = true;
    tambah('user', teks || (file ? 'Tolong baca file ini.' : ''), { lampiran: file && file.nama });
    $('chat-isi').value = '';
    lampiran = null; tampilLampiran();
    const tunggu = lewatSuara ? null : tambah('aura', file ? 'Aura sedang membaca file…' : 'Aura sedang berpikir…', { sementara: true });
    if (lewatSuara) setKeadaan('pikir');
    try {
      const j = await panggil({ aksi: 'chat', pesan: teks, suara: !!lewatSuara, lampiran: file || undefined });
      if (tunggu) tunggu.remove();
      tambah('aura', j.jawab.isi);
      infoKuota(j.kuota);
      sibuk = false;
      if (lewatSuara) ucap(j.jawab.isi, lanjutDengar);
    } catch (e) {
      if (tunggu) tunggu.remove();
      if (e.message === 'BUKAN_INTERNAL' && A.sesiHabis) { sibuk = false; akhiriSesi(); A.diam && A.diam(); A.sesiHabis(); return; } // langsung ke layar Face ID
      if (file && !lampiran) { lampiran = file; tampilLampiran(); } // gagal: file tetap terpasang untuk dicoba lagi
      const t = PESAN_GALAT[e.message] || 'Maaf, aku gagal menjawab. Coba lagi sebentar lagi.';
      tambah('aura', t);
      if (e.data) infoKuota(e.data.kuota, e.data.jam);
      sibuk = false;
      // gagal sementara: tetap lanjut mendengarkan; hanya tidur kalau memang tidak bisa dilanjutkan
      if (lewatSuara) ucap(t, ['TUTUP', 'KUOTA', 'SALDO', 'BUKAN_INTERNAL'].includes(e.message) ? () => tidur() : lanjutDengar);
    }
  }
  A.kirim = kirim;

  function lanjutDengar() {
    if (!suaraMode()) return;
    if (!sesi) { sesi = true; terakhirSuara = Date.now(); }
    if (Date.now() - terakhirSuara > SEPI_MS) { tidur('Sepi, aku tidur dulu. Tepuk 2× kalau butuh aku.'); return; }
    teksSaya('');
    setKeadaan('dengar');
    if (pakaiServerDengar && A.bisaRekam && A.bisaRekam()) {
      A.telinga('dengar').then(ok => { if (!ok) setKeadaan('diam', 'Izinkan mikrofon di browser supaya aku bisa mendengar.'); });
    } else dengarBrowser();
  }

  // ucapan terekam -> server (Whisper) -> teks
  A.saatSuara = ada => { if (ada) { terakhirSuara = Date.now(); if (!$('kata-saya').textContent) teksSaya('…'); } };
  A.saatUcapan = async blob => {
    if (!sesi) return;
    setKeadaan('pikir');
    try {
      const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      const j = await panggil({ aksi: 'dengar', audio: b64, tipe: blob.type });
      const t = koreksi((j.teks || '').trim());
      if (!t) { lanjutDengar(); return; }
      teksSaya(t);
      kirim(t, true);
    } catch (e) {
      if (e.message === 'TANPA_KUNCI') { pakaiServerDengar = false; A.telinga('jeda'); dengarBrowser(); return; }
      lanjutDengar();
    }
  };

  // cadangan: pengenal suara bawaan browser (sebelum kunci Groq dipasang)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const KOREKSI = [
    [/\b(girl ?hood ?(den|then|dan)|golden ?(den|then|dan)|gold ?in ?den|gol ?den ?den|gerl ?hud ?den|golden|gold in|gol den|girl ?hood|gerl ?hud)\b/gi, 'Girlhood Den'],
    [/\b(kimi|kime|kim)\b/gi, 'KIME'], [/\bhana ?su[iy]\b/gi, 'Hanasui'], [/\bsatur ?nine?\b/gi, 'Saturnine'],
    [/\bfast ?moss\b/gi, 'FastMoss'], [/\b(ge em ve|gmf|gm v)\b/gi, 'GMV'],
  ];
  const koreksi = t => KOREKSI.reduce((a, [r, g]) => a.replace(r, g), t);
  let rek = null;
  function dengarBrowser() {
    if (!SR) { setKeadaan('diam', 'Browser ini belum bisa mendengar. Pakai Chrome atau Safari, atau ketik saja.'); return; }
    if (rek) return;
    A.telinga && A.telinga('jeda');
    const r = rek = new SR(); r.lang = 'id-ID'; r.interimResults = true; r.continuous = true;
    let kumpul = '', sementara = '', jeda = 0;
    r.onstart = () => { if (rek === r) setKeadaan('dengar'); };
    r.onresult = ev => {
      if (rek !== r) return;
      sementara = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) kumpul += ev.results[i][0].transcript + ' '; else sementara += ev.results[i][0].transcript;
      }
      terakhirSuara = Date.now();
      teksSaya(koreksi((kumpul + sementara).trim()));
      clearTimeout(jeda);
      jeda = setTimeout(() => { const t = koreksi((kumpul + ' ' + sementara).replace(/\s+/g, ' ').trim()); kumpul = sementara = ''; if (!t) return; berhentiBrowser(); kirim(t, true); }, sementara ? 3200 : 2200);
    };
    r.onerror = ev => { if (rek === r && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) { berhentiBrowser(); setKeadaan('diam', 'Izinkan mikrofon di browser supaya aku bisa mendengar.'); } };
    r.onend = () => {
      if (rek !== r) return;
      rek = null;
      if (!sesi || sibuk || keadaan !== 'dengar') return;
      if (Date.now() - terakhirSuara > SEPI_MS) { tidur('Sepi, aku tidur dulu. Tepuk 2× kalau butuh aku.'); return; }
      setTimeout(dengarBrowser, 120);
    };
    try { r.start(); } catch (e) { rek = null; }
  }
  function berhentiBrowser() { const r = rek; rek = null; if (r) { try { r.abort(); } catch (e) {} } }

  function akhiriSesi() { sesi = false; berhentiBrowser(); }

  // ---------- tidur & bangun ----------
  function tidur(teks) {
    akhiriSesi(); A.diam(); tertunda = null;
    teksSaya('');
    teksAura(teks || '');
    setKeadaan('tidur');
    if (suaraMode() && A.telinga) A.telinga('tidur');
  }
  A.tidur = tidur;

  async function bangun() {
    if (keadaan !== 'tidur' || !suaraMode()) return;
    if (window.adeganMulai) adeganMulai();
    sesi = true; terakhirSuara = Date.now();
    A.telinga && A.telinga('jeda');
    const jamWib = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date()));
    if (sudahSapaHariIni && jamWib < 16) { ucap('Ya, ' + cfg.nama + '?', lanjutDengar); return; } // jam 16–17: server minta setoran
    setKeadaan('pikir');
    try {
      const j = await panggil({ aksi: 'sapa' });
      sudahSapaHariIni = true;
      if (j.baru) tambah('aura', j.teks);
      ucap(j.teks, j.tutup ? () => tidur() : lanjutDengar);
    } catch (e) {
      ucap('Halo ' + cfg.nama + '. Ada yang mau dibahas?', lanjutDengar);
    }
  }
  A.bangun = bangun;

  function ketukOrb() {
    if (!suaraMode()) { setMode('suara'); return; }
    if (tertunda) { const t = tertunda; tertunda = null; ucap(t.teks, t.sesudah); return; }
    if (keadaan === 'tidur') { bangun(); return; }
    if (keadaan === 'bicara') { A.diam(); lanjutDengar(); return; }
    if (keadaan === 'dengar') { tidur(); return; }
    if (keadaan === 'diam') lanjutDengar();
  }

  // kamera melihat ada orang saat Aura tidur: orb menyala sebentar + ajakan, tanpa suara
  A.melihatmu = () => {
    if (keadaan !== 'tidur' || !suaraMode()) return;
    if (window.orbEnergi) { orbEnergi(0.7); setTimeout(() => keadaan === 'tidur' && orbEnergi(0), 1600); }
    teksAura('Hai ' + cfg.nama + '. Tepuk 2× kalau mau ngobrol.');
  };

  // ---------- asisten proaktif: briefing pagi tanpa ditanya + pengingat 11.00 & 14.00 ----------
  function sampaikan(teks) {
    tambah('aura', teks);
    // di mode suara: teks tampil di orb, suara menyusul saat orb diketuk (browser tidak mengizinkan suara otomatis)
    if (suaraMode() && (keadaan === 'tidur' || keadaan === 'diam')) {
      teksAura(teks); tertunda = { teks, sesudah: () => { sesi = true; terakhirSuara = Date.now(); lanjutDengar(); } };
      setKeadaan('diam', 'Ketuk Aura untuk mendengarkan');
    }
  }
  let jedaPengingat = null;
  async function mulaiAsisten() {
    if (!sudahSapaHariIni) {
      try { const j = await panggil({ aksi: 'sapa' }); sudahSapaHariIni = true; if (j.baru && !j.tutup) sampaikan(j.teks); } catch (e) {}
    }
    clearInterval(jedaPengingat);
    const cek = async () => { if (sibuk) return; try { const j = await panggil({ aksi: 'pengingat' }); if (j.teks) sampaikan(j.teks); } catch (e) {} };
    jedaPengingat = setInterval(cek, 5 * 60 * 1000); cek();
  }

  // ---------- pasang ----------
  let terpasang = false;
  A.mulai = async function (c) {
    cfg = c;
    if (!terpasang) {
      terpasang = true;
      $('orb-tombol').onclick = ketukOrb;
      $('ke-ketik').onclick = () => setMode('ketik');
      $('btn-mic').onclick = () => { setMode('suara'); bangun(); };
      $('form-chat').onsubmit = ev => { ev.preventDefault(); kirim($('chat-isi').value, false); };
      $('btn-lampir').onclick = () => $('file-lampir').click();
      $('file-lampir').onchange = ev => { pilihLampiran(ev.target.files[0]); ev.target.value = ''; };
      $('lampiran-hapus').onclick = () => { lampiran = null; tampilLampiran(); };
      $('chat-isi').addEventListener('paste', ev => { const f = [...(ev.clipboardData?.files || [])][0]; if (f) { ev.preventDefault(); pilihLampiran(f); } });
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && suaraMode()) setMode('ketik'); });
    }
    let m = 'suara'; try { m = localStorage.getItem('aura-mode') || 'suara'; } catch (e) {}
    setMode(m);
    try {
      const j = await panggil({ aksi: 'riwayat' });
      $('percakapan').innerHTML = '';
      (j.pesan || []).forEach(p => tambah(p.peran === 'assistant' ? 'aura' : 'user', p.isi, { lampiran: p.nama }));
      if (!(j.pesan || []).length) $('percakapan').classList.add('hidden');
      infoKuota(j.kuota, j.jam);
      pakaiServerDengar = !!j.dengarServer;
      const hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      sudahSapaHariIni = (j.pesan || []).some(p => new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) === hariIni);
      if (j.asisten && !(j.jam && j.jam.tutup)) mulaiAsisten();
    } catch (e) { $('info-chat').textContent = 'Riwayat chat belum bisa dimuat.'; }
  };
})();
