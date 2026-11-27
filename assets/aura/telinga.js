// Telinga Aura: satu mikrofon untuk dua hal, semuanya diproses di perangkat.
// 1) Saat Aura tidur: mendeteksi tepuk tangan 2× -> Aura.bangun().
// 2) Saat Aura mendengarkan: merekam satu ucapan (mulai saat kamu bicara, berhenti setelah jeda),
//    lalu memberikan rekamannya ke Aura.saatUcapan(blob). Rekaman tidak disimpan.
(function () {
  const A = window.Aura = window.Aura || {};
  let stream = null, ac = null, analis = null, buf = null, loop = 0;
  let mode = 'mati'; // mati | tidur | dengar | jeda
  let latar = 0.008;
  // tepuk
  let tepukLalu = 0, jedaTepuk = 0, puncakDi = 0, dalamTepuk = false, jejak = [];
  // ucapan
  let rekam = null, potong = [], bicaraMulai = 0, terakhirBicara = 0, adaBicara = false, mulaiDengar = 0;
  const DIAM_SELESAI = 2600, MAKS_UCAPAN = 120000, TANPA_UCAPAN = 10000; // orang sering berhenti sebentar untuk berpikir di tengah kalimat

  function bunyiTing() {
    try {
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1320, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.4);
    } catch (e) {}
  }
  A.bunyiTing = bunyiTing;

  function mulaiRekam() {
    potong = []; adaBicara = false; bicaraMulai = 0; mulaiDengar = performance.now();
    const tipe = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    try { rekam = new MediaRecorder(stream, tipe ? { mimeType: tipe } : undefined); } catch (e) { rekam = null; return; }
    rekam.ondataavailable = e => { if (e.data && e.data.size) potong.push(e.data); };
    rekam.onstop = () => {
      const kirim = adaBicara && mode === 'dengar';
      const blob = new Blob(potong, { type: rekam && rekam.mimeType || 'audio/webm' });
      rekam = null;
      if (kirim && blob.size > 2000) { mode = 'jeda'; A.saatUcapan && A.saatUcapan(blob); }
      else if (mode === 'dengar') mulaiRekam(); // tidak ada ucapan: rekam ulang supaya potongan tetap pendek
    };
    rekam.start(250);
  }

  function periksa() {
    loop = requestAnimationFrame(periksa);
    if (!analis || document.hidden || mode === 'mati' || mode === 'jeda') return;
    analis.getFloatTimeDomainData(buf);
    let puncak = 0, jumlah = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > puncak) puncak = v; jumlah += v * v; }
    const rms = Math.sqrt(jumlah / buf.length), now = performance.now();

    if (mode === 'tidur') {
      // tepuk = hening -> bunyi tajam jauh di atas suara latar -> hening lagi dalam ~70 ms.
      // (bicara & musik tidak hening sebelum/sesudahnya; ketikan keyboard terlalu lemah)
      jejak.push({ t: now, rms }); while (jejak.length && now - jejak[0].t > 300) jejak.shift();
      const tenang = Math.max(latar * 2.2, 0.02);
      const sebelum = jejak.reduce((m, r) => (now - r.t > 30 && now - r.t < 160 ? Math.max(m, r.rms) : m), 0);
      if (!dalamTepuk && puncak > 0.2 && rms > latar * 4.5 && sebelum < tenang) { dalamTepuk = true; puncakDi = now; }
      else if (dalamTepuk && now - puncakDi > 70) {
        dalamTepuk = false;
        const singkat = rms < tenang;
        if (singkat && now > jedaTepuk) {
          const selang = now - tepukLalu;
          if (selang > 150 && selang < 750) { tepukLalu = 0; jedaTepuk = now + 2500; bunyiTing(); A.bangun && A.bangun('tepuk'); }
          else tepukLalu = now;
        }
      }
      if (!dalamTepuk) latar = latar * 0.97 + rms * 0.03;
      return;
    }

    if (mode === 'dengar' && rekam) {
      const ambang = Math.max(0.012, latar * 2.6);
      if (rms > ambang) { if (!bicaraMulai) bicaraMulai = now; if (now - bicaraMulai > 100) { adaBicara = true; A.saatSuara && A.saatSuara(true); } terakhirBicara = now; }
      else { bicaraMulai = 0; if (!adaBicara) latar = latar * 0.98 + rms * 0.02; }
      const selesai = adaBicara && now - terakhirBicara > DIAM_SELESAI;
      const kepanjangan = adaBicara && now - mulaiDengar > MAKS_UCAPAN;
      const kosong = !adaBicara && now - mulaiDengar > TANPA_UCAPAN;
      if ((selesai || kepanjangan || kosong) && rekam.state === 'recording') {
        if (selesai || kepanjangan) A.saatSuara && A.saatSuara(false);
        rekam.stop();
      }
    }
  }

  async function nyalakan() {
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { stream = null; return false; }
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    const src = ac.createMediaStreamSource(stream);
    analis = ac.createAnalyser(); analis.fftSize = 1024; buf = new Float32Array(analis.fftSize);
    src.connect(analis);
    if (!loop) periksa();
    return true;
  }

  // Aura.telinga('tidur' | 'dengar' | 'jeda' | 'mati')
  A.telinga = async function (m) {
    if (m !== 'mati' && !(await nyalakan())) return false;
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    const lama = mode; mode = m;
    if (rekam && rekam.state === 'recording' && m !== 'dengar') { adaBicara = false; rekam.stop(); }
    if (m === 'dengar' && lama !== 'dengar' && !rekam) mulaiRekam();
    if (m === 'tidur') { tepukLalu = 0; dalamTepuk = false; }
    if (m === 'mati') { cancelAnimationFrame(loop); loop = 0; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; analis = null; }
    return true;
  };
  A.bisaRekam = () => !!(window.MediaRecorder && navigator.mediaDevices);
})();
