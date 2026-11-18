// Orb asisten: gumpalan cair yang terus berubah bentuk, warna bergantian biru-putih <-> merah-oranye-kuning.
// Pakai: <canvas data-orb></canvas>. Satu loop animasi untuk semua orb di halaman.
(function () {
  const FRAG = `
precision highp float;
uniform vec2 res; uniform float t; uniform float energi;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
vec3 panas(float x){x=clamp(x,0.,1.);
  return x<.25?mix(vec3(.05,0,.02),vec3(.75,.02,.03),x/.25):x<.5?mix(vec3(.75,.02,.03),vec3(1.,.35,.05),(x-.25)/.25):
         x<.78?mix(vec3(1.,.35,.05),vec3(1.,.86,.25),(x-.5)/.28):mix(vec3(1.,.86,.25),vec3(1.,.98,.9),(x-.78)/.22);}
vec3 dingin(float x){x=clamp(x,0.,1.);
  return x<.3?mix(vec3(.02,.01,.12),vec3(.12,.1,.85),x/.3):x<.65?mix(vec3(.12,.1,.85),vec3(.55,.55,1.),(x-.3)/.35):mix(vec3(.55,.55,1.),vec3(.97,.97,1.),(x-.65)/.35);}
void main(){
  vec2 p=(gl_FragCoord.xy*2.-res)/min(res.x,res.y);
  float r=length(p),a=atan(p.y,p.x);
  float g=.55+.45*energi;
  float R=.56+g*(.07*sin(3.*a+t*.9)+.075*sin(4.*a-t*1.3+2.*sin(t*.37))*(.5+.5*sin(t*.23))+.035*sin(5.*a+t*1.7)+.03*sin(2.*a-t*.6));
  float d=r/R;
  float fase=.5+.5*sin(t*.42);
  vec2 q=p*1.6+vec2(t*.11,-t*.08);
  float isi=clamp(.55-.85*p.y*cos(t*.19)-.45*p.x*sin(t*.19)+.6*(fbm(q+fbm(q+t*.15))-.5)-.3*d*d,0.,1.);
  float isiPanas=clamp(isi+.25*sin(t*.42+1.3),0.,1.);
  vec3 c=mix(dingin(isi),panas(isiPanas),smoothstep(.42,.58,fase));
  float tepi=smoothstep(.86,1.,d)*smoothstep(1.03,.985,d);
  float sisi=.5+.5*sin(a*1.+t*.5+1.2);
  vec3 warnaTepi=mix(vec3(.35,.3,1.),vec3(1.,.12,.08),sisi);
  c=mix(c,warnaTepi*1.15,tepi*.85);
  float dalam=smoothstep(1.,.97,d);
  float luar=max(d-1.,0.);
  vec3 cahaya=mix(vec3(1.,.12,.08),vec3(.4,.32,1.),.5+.5*sin(a*2.-t*.7))*exp(-luar*7.)*1.05+mix(vec3(.3,.25,1.),vec3(.9,.25,.2),.5+.5*sin(a-t*.5))*exp(-luar*2.4)*.5;
  cahaya*=smoothstep(1.,.72,r);
  vec3 col=c*dalam+cahaya*(1.-dalam);
  float alpha=clamp(dalam+length(cahaya)*.9,0.,1.);
  gl_FragColor=vec4(col*alpha,alpha);
}`;
  const VERT = 'attribute vec2 v;void main(){gl_Position=vec4(v,0,1);}';
  const semua = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pasang(cv) {
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) { cv.classList.add('orb-cadangan'); return; }
    const sh = (tp, src) => { const s = gl.createShader(tp); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { cv.classList.add('orb-cadangan'); return; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'v'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    semua.push({ cv, gl, uRes: gl.getUniformLocation(pr, 'res'), uT: gl.getUniformLocation(pr, 't'), uE: gl.getUniformLocation(pr, 'energi'), awal: Math.random() * 40 });
  }

  // energi 0..1: orb lebih "hidup" saat asisten bicara/berpikir. window.orbEnergi(1) / (0).
  let energi = 0, target = 0;
  window.orbEnergi = v => { target = Math.max(0, Math.min(1, v)); };

  function gambar(ms) {
    energi += (target - energi) * 0.05;
    const t = reduce ? 6 : ms / 1000 * (1 + energi * 0.8);
    for (const o of semua) {
      const r = o.cv.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      const k = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * k), h = Math.round(r.height * k);
      if (o.cv.width !== w || o.cv.height !== h) { o.cv.width = w; o.cv.height = h; o.gl.viewport(0, 0, w, h); }
      o.gl.uniform2f(o.uRes, w, h); o.gl.uniform1f(o.uT, t + o.awal); o.gl.uniform1f(o.uE, energi);
      o.gl.clearColor(0, 0, 0, 0); o.gl.clear(o.gl.COLOR_BUFFER_BIT); o.gl.drawArrays(o.gl.TRIANGLE_STRIP, 0, 4);
    }
    if (!reduce) requestAnimationFrame(gambar);
  }
  window.orbPasang = root => { (root || document).querySelectorAll('canvas[data-orb]').forEach(pasang); };
  window.orbPasang();
  requestAnimationFrame(gambar);
})();
