// Sapaan kamera: kalau ada wajah di depan layar, Aura menyapa. Bukan pengenal wajah dan bukan kunci masuk:
// hanya mendeteksi "ada orang", diproses di perangkat ini, tidak direkam/dikirim. Kamera mati sendiri setelah menyapa atau 20 detik.
const VERSI = '0.10.14';
let detektor = null;

async function siapkan() {
  if (detektor) return detektor;
  const v = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSI}/vision_bundle.mjs`);
  const fs = await v.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSI}/wasm`);
  detektor = await v.FaceDetector.createFromOptions(fs, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
    runningMode: 'VIDEO', minDetectionConfidence: 0.6,
  });
  return detektor;
}

// mulai(saatAdaWajah): nyalakan kamera, panggil callback sekali saat wajah terlihat stabil.
export async function sapaKamera(saatAdaWajah) {
  const wadah = document.getElementById('kamera');
  const video = wadah.querySelector('video');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false });
  } catch (e) { return 'izin'; }
  video.srcObject = stream; await video.play().catch(() => {});
  wadah.classList.remove('hidden');
  const selesai = () => { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; wadah.classList.add('hidden'); };
  try { await siapkan(); } catch (e) { selesai(); return 'model'; }
  return await new Promise(res => {
    let berturut = 0, terakhir = -1;
    const batas = setTimeout(() => { selesai(); res('tidak-ada'); }, 20000);
    const cek = () => {
      if (!video.srcObject) return;
      if (video.currentTime !== terakhir && video.readyState >= 2) {
        terakhir = video.currentTime;
        const h = detektor.detectForVideo(video, performance.now());
        berturut = h.detections && h.detections.length ? berturut + 1 : 0;
        if (berturut >= 5) { clearTimeout(batas); selesai(); saatAdaWajah(); res('ok'); return; }
      }
      setTimeout(cek, 150);
    };
    cek();
  });
}
