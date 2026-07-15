// Clearcoat Showroom — cinematic livery-reveal videos for sharing.
// Choreography: darkness → spotlight passes reveal the design (spec-driven,
// so chrome flashes, matte stays flat, neon glows) → full light with a slow
// push-in and floor reflection → title card. Records to WebM via
// MediaRecorder for a Discord-ready clip.

import { lightFrameAt, lightSweepSupported } from './lightsweep.js';

const W = 1280, H = 720;
const DURATION = 10.0;   // seconds
const FPS = 30;

const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// timeline → {light: [x,y,z] in sheet UV, ambient 0..1, zoom, titleA, revealA}
function cue(t) {
  const p = t / DURATION;
  let light = [0.5, 0.15, 0.45];
  let ambient = 0, zoom = 1.10, titleA = 0, revealA = 1;

  if (t < 1.0) {                                    // fade from black, logo tease
    revealA = clamp01(t / 1.0) * 0.15;
    ambient = 0.02;
  } else if (t < 4.2) {                             // pass 1: high diagonal
    const k = ease((t - 1.0) / 3.2);
    light = [lerp(-0.15, 1.15, k), lerp(0.18, 0.55, k), 0.30];
    ambient = 0.03;
  } else if (t < 6.8) {                             // pass 2: low return sweep
    const k = ease((t - 4.2) / 2.6);
    light = [lerp(1.15, -0.15, k), lerp(0.82, 0.55, k), 0.28];
    ambient = lerp(0.05, 0.16, k);
  } else if (t < 8.4) {                             // lights up: full reveal
    const k = ease((t - 6.8) / 1.6);
    light = [0.5, lerp(0.55, 0.30, k), lerp(0.30, 0.55, k)];
    ambient = lerp(0.16, 1.0, k);
    zoom = lerp(1.10, 1.02, k);
  } else {                                          // hold + title card
    light = [0.5, 0.30, 0.55];
    ambient = 1.0;
    zoom = lerp(1.02, 1.0, ease((t - 8.4) / 1.6));
    titleA = clamp01((t - 8.6) / 0.8);
  }
  return { light, ambient, zoom, titleA, revealA };
}

function drawFrame(ctx, shaded, t, title) {
  const { zoom, titleA, revealA } = cue(t);
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, W, H);

  // sheet: centered, pillarboxed, gentle push-in
  const sheetH = 560 * zoom;
  const sheetW = sheetH;                     // livery sheets are square
  const x = (W - sheetW) / 2;
  const y = 54 - (sheetH - 560) / 2;

  ctx.save();
  ctx.globalAlpha = revealA;
  ctx.drawImage(shaded, x, y, sheetW, sheetH);

  // floor reflection
  ctx.save();
  ctx.translate(0, (y + sheetH) * 2 + 4);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.22 * revealA;
  ctx.drawImage(shaded, x, y + sheetH * 0.62, sheetW, sheetH * 0.38,
                x, y, sheetW, sheetH * 0.38);
  ctx.restore();
  const fade = ctx.createLinearGradient(0, y + sheetH, 0, y + sheetH + 90);
  fade.addColorStop(0, 'rgba(5,6,8,0.35)');
  fade.addColorStop(1, 'rgba(5,6,8,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, y + sheetH, W, H - (y + sheetH));
  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // letterbox bars — instant "cinematic" read
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, 34);
  ctx.fillRect(0, H - 34, W, 34);

  // title card
  if (titleA > 0) {
    ctx.save();
    ctx.globalAlpha = titleA;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e6edf3';
    ctx.font = '600 40px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(title, W / 2, H - 96);
    ctx.globalAlpha = titleA * 0.75;
    ctx.fillStyle = '#f0b429';
    ctx.font = '300 15px "Segoe UI", system-ui, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('B U I L T   W I T H   C L E A R C O A T', W / 2, H - 64);
    ctx.restore();
  }
}

export function showroomSupported() {
  return lightSweepSupported() && 'MediaRecorder' in window;
}

// Plays the reveal on `canvas` (sized W×H here). When `record` is true the
// run is captured and the returned promise resolves with a WebM Blob (or
// null when only previewing / recording unsupported). onDone fires either way.
export function playShowroom(canvas, paintCanvas, specCanvas, title, record, onDone) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  let recorder = null;
  const chunks = [];
  let resolveBlob;
  const blobPromise = new Promise((res) => { resolveBlob = res; });

  if (record) {
    const stream = canvas.captureStream(FPS);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => resolveBlob(new Blob(chunks, { type: 'video/webm' }));
    recorder.start(250);
  } else {
    resolveBlob(null);
  }

  const t0 = performance.now();
  let stopped = false;
  let first = true;

  function frame() {
    if (stopped) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= DURATION) {
      stopped = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      if (onDone) onDone();
      return;
    }
    const { light, ambient } = cue(t);
    const shaded = lightFrameAt(paintCanvas, specCanvas, light, ambient, first);
    first = false;
    if (shaded) drawFrame(ctx, shaded, t, title);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    blob: blobPromise,
    cancel() {
      stopped = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    },
  };
}
