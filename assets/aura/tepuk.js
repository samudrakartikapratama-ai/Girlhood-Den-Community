// Tepuk tangan 2x untuk memanggil Aura. Suara dianalisis di perangkat ini saja, tidak direkam atau dikirim.
// Aura.tepukNyala(true/false). Saat terdeteksi: bunyi "ting" kecil lalu Aura.dengar().
(function () {
  const A = window.Aura = window.Aura || {};
  let stream = null, ac = null, analis = null, buf = null, loop = 0;
  let latar = 0.01, tepukLalu = 0, jedaSampai = 0, puncakDi = 0, dalamTepuk = false, istirahat = false;

  function ting() {
    try {
      const c = ac, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1320, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.4);
    } catch (e) {}
  }

  function periksa() {
    loop = requestAnimationFrame(periksa);
    if (!analis || document.hidden || istirahat) return;
    analis.getFloatTimeDomainData(buf);
    let puncak = 0, jumlah = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > puncak) puncak = v; jumlah += v * v; }
    const rms = Math.sqrt(jumlah / buf.length), now = performance.now();
    // tepuk = lonjakan tajam jauh di atas suara latar, lalu cepat hilang
    if (!dalamTepuk && puncak > 0.3 && rms > latar * 6) { dalamTepuk = true; puncakDi = now; }
    else if (dalamTepuk && now - puncakDi > 60) {
      dalamTepuk = false;
      const singkat = rms < latar * 3 || rms < 0.03; // sudah turun lagi = bunyi pendek (bukan musik/bicara keras)
      if (singkat && now > jedaSampai) {
        const selang = now - tepukLalu;
        if (selang > 150 && selang < 750) { tepukLalu = 0; jedaSampai = now + 2500; ting(); setTimeout(() => A.dengar && A.dengar(), 250); }
        else tepukLalu = now;
      }
    }
    if (!dalamTepuk) latar = latar * 0.97 + rms * 0.03;
  }

  A.tepukNyala = async function (ya) {
    if (!ya) {
      cancelAnimationFrame(loop); loop = 0;
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; analis = null;
      return true;
    }
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { stream = null; return false; }
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const src = ac.createMediaStreamSource(stream);
    analis = ac.createAnalyser(); analis.fftSize = 1024; buf = new Float32Array(analis.fftSize);
    src.connect(analis);
    periksa();
    return true;
  };
  // jangan dengar tepuk saat Aura sedang mendengarkan ucapan
  const lama = A.saatMendengar;
  A.saatMendengar = v => { istirahat = v; if (lama) lama(v); };
})();
