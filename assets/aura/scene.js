// Latar Aura: planet saat fajar, matahari selalu ditaruh tepat di belakang orb yang sedang terlihat.
// Gerak: satu momen pembuka (planet muncul, sinar mekar), lalu sinar berputar pelan dan planet "bernapas".
(function () {
  const IMG = 'assets/aura/fajar.jpg', IW = 736, IH = 1308, FX = 414, FY = 517;
  const cv = document.createElement('canvas');
  cv.id = 'adegan'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const img = new Image(); img.decoding = 'async'; img.src = IMG;
  let siap = false, mulai = 0, tx = null, ty = null, redup = 0, redupTarget = 0;
  img.onload = () => { siap = true; mulai = performance.now(); };

  // sinar matahari: acak tapi tetap, supaya tidak berkedip liar
  const SINAR = Array.from({ length: 22 }, (_, i) => ({ a: (i / 22) * Math.PI * 2 + Math.random() * 0.25, p: 0.35 + Math.random() * 0.9, w: 0.004 + Math.random() * 0.01, f: Math.random() * 6.28 }));
  const DEBU = Array.from({ length: 38 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.4, v: 0.004 + Math.random() * 0.01, f: Math.random() * 6.28 }));

  function matahari() {
    // orb yang terlihat di layar jadi titik matahari; kalau tidak ada, pakai sepertiga atas layar
    for (const o of document.querySelectorAll('canvas[data-orb][data-matahari]')) {
      const r = o.getBoundingClientRect();
      if (r.width > 60 && r.bottom > 0 && r.top < innerHeight && o.offsetParent) return [r.left + r.width / 2, r.top + r.height / 2, 0];
    }
    return [innerWidth * 0.5, innerHeight * 0.28, 1];
  }
  window.adeganRedup = v => { redupTarget = v; };
  // putar ulang momen pembuka (dipakai saat berhasil masuk)
  window.adeganMulai = () => { if (siap) mulai = performance.now(); };

  function gambar(now) {
    const k = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * k) || cv.height !== Math.round(H * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (siap) {
      const t = reduce ? 4 : (now - mulai) / 1000;
      const intro = reduce ? 1 : Math.min(1, t / 1.8), mekar = 1 - Math.pow(1 - intro, 3);
      const [sx, sy, kosong] = matahari();
      tx = tx === null ? sx : tx + (sx - tx) * 0.12; ty = ty === null ? sy : ty + (sy - ty) * 0.12;
      redup += ((kosong ? 0.25 : 0) + redupTarget - redup) * 0.06;
      // skala minimal agar gambar menutupi layar sambil matahari tetap di titik target
      const napas = 1 + (reduce ? 0 : 0.018 * Math.sin(t * 0.35));
      const s = Math.max(W / IW, H / IH, tx / FX, (W - tx) / (IW - FX), ty / FY, (H - ty) / (IH - FY)) * 1.02 * napas;
      ctx.globalAlpha = mekar * (1 - redup);
      ctx.drawImage(img, tx - FX * s, ty - FY * s, IW * s, IH * s);
      // sinar dan cahaya tambahan, ditumpuk terang
      ctx.globalCompositeOperation = 'lighter';
      const R = Math.min(W, H) * (0.55 + 0.25 * mekar);
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, R * 0.6);
      g.addColorStop(0, 'rgba(255,190,120,' + 0.35 * mekar + ')'); g.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.globalAlpha = 1 - redup; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, R * 0.6, 0, 6.29); ctx.fill();
      const putar = reduce ? 0 : t * 0.025;
      for (const r of SINAR) {
        const pj = R * r.p * mekar * (0.85 + 0.15 * Math.sin(t * 0.8 + r.f)), a = r.a + putar;
        const lg = ctx.createLinearGradient(tx, ty, tx + Math.cos(a) * pj, ty + Math.sin(a) * pj);
        lg.addColorStop(0, 'rgba(255,150,80,.55)'); lg.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(a - r.w) * pj, ty + Math.sin(a - r.w) * pj);
        ctx.lineTo(tx + Math.cos(a + r.w) * pj, ty + Math.sin(a + r.w) * pj); ctx.closePath(); ctx.fill();
      }
      for (const d of DEBU) {
        const y = ((d.y - (reduce ? 0 : t * d.v)) % 1 + 1) % 1, x = d.x + 0.01 * Math.sin(t * 0.3 + d.f);
        ctx.globalAlpha = (0.25 + 0.35 * Math.sin(t + d.f) ** 2) * mekar * (1 - redup);
        ctx.fillStyle = '#ffb27a'; ctx.beginPath(); ctx.arc(x * W, y * H, d.r, 0, 6.29); ctx.fill();
      }
    }
    if (!reduce || !siap) requestAnimationFrame(gambar); else setTimeout(() => requestAnimationFrame(gambar), 500);
  }
  requestAnimationFrame(gambar);
})();
