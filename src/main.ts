import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { DEFAULT_CALIBRATION, FINGERS, type Calibration, type Finger, type Landmark, type NailEstimate, type NailTrack, type Point } from './tracking/types.ts';
import { estimateNails } from './tracking/estimate.ts';
import { NailStabilizer } from './tracking/stabilize.ts';
import { drawPolish, type Finish } from './tryon/polish.ts';
import './style.css';

type Mode = 'LANDMARK' | 'NAIL POSITION' | 'NAIL OVERLAY' | 'DEBUG';
const LABELS: Record<Finger, string> = { thumb: '親指', index: '人差し指', middle: '中指', ring: '薬指', pinky: '小指' };
const COLORS: Record<Finger, string> = { thumb: '#f45161', index: '#ffa33a', middle: '#e5da45', ring: '#4ddbb6', pinky: '#8c91ff' };
const SHADES = [
  { name: 'ローズ', color: '#bd586c' }, { name: 'コーラル', color: '#ef8479' },
  { name: 'ベージュ', color: '#b98572' }, { name: 'チェリー', color: '#a82443' },
  { name: 'プラム', color: '#753c64' }, { name: 'ブルー', color: '#637ead' },
];
const INITIAL_FINGER_COLORS: Record<Finger, string> = { thumb: '#bd586c', index: '#ef8479', middle: '#b98572', ring: '#753c64', pinky: '#637ead' };
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><h1>NAIL TRACKING LAB</h1><span>爪位置の実験／片手</span></header>
  <section id="home" class="home">
    <h2>自分の手で、ネイルカラーを試す</h2>
    <p>背面カメラで手の甲を映し、爪に色を重ねて見比べます。好きな色と仕上がりを選び、気に入った状態を写真に保存できます。</p>
    <button id="enter" class="primary">ネイルカラーを試す</button>
    <h3>使い方</h3>
    <ol><li>背面カメラを許可し、明るい場所で片手の甲を映す。</li><li>色と仕上がりを選び、自分の爪で見比べる。</li><li>気に入った状態を写真に保存する。追従を詳しく調べたい場合だけ研究用の表示を開く。</li></ol>
    <h3>試せることと精度</h3>
    <p>現在は関節点から爪の位置と形を推定して塗ります。爪の輪郭そのものをAIで検出する機能はまだないため、色がはみ出す場合があります。補正値は端末内に保存できます。追跡精度を調べる数値は撮影画面の「計測値を見る」にあります。</p>
    <h3>この先</h3>
    <p>iPhoneで静止・移動・傾き・指の重なりを測り、追跡と補正を改善します。実際の爪の輪郭を見つける専用モデルは未導入です。精度と利用条件を確認できた場合に検討し、TSUYAへの移植は検証後に判断します。</p>
  </section>
  <main id="lab" hidden>
    <div class="labNav"><button id="back" type="button">← トップに戻る</button><strong>ネイルカラー試着</strong></div>
    <section class="viewer"><video id="camera" playsinline muted autoplay></video><canvas id="stage"></canvas><div id="banner">背面カメラを開始してください</div></section>
    <section class="controls">
      <div class="row"><button id="start">カメラ開始</button><button id="stop" disabled>停止</button><button id="freeze" disabled>1フレーム固定</button><button id="resume" disabled>再開</button></div>
      <p id="appStatus" class="hint" role="status" aria-live="polite">開始後、手の甲をカメラに向けてください。</p>
      <section class="tryOn" aria-label="ネイルカラーを選ぶ">
        <strong>ネイルカラー</strong>
        <div class="swatches">${SHADES.map(({ name, color }) => `<button class="swatch" type="button" data-color="${color}" style="background:${color}" aria-label="${name}" title="${name}"></button>`).join('')}</div>
        <div class="row"><label>好きな色 <input id="customColor" type="color" value="#bd586c"></label><label><input id="multiColor" type="checkbox"> 5本別々の色</label></div>
        <div id="fingerColors" class="fingerColors" hidden>${FINGERS.map(f => `<label>${LABELS[f]} <input type="color" data-finger="${f}" value="${INITIAL_FINGER_COLORS[f]}"></label>`).join('')}</div>
        <div class="row"><label>仕上がり <select id="finish"><option value="cream">クリーム</option><option value="gel">ジェル風</option><option value="sheer">シアー</option><option value="matte">マット</option></select></label><label><input id="bare" type="checkbox"> 色を外して比較</label></div>
        <button id="capture" type="button" disabled>この試着を写真に保存</button>
        <p class="hint">保存を押したときだけ、この端末に写真を作ります。撮影画像はサーバーに送りません。</p>
        <p class="hint">色は爪の推定位置に重ねます。輪郭がずれたら下の補正で調整してください。</p>
      </section>
      <details class="tools"><summary>追跡の表示・設定（研究用）</summary>
      <label>表示モード <select id="mode"><option>NAIL OVERLAY</option><option>LANDMARK</option><option>NAIL POSITION</option><option>DEBUG</option></select></label>
      <div class="row"><label><input type="checkbox" id="mirror"> 左右反転</label><label><input type="checkbox" id="filter" checked> One Euro Filter</label><label><input type="checkbox" id="compare" checked> 補正前も表示</label></div>
      </details>
      <details class="tools"><summary>指ごとの位置・大きさを補正</summary>
        <label>調整する指 <select id="finger">${FINGERS.map(f => `<option value="${f}">${LABELS[f]}</option>`).join('')}</select></label>
        <div id="sliders"></div>
        <div class="row"><button id="reset">この指の補正を初期化</button><button id="save">補正値を端末に保存</button></div>
      </details>
      <p class="hint">固定フレームでは、爪を選んで輪郭上を順にタップしてください。点は最大12個です。輪郭は端末内の一時メモリにのみ保持します。</p>
      <div class="row"><button id="undo" disabled>点を戻す</button><button id="clear" disabled>輪郭を消す</button><button id="export" disabled>比較結果を保存</button></div>
      <details class="tools"><summary>計測値を見る（研究用）</summary>
        <p class="hint">FPS＝画面更新、推論ms＝手の認識時間、描画ms＝重ね描き時間。各指の位置・幅・角度・変動は推定値です。「認識信頼度 不明」は爪そのものを検出していないことを示します。</p>
        <div id="metrics" aria-live="polite"></div>
        <div id="fingerStatus"></div>
        <div id="comparison"></div>
      </details>
    </section>
  </main>`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#stage');
const ctx = canvas.getContext('2d')!;
const video = $<HTMLVideoElement>('#camera');
const banner = $<HTMLDivElement>('#banner');
const metrics = $<HTMLDivElement>('#metrics');
const statusBox = $<HTMLDivElement>('#fingerStatus');
const comparison = $<HTMLDivElement>('#comparison');
const appStatus = $<HTMLParagraphElement>('#appStatus');
const modeInput = $<HTMLSelectElement>('#mode');
const fingerInput = $<HTMLSelectElement>('#finger');
const stabilizer = new NailStabilizer();
const fingerColors = { ...INITIAL_FINGER_COLORS };
let selectedColor = SHADES[0].color;
let finish: Finish = 'cream';

function updateSwatches() {
  document.querySelectorAll<HTMLButtonElement>('.swatch').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.color === selectedColor && !$<HTMLInputElement>('#multiColor').checked));
  });
}
function useSingleColor(color: string) {
  selectedColor = color;
  $<HTMLInputElement>('#customColor').value = color;
  $<HTMLInputElement>('#multiColor').checked = false;
  $<HTMLElement>('#fingerColors').hidden = true;
  updateSwatches();
  render();
}
document.querySelectorAll<HTMLButtonElement>('.swatch').forEach(button => button.addEventListener('click', () => useSingleColor(button.dataset.color!)));
$<HTMLInputElement>('#customColor').addEventListener('input', event => useSingleColor((event.target as HTMLInputElement).value));
$<HTMLInputElement>('#multiColor').addEventListener('change', event => {
  $<HTMLElement>('#fingerColors').hidden = !(event.target as HTMLInputElement).checked;
  updateSwatches(); render();
});
document.querySelectorAll<HTMLInputElement>('#fingerColors input').forEach(input => input.addEventListener('input', () => {
  fingerColors[input.dataset.finger as Finger] = input.value;
  render();
}));
$<HTMLSelectElement>('#finish').addEventListener('change', event => { finish = (event.target as HTMLSelectElement).value as Finish; render(); });
$<HTMLInputElement>('#bare').addEventListener('change', render);
updateSwatches();

function readCalibration(): Record<Finger, Calibration> {
  try {
    const saved = JSON.parse(localStorage.getItem('nail-tracking-lab-calibration-v1') || '{}');
    return Object.fromEntries(FINGERS.map(f => [f, { ...DEFAULT_CALIBRATION, ...saved[f] }])) as Record<Finger, Calibration>;
  } catch { return Object.fromEntries(FINGERS.map(f => [f, { ...DEFAULT_CALIBRATION }])) as Record<Finger, Calibration>; }
}
const calibration = readCalibration();
let landmarker: HandLandmarker | null = null;
let landmarkerPromise: Promise<HandLandmarker> | null = null;
let stream: MediaStream | null = null;
let startToken = 0;
let running = false;
let frozen = false;
let frozenFrame: HTMLCanvasElement | null = null;
let frozenTracks: Record<Finger, NailTrack> | null = null;
let currentTracks: Record<Finger, NailTrack> | null = null;
let currentLandmarks: Landmark[] = [];
const emptyManual = () => Object.fromEntries(FINGERS.map(f => [f, [] as Point[]])) as Record<Finger, Point[]>;
let manual = emptyManual();
let lastInferenceAt = 0;
let inferenceMs = 0;
let drawMs = 0;
let frameCount = 0;
let fpsAt = performance.now();
let fps = 0;
let rafId = 0;
let lastDrawAt = 0;
let lastUiAt = 0;
let lastHandAt = 0;
const inferenceCanvas = document.createElement('canvas');
const inferenceContext = inferenceCanvas.getContext('2d', { willReadFrequently: true })!;

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
for (const id of ['mode', 'mirror', 'compare']) $<HTMLElement>(`#${id}`).addEventListener('change', () => {
  if (id === 'mirror') video.style.transform = $<HTMLInputElement>('#mirror').checked ? 'scaleX(-1)' : '';
  render();
});
showSliders();
$('#reset').addEventListener('click', () => { calibration[fingerInput.value as Finger] = { ...DEFAULT_CALIBRATION }; showSliders(); if (frozen) recomputeFrozen(); });
$('#save').addEventListener('click', () => { localStorage.setItem('nail-tracking-lab-calibration-v1', JSON.stringify(calibration)); banner.textContent = '補正値をこの端末に保存しました'; });

async function initLandmarker() {
  if (landmarker) return;
  banner.textContent = '手の認識モデルを読み込み中…';
  if (!landmarkerPromise) landmarkerPromise = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
    });
  })().catch(error => { landmarkerPromise = null; throw error; });
  landmarker = await landmarkerPromise;
}

async function start() {
  if (stream || running) return;
  const token = ++startToken;
  const startButton = $<HTMLButtonElement>('#start');
  startButton.disabled = true;
  $<HTMLButtonElement>('#stop').disabled = false;
  appStatus.textContent = 'カメラに接続中…';
  try {
    if (!window.isSecureContext) throw new Error('カメラには HTTPS または localhost が必要です。');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラを利用できません。');
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
    if (token !== startToken) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (token === startToken) { stop(); banner.textContent = 'カメラが切断されました。再度「カメラ開始」を押してください。'; } });
    video.srcObject = stream;
    await video.play();
    if (token !== startToken) return;
    if (video.videoWidth && video.videoHeight) video.style.aspectRatio = `${video.videoWidth}/${video.videoHeight}`;
    banner.textContent = '手の認識モデルを読み込み中…映像は先に確認できます';
    appStatus.textContent = 'モデルを準備中。長く止まる場合は「停止」からやり直せます。';
    await initLandmarker();
    if (token !== startToken) return;
    running = true; frozen = false; lastInferenceAt = 0; lastHandAt = performance.now();
    inferenceMs = 0; drawMs = 0; frameCount = 0; fps = 0; fpsAt = performance.now(); stabilizer.reset();
    $<HTMLButtonElement>('#freeze').disabled = false;
    $<HTMLButtonElement>('#capture').disabled = false;
    banner.textContent = '';
    appStatus.textContent = '手の甲を背面カメラに向けてください。選んだ色を爪の推定位置に重ねます。';
    rafId = requestAnimationFrame(loop);
  } catch (error) {
    if (token !== startToken) return;
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    video.srcObject = null; video.style.aspectRatio = '';
    startButton.disabled = false;
    $<HTMLButtonElement>('#stop').disabled = true;
    appStatus.textContent = '開始に失敗しました。表示された原因を確認して、もう一度試してください。';
    banner.textContent = error instanceof DOMException && error.name === 'OverconstrainedError'
      ? '背面カメラを利用できません。この端末とブラウザのカメラ設定を確認してください。'
      : `開始できません: ${error instanceof Error ? error.message : String(error)}`;
  }
}
function stop() {
  startToken++;
  running = false; frozen = false; cancelAnimationFrame(rafId);
  stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; video.style.aspectRatio = '';
  $<HTMLElement>('.viewer').classList.remove('frozen');
  frozenFrame = null; frozenTracks = null; currentTracks = null; currentLandmarks = []; manual = emptyManual();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  stabilizer.reset();
  $<HTMLButtonElement>('#start').disabled = false;
  for (const id of ['stop', 'freeze', 'resume', 'undo', 'clear', 'export']) $<HTMLButtonElement>(`#${id}`).disabled = true;
  $<HTMLButtonElement>('#capture').disabled = true;
  banner.textContent = 'カメラを停止しました'; comparison.textContent = '';
  appStatus.textContent = '「カメラ開始」で再開できます。';
}
$('#start').addEventListener('click', start);
$('#stop').addEventListener('click', stop);
$('#capture').addEventListener('click', () => {
  if (!running || !video.videoWidth || !video.videoHeight) return;
  const photo = document.createElement('canvas');
  photo.width = frozenFrame?.width ?? video.videoWidth;
  photo.height = frozenFrame?.height ?? video.videoHeight;
  const photoContext = photo.getContext('2d');
  if (!photoContext) { appStatus.textContent = '写真を作成できませんでした。'; return; }
  render();
  if (frozenFrame) photoContext.drawImage(canvas, 0, 0, photo.width, photo.height);
  else {
    if ($<HTMLInputElement>('#mirror').checked) {
      photoContext.translate(photo.width, 0);
      photoContext.scale(-1, 1);
    }
    photoContext.drawImage(video, 0, 0, photo.width, photo.height);
    photoContext.setTransform(1, 0, 0, 1, 0, 0);
    photoContext.drawImage(canvas, 0, 0, photo.width, photo.height);
  }
  photo.toBlob(blob => {
    if (!blob) { appStatus.textContent = '写真を作成できませんでした。'; return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nail-tryon-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    appStatus.textContent = '試着写真のダウンロードを開始しました。ブラウザの保存先を確認してください。';
  }, 'image/png');
});
function showView() {
  const labOpen = location.hash === '#experiment';
  $<HTMLElement>('#home').hidden = labOpen;
  $<HTMLElement>('#lab').hidden = !labOpen;
  if (!labOpen) {
    if (stream || running || $<HTMLButtonElement>('#start').disabled) stop();
    window.scrollTo(0, 0);
  }
}
$('#enter').addEventListener('click', () => {
  location.hash = 'experiment';
  showView();
  void start();
});
$('#back').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname + location.search);
  showView();
});
window.addEventListener('hashchange', showView);
showView();
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
  } catch (error) { frozenTracks = null; currentLandmarks = []; appStatus.textContent = `固定フレームの認識に失敗しました: ${String(error)}`; }
  frozenFrame = frame; frozen = true;
  $<HTMLButtonElement>('#resume').disabled = false; $<HTMLButtonElement>('#freeze').disabled = true;
  $<HTMLButtonElement>('#undo').disabled = false; $<HTMLButtonElement>('#clear').disabled = false;
  $<HTMLButtonElement>('#export').disabled = false;
  banner.textContent = '固定中：輪郭をタップして指定。「再開」でライブに戻ります';
  appStatus.textContent = '1フレーム固定中です。「再開」でカメラ映像に戻ります。';
  $<HTMLElement>('.viewer').classList.add('frozen');
  render();
});
$('#resume').addEventListener('click', () => { frozen = false; frozenFrame = null; frozenTracks = null; manual = emptyManual(); stabilizer.reset(); lastInferenceAt = 0; $<HTMLElement>('.viewer').classList.remove('frozen'); $<HTMLButtonElement>('#resume').disabled = true; $<HTMLButtonElement>('#freeze').disabled = false; $<HTMLButtonElement>('#export').disabled = true; comparison.textContent = ''; banner.textContent = ''; appStatus.textContent = 'ライブ映像に戻りました。'; });
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
  try {
    if (!frozen && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      // The video stays visible while inference runs on a smaller copy of the frame.
      // Do not gate inference on currentTime: camera streams may report it unreliably.
      if (now - lastInferenceAt >= Math.max(65, Math.min(180, inferenceMs * 1.25))) {
        const scale = Math.min(1, 640 / video.videoWidth);
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (inferenceCanvas.width !== width || inferenceCanvas.height !== height) { inferenceCanvas.width = width; inferenceCanvas.height = height; }
        inferenceContext.drawImage(video, 0, 0, width, height);
        const began = performance.now();
        const result: HandLandmarkerResult = landmarker!.detectForVideo(inferenceCanvas, now);
        inferenceMs = performance.now() - began;
        lastInferenceAt = now;
        currentLandmarks = result.landmarks[0]?.length === 21 ? result.landmarks[0] as Landmark[] : [];
        if (currentLandmarks.length) lastHandAt = now;
        currentTracks = stabilizer.update(estimateNails(currentLandmarks, calibration, video.videoWidth / video.videoHeight), now, $<HTMLInputElement>('#filter').checked);
      }
    }
    if (now - lastDrawAt >= 32) {
      const beganDraw = performance.now(); render(); drawMs = performance.now() - beganDraw;
      lastDrawAt = now; frameCount++;
      if (now - fpsAt >= 1000) { fps = frameCount * 1000 / (now - fpsAt); frameCount = 0; fpsAt = now; }
      if (!frozen && now - lastUiAt < 40) appStatus.textContent = video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ? 'カメラ映像を待っています。「停止」からやり直せます。'
        : now - lastHandAt > 1000 ? '手を見つけられません。明るい場所で手の甲と指先を画面内に入れてください。'
          : !currentTracks || !FINGERS.some(f => currentTracks![f].status === 'tracked')
            ? '手は見つかりましたが、爪位置は不明です。指先を離し、手の甲をカメラへ向けてください。'
            : $<HTMLInputElement>('#bare').checked ? '色を外して比較中です。チェックを外すと再び色が重なります。'
              : '選んだ色を爪の推定位置に重ねています。ずれた指は補正できます。';
    }
  } catch (error) {
    stop();
    banner.textContent = `認識・描画エラー: ${error instanceof Error ? error.message : String(error)}。再度「カメラ開始」を押してください。`;
    appStatus.textContent = '処理を停止しました。エラーを確認して再開できます。';
    return;
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
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (frozenFrame) {
    ctx.save();
    if ($<HTMLInputElement>('#mirror').checked) { ctx.translate(canvas.width,0); ctx.scale(-1,1); }
    ctx.drawImage(source,0,0,canvas.width,canvas.height); ctx.restore();
  }
  const mode = modeInput.value as Mode;
  const tracks = frozen ? frozenTracks : currentTracks;
  if (mode === 'LANDMARK' || mode === 'DEBUG') drawLandmarks();
  if (mode !== 'LANDMARK' && tracks) for (const f of FINGERS) {
    const t = tracks[f];
    if (t.filtered && t.status !== 'unknown' && t.status !== 'lost') {
      if (mode === 'NAIL OVERLAY') {
        if (!$<HTMLInputElement>('#bare').checked) drawPolish(ctx, t.filtered, canvas.width, canvas.height, $<HTMLInputElement>('#mirror').checked,
          $<HTMLInputElement>('#multiColor').checked ? fingerColors[f] : selectedColor, finish, t.alpha);
      } else drawNail(t.filtered,COLORS[f],false,t.alpha,t.status === 'held');
    }
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
