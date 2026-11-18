// Musik intro Aura (~6 detik), disintesis langsung di browser: dengung rendah, pad yang "terbit", kilau nada tinggi, lonceng penutup.
// Browser hanya mengizinkan suara setelah pengguna menekan sesuatu, jadi auraIntro() dipanggil tepat setelah tombol masuk ditekan.
(function () {
  let ac = null;
  // Panggil langsung di dalam klik tombol (sebelum menunggu server) supaya Safari/Chrome mengizinkan suara nanti.
  window.auraSiapkan = function () {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {}
    return ac;
  };
  window.auraIntro = function (konteksLain) {
    let ac = konteksLain;
    if (!ac) {
      try { ac = window.auraSiapkan() || null; } catch (e) { return; }
      if (!ac) return;
    }
    const t0 = ac.currentTime + 0.05;
    const master = ac.createGain(); master.gain.value = 0.55;
    const komp = ac.createDynamicsCompressor(); master.connect(komp); komp.connect(ac.destination);
    // gema untuk kilau
    const gema = ac.createDelay(1); gema.delayTime.value = 0.32;
    const umpan = ac.createGain(); umpan.gain.value = 0.38;
    const gemaOut = ac.createGain(); gemaOut.gain.value = 0.45;
    gema.connect(umpan); umpan.connect(gema); gema.connect(gemaOut); gemaOut.connect(master);

    const env = (g, a, puncak, tahan, lepas) => {
      g.gain.setValueAtTime(0.0001, t0 + a[0]);
      g.gain.exponentialRampToValueAtTime(puncak, t0 + a[1]);
      g.gain.setValueAtTime(puncak, t0 + tahan);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + lepas);
    };
    const osc = (tipe, f, mulai, selesai, tujuan, detune = 0) => {
      const o = ac.createOscillator(); o.type = tipe; o.frequency.value = f; o.detune.value = detune;
      o.connect(tujuan); o.start(t0 + mulai); o.stop(t0 + selesai + 0.1); return o;
    };

    // 1. dengung rendah (A1 + E2)
    const gDengung = ac.createGain(); gDengung.connect(master);
    env(gDengung, [0, 2.2], 0.22, 4.2, 6.2);
    osc('sine', 55, 0, 6.2, gDengung); osc('triangle', 82.41, 0, 6.2, gDengung);

    // 2. pad Aadd9 yang "terbit": filter dibuka pelan
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(260, t0); lp.frequency.exponentialRampToValueAtTime(3200, t0 + 3.2); lp.frequency.exponentialRampToValueAtTime(900, t0 + 6);
    const gPad = ac.createGain(); lp.connect(gPad); gPad.connect(master);
    env(gPad, [0.2, 2.6], 0.09, 4, 6);
    for (const f of [220, 277.18, 329.63, 493.88]) { osc('sawtooth', f, 0.2, 6, lp, -7); osc('sawtooth', f, 0.2, 6, lp, 7); }

    // 3. kilau: arpeggio nada tinggi saat sinar matahari mekar
    [[1.5, 659.25], [1.85, 880], [2.2, 987.77], [2.55, 1318.5], [2.9, 1760]].forEach(([w, f]) => {
      const g = ac.createGain(); g.connect(master); g.connect(gema);
      g.gain.setValueAtTime(0.0001, t0 + w); g.gain.exponentialRampToValueAtTime(0.08, t0 + w + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + w + 1.1);
      osc('sine', f, w, w + 1.2, g);
    });

    // 4. lonceng penutup (A5 + E6 dengan nada atas lembut)
    const gL = ac.createGain(); gL.connect(master); gL.connect(gema);
    gL.gain.setValueAtTime(0.0001, t0 + 3.3); gL.gain.exponentialRampToValueAtTime(0.13, t0 + 3.33); gL.gain.exponentialRampToValueAtTime(0.0001, t0 + 6.4);
    osc('sine', 880, 3.3, 6.4, gL); osc('sine', 1318.5, 3.3, 6.4, gL); osc('sine', 2637, 3.3, 5, gL);
  };
})();
