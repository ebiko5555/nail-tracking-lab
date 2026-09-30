import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { DEFAULT_CALIBRATION, FINGERS, type Calibration, type Finger, type Landmark, type NailEstimate, type NailTrack, type Point } from './tracking/types.ts';
import { estimateNails } from './tracking/estimate.ts';
import { NailStabilizer } from './tracking/stabilize.ts';
import './style.css';

type Mode = 'LANDMARK' | 'NAIL POSITION' | 'NAIL OVERLAY' | 'DEBUG';
const LABELS: Record<Finger, string> = { thumb: '親指', index: '人差し指', middle: '中指', ring: '薬指', pinky: '小指' };
const COLORS: Record<Finger, string> = { thumb: '#f45161', index: '#ffa33a', middle: '#e5da45', ring: '#4ddbb6', pinky: '#8c91ff' };
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><h1>NAIL TRACKING LAB</h1><span>爪位置の実験／片手</span></header>
  <main>
    <section class="viewer"><canvas id="stage"></canvas><video id="camera" playsinline muted autoplay></video><div id="banner">カメラを開始してください</div></section>
    <section class="controls">
      <div class="row"><button id="start">カメラ開始</button><button id="stop" disabled>停止</button><button id="freeze" disabled>1フレーム固定</button><button id="resume" disabled>再開</button></div>
      <label>表示モード <select id="mode"><option>LANDMARK</option><option>NAIL POSITION</option><option>NAIL OVERLAY</option><option>DEBUG</option></select></label>
      <div class="row"><label><input type="checkbox" id="mirror"> 左右反転</label><label><input type="checkbox" id="filter" checked> One Euro Filter</label><label><input type="checkbox" id="compare" checked> 補正前も表示</label></div>
      <label>調整する指 <select id="finger">${FINGERS.map(f => `<option value="${f}">${LABELS[f]}</option>`).join('')}</select></label>
      <div id="sliders"></div>
      <div class="row"><button id="reset">この指の補正を初期化</button><button id="save">補正値を端末に保存</button></div>
      <p class="hint">固定フレームでは、爪を選んで輪郭上を順にタップしてください。点は最大12個です。輪郭は端末内の一時メモリにのみ保持します。</p>
      <div class="row"><button id="undo" disabled>点を戻す</button><button id="clear" disabled>輪郭を消す</button><button id="export" disabled>比較結果を保存</button></div>
      <div id="metrics" aria-live="polite"></div>
      <div id="fingerStatus"></div>
      <div id="comparison"></div>
    </section>
  </main>`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#stage');
const ctx = canvas.getContext('2d', { alpha: false })!;
const video = $<HTMLVideoElement>('#camera');
const banner = $<HTMLDivElement>('#banner');
const metrics = $<HTMLDivElement>('#metrics');
const statusBox = $<HTMLDivElement>('#fingerStatus');
const comparison = $<HTMLDivElement>('#comparison');
const modeInput = $<HTMLSelectElement>('#mode');
const fingerInput = $<HTMLSelectElement>('#finger');
const stabilizer = new NailStabilizer();

function readCalibration(): Record<Finger, Calibration> {
  try {
    const saved = JSON.parse(localStorage.getItem('nail-tracking-lab-calibration-v1') || '{}');
    return Object.fromEntries(FINGERS.map(f => [f, { ...DEFAULT_CALIBRATION, ...saved[f] }])) as Record<Finger, Calibration>;
  } catch { return Object.fromEntries(FINGERS.map(f => [f, { ...DEFAULT_CALIBRATION }])) as Record<Finger, Calibration>; }
}
const calibration = readCalibration();
let landmarker: HandLandmarker | null = null;
let stream: MediaStream | null = null;
let running = false;
let frozen = false;
let frozenFrame: HTMLCanvasElement | null = null;
let frozenTracks: Record<Finger, NailTrack> | null = null;
let currentTracks: Record<Finger, NailTrack> | null = null;
let currentLandmarks: Landmark[] = [];
const emptyManual = () => Object.fromEntries(FINGERS.map(f => [f, [] as Point[]])) as Record<Finger, Point[]>;
let manual = emptyManual();
let lastVideoTime = -1;
let lastInferenceAt = 0;
let inferenceMs = 0;
let drawMs = 0;
let frameCount = 0;
let fpsAt = performance.now();
let fps = 0;
let rafId = 0;
let lastDrawAt = 0;
let lastUiAt = 0;

const sliderDefs = [
  ['along', '指方向の位置', -0.5, 0.5, 0.01],
  ['across', '横方向の位置', -0.5, 0.5, 0.01],
  ['width', '横幅', 0.5, 1.7, 0.01],
  ['length', '長さ', 0.5, 1.7, 0.01],
] as const;

function showSliders() {
  const c = calibration[fingerInput.value as Finger];
  $('#sliders').innerHTML = sliderDefs.map(([key, label, min, max, step]) =>
    `<label>${label} <output>${c[key].toFixed(2)}</output><input data-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${c[key]}"></label>`).join('');
  $('#sliders').querySelectorAll<HTMLInputElement>('input').forEach(input => input.addEventListener('input', () => {
    calibration[fingerInput.value as Finger][input.dataset.key as keyof Calibration] = Number(input.value);
    input.parentElement!.querySelector('output')!.textContent = Number(input.value).toFixed(2);
    if (frozen) recomputeFrozen();
  }));
}
fingerInput.addEventListener('change', showSliders);
for (const id of ['mode', 'mirror', 'compare']) $<HTMLElement>(`#${id}`).addEventListener('change', () => { if (frozen) render(); });
showSliders();
$('#reset').addEventListener('click', () => { calibration[fingerInput.value as Finger] = { ...DEFAULT_CALIBRATION }; showSliders(); if (frozen) recomputeFrozen(); });
$('#save').addEventListener('click', () => { localStorage.setItem('nail-tracking-lab-calibration-v1', JSON.stringify(calibration)); banner.textContent = '補正値をこの端末に保存しました'; });

async function initLandmarker() {
  if (landmarker) return;
  banner.textContent = '手の認識モデルを読み込み中…';
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
  });
}

async function start() {
  try {
    if (!window.isSecureContext) throw new Error('カメラには HTTPS または localhost が必要です。');
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
    video.srcObject = stream;
    await video.play();
    await initLandmarker();
    running = true; frozen = false; lastVideoTime = -1; stabilizer.reset();
    $<HTMLButtonElement>('#start').disabled = true;
    $<HTMLButtonElement>('#stop').disabled = false;
    $<HTMLButtonElement>('#freeze').disabled = false;
    banner.textContent = '';
    rafId = requestAnimationFrame(loop);
  } catch (error) {
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    banner.textContent = error instanceof DOMException && error.name === 'OverconstrainedError'
      ? '背面カメラを利用できません。この端末とブラウザのカメラ設定を確認してください。'
      : `開始できません: ${error instanceof Error ? error.message : String(error)}`;
  }
}
function stop() {
  running = false; frozen = false; cancelAnimationFrame(rafId);
  stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null;
  frozenFrame = null; frozenTracks = null; currentTracks = null; currentLandmarks = []; manual = emptyManual();
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  stabilizer.reset();
  $<HTMLButtonElement>('#start').disabled = false;
  for (const id of ['stop', 'freeze', 'resume', 'undo', 'clear', 'export']) $<HTMLButtonElement>(`#${id}`).disabled = true;
  banner.textContent = 'カメラを停止しました'; comparison.textContent = '';
}
$('#start').addEventListener('click', start);
$('#stop').addEventListener('click', stop);
$('#freeze').addEventListener('click', () => {
  if (!running || !video.videoWidth) return;
  const frame = document.createElement('canvas'); frame.width = video.videoWidth; frame.height = video.videoHeight;
  frame.getContext('2d')!.drawImage(video, 0, 0);
  // Re-run inference on exactly the pixels shown in the frozen frame.
  try {
    const result = landmarker!.detectForVideo(frame, performance.now());
    currentLandmarks = (result.landmarks[0] ?? []) as Landmark[];
    const estimates = estimateNails(currentLandmarks, calibration, frame.width / frame.height);
    frozenTracks = Object.fromEntries(FINGERS.map(f => [f, { finger: f, status: estimates[f]?.quality !== null && estimates[f] ? 'tracked' : 'unknown', raw: estimates[f], filtered: estimates[f], alpha: 1, displacement: 0, motion: null }])) as Record<Finger, NailTrack>;
  } catch { frozenTracks = null; currentLandmarks = []; banner.textContent = '固定フレームの認識に失敗しました'; }
  frozenFrame = frame; frozen = true;
  $<HTMLButtonElement>('#resume').disabled = false; $<HTMLButtonElement>('#freeze').disabled = true;
  $<HTMLButtonElement>('#undo').disabled = false; $<HTMLButtonElement>('#clear').disabled = false;
  $<HTMLButtonElement>('#export').disabled = false;
  banner.textContent = '固定中：輪郭をタップして指定';
  render();
});
$('#resume').addEventListener('click', () => { frozen = false; frozenFrame = null; frozenTracks = null; manual = emptyManual(); stabilizer.reset(); $<HTMLButtonElement>('#resume').disabled = true; $<HTMLButtonElement>('#freeze').disabled = false; $<HTMLButtonElement>('#export').disabled = true; comparison.textContent = ''; banner.textContent = ''; });
$('#undo').addEventListener('click', () => { manual[fingerInput.value as Finger].pop(); render(); });
$('#clear').addEventListener('click', () => { manual[fingerInput.value as Finger] = []; render(); });

function recomputeFrozen() {
  if (!frozenTracks || currentLandmarks.length !== 21) return;
  const estimated = estimateNails(currentLandmarks, calibration, frozenFrame ? frozenFrame.width / frozenFrame.height : 1);
  for (const f of FINGERS) frozenTracks[f] = { finger: f, status: estimated[f] && estimated[f].quality !== null ? 'tracked' : 'unknown', raw: estimated[f], filtered: estimated[f], alpha: 1, displacement: 0, motion: null };
  render();
}

function loop(now: number) {
  if (!running) return;
  if (frozen) { rafId = requestAnimationFrame(loop); return; }
  if (!frozen && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    // Inference is throttled independently of display frames; duplicate camera frames are skipped.
    if (video.currentTime !== lastVideoTime && now - lastInferenceAt >= 50) {
      const began = performance.now();
      let result: HandLandmarkerResult;
      try { result = landmarker!.detectForVideo(video, now); }
      catch (error) { stop(); banner.textContent = `認識エラー: ${String(error)}`; return; }
      inferenceMs = performance.now() - began;
      lastInferenceAt = now; lastVideoTime = video.currentTime;
      currentLandmarks = (result.landmarks[0] ?? []) as Landmark[];
      currentTracks = stabilizer.update(estimateNails(currentLandmarks, calibration, video.videoWidth / video.videoHeight), now, $<HTMLInputElement>('#filter').checked);
    } else if (currentTracks && now - lastInferenceAt > 150) {
      currentTracks = stabilizer.update(Object.fromEntries(FINGERS.map(f => [f, null])) as Record<Finger, null>, now, $<HTMLInputElement>('#filter').checked);
    }
  }
  if (now - lastDrawAt >= 32) {
    const beganDraw = performance.now(); render(); drawMs = performance.now() - beganDraw;
    lastDrawAt = now; frameCount++;
    if (now - fpsAt >= 1000) { fps = frameCount * 1000 / (now - fpsAt); frameCount = 0; fpsAt = now; }
  }
  rafId = requestAnimationFrame(loop);
}

function sizeCanvas() {
  const source = frozenFrame ?? video;
  const w = source.width || video.videoWidth || 640;
  const h = source.height || video.videoHeight || 480;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function displayPoint(p: Point): Point { return { x: ($<HTMLInputElement>('#mirror').checked ? 1 - p.x : p.x) * canvas.width, y: p.y * canvas.height }; }
function drawNail(n: NailEstimate, color: string, fill: boolean, alpha = 1, dashed = false) {
  const p = displayPoint(n.center);
  const dx = ($<HTMLInputElement>('#mirror').checked ? -n.direction.x : n.direction.x);
  const dy = n.direction.y;
  const angle = Math.atan2(dy, dx);
  const width = n.width * canvas.height;
  const length = n.length * canvas.height;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle); ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.ellipse(0, 0, length / 2, width / 2, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = color; ctx.fill(); }
  ctx.lineWidth = Math.max(2, canvas.width / 450); ctx.strokeStyle = color; ctx.setLineDash(dashed ? [8, 6] : []); ctx.stroke(); ctx.restore();
}
function drawLandmarks() {
  const edges = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  ctx.lineWidth = Math.max(2, canvas.width / 500); ctx.strokeStyle = '#32e0f0';
  for (const [a,b] of edges) { const x = currentLandmarks[a], y = currentLandmarks[b]; if (!x || !y) continue; const p = displayPoint(x), q = displayPoint(y); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke(); }
  currentLandmarks.forEach((p,i) => { const q = displayPoint(p); ctx.beginPath(); ctx.arc(q.x,q.y,Math.max(3,canvas.width/180),0,Math.PI*2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.fillStyle = '#111'; ctx.font = `${Math.max(12,canvas.width/65)}px sans-serif`; ctx.fillText(String(i),q.x+5,q.y-5); });
}
function render() {
  sizeCanvas();
  const source = frozenFrame ?? video;
  ctx.fillStyle = '#111'; ctx.fillRect(0,0,canvas.width,canvas.height);
  if (frozenFrame || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    ctx.save();
    if ($<HTMLInputElement>('#mirror').checked) { ctx.translate(canvas.width,0); ctx.scale(-1,1); }
    ctx.drawImage(source,0,0,canvas.width,canvas.height); ctx.restore();
  }
  const mode = modeInput.value as Mode;
  const tracks = frozen ? frozenTracks : currentTracks;
  if (mode === 'LANDMARK' || mode === 'DEBUG') drawLandmarks();
  if (mode !== 'LANDMARK' && tracks) for (const f of FINGERS) {
    const t = tracks[f];
    if (t.filtered && t.status !== 'unknown' && t.status !== 'lost') drawNail(t.filtered,COLORS[f],mode === 'NAIL OVERLAY',t.alpha,t.status === 'held');
    if (mode === 'DEBUG' && $<HTMLInputElement>('#compare').checked && t.raw && t.status === 'tracked') drawNail(t.raw,'#ffffff',false,0.8,true);
  }
  if (frozen) for (const f of FINGERS) {
    const points = manual[f]; if (!points.length) continue;
    ctx.strokeStyle = COLORS[f]; ctx.fillStyle = COLORS[f]; ctx.lineWidth = 3; ctx.beginPath();
    points.forEach((p,i) => { const q = displayPoint(p); i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y); });
    if (points.length >= 3) ctx.closePath(); ctx.stroke();
    points.forEach(p => { const q = displayPoint(p); ctx.beginPath(); ctx.arc(q.x,q.y,5,0,Math.PI*2); ctx.fill(); });
  }
  if (performance.now() - lastUiAt < 220 && !frozen) return;
  lastUiAt = performance.now();
  metrics.textContent = `描画 ${fps.toFixed(1)} FPS ｜ 推論 ${inferenceMs.toFixed(1)} ms ｜ 描画 ${drawMs.toFixed(1)} ms ｜ ${frozen ? '固定中' : 'ライブ'}`;
  statusBox.innerHTML = FINGERS.map(f => {
    const t = tracks?.[f], n = t?.filtered;
    return `<div><span style="color:${COLORS[f]}">●</span> ${LABELS[f]}：${t?.status ?? 'unknown'} ｜位置 ${n ? `${n.center.x.toFixed(3)}, ${n.center.y.toFixed(3)}` : '不明'} ｜幅 ${n ? n.width.toFixed(3) : '不明'} ｜長さ ${n ? n.length.toFixed(3) : '不明'} ｜角度 ${n ? (n.angle*180/Math.PI).toFixed(0)+'°' : '不明'} ｜向き ${n ? `${n.direction.x.toFixed(2)}, ${n.direction.y.toFixed(2)}` : '不明'} ｜認識信頼度 不明 ｜幾何品質 ${n?.quality === null || !n ? '不明' : n.quality.toFixed(2)} ｜フレーム間変動 ${t?.motion === null || t?.motion === undefined ? '不明' : t.motion.toFixed(4)} ｜補正差 ${t?.displacement === null || t?.displacement === undefined ? '不明' : t.displacement.toFixed(4)}</div>`;
  }).join('');
  if (frozen) showComparison();
}

function polygonArea(points: Point[]): number { let sum = 0; for (let i=0;i<points.length;i++) { const a=points[i], b=points[(i+1)%points.length]; sum += a.x*b.y-b.x*a.y; } return Math.abs(sum)/2; }
function polygonCenter(points: Point[]): Point {
  let crossSum = 0, xSum = 0, ySum = 0;
  for (let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length], cross=a.x*b.y-b.x*a.y;
    crossSum += cross; xSum += (a.x+b.x)*cross; ySum += (a.y+b.y)*cross;
  }
  if (Math.abs(crossSum) < 1e-7) return points.reduce((a,p) => ({x:a.x+p.x/points.length,y:a.y+p.y/points.length}),{x:0,y:0});
  return {x:xSum/(3*crossSum),y:ySum/(3*crossSum)};
}
function showComparison() {
  comparison.innerHTML = FINGERS.map(f => {
    const pts = manual[f], n = frozenTracks?.[f]?.raw;
    if (pts.length < 3 || !n) return `${LABELS[f]}：手動輪郭 ${pts.length}/3点以上<br>`;
    const centroid = polygonCenter(pts);
    const offset = Math.hypot(centroid.x-n.center.x,centroid.y-n.center.y);
    const ratio = polygonArea(pts)/(Math.PI*n.width*n.length/(4*(frozenFrame!.width/frozenFrame!.height)));
    return `${LABELS[f]}：中心差 ${(offset*100).toFixed(2)}（正規化座標×100）／面積比 ${ratio.toFixed(2)}<br>`;
  }).join('');
}
canvas.addEventListener('pointerdown', event => {
  if (!frozen || !frozenFrame) return;
  const rect = canvas.getBoundingClientRect();
  const displayed = { x: (event.clientX-rect.left)/rect.width, y: (event.clientY-rect.top)/rect.height };
  if (displayed.x < 0 || displayed.x > 1 || displayed.y < 0 || displayed.y > 1) return;
  manual[fingerInput.value as Finger].push({ x: $<HTMLInputElement>('#mirror').checked ? 1-displayed.x : displayed.x, y: displayed.y });
  if (manual[fingerInput.value as Finger].length > 12) manual[fingerInput.value as Finger].shift();
  render();
});
$('#export').addEventListener('click', () => {
  if (!frozen) return;
  const payload = { app: 'NAIL TRACKING LAB', createdAt: new Date().toISOString(), note: '画像は含まない。輪郭は手動指定。推定はMediaPipeランドマークに基づく。', calibration, manualContours: manual, estimates: frozenTracks };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download='nail-tracking-comparison.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
window.addEventListener('pagehide', () => { stream?.getTracks().forEach(t => t.stop()); });
