import {
  SIZE, MATERIALS, BLEND_MODES, createDoc, createImageLayer, createPatternLayer, createFillLayer,
  createMaskedPatternLayer,
  createTextLayer, regenerateText, fillShapePath, fillPaintStyle,
  GOOGLE_FONTS, registerCustomFont,
  renderPaint, renderSpec, hitTest, hitTestAll, layerCorners, isRegionLayer,
  buildDragCache, renderPaintWithDrag,
  serializeDoc, deserializeDoc, loadImage,
  templateOverlay, defaultParams, resolveParams, mixHex, drawLayer,
} from './engine.js';
import { detectPalette, splitByPalette } from './separate.js';
import { canvasToTGA, tgaToCanvas } from './tga.js';
import { psdToTemplate } from './psd.js';
import { renderBall, layerAlbedo } from './shaderball.js';
import { lightSweepSupported, lightSweepFrame } from './lightsweep.js';
import { studioSupported, openStudio, closeStudio, studioCanvas, studioSetShape, studioSetEnv } from './studio.js';
import * as persist from './persist.js';
import { LIBRARY, libraryItemToLayerSource } from './library.js';
import { wandSelect } from './wand.js';
import { parseRegionMap, createRegionMap, regionAt, regionById, mirrorPoint, mirrorLayerPlacement, uniqueRegionId } from './regions.js';
import { initAdvisor } from './advisor.js';

// ---------- state ----------

let doc = createDoc();
let selectedId = null;        // primary selection: layer id, 'base', or null
const selectedIds = new Set(); // multi-select (layer ids only, never 'base')
let specView = false;
let shineView = false;
let shineStart = 0;
let dirty = true;             // composite needs re-render
let studioView = false;       // Studio 3D panel open
let studioDirty = true;       // studio textures need re-render + re-upload
let autosaveTimer = null;
let currentProjectId = null;  // browser project autosave writes through to (null = unsaved scratch)

const view = { x: 0, y: 0, zoom: 0.3 };   // doc → screen: screen = (doc + offset) * zoom

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const vctx = viewport.getContext('2d');

// ---------- status bar ----------

let statusTimer = null;
function status(msg, cls = '') {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = cls;
  clearTimeout(statusTimer);
  if (cls) statusTimer = setTimeout(() => { el.className = ''; el.textContent = 'Ready.'; }, 4000);
}

// ---------- coordinate transforms ----------

function screenToDoc(sx, sy) {
  return { x: sx / view.zoom - view.x, y: sy / view.zoom - view.y };
}
function docToScreen(dx, dy) {
  return { x: (dx + view.x) * view.zoom, y: (dy + view.y) * view.zoom };
}

function syncZoomReadout() {
  $('zoom-readout').textContent = Math.round(view.zoom * 100) + '%';
}

function fitView() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  view.zoom = Math.min(w / SIZE, h / SIZE) * 0.92;
  view.x = (w / view.zoom - SIZE) / 2;
  view.y = (h / view.zoom - SIZE) / 2;
  syncZoomReadout();
  requestRender();
}

function setZoom(z, cx, cy) {
  // keep doc point under (cx, cy) fixed
  const before = screenToDoc(cx, cy);
  view.zoom = Math.max(0.05, Math.min(8, z));
  const after = screenToDoc(cx, cy);
  view.x += after.x - before.x;
  view.y += after.y - before.y;
  syncZoomReadout();
  requestRender();
}

// ---------- viewport rendering ----------

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; draw(); });
}

function markDirty() {
  dirty = true;
  studioDirty = true; // studio picks fresh maps up on its next frame
  skipNextCapture = false; // a real edit followed an undo/redo — capture it
  requestRender();
  scheduleAutosave();
}

// ---------- undo / redo ----------
// Snapshot-based: the autosave debounce also captures history, so one undo
// step ≈ one settled action (a slider drag, a move, a delete).

const undoStack = [];
const redoStack = [];
let suppressHistory = false;
// set right after an undo/redo restore: the next settled capture would only
// re-record the restored state (text layers re-rasterize, so the string may
// differ and would wrongly clear the redo stack). Any real edit clears it.
let skipNextCapture = false;

// Layer srcs, the template image, and custom font data are large base64
// strings — duplicating them into all 40 snapshot strings costs real memory.
// History snapshots store a short intern ref instead; the actual strings live
// once in a side table. Project export and autosave still serialize the full
// data — only history is interned.
const SRC_REF = '@cc-history-src:';
const internedSrcs = new Map();   // ref → src
const internedRefs = new Map();   // src → ref (dedupe)
let internSeq = 0;

function internString(s) {
  let ref = internedRefs.get(s);
  if (!ref) {
    ref = SRC_REF + (++internSeq);
    internedRefs.set(s, ref);
    internedSrcs.set(ref, s);
  }
  return ref;
}

// swap big strings for intern refs — serializeDoc returns fresh objects,
// so mutating them never touches the live doc
function internSnapshot(data) {
  for (const l of data.layers) {
    if (typeof l.src === 'string' && l.src) l.src = internString(l.src);
  }
  if (typeof data.template === 'string' && data.template) {
    data.template = internString(data.template);
  }
  for (const f of (data.customFonts || [])) {
    if (typeof f.data === 'string' && f.data) f.data = internString(f.data);
  }
  return data;
}

// swap intern refs back to real strings before deserializeDoc sees them
function resolveSnapshot(data) {
  const resolve = (s) =>
    (typeof s === 'string' && s.startsWith(SRC_REF)) ? (internedSrcs.get(s) ?? null) : s;
  for (const l of data.layers) l.src = resolve(l.src);
  data.template = resolve(data.template);
  for (const f of (data.customFonts || [])) f.data = resolve(f.data);
  return data;
}

// drop interned srcs no longer referenced by any remaining snapshot;
// the trailing quote keeps ":1" from matching ":10" etc.
function pruneInternedSrcs() {
  for (const [ref, src] of internedSrcs) {
    const needle = ref + '"';
    if (undoStack.some(s => s.includes(needle))) continue;
    if (redoStack.some(s => s.includes(needle))) continue;
    internedSrcs.delete(ref);
    internedRefs.delete(src);
  }
}

// data: an already-serialized doc (it gets interned/mutated — don't reuse it)
function captureHistory(data) {
  if (suppressHistory) return;
  if (skipNextCapture) { skipNextCapture = false; return; }
  const snap = JSON.stringify(internSnapshot(data || serializeDoc(doc)));
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  const evicted = undoStack.length > 40;
  if (evicted) undoStack.shift();
  const cleared = redoStack.length > 0;
  redoStack.length = 0;
  if (evicted || cleared) pruneInternedSrcs();
  updateUndoButtons();
}

// opening a project starts its own timeline — empty stacks let the prune
// sweep every interned src, so the tables fully clear
function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  pruneInternedSrcs();
  updateUndoButtons();
}

function updateUndoButtons() {
  $('btn-undo').disabled = undoStack.length < 2;
  $('btn-redo').disabled = redoStack.length === 0;
}

async function applyHistory(snap) {
  suppressHistory = true;
  try {
    doc = await deserializeDoc(resolveSnapshot(JSON.parse(snap)));
    selectedId = null;
    selectedIds.clear();
    syncDocUI();
    markDirty();
  } finally {
    suppressHistory = false;
    // the autosave this restore scheduled must not re-capture the restored
    // state; markDirty from a real edit lifts this immediately
    skipNextCapture = true;
  }
  updateUndoButtons();
}

function undo() {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  applyHistory(undoStack[undoStack.length - 1]);
}

function redo() {
  if (!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(snap);
  applyHistory(snap);
}

$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

function selectedLayer() {
  return doc.layers.find(l => l.id === selectedId) || null;
}

const HANDLE_PX = 8;

// Composite cache: renderPaint/renderSpec draw into shared singleton canvases
// in engine.js, so "cache" just means skipping the call — valid while the doc
// is clean (`dirty` false) and the view mode matches the last render. Shine
// view is animated and never caches here.
let compositeCache = null;     // canvas from the last paint/spec render
let compositeCacheMode = null; // 'paint' | 'spec'

function draw() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (viewport.width !== w * devicePixelRatio || viewport.height !== h * devicePixelRatio) {
    viewport.width = w * devicePixelRatio;
    viewport.height = h * devicePixelRatio;
  }
  vctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  vctx.clearRect(0, 0, w, h);

  let composite;
  if (shineView) {
    const frame = lightSweepFrame(
      renderPaint(doc), renderSpec(doc),
      (performance.now() - shineStart) / 1000, dirty,
    );
    composite = frame || renderPaint(doc); // WebGL unavailable → plain paint
    compositeCache = null; // shine touched both singletons — re-render next time
  } else if (drag && dragPaintCache && !specView) {
    // live layer drag: static slabs pre-rendered, only moving layers redraw
    composite = renderPaintWithDrag(doc, dragPaintCache);
    compositeCache = null;
  } else {
    const mode = specView ? 'spec' : 'paint';
    if (dirty || !compositeCache || compositeCacheMode !== mode) {
      compositeCache = specView ? renderSpec(doc) : renderPaint(doc);
      compositeCacheMode = mode;
    }
    composite = compositeCache;
  }
  dirty = false;

  vctx.save();
  vctx.scale(view.zoom, view.zoom);
  vctx.translate(view.x, view.y);

  // sheet shadow + paint
  vctx.save();
  vctx.shadowColor = 'rgba(0,0,0,.6)';
  vctx.shadowBlur = 40 / view.zoom;
  vctx.fillStyle = '#000';
  vctx.fillRect(0, 0, SIZE, SIZE);
  vctx.restore();
  vctx.imageSmoothingQuality = 'high';
  vctx.drawImage(composite, 0, 0);

  // template overlay — recolored linework, or multiply for 'original'
  if (doc.template && !specView && doc.templateOpacity > 0) {
    const ov = templateOverlay(doc);
    vctx.save();
    vctx.globalAlpha = doc.templateOpacity;
    if (ov.multiply) vctx.globalCompositeOperation = 'multiply';
    vctx.drawImage(ov.img, 0, 0, SIZE, SIZE);
    vctx.restore();
  }
  vctx.restore();

  // region map overlay — screen space, forced on while annotating
  if ((regionsView || annotateMode) && doc.regionMap) drawRegionOverlay();

  // annotate / marquee drag — live rectangle preview
  if (drag && (drag.mode === 'annotate' || drag.mode === 'marquee')) {
    const a = docToScreen(drag.startP.x, drag.startP.y);
    const b = docToScreen(drag.curP.x, drag.curP.y);
    vctx.save();
    vctx.strokeStyle = drag.mode === 'annotate' ? '#ff4d00' : '#2dd6c1';
    vctx.lineWidth = 1.5;
    vctx.setLineDash([4, 4]);
    vctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    vctx.restore();
  }

  // snap guides — full-viewport lines where the dragged layer locked on
  if (drag && (drag.snapLineX != null || drag.snapLineY != null)) {
    vctx.save();
    vctx.strokeStyle = 'rgba(45, 214, 193, .8)';
    vctx.lineWidth = 1;
    vctx.setLineDash([6, 4]);
    if (drag.snapLineX != null) {
      const x = docToScreen(drag.snapLineX, 0).x;
      vctx.beginPath(); vctx.moveTo(x, 0); vctx.lineTo(x, h); vctx.stroke();
    }
    if (drag.snapLineY != null) {
      const y = docToScreen(0, drag.snapLineY).y;
      vctx.beginPath(); vctx.moveTo(0, y); vctx.lineTo(w, y); vctx.stroke();
    }
    vctx.restore();
  }

  // secondary selections: outline only, no handles
  for (const l of selectedLayers()) {
    if (l.id === selectedId || !l.visible) continue;
    const corners = layerCorners(l).map(p => docToScreen(p.x, p.y));
    vctx.save();
    vctx.strokeStyle = 'rgba(255, 77, 0, .45)';
    vctx.lineWidth = 1.5;
    vctx.setLineDash([4, 4]);
    vctx.beginPath();
    corners.forEach((p, i) => i ? vctx.lineTo(p.x, p.y) : vctx.moveTo(p.x, p.y));
    vctx.closePath();
    vctx.stroke();
    vctx.restore();
  }

  // group selection: bbox with its own scale/rotate handles
  const gb = groupBBox();
  if (gb) {
    const a = docToScreen(gb.x1, gb.y1);
    const b = docToScreen(gb.x2, gb.y2);
    vctx.save();
    vctx.strokeStyle = '#2dd6c1';
    vctx.lineWidth = 1.5;
    vctx.setLineDash([8, 5]);
    vctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    vctx.setLineDash([]);
    vctx.fillStyle = '#2dd6c1';
    for (const [hx, hy] of [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]]) {
      vctx.fillRect(hx - HANDLE_PX / 2, hy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    }
    // rotate handle above the top edge center
    vctx.beginPath();
    vctx.arc((a.x + b.x) / 2, a.y - 26, HANDLE_PX / 2 + 1, 0, Math.PI * 2);
    vctx.fill();
    vctx.restore();
  }

  // selection box + handles (screen space for crisp lines)
  const sel = selectedLayer();
  if (sel && sel.visible) {
    const corners = layerCorners(sel).map(p => docToScreen(p.x, p.y));
    vctx.save();
    vctx.strokeStyle = sel.locked ? '#5d636e' : '#ff4d00';
    vctx.lineWidth = 1.5;
    vctx.setLineDash([6, 4]);
    vctx.beginPath();
    corners.forEach((p, i) => i ? vctx.lineTo(p.x, p.y) : vctx.moveTo(p.x, p.y));
    vctx.closePath();
    vctx.stroke();
    vctx.setLineDash([]);

    // scale handles at corners (resize the region for pattern layers);
    // locked layers show the outline only
    if (!sel.locked) {
      vctx.fillStyle = '#ff4d00';
      for (const p of corners) {
        vctx.fillRect(p.x - HANDLE_PX / 2, p.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      }
      // mid-edge stretch handles (image/text only): scale one axis
      if (!isRegionLayer(sel)) {
        const s = HANDLE_PX - 3;
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          vctx.fillRect(mx - s / 2, my - s / 2, s, s);
        }
      }
    }

    // rotate handle — image layers only (regions stay axis-aligned)
    if (!sel.locked && !isRegionLayer(sel)) {
      const rot = rotateHandlePos(sel);
      vctx.beginPath();
      vctx.arc(rot.x, rot.y, HANDLE_PX / 2 + 1, 0, Math.PI * 2);
      vctx.fillStyle = '#2dd6c1';
      vctx.fill();
    }
    vctx.restore();
  }
}

function rotateHandlePos(layer) {
  const corners = layerCorners(layer).map(p => docToScreen(p.x, p.y));
  const midTop = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const center = docToScreen(layer.x, layer.y);
  const dx = midTop.x - center.x, dy = midTop.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: midTop.x + dx / len * 26, y: midTop.y + dy / len * 26 };
}

// ---------- region map overlay ----------

let regionsView = false;
let annotateMode = false;

function drawRegionOverlay() {
  vctx.save();
  vctx.lineWidth = 1;
  vctx.font = '11px "IBM Plex Mono", monospace';
  for (const r of doc.regionMap.regions) {
    const a = docToScreen(r.x, r.y);
    const b = docToScreen(r.x + r.w, r.y + r.h);
    vctx.fillStyle = 'rgba(45, 214, 193, .07)';
    vctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    vctx.strokeStyle = 'rgba(45, 214, 193, .75)';
    vctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const label = r.name + (r.mirror ? ' ⇄' : '');
    vctx.fillStyle = 'rgba(13, 14, 17, .75)'; // backing so labels read over any paint
    vctx.fillRect(a.x, a.y, vctx.measureText(label).width + 8, 17);
    vctx.fillStyle = '#2dd6c1';
    vctx.fillText(label, a.x + 4, a.y + 12);
  }
  vctx.restore();
}

// ---------- pointer interaction ----------

let drag = null; // { mode: 'move'|'scale'|'rotate'|'pan'|'marquee'|..., ... }
let dragPaintCache = null; // engine drag-slab cache while a layer drag is live

// pre-render the static slabs around the layers about to move (paint view
// only — spec/shine re-render fully anyway); null means "not applicable"
function startLayerDrag(ids) {
  dragPaintCache = (!specView && !shineView) ? buildDragCache(doc, ids) : null;
}

// ---------- snapping ----------
// While moving, layer centers (and region edges) snap to the sheet edges +
// center, to region-map lines, and to other layers' bounding-box edges and
// centers. Hold Alt to move freely.

function snapCandidates(excludeIds) {
  const xs = new Set([0, SIZE / 2, SIZE]);
  const ys = new Set([0, SIZE / 2, SIZE]);
  if (doc.regionMap) {
    for (const r of doc.regionMap.regions) {
      xs.add(r.x); xs.add(r.x + r.w / 2); xs.add(r.x + r.w);
      ys.add(r.y); ys.add(r.y + r.h / 2); ys.add(r.y + r.h);
    }
  }
  for (const l of doc.layers) {
    if (!l.visible || (excludeIds && excludeIds.has(l.id))) continue;
    const cs = layerCorners(l);
    const x1 = Math.min(...cs.map(c => c.x)), x2 = Math.max(...cs.map(c => c.x));
    const y1 = Math.min(...cs.map(c => c.y)), y2 = Math.max(...cs.map(c => c.y));
    xs.add(Math.round(x1)); xs.add(Math.round((x1 + x2) / 2)); xs.add(Math.round(x2));
    ys.add(Math.round(y1)); ys.add(Math.round((y1 + y2) / 2)); ys.add(Math.round(y2));
  }
  return { xs: [...xs], ys: [...ys] };
}

// ---------- group transforms (multi-select) ----------

// doc-space bounding box over all selected, visible layers
function groupBBox() {
  const layers = selectedLayers().filter(l => l.visible);
  if (layers.length < 2) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const l of layers) {
    for (const c of layerCorners(l)) {
      x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
      x2 = Math.max(x2, c.x); y2 = Math.max(y2, c.y);
    }
  }
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

function groupTransformStarts() {
  return selectedLayers().filter(l => !l.locked).map(l => ({
    layer: l, x: l.x, y: l.y, scale: l.scale, scaleY: l.scaleY ?? null,
    rotation: l.rotation || 0,
    rx: l.rx, ry: l.ry, rw: l.rw, rh: l.rh,
  }));
}

// best candidate line within tol for any of the feature offsets (e.g. a
// region's left edge / center / right edge); returns { v, line } or null
function snapEdge(v, spans, cands, tol) {
  let best = null, bd = tol;
  for (const off of spans) {
    for (const c of cands) {
      const d = Math.abs(v + off - c);
      if (d < bd) { bd = d; best = { v: c - off, line: c }; }
    }
  }
  return best;
}

function handleAt(sx, sy) {
  // group handles take priority while a multi-selection is active
  const gb = groupBBox();
  if (gb) {
    const a = docToScreen(gb.x1, gb.y1);
    const b = docToScreen(gb.x2, gb.y2);
    const rot = { x: (a.x + b.x) / 2, y: a.y - 26 };
    if (Math.hypot(sx - rot.x, sy - rot.y) <= HANDLE_PX) return { type: 'group-rotate' };
    const corners = [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(sx - corners[i][0]) <= HANDLE_PX && Math.abs(sy - corners[i][1]) <= HANDLE_PX) {
        return { type: 'group-scale' };
      }
    }
  }
  const sel = selectedLayer();
  if (!sel || !sel.visible || sel.locked) return null;
  if (!isRegionLayer(sel)) {
    const rot = rotateHandlePos(sel);
    if (Math.hypot(sx - rot.x, sy - rot.y) <= HANDLE_PX) return { type: 'rotate' };
  }
  const corners = layerCorners(sel).map(p => docToScreen(p.x, p.y));
  for (let i = 0; i < 4; i++) {
    if (Math.abs(sx - corners[i].x) <= HANDLE_PX && Math.abs(sy - corners[i].y) <= HANDLE_PX) {
      return { type: isRegionLayer(sel) ? 'region' : 'scale', corner: i };
    }
  }
  // mid-edge stretch handles (image/text only): 0 top, 1 right, 2 bottom, 3 left
  if (!isRegionLayer(sel)) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (Math.abs(sx - mx) <= HANDLE_PX && Math.abs(sy - my) <= HANDLE_PX) {
        return { type: 'stretch', edge: i };
      }
    }
  }
  return null;
}

// ---------- magic wand ----------

let wandMode = false;

function setWandMode(on) {
  wandMode = on;
  if (on && annotateMode) setAnnotateMode(false); // the two modes never coexist
  $('btn-wand').classList.toggle('active', on);
  $('wand-tol-row').hidden = !on;
  viewport.classList.toggle('wand', on || annotateMode);
  if (on) status('Wand: click a color region — Shift+click selects that color everywhere. Esc to exit.');
}
$('btn-wand').addEventListener('click', () => setWandMode(!wandMode));
$('wand-tol').addEventListener('input', () => {
  $('wand-tol-val').textContent = $('wand-tol').value;
});
$('wand-recolor').addEventListener('change', () => {
  $('wand-recolor-color').hidden = !$('wand-recolor').checked;
  if ($('wand-recolor').checked) $('wand-pattern').checked = false; // one action at a time
});

// wand "Pattern" fill — pick a tiling texture once, then every wand click
// fills its selection with that texture instead of making a material layer
let wandPatternImg = null;
$('wand-pattern').addEventListener('change', () => {
  if ($('wand-pattern').checked) {
    $('wand-recolor').checked = false;
    $('wand-recolor-color').hidden = true;
    $('file-wand-pattern').click();
  } else {
    wandPatternImg = null;
  }
});
$('file-wand-pattern').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) { $('wand-pattern').checked = false; return; }
  try {
    wandPatternImg = await loadImage(await fileToDataURL(file));
    status('Pattern armed — wand clicks now fill their selection with the texture.', 'ok');
  } catch {
    $('wand-pattern').checked = false;
    status('Could not load that image.', 'err');
  }
});

function wandClick(p, global) {
  const tol = parseInt($('wand-tol').value, 10);
  status('Selecting…');
  // give the status a frame to paint before the pixel crunch
  requestAnimationFrame(async () => {
    const result = wandSelect(renderPaint(doc), p.x, p.y, tol, global,
      $('wand-tight').checked ? 2 : 0);
    if (!result) { status('Nothing selected — try a higher tolerance.', 'err'); return; }
    try {
      const recolor = $('wand-recolor').checked;
      // pattern fill: clip the armed texture to the selection mask
      if ($('wand-pattern').checked && wandPatternImg && !recolor) {
        const maskImg = await loadImage(result.src);
        const mask = document.createElement('canvas');
        mask.width = mask.height = SIZE;
        mask.getContext('2d').drawImage(maskImg, 0, 0);
        const layer = createMaskedPatternLayer(mask, wandPatternImg, 'pattern ' + result.color);
        doc.layers.push(layer);
        selectLayer(layer.id);
        markDirty();
        const pctP = (result.count / (SIZE * SIZE) * 100).toFixed(1);
        status(`Filled ${result.color} (${pctP}% of sheet) with the armed texture.`, 'ok');
        return;
      }
      const img = await loadImage(result.src);
      const layer = createImageLayer(img, result.src,
        (recolor ? 'recolor ' : global ? 'color ' : 'region ') + result.color);
      layer.x = SIZE / 2; layer.y = SIZE / 2; layer.scale = 1;
      if (recolor) {
        // the mask is white — a 100% tint wash repaints it the chosen color
        layer.matParams = {
          ...defaultParams(layer.material),
          tint: $('wand-recolor-color').value,
          tintAmt: 100,
        };
      } else {
        layer.specOnly = true; // finish-only by design — pick a material next
      }
      doc.layers.push(layer);
      selectLayer(layer.id);
      markDirty();
      const pct = (result.count / (SIZE * SIZE) * 100).toFixed(1);
      status(recolor
        ? `Recolored ${result.color} → ${$('wand-recolor-color').value} (${pct}% of sheet) — adjust via the layer's Tint.`
        : `Selected ${result.color} (${pct}% of sheet) as a material-only layer — pick a finish.`, 'ok');
    } catch (err) {
      status('Selection failed: ' + err.message, 'err');
    }
  });
}

// ---------- color separation ----------
// Split the selected image/pattern layer into one layer per dominant color.
// Each split layer keeps its original pixels (AA and shading survive), so
// recoloring is the existing Tint wash and materials apply per color.
$('ins-split-colors').addEventListener('click', () => {
  const sel = selectedLayer();
  if (!sel || (sel.type !== 'image' && sel.type !== 'pattern')) return;
  status('Detecting colors…');
  requestAnimationFrame(() => {
    try {
      const flat = document.createElement('canvas');
      flat.width = flat.height = SIZE;
      const fctx = flat.getContext('2d');
      drawLayer(fctx, sel, false); // doc-space raster, fx and transform included
      const img = fctx.getImageData(0, 0, SIZE, SIZE);
      const palette = detectPalette(img.data);
      if (palette.length < 2) {
        status('Only one dominant color found — nothing to split.', 'err');
        return;
      }
      const parts = splitByPalette(img.data, palette);
      const at = doc.layers.indexOf(sel);
      const added = [];
      for (const part of parts) { // largest coverage first → bottom of the stack
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        c.getContext('2d').putImageData(new ImageData(part.data, SIZE, SIZE), 0, 0);
        const pct = (part.count / (SIZE * SIZE) * 100).toFixed(1);
        const layer = createImageLayer(c, c.toDataURL('image/png'), `${part.color} (${pct}%)`);
        layer.x = SIZE / 2; layer.y = SIZE / 2; layer.scale = 1;
        layer.material = sel.material;
        added.push(layer);
      }
      sel.visible = false; // keep the original underneath as a safety net
      doc.layers.splice(at + 1, 0, ...added);
      selectLayer(added[added.length - 1].id);
      rebuildLayerList();
      markDirty();
      status(`Split into ${added.length} color layers — original hidden beneath. Recolor via Tint, or give each its own material.`, 'ok');
    } catch (err) {
      status('Split failed: ' + err.message, 'err');
    }
  });
});

viewport.addEventListener('pointerdown', (e) => {
  viewport.setPointerCapture(e.pointerId);
  const sx = e.offsetX, sy = e.offsetY;

  if (annotateMode && e.button === 0 && !spaceHeld) {
    const p = screenToDoc(sx, sy);
    drag = { mode: 'annotate', startP: p, curP: p };
    return;
  }

  if (wandMode && e.button === 0 && !spaceHeld) {
    const p = screenToDoc(sx, sy);
    if (p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE) wandClick(p, e.shiftKey);
    return;
  }

  if (e.button === 1 || e.button === 2 || spaceHeld) {
    drag = { mode: 'pan', startX: sx, startY: sy, vx: view.x, vy: view.y };
    viewport.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;

  const handle = handleAt(sx, sy);
  const sel = selectedLayer();
  if (handle && (handle.type === 'group-scale' || handle.type === 'group-rotate')) {
    const p = screenToDoc(sx, sy);
    const gb = groupBBox();
    const starts = groupTransformStarts();
    if (gb && starts.length) {
      drag = handle.type === 'group-scale'
        ? { mode: 'group-scale', cx: gb.cx, cy: gb.cy, starts, startDist: Math.hypot(p.x - gb.cx, p.y - gb.cy) }
        : { mode: 'group-rotate', cx: gb.cx, cy: gb.cy, starts, startAngle: Math.atan2(p.y - gb.cy, p.x - gb.cx) * 180 / Math.PI };
      startLayerDrag(new Set(starts.map(s => s.layer.id)));
    }
    return;
  }
  if (handle && sel) {
    const p = screenToDoc(sx, sy);
    if (handle.type === 'rotate') {
      drag = {
        mode: 'rotate', layer: sel,
        startAngle: Math.atan2(p.y - sel.y, p.x - sel.x) * 180 / Math.PI - sel.rotation,
      };
    } else if (handle.type === 'region') {
      // corners resize the coverage region; Ctrl+corner on a pattern zooms
      // the texture itself around the region center instead
      if ((e.ctrlKey || e.metaKey) && sel.type === 'pattern') {
        const cx = sel.rx + sel.rw / 2, cy = sel.ry + sel.rh / 2;
        drag = {
          mode: 'pattern-zoom', layer: sel, cx, cy,
          startDist: Math.hypot(p.x - cx, p.y - cy),
          startScale: sel.scale, startX: sel.x, startY: sel.y,
        };
      } else {
        // anchor = the corner opposite the grabbed one
        const corners = layerCorners(sel);
        const anchor = corners[(handle.corner + 2) % 4];
        drag = { mode: 'region', layer: sel, anchor };
      }
    } else if (handle.type === 'stretch') {
      // one-axis stretch: work in the layer's unscaled local space so
      // rotation/skew don't bend the axis being dragged
      const m0 = new DOMMatrix()
        .translate(sel.x, sel.y)
        .rotate(sel.rotation || 0)
        .skewX(sel.skewX || 0)
        .skewY(sel.skewY || 0);
      drag = { mode: 'stretch', layer: sel, edge: handle.edge, inv: m0.inverse() };
    } else {
      drag = {
        mode: 'scale', layer: sel,
        startDist: Math.hypot(p.x - sel.x, p.y - sel.y),
        startScale: sel.scale,
        startScaleY: sel.scaleY ?? null,
      };
    }
    startLayerDrag(new Set([sel.id]));
    return;
  }

  const p = screenToDoc(sx, sy);
  const hits = hitTestAll(doc, p.x, p.y);
  let hit = hits[0] || null;

  // Shift+click toggles a layer in/out of the selection; Shift+drag on empty
  // sheet rubber-bands a multi-selection
  if (e.shiftKey) {
    if (hit) toggleSelect(hit.id);
    else drag = { mode: 'marquee', startP: p, curP: p };
    return;
  }

  // clicking again on an already-selected spot cycles down the stack
  if (hits.length > 1) {
    const idx = hits.findIndex(l => l.id === selectedId);
    if (idx !== -1) hit = hits[(idx + 1) % hits.length];
  }
  if (hit) {
    // dragging within a multi-selection moves the whole selection
    if (selectedIds.has(hit.id) && selectedIds.size > 1) {
      const starts = selectedLayers().filter(l => !l.locked).map(l => ({
        layer: l, x: l.x, y: l.y, rx: l.rx, ry: l.ry,
      }));
      drag = { mode: 'move-multi', startP: p, starts };
      startLayerDrag(new Set(starts.map(s => s.layer.id)));
      return;
    }
    selectLayer(hit.id);
    drag = isRegionLayer(hit)
      ? { mode: 'move-region', layer: hit, offX: p.x - hit.rx, offY: p.y - hit.ry, snaps: snapCandidates(new Set([hit.id])) }
      : { mode: 'move', layer: hit, offX: p.x - hit.x, offY: p.y - hit.y, snaps: snapCandidates(new Set([hit.id])) };
    startLayerDrag(new Set([hit.id]));
  } else {
    selectLayer(null);
    drag = { mode: 'pan', startX: sx, startY: sy, vx: view.x, vy: view.y };
    viewport.classList.add('panning');
  }
});

viewport.addEventListener('pointermove', (e) => {
  const sx = e.offsetX, sy = e.offsetY;
  const p = screenToDoc(sx, sy);
  const region = doc.regionMap ? regionAt(doc.regionMap, p.x, p.y) : null;
  $('status-pos').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}` + (region ? ` — ${region.name}` : '');

  if (!drag) {
    viewport.classList.toggle('over-layer', !!handleAt(sx, sy) || !!hitTest(doc, p.x, p.y));
    return;
  }

  switch (drag.mode) {
    case 'annotate':
    case 'marquee':
      drag.curP = p;
      requestRender();
      break;
    case 'pan':
      view.x = drag.vx + (sx - drag.startX) / view.zoom;
      view.y = drag.vy + (sy - drag.startY) / view.zoom;
      requestRender();
      break;
    case 'move': {
      let nx = Math.round(p.x - drag.offX);
      let ny = Math.round(p.y - drag.offY);
      drag.snapLineX = drag.snapLineY = null;
      if (!e.altKey && drag.snaps) {
        const tol = 8 / view.zoom; // ~8 screen px
        const sX = snapEdge(nx, [0], drag.snaps.xs, tol);
        const sY = snapEdge(ny, [0], drag.snaps.ys, tol);
        if (sX) { nx = Math.round(sX.v); drag.snapLineX = sX.line; }
        if (sY) { ny = Math.round(sY.v); drag.snapLineY = sY.line; }
      }
      drag.layer.x = nx;
      drag.layer.y = ny;
      syncInspector();
      markDirty();
      break;
    }
    case 'move-multi': {
      const dx = Math.round(p.x - drag.startP.x);
      const dy = Math.round(p.y - drag.startP.y);
      for (const s of drag.starts) {
        if (isRegionLayer(s.layer)) {
          s.layer.rx = s.rx + dx; s.layer.ry = s.ry + dy;
          s.layer.x = s.x + dx; s.layer.y = s.y + dy;
        } else {
          s.layer.x = s.x + dx; s.layer.y = s.y + dy;
        }
      }
      syncInspector();
      markDirty();
      break;
    }
    case 'move-region': {
      const l = drag.layer;
      let nx = Math.round(p.x - drag.offX);
      let ny = Math.round(p.y - drag.offY);
      drag.snapLineX = drag.snapLineY = null;
      if (!e.altKey && drag.snaps) {
        const tol = 8 / view.zoom;
        // region rects snap by left edge, center, or right edge
        const sX = snapEdge(nx, [0, l.rw / 2, l.rw], drag.snaps.xs, tol);
        const sY = snapEdge(ny, [0, l.rh / 2, l.rh], drag.snaps.ys, tol);
        if (sX) { nx = Math.round(sX.v); drag.snapLineX = sX.line; }
        if (sY) { ny = Math.round(sY.v); drag.snapLineY = sY.line; }
      }
      l.x += nx - l.rx; l.y += ny - l.ry; // texture rides along with its region
      l.rx = nx; l.ry = ny;
      markDirty();
      break;
    }
    case 'region': {
      const l = drag.layer;
      const a = drag.anchor;
      l.rx = Math.round(Math.min(a.x, p.x));
      l.ry = Math.round(Math.min(a.y, p.y));
      l.rw = Math.max(32, Math.round(Math.abs(p.x - a.x)));
      l.rh = Math.max(32, Math.round(Math.abs(p.y - a.y)));
      markDirty();
      break;
    }
    case 'scale': {
      const dist = Math.hypot(p.x - drag.layer.x, p.y - drag.layer.y);
      if (drag.startDist > 1) {
        const f = dist / drag.startDist;
        drag.layer.scale = Math.max(0.01, drag.startScale * f);
        // stretched layers keep their aspect through a uniform corner drag
        if (drag.startScaleY != null) drag.layer.scaleY = Math.max(0.01, drag.startScaleY * f);
        syncInspector();
        markDirty();
      }
      break;
    }
    case 'stretch': {
      const l = drag.layer;
      const lp = drag.inv.transformPoint(new DOMPoint(p.x, p.y));
      if (drag.edge === 1 || drag.edge === 3) {        // right/left: X axis
        if (l.scaleY == null) l.scaleY = l.scale;      // unlink so Y holds still
        l.scale = Math.max(0.01, Math.abs(lp.x) / (l.img.width / 2));
      } else {                                          // top/bottom: Y axis
        l.scaleY = Math.max(0.01, Math.abs(lp.y) / (l.img.height / 2));
      }
      syncInspector();
      markDirty();
      break;
    }
    case 'pattern-zoom': {
      const dist = Math.hypot(p.x - drag.cx, p.y - drag.cy);
      if (drag.startDist < 1) break;
      const f = Math.max(0.05, dist / drag.startDist);
      const l = drag.layer;
      l.scale = Math.max(0.01, drag.startScale * f);
      // keep the zoom visually centered: the tile origin orbits the region center
      l.x = Math.round(drag.cx + (drag.startX - drag.cx) * f);
      l.y = Math.round(drag.cy + (drag.startY - drag.cy) * f);
      syncInspector();
      markDirty();
      break;
    }
    case 'rotate': {
      let ang = Math.atan2(p.y - drag.layer.y, p.x - drag.layer.x) * 180 / Math.PI - drag.startAngle;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      drag.layer.rotation = Math.round(ang * 10) / 10;
      syncInspector();
      markDirty();
      break;
    }
    case 'group-scale': {
      const dist = Math.hypot(p.x - drag.cx, p.y - drag.cy);
      if (drag.startDist < 1) break;
      const f = Math.max(0.02, dist / drag.startDist);
      for (const s of drag.starts) {
        const l = s.layer;
        if (isRegionLayer(l)) {
          l.rw = Math.max(32, Math.round(s.rw * f));
          l.rh = Math.max(32, Math.round(s.rh * f));
          l.rx = Math.round(drag.cx + (s.rx + s.rw / 2 - drag.cx) * f - l.rw / 2);
          l.ry = Math.round(drag.cy + (s.ry + s.rh / 2 - drag.cy) * f - l.rh / 2);
          if (l.type === 'pattern') l.scale = Math.max(0.01, s.scale * f); // tiles ride along
        } else {
          l.scale = Math.max(0.01, s.scale * f);
          if (s.scaleY != null) l.scaleY = Math.max(0.01, s.scaleY * f);
          l.x = Math.round(drag.cx + (s.x - drag.cx) * f);
          l.y = Math.round(drag.cy + (s.y - drag.cy) * f);
        }
      }
      syncInspector();
      markDirty();
      break;
    }
    case 'group-rotate': {
      let delta = Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180 / Math.PI - drag.startAngle;
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      const rad = delta * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const spin = (x, y) => ({
        x: drag.cx + (x - drag.cx) * cos - (y - drag.cy) * sin,
        y: drag.cy + (x - drag.cx) * sin + (y - drag.cy) * cos,
      });
      for (const s of drag.starts) {
        const l = s.layer;
        if (isRegionLayer(l)) {
          // regions stay axis-aligned: orbit the rect center only
          const c = spin(s.rx + s.rw / 2, s.ry + s.rh / 2);
          const nrx = Math.round(c.x - s.rw / 2), nry = Math.round(c.y - s.rh / 2);
          l.x = s.x + (nrx - s.rx); l.y = s.y + (nry - s.ry); // tile offset rides along
          l.rx = nrx; l.ry = nry;
        } else {
          const c = spin(s.x, s.y);
          l.x = Math.round(c.x); l.y = Math.round(c.y);
          l.rotation = Math.round((s.rotation + delta) * 10) / 10;
        }
      }
      syncInspector();
      markDirty();
      break;
    }
  }
});

window.addEventListener('pointerup', () => {
  if (drag && drag.mode === 'annotate') finishAnnotate(drag);
  if (drag && drag.mode === 'marquee') finishMarquee(drag);
  drag = null;
  if (dragPaintCache) {
    // slabs are stale the moment the drag ends — force one clean full render
    dragPaintCache = null;
    compositeCache = null;
    requestRender();
  }
  viewport.classList.remove('panning');
});

// select every unlocked visible layer whose bounds intersect the marquee rect
function finishMarquee(d) {
  const x1 = Math.min(d.startP.x, d.curP.x), y1 = Math.min(d.startP.y, d.curP.y);
  const x2 = Math.max(d.startP.x, d.curP.x), y2 = Math.max(d.startP.y, d.curP.y);
  if (x2 - x1 < 3 && y2 - y1 < 3) { requestRender(); return; } // stray shift-click
  const picked = doc.layers.filter(l => {
    if (!l.visible || l.locked) return false;
    const cs = layerCorners(l);
    const bx1 = Math.min(...cs.map(c => c.x)), bx2 = Math.max(...cs.map(c => c.x));
    const by1 = Math.min(...cs.map(c => c.y)), by2 = Math.max(...cs.map(c => c.y));
    return bx1 < x2 && bx2 > x1 && by1 < y2 && by2 > y1;
  });
  selectedIds.clear();
  for (const l of picked) selectedIds.add(l.id);
  selectedId = picked.length ? picked[picked.length - 1].id : null;
  rebuildLayerList();
  syncInspector();
  requestRender();
  if (picked.length) status(`${picked.length} layer${picked.length === 1 ? '' : 's'} selected.`);
}

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoom(view.zoom * factor, e.offsetX, e.offsetY);
}, { passive: false });

viewport.addEventListener('contextmenu', (e) => e.preventDefault());

let spaceHeld = false;

// ---------- ask dialog (prompt() replacement) ----------
// Small in-app form: askDialog({ title, fields, okLabel }) resolves with
// { key: value } or null on cancel. fields: { key, label, value?,
// placeholder?, type?: 'select', options?: [{ value, label }] }.

const askModal = $('ask-modal');
let askResolve = null;

function closeAsk(result) {
  askModal.hidden = true;
  const r = askResolve;
  askResolve = null;
  if (r) r(result);
}

function askDialog({ title, fields, okLabel = 'OK' }) {
  return new Promise((resolve) => {
    if (askResolve) closeAsk(null); // a second dialog cancels the first
    askResolve = resolve;
    $('ask-title').textContent = title;
    $('ask-ok').textContent = okLabel;
    const wrap = $('ask-fields');
    wrap.innerHTML = '';
    for (const f of fields) {
      const row = document.createElement('label');
      row.className = 'ask-row';
      const span = document.createElement('span');
      span.textContent = f.label;
      row.appendChild(span);
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        input.className = 'tune-select';
        for (const o of f.options || []) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          input.appendChild(opt);
        }
        if (f.value != null) input.value = f.value;
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'ins-name';
        input.spellcheck = false;
        if (f.value != null) input.value = f.value;
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      input.dataset.key = f.key;
      row.appendChild(input);
      wrap.appendChild(row);
    }
    askModal.hidden = false;
    const first = wrap.querySelector('input, select');
    if (first) { first.focus(); if (first.select) first.select(); }
  });
}

function askSubmit() {
  const out = {};
  for (const el of $('ask-fields').querySelectorAll('[data-key]')) out[el.dataset.key] = el.value;
  closeAsk(out);
}

$('ask-ok').addEventListener('click', askSubmit);
$('ask-cancel').addEventListener('click', () => closeAsk(null));
askModal.addEventListener('click', (e) => { if (e.target === askModal) closeAsk(null); });
askModal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); askSubmit(); }
  if (e.key === 'Escape') { e.stopPropagation(); closeAsk(null); }
});

// ---------- drag & drop images ----------

const wrap = $('viewport-wrap');
let dragDepth = 0;
wrap.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop-cue').hidden = false; });
wrap.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-cue').hidden = true; } });
wrap.addEventListener('dragover', (e) => e.preventDefault());
wrap.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-cue').hidden = true;
  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) await addImageLayerFromFile(file);
  }
});

// ---------- layers ----------

async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function addImageLayerFromFile(file, asPattern = false) {
  try {
    const src = await fileToDataURL(file);
    const img = await loadImage(src);
    const name = file.name.replace(/\.[^.]+$/, '');
    const layer = asPattern ? createPatternLayer(img, src, name) : createImageLayer(img, src, name);
    doc.layers.push(layer);
    selectLayer(layer.id);
    rebuildLayerList();
    markDirty();
    status(asPattern ? `Added tiling pattern "${layer.name}"` : `Added layer "${layer.name}"`, 'ok');
  } catch {
    status('Could not load that image.', 'err');
  }
}

let patternHintShown = false;

function selectLayer(id) {
  selectedId = id;
  selectedIds.clear();
  if (id && id !== 'base') selectedIds.add(id);
  rebuildLayerList();
  syncInspector();
  requestRender();
  // patterns confuse first-timers: corners crop coverage, they don't scale
  if (!patternHintShown) {
    const sel = selectedLayer();
    if (sel && sel.type === 'pattern') {
      patternHintShown = true;
      status('Pattern layer: corner handles resize the COVERAGE region (what area it tiles). To resize the texture itself, Ctrl+drag a corner or use the Scale field.');
    }
  }
}

// Ctrl+click in the layer list adds/removes from the selection
function toggleSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    if (selectedId === id) selectedId = [...selectedIds].pop() || null;
  } else {
    selectedIds.add(id);
    selectedId = id;
  }
  rebuildLayerList();
  syncInspector();
  requestRender();
}

function selectedLayers() {
  return doc.layers.filter(l => selectedIds.has(l.id));
}

function rebuildLayerList() {
  const list = $('layer-list');
  list.innerHTML = '';
  if (doc.layers.length === 0) {
    const li = document.createElement('li');
    li.className = 'layer-list-empty';
    li.textContent = 'No layers yet — add an image or drop one on the canvas.';
    list.appendChild(li);
  }
  // top layer first in the panel
  [...doc.layers].reverse().forEach((layer) => {
    const li = document.createElement('li');
    li.className = 'layer-item'
      + (layer.id === selectedId || selectedIds.has(layer.id) ? ' selected' : '')
      + (layer.visible ? '' : ' hidden-layer');
    li.setAttribute('role', 'option');

    let thumb;
    if (layer.type === 'fill') {
      // tiny canvas so the thumb shows the actual shape + gradient
      thumb = document.createElement('canvas');
      thumb.className = 'thumb';
      thumb.width = thumb.height = 30;
      const tctx = thumb.getContext('2d');
      tctx.fillStyle = fillPaintStyle(tctx, layer, 2, 2, 26, 26);
      tctx.fill(fillShapePath(layer.shape, 2, 2, 26, 26));
    } else {
      thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.src = layer.src;
      thumb.alt = '';
    }

    const name = document.createElement('span');
    name.className = 'lname';
    name.textContent = layer.name;

    const mat = document.createElement('span');
    mat.className = 'lmat';
    mat.textContent = layer.material;

    const dup = document.createElement('button');
    dup.className = 'vis';
    dup.title = 'Duplicate layer (Ctrl+D)';
    dup.textContent = '⧉';
    dup.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateLayer(layer);
    });

    const del = document.createElement('button');
    del.className = 'vis';
    del.title = 'Delete layer (or select it and press Delete)';
    del.textContent = '🗑';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      doc.layers = doc.layers.filter(x => x !== layer);
      selectedIds.delete(layer.id);
      if (selectedId === layer.id) selectedId = [...selectedIds].pop() || null;
      rebuildLayerList();
      syncInspector();
      markDirty();
      status(`Layer "${layer.name}" deleted — Ctrl+Z brings it back.`);
    });

    const lock = document.createElement('button');
    lock.className = 'vis' + (layer.locked ? ' locked' : '');
    lock.title = layer.locked ? 'Unlock layer (canvas clicks pass through it)' : 'Lock layer — clicks on the canvas pass through to layers beneath';
    lock.textContent = layer.locked ? '🔒' : '🔓';
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      rebuildLayerList();
      requestRender();
      scheduleAutosave();
    });

    const vis = document.createElement('button');
    vis.className = 'vis';
    vis.title = layer.visible ? 'Hide layer' : 'Show layer';
    vis.textContent = layer.visible ? '👁' : '–';
    vis.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      rebuildLayerList();
      markDirty();
    });

    const order = document.createElement('span');
    order.className = 'order-btns';
    const up = document.createElement('button');
    up.textContent = '▲'; up.title = 'Bring forward';
    up.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, +1); });
    const down = document.createElement('button');
    down.textContent = '▼'; down.title = 'Send backward';
    down.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });
    order.append(up, down);

    li.append(thumb, name, mat, dup, lock, vis, del, order);
    li.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) toggleSelect(layer.id);
      else selectLayer(layer.id);
    });
    list.appendChild(li);
  });

  $('basecoat-row').classList.toggle('selected', selectedId === 'base');
  $('basecoat-material-chip').textContent = doc.baseMaterial;
}

function moveLayer(layer, dir) {
  const i = doc.layers.indexOf(layer);
  const j = i + dir;
  if (j < 0 || j >= doc.layers.length) return;
  [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
  rebuildLayerList();
  markDirty();
}

function deleteSelected() {
  const targets = selectedLayers();
  if (!targets.length) return;
  doc.layers = doc.layers.filter(l => !selectedIds.has(l.id));
  selectLayer(null);
  markDirty();
  status(targets.length > 1 ? `${targets.length} layers deleted.` : 'Layer deleted.');
}

function duplicateLayer(layer) {
  const copy = {
    ...layer,
    id: 'L' + Math.random().toString(36).slice(2),
    name: layer.name + ' copy',
    locked: false, // a fresh copy is for editing
    matParams: layer.matParams ? { ...layer.matParams } : null,
    lumSpec: layer.lumSpec ? { ...layer.lumSpec } : null,
  };
  if (isRegionLayer(layer)) { copy.rx = layer.rx + 40; copy.ry = layer.ry + 40; }
  else { copy.x = layer.x + 40; copy.y = layer.y + 40; }
  doc.layers.push(copy);
  selectLayer(copy.id);
  markDirty();
}

function duplicateSelected() {
  const targets = selectedLayers();
  if (!targets.length) return;
  if (targets.length === 1) { duplicateLayer(targets[0]); return; }
  // duplicate the whole selection and select the copies
  const copies = targets.map(l => {
    duplicateLayer(l);
    return doc.layers[doc.layers.length - 1].id;
  });
  selectedIds.clear();
  copies.forEach(id => selectedIds.add(id));
  selectedId = copies[copies.length - 1];
  rebuildLayerList();
  syncInspector();
  markDirty();
}

// ---------- inspector ----------

function syncInspector() {
  const sel = selectedLayer();
  const isBase = selectedId === 'base';
  $('inspector-empty').hidden = !!sel || isBase;
  $('inspector-layer').hidden = !sel;
  $('inspector-basecoat').hidden = !isBase;
  $('inspector-material').hidden = !sel && !isBase;

  if (sel) {
    if (document.activeElement !== $('ins-name')) $('ins-name').value = sel.name;
    $('ins-opacity').value = Math.round(sel.opacity * 100);
    $('ins-opacity-val').textContent = Math.round(sel.opacity * 100) + '%';
    $('ins-spec-only').checked = !!sel.specOnly;
    $('ins-paint-only').checked = !!sel.paintOnly;
    $('ins-blend').value = BLEND_MODES[sel.blend] ? sel.blend : 'normal';
    // fill layers: color/shape/gradient pickers instead of image transforms
    $('ins-fill-row').hidden = sel.type !== 'fill';
    $('ins-fill-shape-row').hidden = sel.type !== 'fill';
    $('ins-fill-type-row').hidden = sel.type !== 'fill';
    document.querySelector('.xform-grid').hidden = sel.type === 'fill';
    $('ins-flip-h').hidden = $('ins-flip-v').hidden = sel.type === 'fill';
    if (sel.type === 'fill') {
      const ft = sel.fillType || 'solid';
      $('ins-fill-color').value = sel.color;
      $('ins-fill-color2').hidden = ft === 'solid';
      $('ins-fill-color2').value = sel.color2 || '#101114';
      $('ins-fill-shape').value = sel.shape || 'rect';
      $('ins-fill-type').value = ft;
      $('ins-fill-angle').hidden = ft !== 'linear';
      if (document.activeElement !== $('ins-fill-angle')) $('ins-fill-angle').value = sel.gradAngle ?? 0;
      // three-stop gradient controls
      $('ins-fill-mid-row').hidden = ft === 'solid';
      $('ins-fill-mid').checked = !!sel.colorMid;
      $('ins-fill-colormid').hidden = !sel.colorMid;
      $('ins-fill-midpos').hidden = !sel.colorMid;
      if (sel.colorMid) {
        $('ins-fill-colormid').value = sel.colorMid;
        $('ins-fill-midpos').value = Math.round((sel.midPos ?? 0.5) * 100);
      }
    } else {
      $('ins-fill-mid-row').hidden = true;
    }
    $('ins-text-section').hidden = sel.type !== 'text';
    if (sel.type === 'text') {
      if (document.activeElement !== $('ins-text')) $('ins-text').value = sel.text;
      $('ins-text-font').value = sel.font;
      if (document.activeElement !== $('ins-text-size')) $('ins-text-size').value = sel.fontSize;
      if (document.activeElement !== $('ins-text-spacing')) $('ins-text-spacing').value = sel.letterSpacing;
      if (document.activeElement !== $('ins-text-outline-w')) $('ins-text-outline-w').value = sel.outlineWidth;
      $('ins-text-color').value = sel.textColor;
      $('ins-text-outline-color').value = sel.outlineColor;
      $('ins-text-italic').checked = sel.italic;
      $('ins-text-curve').value = sel.curve || 0;
      $('ins-text-curve-val').textContent = (sel.curve || 0) + '°';
    }
    // effects: raster layers only (image + text)
    $('ins-split-row').hidden = sel.type !== 'image' && sel.type !== 'pattern';
    const hasFxUI = sel.type === 'image' || sel.type === 'text';
    $('ins-fx-section').hidden = !hasFxUI;
    if (hasFxUI) {
      const fx = sel.fx || {};
      $('ins-fx-stroke').value = fx.strokeW || 0;
      $('ins-fx-stroke-color').value = fx.strokeColor || '#000000';
      $('ins-fx-shadow').value = fx.shadow || 0;
      $('ins-fx-shadow-color').value = fx.shadowColor || '#000000';
      $('ins-fx-shadow-off').hidden = !(fx.shadow > 0);
      if (document.activeElement !== $('ins-fx-sdx')) $('ins-fx-sdx').value = fx.shadowDX ?? 8;
      if (document.activeElement !== $('ins-fx-sdy')) $('ins-fx-sdy').value = fx.shadowDY ?? 8;
      $('ins-fx-glow').value = fx.glow || 0;
      $('ins-fx-glow-color').value = fx.glowColor || '#ffffff';
    }
    for (const [id, prop] of [['ins-x', 'x'], ['ins-y', 'y'], ['ins-scale', 'scale'], ['ins-scy', 'scaleY'], ['ins-rot', 'rotation'], ['ins-skx', 'skewX'], ['ins-sky', 'skewY']]) {
      const el = $(id);
      if (document.activeElement !== el) {
        el.value = prop === 'scale' ? sel[prop].toFixed(3)
          : prop === 'scaleY' ? (sel.scaleY ?? sel.scale).toFixed(3)
          : Math.round((sel[prop] || 0) * 10) / 10;
      }
    }
    // skew/stretch only make sense for image-like layers (patterns/fills are regions)
    $('ins-skx-wrap').hidden = $('ins-sky-wrap').hidden = $('ins-scy-wrap').hidden =
      sel.type !== 'image' && sel.type !== 'text';
    $('ins-mirror').disabled = !doc.regionMap;
  }
  if (isBase) syncBaseColorFields();
  syncMaterialGrid();
}

// keep swatch, hex field, and RGB fields in agreement (skip whichever the
// user is currently typing in)
function syncBaseColorFields() {
  const hex = doc.baseColor;
  $('ins-base-color').value = hex;
  $('basecoat-color').value = hex;
  if (document.activeElement !== $('ins-base-hex')) {
    $('ins-base-hex').value = hex.toUpperCase();
    $('ins-base-hex').classList.remove('invalid');
  }
  const rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  ['ins-base-r', 'ins-base-g', 'ins-base-b'].forEach((id, i) => {
    if (document.activeElement !== $(id)) $(id).value = rgb[i];
  });
}

function setBaseColor(hex) {
  doc.baseColor = hex.toLowerCase();
  syncBaseColorFields();
  syncMaterialGrid();
  markDirty();
}

// the layer or base coat whose material is being edited
function matTarget() {
  if (selectedId === 'base') {
    return {
      get material() { return doc.baseMaterial; },
      set material(v) { doc.baseMaterial = v; },
      get matParams() { return doc.baseMatParams; },
      set matParams(v) { doc.baseMatParams = v; },
    };
  }
  return selectedLayer();
}

function syncMaterialGrid() {
  const target = matTarget();
  const current = target?.material;
  // shade every ball with the color the material would actually be applied to
  const albedo = selectedId === 'base' ? doc.baseColor : layerAlbedo(selectedLayer(), doc.baseColor);
  const activeParams = target ? resolveParams(current, target.matParams) : null;
  // the active ball previews the tint wash on its albedo, like the paint will
  const activeAlbedo = (activeParams?.tintAmt && activeParams.tint)
    ? mixHex(albedo, activeParams.tint, activeParams.tintAmt / 100)
    : albedo;
  document.querySelectorAll('.material-swatch').forEach(btn => {
    const isActive = btn.dataset.material === current;
    btn.classList.toggle('active', isActive);
    renderBall(btn.querySelector('.ball'), btn.dataset.material, isActive ? activeAlbedo : albedo, isActive ? activeParams : null);
  });
  syncMaterialTune();
}

const TUNE_KEYS = ['met', 'rough', 'clear', 'density', 'scale', 'contrast'];

function syncMaterialTune() {
  const target = matTarget();
  if (!target) return;
  const p = resolveParams(target.material, target.matParams);
  for (const key of TUNE_KEYS) {
    const row = $(`tune-${key}`).closest('.slider-row');
    const applies = p[key] !== undefined;
    row.hidden = !applies;
    if (!applies) continue;
    if (document.activeElement !== $(`tune-${key}-n`)) $(`tune-${key}-n`).value = p[key];
    $(`tune-${key}`).value = p[key];
  }
  $('tune-tint').value = p.tint || '#ffffff';
  $('tune-tintamt').value = p.tintAmt || 0;
  if (document.activeElement !== $('tune-tintamt-n')) $('tune-tintamt-n').value = p.tintAmt || 0;
  // stacking applies to layers only — the base coat has nothing beneath it
  $('tune-stack-row').hidden = selectedId === 'base';
  const sel = selectedLayer();
  if (sel) $('tune-stack').value = sel.specBlend || 'replace';
  // weathering reads the layer's paint — a flat base coat has no lights/darks
  $('tune-lum-row').hidden = selectedId === 'base';
  if (sel) {
    const amt = sel.lumSpec?.amt || 0;
    $('tune-lumamt').value = amt;
    if (document.activeElement !== $('tune-lumamt-n')) $('tune-lumamt-n').value = amt;
    $('tune-luminv').classList.toggle('active', !!sel.lumSpec?.invert);
  }
}

function setLumSpec(raw) {
  const sel = selectedLayer();
  if (!sel) return;
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return;
  const amt = Math.max(0, Math.min(100, v));
  sel.lumSpec = amt > 0 ? { amt, invert: !!sel.lumSpec?.invert } : null;
  markDirty();
}

function setTuneParam(key, raw, min, max) {
  const target = matTarget();
  if (!target) return;
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return;
  const p = resolveParams(target.material, target.matParams);
  p[key] = Math.max(min, Math.min(max, v));
  target.matParams = p;
  syncMaterialGrid();
  markDirty();
}

for (const key of TUNE_KEYS) {
  const range = $(`tune-${key}`);
  const num = $(`tune-${key}-n`);
  const min = parseInt(range.min, 10), max = parseInt(range.max, 10);
  range.addEventListener('input', () => setTuneParam(key, range.value, min, max));
  num.addEventListener('input', () => setTuneParam(key, num.value, min, max));
  num.addEventListener('blur', () => syncMaterialTune());
}

$('tune-tint').addEventListener('input', () => {
  const target = matTarget();
  if (!target) return;
  const p = resolveParams(target.material, target.matParams);
  p.tint = $('tune-tint').value;
  if (!p.tintAmt) { p.tintAmt = 35; } // picking a color implies wanting some of it
  target.matParams = p;
  syncMaterialGrid();
  markDirty();
});
$('tune-tintamt').addEventListener('input', () => setTuneParam('tintAmt', $('tune-tintamt').value, 0, 100));
$('tune-tintamt-n').addEventListener('input', () => setTuneParam('tintAmt', $('tune-tintamt-n').value, 0, 100));
$('tune-tintamt-n').addEventListener('blur', () => syncMaterialTune());

$('tune-lumamt').addEventListener('input', () => setLumSpec($('tune-lumamt').value));
$('tune-lumamt-n').addEventListener('input', () => setLumSpec($('tune-lumamt-n').value));
$('tune-lumamt-n').addEventListener('blur', () => syncMaterialTune());
$('tune-luminv').addEventListener('click', () => {
  const sel = selectedLayer();
  if (!sel || !sel.lumSpec) return; // invert is meaningless until Weather > 0
  sel.lumSpec = { ...sel.lumSpec, invert: !sel.lumSpec.invert };
  syncMaterialTune();
  markDirty();
});

$('tune-stack').addEventListener('change', () => {
  const sel = selectedLayer();
  if (!sel) return;
  sel.specBlend = $('tune-stack').value;
  markDirty();
});

$('tune-reset').addEventListener('click', () => {
  const target = matTarget();
  if (!target) return;
  target.matParams = null;
  const sel = selectedLayer();
  if (sel) { sel.specBlend = 'replace'; sel.lumSpec = null; }
  syncMaterialGrid();
  markDirty();
});

function buildMaterialGrid() {
  const grid = $('material-grid');
  for (const [key, mat] of Object.entries(MATERIALS)) {
    const btn = document.createElement('button');
    btn.className = 'material-swatch';
    btn.dataset.material = key;
    btn.innerHTML = `<canvas class="ball"></canvas><span class="mlabel">${mat.label}</span>`;
    btn.addEventListener('click', () => {
      const target = matTarget();
      if (!target) return;
      target.material = key;
      target.matParams = null; // switching material starts from its preset
      if (key === 'vanta') {
        // Vanta only reads as a void over pure black paint — any albedo
        // above #000 still catches diffuse light in the sim
        if (selectedId === 'base') {
          doc.baseColor = '#000000';
          $('basecoat-color').value = '#000000';
        } else {
          const sel = selectedLayer();
          if (sel && typeof sel.color === 'string') {
            sel.color = '#000000';
            if (sel.type === 'text') regenerateText(sel);
          }
        }
        syncInspector();
        status('Vanta applied — paint forced to black. Deepest black the sim can render.', 'ok');
      }
      rebuildLayerList();
      syncMaterialGrid();
      markDirty();
    });
    grid.appendChild(btn);
  }
}

// inspector inputs
$('ins-name').addEventListener('input', () => {
  const sel = selectedLayer(); if (!sel) return;
  sel.name = $('ins-name').value;
  rebuildLayerList();
  scheduleAutosave();
});
$('ins-opacity').addEventListener('input', () => {
  const sel = selectedLayer(); if (!sel) return;
  sel.opacity = $('ins-opacity').value / 100;
  $('ins-opacity-val').textContent = $('ins-opacity').value + '%';
  markDirty();
});
for (const [id, prop] of [['ins-x', 'x'], ['ins-y', 'y'], ['ins-scale', 'scale'], ['ins-scy', 'scaleY'], ['ins-rot', 'rotation'], ['ins-skx', 'skewX'], ['ins-sky', 'skewY']]) {
  $(id).addEventListener('input', () => {
    const sel = selectedLayer(); if (!sel) return;
    const v = parseFloat($(id).value);
    if (!Number.isFinite(v)) return;
    if (prop === 'scale') sel[prop] = Math.max(0.01, v);
    else if (prop === 'scaleY') {
      sel.scaleY = Math.max(0.01, v);
      // typing the X value back in relinks the axes (uniform again)
      if (Math.abs(sel.scaleY - sel.scale) < 0.0005) sel.scaleY = null;
    }
    else if (prop === 'skewX' || prop === 'skewY') sel[prop] = Math.max(-80, Math.min(80, v));
    else sel[prop] = v;
    markDirty();
  });
}
$('ins-spec-only').addEventListener('change', () => {
  const sel = selectedLayer(); if (!sel) return;
  sel.specOnly = $('ins-spec-only').checked;
  if (sel.specOnly && sel.paintOnly) { sel.paintOnly = false; $('ins-paint-only').checked = false; }
  markDirty();
});
$('ins-paint-only').addEventListener('change', () => {
  const sel = selectedLayer(); if (!sel) return;
  sel.paintOnly = $('ins-paint-only').checked;
  // the two flags are opposites — both at once would delete the layer
  if (sel.paintOnly && sel.specOnly) { sel.specOnly = false; $('ins-spec-only').checked = false; }
  markDirty();
  if (sel.paintOnly) status('Paint only — this layer now colors the livery without touching the finish beneath it.', 'ok');
});
$('ins-blend').addEventListener('change', () => {
  const sel = selectedLayer(); if (!sel) return;
  sel.blend = $('ins-blend').value;
  markDirty();
});
$('ins-flip-h').addEventListener('click', () => { const s = selectedLayer(); if (s) { s.flipH = !s.flipH; markDirty(); } });
$('ins-flip-v').addEventListener('click', () => { const s = selectedLayer(); if (s) { s.flipV = !s.flipV; markDirty(); } });

// duplicate the selected layer onto its region's mirror partner panel
$('ins-mirror').addEventListener('click', () => {
  const sel = selectedLayer();
  if (!sel || !doc.regionMap) return;
  const cx = isRegionLayer(sel) ? sel.rx + sel.rw / 2 : sel.x;
  const cy = isRegionLayer(sel) ? sel.ry + sel.rh / 2 : sel.y;
  const src = regionAt(doc.regionMap, cx, cy);
  if (!src) { status('Layer center is not inside a mapped region.', 'err'); return; }
  if (!src.mirror) { status(`"${src.name}" has no mirror partner in the map.`, 'err'); return; }
  const dst = regionById(doc.regionMap, src.mirror);
  if (!dst) { status(`Mirror partner "${src.mirror}" is missing from the map.`, 'err'); return; }
  const copy = {
    ...sel,
    id: 'L' + Math.random().toString(36).slice(2),
    name: sel.name + ' (mirrored)',
    locked: false,
    matParams: sel.matParams ? { ...sel.matParams } : null,
    flipH: !sel.flipH,
    // a true mirror image reflects the whole transform, not just the raster
    rotation: -(sel.rotation || 0),
    skewX: -(sel.skewX || 0),
    skewY: -(sel.skewY || 0),
  };
  if (isRegionLayer(sel)) {
    // mirror both corners of the region rect, then normalize
    const p1 = mirrorPoint(src, dst, sel.rx, sel.ry);
    const p2 = mirrorPoint(src, dst, sel.rx + sel.rw, sel.ry + sel.rh);
    copy.rx = Math.round(Math.min(p1.x, p2.x));
    copy.ry = Math.round(Math.min(p1.y, p2.y));
    copy.rw = Math.max(1, Math.round(Math.abs(p2.x - p1.x)));
    copy.rh = Math.max(1, Math.round(Math.abs(p2.y - p1.y)));
  } else {
    const placed = mirrorLayerPlacement(doc.regionMap, sel);
    copy.x = placed.x;
    copy.y = placed.y;
  }
  doc.layers.push(copy);
  selectLayer(copy.id);
  markDirty();
  status(`Mirrored "${sel.name}" onto ${dst.name}.`, 'ok');
});
$('ins-delete').addEventListener('click', deleteSelected);
$('ins-duplicate').addEventListener('click', duplicateSelected);

$('ins-base-color').addEventListener('input', () => setBaseColor($('ins-base-color').value));

$('ins-base-hex').addEventListener('input', () => {
  const raw = $('ins-base-hex').value.trim().replace(/^#?/, '#');
  const valid = /^#[0-9a-fA-F]{6}$/.test(raw);
  $('ins-base-hex').classList.toggle('invalid', !valid);
  if (valid) setBaseColor(raw);
});
$('ins-base-hex').addEventListener('blur', () => syncBaseColorFields());
$('ins-base-hex').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('ins-base-hex').blur();
});

for (const [id, idx] of [['ins-base-r', 0], ['ins-base-g', 1], ['ins-base-b', 2]]) {
  $(id).addEventListener('input', () => {
    const v = parseInt($(id).value, 10);
    if (!Number.isFinite(v)) return;
    const c = Math.max(0, Math.min(255, v));
    const rgb = [
      parseInt(doc.baseColor.slice(1, 3), 16),
      parseInt(doc.baseColor.slice(3, 5), 16),
      parseInt(doc.baseColor.slice(5, 7), 16),
    ];
    rgb[idx] = c;
    setBaseColor('#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''));
  });
  $(id).addEventListener('blur', () => syncBaseColorFields());
}

// base coat row
$('basecoat-row').addEventListener('click', () => selectLayer('base'));
$('basecoat-color').addEventListener('click', (e) => e.stopPropagation());
$('basecoat-color').addEventListener('input', () => setBaseColor($('basecoat-color').value));

// ---------- template ----------

$('btn-load-template').addEventListener('click', () => $('file-template').click());
$('file-template').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    let src;
    if (/\.psd$/i.test(file.name)) {
      status('Reading PSD — extracting wireframe…');
      const { src: psdSrc, usedWireframe } = await psdToTemplate(await file.arrayBuffer());
      src = psdSrc;
      status(usedWireframe
        ? 'Wireframe extracted from PSD.'
        : 'PSD loaded (no wireframe layers found — using flattened composite).', 'ok');
    } else {
      src = await fileToDataURL(file);
      status('Template loaded — shown as a multiply overlay.', 'ok');
    }
    doc.template = { img: await loadImage(src), src };
    $('btn-clear-template').hidden = false;
    $('template-opacity-row').hidden = false;
    $('template-style-row').hidden = false;
    syncTemplateStyle();
    markDirty();
  } catch (err) {
    status('Could not load template: ' + (err.message || 'unknown error'), 'err');
  }
});
$('btn-clear-template').addEventListener('click', () => {
  doc.template = null;
  $('btn-clear-template').hidden = true;
  $('template-opacity-row').hidden = true;
  $('template-style-row').hidden = true;
  markDirty();
});

function syncTemplateStyle() {
  document.querySelectorAll('.tpl-color').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tcolor === doc.templateColor);
  });
  $('template-bold').checked = doc.templateBold;
}
document.querySelectorAll('.tpl-color').forEach(btn => {
  btn.addEventListener('click', () => {
    doc.templateColor = btn.dataset.tcolor;
    syncTemplateStyle();
    markDirty();
  });
});
$('template-bold').addEventListener('change', () => {
  doc.templateBold = $('template-bold').checked;
  markDirty();
});
$('template-opacity').addEventListener('input', () => {
  doc.templateOpacity = $('template-opacity').value / 100;
  $('template-opacity-val').textContent = $('template-opacity').value + '%';
  markDirty();
});

// ---------- region map ----------

function syncRegionUI() {
  const map = doc.regionMap;
  $('btn-clear-regions').hidden = !map;
  $('region-map-info').hidden = !map;
  if (map) {
    $('region-map-name').textContent = `${map.car} — ${map.regions.length} region${map.regions.length === 1 ? '' : 's'}`;
  }
  $('btn-regions-view').disabled = !map;
  if (!map && regionsView) setRegionsView(false);
  syncInspector(); // Mirror button availability
}

// shared by the file loader and the community "Get map…" flow — validates,
// applies to the doc, and syncs everything that watches the region map
function applyRegionMap(data) {
  doc.regionMap = parseRegionMap(data);
  syncRegionUI();
  scheduleAutosave();
  requestRender();
  return doc.regionMap;
}

$('btn-load-regions').addEventListener('click', () => $('file-regions').click());
$('file-regions').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const map = applyRegionMap(JSON.parse(await file.text()));
    status(`Region map loaded: ${map.car} (${map.regions.length} regions) — hover the sheet for panel names.`, 'ok');
  } catch (err) {
    status('Could not load region map: ' + (err.message || 'invalid JSON'), 'err');
  }
});

// ---------- community region maps (maps/ on GitHub) ----------

const MAPS_RAW_BASE = 'https://raw.githubusercontent.com/OblivionsPeak/clearcoat/main/maps/';
const MAPS_FOLDER_URL = 'https://github.com/OblivionsPeak/clearcoat/tree/main/maps';
const mapsModal = $('maps-modal');

async function fetchMapsJson(file) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(MAPS_RAW_BASE + file, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapsListMessage(text, withLink) {
  const list = $('maps-list');
  list.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'project-list-empty';
  li.textContent = text;
  if (withLink) {
    li.append(' ');
    const a = document.createElement('a');
    a.href = MAPS_FOLDER_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'maps folder ↗';
    li.appendChild(a);
  }
  list.appendChild(li);
}

async function openMapsModal() {
  mapsModal.hidden = false;
  mapsListMessage('Fetching map list…');
  let index;
  try {
    index = await fetchMapsJson('index.json');
    if (!Array.isArray(index)) throw new Error('bad index');
  } catch {
    mapsListMessage('Could not reach GitHub for the map list — you may be offline. Try again later, or load a map from a file instead.');
    return;
  }
  if (mapsModal.hidden) return; // closed while fetching
  if (!index.length) {
    mapsListMessage('No community maps yet — use Annotate to map your car and contribute yours!', true);
    return;
  }
  const list = $('maps-list');
  list.innerHTML = '';
  for (const entry of index) {
    if (!entry || typeof entry.file !== 'string') continue;
    const label = typeof entry.label === 'string' && entry.label ? entry.label : entry.file;
    const li = document.createElement('li');
    li.className = 'project-item';

    const info = document.createElement('div');
    info.className = 'project-info';
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = label;
    const car = document.createElement('span');
    car.className = 'ptime mono';
    car.textContent = typeof entry.car === 'string' ? entry.car : '';
    info.append(name, car);

    const load = document.createElement('button');
    load.className = 'sm-btn';
    load.textContent = 'Load';
    load.addEventListener('click', async () => {
      load.disabled = true;
      load.textContent = 'Loading…';
      try {
        applyRegionMap(await fetchMapsJson(entry.file));
        closeMapsModal();
        status(`Loaded region map for ${label}`, 'ok');
      } catch (err) {
        load.disabled = false;
        load.textContent = 'Load';
        status(`Could not load the map for ${label}: ` + (err.name === 'AbortError' ? 'timed out — you may be offline' : err.message || 'fetch failed'), 'err');
      }
    });

    li.append(info, load);
    list.appendChild(li);
  }
}

function closeMapsModal() { mapsModal.hidden = true; }

$('btn-get-map').addEventListener('click', openMapsModal);
$('maps-close').addEventListener('click', closeMapsModal);
mapsModal.addEventListener('click', (e) => {
  if (e.target === mapsModal) closeMapsModal(); // backdrop click
});

$('btn-clear-regions').addEventListener('click', () => {
  doc.regionMap = null;
  syncRegionUI();
  scheduleAutosave();
  requestRender();
  status('Region map removed.');
});

$('btn-export-regions').addEventListener('click', () => {
  if (!doc.regionMap) return;
  const blob = new Blob([JSON.stringify(doc.regionMap, null, 2)], { type: 'application/json' });
  const name = doc.regionMap.car.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'car';
  downloadBlob(blob, name + '.regions.json');
  status('Region map exported.', 'ok');
});

function setRegionsView(on) {
  regionsView = on;
  $('btn-regions-view').classList.toggle('active', on);
  requestRender();
}
$('btn-regions-view').addEventListener('click', () => setRegionsView(!regionsView));

function setAnnotateMode(on) {
  annotateMode = on;
  if (on && wandMode) setWandMode(false); // the two modes never coexist
  $('btn-annotate').classList.toggle('active', on);
  viewport.classList.toggle('wand', on || wandMode);
  if (on) {
    setRegionsView(true);
    status('Annotate: drag a rectangle over a panel, then name it. Esc to exit.');
  } else {
    if (!doc.regionMap && regionsView) setRegionsView(false); // nothing to overlay
    requestRender();
  }
}
$('btn-annotate').addEventListener('click', () => setAnnotateMode(!annotateMode));

// drag released in annotate mode → one small form (name + mirror partner,
// plus car name for a brand-new map) and the region joins the doc's map
async function finishAnnotate(d) {
  const cl = (v) => Math.max(0, Math.min(SIZE, v));
  const x1 = cl(Math.min(d.startP.x, d.curP.x)), y1 = cl(Math.min(d.startP.y, d.curP.y));
  const x2 = cl(Math.max(d.startP.x, d.curP.x)), y2 = cl(Math.max(d.startP.y, d.curP.y));
  const w = Math.round(x2 - x1), h = Math.round(y2 - y1);
  if (w < 24 || h < 24) { requestRender(); status('Region too small — drag a rectangle at least 24px on each side.', 'err'); return; }
  const fields = [];
  if (!doc.regionMap) {
    fields.push({ key: 'car', label: 'Car name', placeholder: 'e.g. Mazda MX-5 Cup' });
  }
  fields.push({ key: 'name', label: 'Region name', placeholder: 'e.g. Hood, Left Door' });
  fields.push({
    key: 'mirror', label: 'Mirrors', type: 'select',
    options: [
      { value: '', label: '(no mirror partner)' },
      ...(doc.regionMap ? doc.regionMap.regions.map(r => ({ value: r.id, label: r.name })) : []),
    ],
  });
  const ans = await askDialog({ title: 'New region', fields, okLabel: 'Add region' });
  if (!ans || !ans.name || !ans.name.trim()) { requestRender(); return; }
  if (!doc.regionMap) {
    if (!ans.car || !ans.car.trim()) { requestRender(); status('A car name is needed to start a region map.', 'err'); return; }
    doc.regionMap = createRegionMap(ans.car.trim());
  }
  const map = doc.regionMap;
  const region = { id: uniqueRegionId(ans.name.trim(), map), name: ans.name.trim(), x: Math.round(x1), y: Math.round(y1), w, h };
  let mirrorNote = '';
  if (ans.mirror) {
    const other = regionById(map, ans.mirror);
    if (other) { region.mirror = other.id; other.mirror = region.id; mirrorNote = ` ⇄ ${other.id}`; }
  }
  map.regions.push(region);
  syncRegionUI();
  scheduleAutosave();
  requestRender();
  status(`Region "${region.name}" added as ${region.id}${mirrorNote}.`, 'ok');
}

// ---------- add image ----------

$('btn-add-image').addEventListener('click', () => $('file-image').click());
$('file-image').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await addImageLayerFromFile(file);
});
$('btn-add-fill').addEventListener('click', () => {
  const layer = createFillLayer();
  doc.layers.push(layer);
  selectLayer(layer.id);
  markDirty();
  status('Fill added — drag its corners to size it, then pick a material.', 'ok');
});

$('ins-fill-color').addEventListener('input', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill') return;
  sel.color = $('ins-fill-color').value;
  rebuildLayerList();
  syncMaterialGrid(); // shader balls re-shade with the new albedo
  markDirty();
});

$('ins-fill-color2').addEventListener('input', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill') return;
  sel.color2 = $('ins-fill-color2').value;
  rebuildLayerList();
  markDirty();
});

$('ins-fill-shape').addEventListener('change', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill') return;
  sel.shape = $('ins-fill-shape').value;
  rebuildLayerList();
  markDirty();
});

$('ins-fill-type').addEventListener('change', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill') return;
  sel.fillType = $('ins-fill-type').value;
  syncInspector(); // show/hide color2 + angle for the new type
  rebuildLayerList();
  markDirty();
});

$('ins-fill-angle').addEventListener('input', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill') return;
  const v = parseInt($('ins-fill-angle').value, 10);
  if (!Number.isFinite(v)) return;
  sel.gradAngle = Math.max(0, Math.min(360, v));
  rebuildLayerList();
  markDirty();
});
$('ins-fill-angle').addEventListener('blur', () => syncInspector());

// three-stop gradient controls
$('ins-fill-mid').addEventListener('change', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill') return;
  sel.colorMid = $('ins-fill-mid').checked ? $('ins-fill-colormid').value : null;
  if (sel.midPos == null) sel.midPos = 0.5;
  syncInspector();
  rebuildLayerList();
  markDirty();
});
$('ins-fill-colormid').addEventListener('input', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill' || !sel.colorMid) return;
  sel.colorMid = $('ins-fill-colormid').value;
  rebuildLayerList();
  markDirty();
});
$('ins-fill-midpos').addEventListener('input', () => {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'fill' || !sel.colorMid) return;
  sel.midPos = parseInt($('ins-fill-midpos').value, 10) / 100;
  rebuildLayerList();
  markDirty();
});

// ---------- layer effects ----------

// merge a patch into the layer's fx (creating it with defaults on first use);
// an all-zero fx collapses back to null so untouched layers stay lean
function setFx(patch) {
  const sel = selectedLayer();
  if (!sel || (sel.type !== 'image' && sel.type !== 'text')) return;
  sel.fx = {
    strokeW: 0, strokeColor: '#000000',
    shadow: 0, shadowDX: 8, shadowDY: 8, shadowColor: '#000000',
    glow: 0, glowColor: '#ffffff',
    ...(sel.fx || {}), ...patch,
  };
  if (!sel.fx.strokeW && !sel.fx.shadow && !sel.fx.glow) sel.fx = null;
  syncInspector();
  markDirty();
}
$('ins-fx-stroke').addEventListener('input', () => setFx({ strokeW: parseInt($('ins-fx-stroke').value, 10) || 0 }));
$('ins-fx-stroke-color').addEventListener('input', () => setFx({ strokeColor: $('ins-fx-stroke-color').value }));
$('ins-fx-shadow').addEventListener('input', () => setFx({ shadow: parseInt($('ins-fx-shadow').value, 10) || 0 }));
$('ins-fx-shadow-color').addEventListener('input', () => setFx({ shadowColor: $('ins-fx-shadow-color').value }));
$('ins-fx-glow').addEventListener('input', () => setFx({ glow: parseInt($('ins-fx-glow').value, 10) || 0 }));
$('ins-fx-glow-color').addEventListener('input', () => setFx({ glowColor: $('ins-fx-glow-color').value }));
for (const [id, key] of [['ins-fx-sdx', 'shadowDX'], ['ins-fx-sdy', 'shadowDY']]) {
  $(id).addEventListener('input', () => {
    const v = parseInt($(id).value, 10);
    if (Number.isFinite(v)) setFx({ [key]: Math.max(-60, Math.min(60, v)) });
  });
}

$('btn-add-text').addEventListener('click', () => {
  const layer = createTextLayer();
  doc.layers.push(layer);
  selectLayer(layer.id);
  markDirty();
  status('Text added — edit it in the inspector.', 'ok');
});

function setTextProp(prop, value) {
  const sel = selectedLayer();
  if (!sel || sel.type !== 'text') return;
  sel[prop] = value;
  regenerateText(sel);
  rebuildLayerList();
  syncMaterialGrid(); // shader balls re-shade with the new raster
  markDirty();
}

// ---------- fonts ----------

// Google fonts load on demand — one stylesheet injection per family, cached
const googleFontLoads = new Map();
function loadGoogleFont(family) {
  if (googleFontLoads.has(family)) return googleFontLoads.get(family);
  const p = (async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + family.replace(/ /g, '+') + '&display=swap';
    await new Promise((resolve, reject) => {
      link.onload = resolve;
      link.onerror = () => reject(new Error('stylesheet unreachable'));
      document.head.appendChild(link);
    });
    await document.fonts.load(`160px "${family}"`);
    if (!document.fonts.check(`160px "${family}"`)) throw new Error('font not available');
  })();
  googleFontLoads.set(family, p);
  p.catch(() => googleFontLoads.delete(family)); // failed (offline?) — allow a later retry
  return p;
}

// re-rasterize every text layer using a family once it becomes available
function regenerateFontUsers(family) {
  let touched = false;
  for (const l of doc.layers) {
    if (l.type === 'text' && l.font === family) { regenerateText(l); touched = true; }
  }
  if (touched) { rebuildLayerList(); syncMaterialGrid(); markDirty(); }
}

function requestGoogleFont(family) {
  loadGoogleFont(family)
    .then(() => regenerateFontUsers(family))
    .catch(() => status(`Couldn't load Google font "${family}" — using a fallback face.`, 'err'));
}

// non-blocking: kick off loads for any Google fonts the doc's text layers use
function ensureDocFonts() {
  const families = new Set(doc.layers.filter(l => l.type === 'text').map(l => l.font));
  for (const family of families) {
    if (GOOGLE_FONTS.includes(family)) requestGoogleFont(family);
  }
}

// the Custom optgroup mirrors doc.customFonts; System/Google options are static
function rebuildFontSelect() {
  const group = $('font-group-custom');
  group.innerHTML = '';
  for (const f of (doc.customFonts || [])) {
    const opt = document.createElement('option');
    opt.textContent = f.name;
    group.appendChild(opt);
  }
  const sel = selectedLayer();
  if (sel && sel.type === 'text') $('ins-text-font').value = sel.font;
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

$('btn-upload-font').addEventListener('click', () => $('file-font').click());
$('file-font').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { status('Font file too large — 4 MB max.', 'err'); return; }
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]+/g, ' ').trim() || 'custom font';
  try {
    const data = bufferToBase64(await file.arrayBuffer());
    await registerCustomFont(name, data);
    doc.customFonts = (doc.customFonts || []).filter(f => f.name !== name); // re-upload replaces
    doc.customFonts.push({ name, data });
    rebuildFontSelect();
    const sel = selectedLayer();
    if (sel && sel.type === 'text') setTextProp('font', name);
    else scheduleAutosave();
    status(`Font "${name}" added — saved with the project.`, 'ok');
  } catch {
    status('That file is not a usable font.', 'err');
  }
});

$('ins-text').addEventListener('input', () => setTextProp('text', $('ins-text').value));
$('ins-text-font').addEventListener('change', () => {
  const family = $('ins-text-font').value;
  setTextProp('font', family);
  if (GOOGLE_FONTS.includes(family)) requestGoogleFont(family);
});
$('ins-text-color').addEventListener('input', () => setTextProp('textColor', $('ins-text-color').value));
$('ins-text-outline-color').addEventListener('input', () => setTextProp('outlineColor', $('ins-text-outline-color').value));
$('ins-text-italic').addEventListener('change', () => setTextProp('italic', $('ins-text-italic').checked));
$('ins-text-curve').addEventListener('input', () => {
  const v = parseInt($('ins-text-curve').value, 10) || 0;
  $('ins-text-curve-val').textContent = v + '°';
  setTextProp('curve', Math.max(-180, Math.min(180, v)));
});
for (const [id, prop, min, max] of [
  ['ins-text-size', 'fontSize', 40, 400],
  ['ins-text-outline-w', 'outlineWidth', 0, 30],
  ['ins-text-spacing', 'letterSpacing', 0, 40],
]) {
  $(id).addEventListener('input', () => {
    const v = parseInt($(id).value, 10);
    if (!Number.isFinite(v)) return;
    setTextProp(prop, Math.max(min, Math.min(max, v)));
  });
  $(id).addEventListener('blur', () => syncInspector());
}

// ---------- graphics library ----------

const libraryModal = $('library-modal');

function buildLibraryGrid() {
  const grid = $('library-grid');
  for (const item of LIBRARY) {
    const btn = document.createElement('button');
    btn.className = 'library-item';
    btn.title = `Insert "${item.name}" as an image layer`;
    btn.innerHTML = item.svg + `<span class="library-name">${item.name}</span>`;
    btn.addEventListener('click', () => addLibraryItem(item));
    grid.appendChild(btn);
  }
}

function openLibrary() {
  if (!$('library-grid').childElementCount) buildLibraryGrid();
  libraryModal.hidden = false;
}

function closeLibrary() {
  libraryModal.hidden = true;
}

async function addLibraryItem(item) {
  closeLibrary();
  try {
    const src = await libraryItemToLayerSource(item);
    const img = await loadImage(src);
    const layer = createImageLayer(img, src, item.name);
    doc.layers.push(layer);
    selectLayer(layer.id);
    markDirty();
    status(`Added "${item.name}" — recolor it with the material Tint.`, 'ok');
  } catch {
    status('Could not add that graphic.', 'err');
  }
}

$('btn-add-library').addEventListener('click', openLibrary);
$('library-close').addEventListener('click', closeLibrary);
libraryModal.addEventListener('click', (e) => {
  if (e.target === libraryModal) closeLibrary(); // backdrop click
});

$('btn-add-pattern').addEventListener('click', () => $('file-pattern').click());
$('file-pattern').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await addImageLayerFromFile(file, true);
});

// ---------- SimTex Pro bridge ----------
// "+ SimTex" opens SimTex Pro in bridge mode; its "Send to Clearcoat" button
// posts { type: 'simtex-texture', name, dataUrl } back to this window. Only
// messages from the popup we opened are accepted.

const SIMTEX_URL = 'https://oblivionspeak.github.io/simtex-pro/?bridge=clearcoat';
let simtexWin = null;

$('btn-add-simtex').addEventListener('click', () => {
  simtexWin = window.open(SIMTEX_URL, 'simtex-bridge');
  if (!simtexWin) { status('Popup blocked — allow popups for Clearcoat to use the SimTex bridge.', 'err'); return; }
  status('SimTex Pro opened — design a texture, then hit "Send to Clearcoat".');
});

window.addEventListener('message', async (e) => {
  const d = e.data;
  if (!d || d.type !== 'simtex-texture' || typeof d.dataUrl !== 'string') return;
  if (!simtexWin || e.source !== simtexWin) return;      // not our popup
  if (!d.dataUrl.startsWith('data:image/')) return;
  try {
    const img = await loadImage(d.dataUrl);
    const layer = createPatternLayer(img, d.dataUrl, String(d.name || 'SimTex texture').slice(0, 80));
    doc.layers.push(layer);
    selectLayer(layer.id);
    markDirty();
    status(`SimTex texture "${layer.name}" added as a tiling pattern — drag its corners to place it.`, 'ok');
  } catch {
    status('Could not load the texture SimTex sent over.', 'err');
  }
});

// ---------- HUD ----------

$('btn-help').addEventListener('click', () => { $('help-modal').hidden = false; });
$('help-close').addEventListener('click', () => { $('help-modal').hidden = true; });
$('help-modal').addEventListener('click', (e) => { if (e.target === $('help-modal')) $('help-modal').hidden = true; });
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); $('help-modal').hidden = !$('help-modal').hidden; }
});

$('btn-fit').addEventListener('click', fitView);
$('btn-zoom-in').addEventListener('click', () => setZoom(view.zoom * 1.25, viewport.clientWidth / 2, viewport.clientHeight / 2));
$('btn-zoom-out').addEventListener('click', () => setZoom(view.zoom / 1.25, viewport.clientWidth / 2, viewport.clientHeight / 2));
$('btn-spec-view').addEventListener('click', () => {
  specView = !specView;
  if (specView && shineView) setShineView(false);
  $('btn-spec-view').classList.toggle('active', specView);
  $('spec-legend').hidden = !specView;
  requestRender();
});

function setShineView(on) {
  shineView = on;
  $('btn-shine-view').classList.toggle('active', on);
  if (on) {
    shineStart = performance.now();
    if (specView) {
      specView = false;
      $('btn-spec-view').classList.remove('active');
      $('spec-legend').hidden = true;
    }
    markDirty(); // force a texture re-upload for the first frame
    (function shineLoop() {
      if (!shineView) return;
      requestRender();
      requestAnimationFrame(shineLoop);
    })();
  } else {
    requestRender();
  }
}
$('btn-shine-view').addEventListener('click', () => setShineView(!shineView));

// ---------- studio (3D material proofing) ----------
// Docked panel, not a modal — editing stays live while the studio watches.
// Maps are re-rendered only when studioDirty (set in markDirty) so the rAF
// loop doesn't recomposite 2048² canvases every frame.

function setStudioView(on) {
  if (on && !studioSupported()) return;
  if (on) {
    const holder = $('studio-canvas-wrap');
    if (!holder.childElementCount) {
      const canvas = studioCanvas();
      if (!canvas) { status('Studio could not start — WebGL failed.', 'err'); return; }
      holder.appendChild(canvas);
    }
    studioDirty = true; // first frame always gets fresh maps
    const ok = openStudio(() => {
      if (!studioDirty) return { changed: false };
      studioDirty = false;
      return { paint: renderPaint(doc), spec: renderSpec(doc), changed: true };
    });
    if (!ok) { status('Studio could not start — WebGL failed.', 'err'); return; }
  } else {
    closeStudio();
  }
  studioView = on;
  $('btn-studio-view').classList.toggle('active', on);
  $('studio-panel').hidden = !on;
}
$('btn-studio-view').addEventListener('click', () => setStudioView(!studioView));
$('studio-close').addEventListener('click', () => setStudioView(false));

document.querySelectorAll('#studio-panel [data-shape]').forEach(btn => {
  btn.addEventListener('click', () => {
    studioSetShape(btn.dataset.shape);
    document.querySelectorAll('#studio-panel [data-shape]')
      .forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.querySelectorAll('#studio-panel [data-env]').forEach(btn => {
  btn.addEventListener('click', () => {
    studioSetEnv(btn.dataset.env);
    document.querySelectorAll('#studio-panel [data-env]')
      .forEach(b => b.classList.toggle('active', b === btn));
  });
});

// ---------- project save / open / new ----------

$('project-name').addEventListener('input', () => {
  doc.name = $('project-name').value;
  scheduleAutosave();
});

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function safeName() {
  return (doc.name || 'livery').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'livery';
}

$('btn-save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serializeDoc(doc))], { type: 'application/json' });
  downloadBlob(blob, safeName() + '.clearcoat.json');
  status('Project saved.', 'ok');
});

$('btn-open').addEventListener('click', () => $('file-project').click());
$('file-project').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    doc = await deserializeDoc(data);
    setCurrentProject(null); // an imported file must not write through to a browser project
    afterDocLoad();
    status(`Opened "${doc.name}".`, 'ok');
  } catch {
    status('That file is not a valid Clearcoat project.', 'err');
  }
});

$('btn-new').addEventListener('click', () => {
  if (doc.layers.length && !confirm('Start a new livery? Unsaved changes are kept only in autosave.')) return;
  doc = createDoc();
  setCurrentProject(null);
  afterDocLoad();
  status('New project.');
});

function afterDocLoad() {
  selectedId = null;
  selectedIds.clear();
  syncDocUI();
  fitView();
  markDirty();
  captureHistory();
}

// UI sync shared by project load and history restore (no view reset)
function syncDocUI() {
  $('project-name').value = doc.name;
  syncPaintTarget();
  $('btn-clear-template').hidden = !doc.template;
  $('template-opacity-row').hidden = !doc.template;
  $('template-style-row').hidden = !doc.template;
  $('template-opacity').value = Math.round(doc.templateOpacity * 100);
  $('template-opacity-val').textContent = Math.round(doc.templateOpacity * 100) + '%';
  syncTemplateStyle();
  $('basecoat-color').value = doc.baseColor;
  rebuildFontSelect();
  ensureDocFonts();
  if (doc.fontWarnings?.length) {
    const failed = doc.fontWarnings.join(', ');
    // deferred so it lands after the caller's own "Opened…" status
    setTimeout(() => status(`Custom font failed to load: ${failed} — using a fallback face.`, 'err'), 0);
  }
  rebuildLayerList();
  syncInspector();
  syncRegionUI();
}

// ---------- projects (browser library) ----------
// Named projects live in IndexedDB next to the autosave. The autosave key is
// still written on every save (crash recovery is unchanged); when a project
// is open, the same serialized doc also writes through to its project record.

const projectsModal = $('projects-modal');

function setCurrentProject(id, name) {
  currentProjectId = id;
  $('current-project-label').textContent = id ? name : 'unsaved';
  persist.saveSetting('currentProject', id).catch(() => {});
}

// 128px JPEG of the current paint for the project browser — built at most
// once per settled autosave, never on input events
function projectThumb() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderPaint(doc), 0, 0, 128, 128);
  return c.toDataURL('image/jpeg', 0.6);
}

function relTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
}

async function refreshProjectList() {
  const list = $('project-list');
  const projects = (await persist.listProjects().catch(() => []))
    .slice().sort((a, b) => b.updatedAt - a.updatedAt);
  list.innerHTML = '';
  if (!projects.length) {
    const li = document.createElement('li');
    li.className = 'project-list-empty';
    li.textContent = 'No projects yet — "Save as project" keeps the current livery in this browser.';
    list.appendChild(li);
    return;
  }
  for (const p of projects) {
    const li = document.createElement('li');
    li.className = 'project-item' + (p.id === currentProjectId ? ' current' : '');

    const thumb = document.createElement('img');
    thumb.className = 'project-thumb';
    thumb.alt = '';
    if (p.thumb) thumb.src = p.thumb;

    const info = document.createElement('div');
    info.className = 'project-info';
    const pname = document.createElement('span');
    pname.className = 'pname';
    pname.textContent = p.name;
    const ptime = document.createElement('span');
    ptime.className = 'ptime';
    ptime.textContent = relTime(p.updatedAt) + (p.id === currentProjectId ? ' · open' : '');
    info.append(pname, ptime);

    const open = document.createElement('button');
    open.className = 'sm-btn';
    open.textContent = 'Open';
    open.addEventListener('click', () => openProject(p));

    const ren = document.createElement('button');
    ren.className = 'sm-btn';
    ren.textContent = 'Rename';
    ren.addEventListener('click', async () => {
      const ans = await askDialog({
        title: 'Rename project',
        fields: [{ key: 'name', label: 'Project name', value: p.name }],
        okLabel: 'Rename',
      });
      const name = ans?.name;
      if (!name || !name.trim()) return;
      await persist.renameProject(p.id, name.trim()).catch(() => {});
      if (p.id === currentProjectId) {
        doc.name = name.trim();
        $('project-name').value = doc.name;
        setCurrentProject(p.id, doc.name);
        scheduleAutosave();
      }
      refreshProjectList();
    });

    const del = document.createElement('button');
    del.className = 'sm-btn danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
      await persist.deleteProject(p.id).catch(() => {});
      // the doc stays in the editor — it just stops writing through
      if (p.id === currentProjectId) setCurrentProject(null);
      refreshProjectList();
      status(`Deleted project "${p.name}".`);
    });

    li.append(thumb, info, open, ren, del);
    list.appendChild(li);
  }
}

async function openProject(p) {
  if (!currentProjectId && doc.layers.length
      && !confirm('Open this project? Your current unsaved livery is kept only in autosave, which now follows the opened project.')) return;
  flushAutosave(); // last settled edits of the outgoing doc land in its own project
  try {
    let data = await persist.loadProject(p.id);
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
    if (!data) {
      status('Project data is missing — removing it from the list.', 'err');
      await persist.deleteProject(p.id).catch(() => {});
      refreshProjectList();
      return;
    }
    doc = await deserializeDoc(data);
    setCurrentProject(p.id, p.name);
    resetHistory();
    afterDocLoad(); // syncDocUI + markDirty + baseline history snapshot
    closeProjects();
    status(`Opened "${p.name}".`, 'ok');
  } catch {
    status('Could not open that project.', 'err');
  }
}

function openProjects() { projectsModal.hidden = false; refreshProjectList(); }
function closeProjects() { projectsModal.hidden = true; }

$('btn-projects').addEventListener('click', openProjects);
$('projects-close').addEventListener('click', closeProjects);
projectsModal.addEventListener('click', (e) => {
  if (e.target === projectsModal) closeProjects(); // backdrop click
});

$('btn-save-as-project').addEventListener('click', async () => {
  const ans = await askDialog({
    title: 'Save as project',
    fields: [{ key: 'name', label: 'Project name', value: doc.name || 'untitled livery' }],
    okLabel: 'Save',
  });
  const name = ans?.name;
  if (!name || !name.trim()) return;
  doc.name = name.trim();
  $('project-name').value = doc.name;
  const id = Date.now().toString(36);
  try {
    await persist.saveProject(id, { name: doc.name, thumb: projectThumb() }, JSON.stringify(serializeDoc(doc)));
    setCurrentProject(id, doc.name);
    refreshProjectList();
    status(`Saved as project "${doc.name}" — it autosaves while open.`, 'ok');
  } catch (err) {
    status('Could not save project: ' + (err.message || 'storage error'), 'err');
  }
});

$('btn-new-project').addEventListener('click', () => {
  closeProjects();
  $('btn-new').click(); // shared new-doc flow (confirm + setCurrentProject(null))
});

// ---------- autosave ----------

// last write, so unchanged docs skip the IndexedDB roundtrip entirely
let lastSaved = { json: null, project: undefined };

async function runAutosave() {
  autosaveTimer = null;
  // serialize once: the JSON string is what gets persisted (loadAutosave /
  // loadProject parse it back); the object is handed to captureHistory,
  // which interns/mutates it — so stringify BEFORE capturing
  const data = serializeDoc(doc);
  const json = JSON.stringify(data);
  captureHistory(data);
  // snapshot the project binding synchronously — flushAutosave can run
  // right before a project switch swaps it out from under the awaits
  const projectId = currentProjectId;
  if (json === lastSaved.json && projectId === lastSaved.project) return;
  const meta = projectId ? { name: doc.name, thumb: projectThumb() } : null;
  try {
    await persist.saveAutosave(json);
    if (projectId) {
      await persist.saveProject(projectId, meta, json);
      // topbar rename lands in the index on save — keep the label current
      if (projectId === currentProjectId) $('current-project-label').textContent = meta.name;
    }
    lastSaved = { json, project: projectId };
    $('status-autosave').textContent = 'autosaved ' + new Date().toLocaleTimeString();
  } catch { /* quota or private mode — non-fatal */ }
}

function scheduleAutosave() {
  liveSyncTick();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(runAutosave, 1200);
}

// the tab can vanish mid-debounce — flush the pending save before it does
// (fire-and-forget; IndexedDB writes usually complete from these handlers)
function flushAutosave() {
  if (!autosaveTimer) return;
  clearTimeout(autosaveTimer);
  runAutosave();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutosave();
});
window.addEventListener('pagehide', flushAutosave);

// ---------- exports ----------

$('btn-export-png').addEventListener('click', () => {
  // helmets ship at 1024 — the PNG matches what the TGA would be
  exportPaintCanvas(renderPaint(doc)).toBlob((blob) => {
    downloadBlob(blob, safeName() + '.png');
    status('PNG saved to your Downloads folder.', 'ok');
  }, 'image/png');
});

// Make Trading Paints serve the Clearcoat design: download the PNG TP wants
// (plus the sim-generated spec .mip when it exists — TP can't create MIPs,
// only the sim can) and open the upload page.
$('btn-send-tp').addEventListener('click', async () => {
  // grab the spec MIP first if the folder is linked and the sim has made one
  let gotMip = false, staleMip = false;
  try {
    const custid = $('custid').value.trim();
    if (/^\d+$/.test(custid)) {
      const handle = await effectivePaintsDir();
      if (handle) {
        // the MIP is only as fresh as the last showroom visit — compare it
        // to the spec TGA it was generated from
        const specTga = await persist.readFileFromFolder(handle, `car_spec_${custid}.tga`);
        const mips = (await persist.listFolder(handle))
          .filter(n => /^car_spec_.*\.mip$/i.test(n) && n.includes(custid));
        for (const n of mips) {
          const f = await persist.readFileFromFolder(handle, n);
          if (f) {
            downloadBlob(f, n);
            gotMip = true;
            if (specTga && f.lastModified < specTga.lastModified) staleMip = true;
          }
        }
      }
    }
  } catch { /* no folder / no MIP yet — PNG alone still uploads */ }
  exportPaintCanvas(renderPaint(doc)).toBlob((blob) => {
    downloadBlob(blob, safeName() + '.png');
    window.open('https://www.tradingpaints.com/upload', '_blank', 'noopener');
    if (staleMip) {
      status('⚠ The spec MIP is OLDER than your latest spec map — it predates your current finishes. Open the sim showroom once (it regenerates the .mip), then Send to TP again. Uploading this one bakes in your OLD materials.', 'err');
    } else {
      status(gotMip
        ? 'PNG + spec MIP copied to Downloads, Trading Paints upload opened — pick the PNG as the paint and the car_spec .mip as the spec map. Note: custom spec maps need Trading Paints Pro; without Pro, TP serves the paint with default shine.'
        : 'PNG saved to Downloads + Trading Paints upload opened. For the spec map: Save to iRacing, open the showroom once (the sim writes the .mip into the paints folder), then Get MIPs copies it to Downloads for the TP form.', 'ok');
    }
  }, 'image/png');
});

$('btn-export-tga').addEventListener('click', () => {
  downloadBlob(canvasToTGA(exportPaintCanvas(renderPaint(doc))), safeName() + '.tga');
  // if a paints folder is linked, remind that the direct path exists
  const tip = !$('btn-save-iracing').disabled
    ? ' Tip: "Save to iRacing" writes them straight into your linked paints folder instead.'
    : '';
  if (doc.target === 'car') {
    downloadBlob(canvasToTGA(renderSpec(doc), { alpha: true }), safeName() + '_spec.tga');
    status('Paint + spec TGAs saved to your Downloads folder.' + tip, 'ok');
  } else {
    status(`${doc.target === 'helmet' ? 'Helmet' : 'Suit'} paint TGA saved to your Downloads folder.` + tip, 'ok');
  }
});

// ---------- File System Access: save into iRacing ----------
// The user can link either a single car folder (paints/<car>) or the paints
// root — when the linked folder contains subdirectories, a car dropdown
// appears and all reads/writes go into the chosen subfolder.

async function effectivePaintsDir({ requestIfNeeded = false } = {}) {
  const root = await persist.getPaintsFolder({ requestIfNeeded }).catch(() => null);
  if (!root) return null;
  const car = await persist.loadSetting('paintsCar').catch(() => null);
  if (!car) return root;
  try {
    return await root.getDirectoryHandle(car);
  } catch {
    return root; // subfolder deleted or permission pending — fall back to root
  }
}

async function refreshFsStatus() {
  if (!persist.fsSupported()) {
    $('status-fs').textContent = 'live save needs Chrome/Edge';
    const why = 'This browser does not expose the File System Access API. Use Chrome or Edge; in Brave enable it via brave://flags ("File System Access API"). Firefox/Safari cannot link folders — use Export TGA instead.';
    $('btn-link-folder').disabled = true;
    $('btn-link-folder').title = why;
    $('btn-save-iracing').disabled = true;
    $('btn-save-iracing').title = why;
    $('paints-car').hidden = true;
    return;
  }
  const root = await persist.getPaintsFolder().catch(() => null);
  const carSel = $('paints-car');
  if (root) {
    const subdirs = await persist.listSubdirs(root);
    const savedCar = await persist.loadSetting('paintsCar').catch(() => null);
    carSel.hidden = !subdirs.length; // a car folder linked directly has none
    if (subdirs.length) {
      carSel.innerHTML = '';
      const optRoot = document.createElement('option');
      optRoot.value = '';
      optRoot.textContent = '(' + root.name + ')';
      carSel.appendChild(optRoot);
      for (const name of subdirs.filter(n => n !== 'clearcoat-backup')) {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        carSel.appendChild(o);
      }
      carSel.value = (savedCar && subdirs.includes(savedCar)) ? savedCar : '';
    }
    const car = (!carSel.hidden && carSel.value) ? carSel.value : null;
    $('status-fs').textContent = '📁 ' + root.name + (car ? ' / ' + car : '');
    $('btn-save-iracing').disabled = false;
    $('btn-get-mips').disabled = false;
    const eff = await effectivePaintsDir();
    if (eff) refreshRestoreButton(eff, $('custid').value.trim()).catch(() => {});
  } else {
    $('status-fs').textContent = 'no folder linked';
    $('btn-save-iracing').disabled = true;
    $('btn-get-mips').disabled = true;
    $('btn-restore-original').hidden = true;
    carSel.hidden = true;
  }
}

$('btn-link-folder').addEventListener('click', async () => {
  try {
    const handle = await persist.pickPaintsFolder();
    await persist.saveSetting('paintsCar', null).catch(() => {}); // new root — no car chosen yet
    status(`Linked folder "${handle.name}". Save to iRacing is live.`, 'ok');
  } catch { /* user cancelled */ }
  refreshFsStatus();
});

$('paints-car').addEventListener('change', async () => {
  const car = $('paints-car').value || null;
  await persist.saveSetting('paintsCar', car).catch(() => {});
  await refreshFsStatus();
  status(car ? `Saving into ${car}/.` : 'Saving into the linked folder itself.');
});

// [paintName, specName] for the active target. Custom Number paints use the
// car_num_ prefix; helmets and suits have no spec map (specName = null).
function paintFilenames(custid) {
  if (doc.target === 'helmet') return [`helmet_${custid}.tga`, null];
  if (doc.target === 'suit') return [`suit_${custid}.tga`, null];
  return [`car_${doc.customNumber ? 'num_' : ''}${custid}.tga`, `car_spec_${custid}.tga`];
}

// iRacing helmets are 1024×1024 — downscale the 2048 sheet for that target;
// car and suit ship at full size.
function exportPaintCanvas(canvas) {
  if (doc.target !== 'helmet') return canvas;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, 1024, 1024);
  return c;
}

function validCustid() {
  const custid = $('custid').value.trim();
  if (!/^\d+$/.test(custid)) {
    status('Enter your numeric iRacing customer ID first.', 'err');
    $('custid').focus();
    return null;
  }
  persist.saveSetting('custid', custid).catch(() => {});
  return custid;
}

// Snapshot whatever is currently in the folder (e.g. your Trading Paints
// livery) into clearcoat-backup/ — but only if no snapshot exists yet, so
// repeated Clearcoat saves never overwrite the true original.
async function backupOriginals(handle, custid) {
  let backed = false;
  for (const name of paintFilenames(custid)) {
    if (!name) continue; // no spec map for this target
    const existing = await persist.readFileFromFolder(handle, name);
    if (!existing) continue;
    const bdir = await persist.getBackupDir(handle, true);
    if (!bdir) return false;
    if (await persist.readFileFromFolder(bdir, name)) continue; // original already kept
    await persist.writeFileToFolder(bdir, name, existing);
    backed = true;
  }
  return backed;
}

async function refreshRestoreButton(handle, custid) {
  let hasBackup = false;
  if (handle && custid) {
    const bdir = await persist.getBackupDir(handle, false);
    if (bdir) {
      for (const name of paintFilenames(custid)) {
        if (name && await persist.readFileFromFolder(bdir, name)) { hasBackup = true; break; }
      }
    }
  }
  $('btn-restore-original').hidden = !hasBackup;
}

async function saveToiRacing({ quiet = false } = {}) {
  const custid = quiet ? $('custid').value.trim() : validCustid();
  if (!custid || !/^\d+$/.test(custid)) return false;
  try {
    const handle = await effectivePaintsDir({ requestIfNeeded: !quiet });
    if (!handle) {
      if (!quiet) { status('Folder permission lost — click Link Folder again.', 'err'); refreshFsStatus(); }
      return false;
    }
    const backed = await backupOriginals(handle, custid);
    const [paintName, specName] = paintFilenames(custid);
    await persist.writeFileToFolder(handle, paintName, canvasToTGA(exportPaintCanvas(renderPaint(doc))));
    if (specName) await persist.writeFileToFolder(handle, specName, canvasToTGA(renderSpec(doc), { alpha: true }));
    await recordGuardBaseline(handle, custid);
    if (quiet) {
      $('status-fs').textContent = '📁 live · ' + new Date().toLocaleTimeString();
    } else {
      const btn = $('btn-save-iracing');
      btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
      status(backed
        ? `Saved ${paintName} — your previous paint is kept in clearcoat-backup/. Use Restore to swap back.`
        : `Saved ${paintName}${specName ? ' + spec' : ''} — check the showroom.`, 'ok');
      refreshRestoreButton(handle, custid);
    }
    return true;
  } catch (err) {
    if (!quiet) status('Write failed: ' + err.message, 'err');
    return false;
  }
}

$('btn-save-iracing').addEventListener('click', () => saveToiRacing());

// ---------- live sync ----------
// While enabled, settled edits stream straight into the iRacing folder —
// keep the sim showroom open on a second monitor and it *is* the preview.

let liveSyncTimer = null;
let liveSyncBusy = false;
let liveSyncWarned = false; // surface a quiet-save failure once, not per tick

function liveSyncTick() {
  if (!$('live-sync').checked) return;
  clearTimeout(liveSyncTimer);
  liveSyncTimer = setTimeout(async () => {
    if (liveSyncBusy) { liveSyncTick(); return; }
    liveSyncBusy = true;
    try {
      const ok = await saveToiRacing({ quiet: true });
      if (!ok && !liveSyncWarned) {
        liveSyncWarned = true;
        $('status-fs').textContent = 'live sync paused';
        status('Live Sync paused — folder permission needed. Click Save to iRacing once to re-grant.', 'err');
      } else if (ok) {
        liveSyncWarned = false;
      }
    } finally { liveSyncBusy = false; }
  }, 2500);
}

$('live-sync').addEventListener('change', () => {
  persist.saveSetting('liveSync', $('live-sync').checked).catch(() => {});
  if ($('live-sync').checked) {
    status('Live sync ON — edits stream to the iRacing folder; keep the showroom open.', 'ok');
    liveSyncTick();
  } else {
    clearTimeout(liveSyncTimer);
    status('Live sync off.');
  }
});

// ---------- TP Guard ----------
// The Trading Paints desktop app re-downloads the user's active TP livery
// into the paints folder, silently clobbering whatever Clearcoat just saved
// — so the sim keeps loading the TP paint. While TP Guard is on, Clearcoat
// remembers the exact file stats of everything it wrote and polls the
// folder; the moment those files change under it, it writes the design
// straight back. Arms after the first Save to iRacing (or Live Sync write).

const TP_GUARD_MS = 3000;
let tpGuardInterval = null;
let tpGuardExpected = {}; // filename → { size, lastModified } of Clearcoat's own write
let tpGuardHits = 0;
let tpGuardBusy = false;

async function recordGuardBaseline(handle, custid) {
  for (const name of paintFilenames(custid)) {
    if (!name) continue;
    const f = await persist.readFileFromFolder(handle, name);
    if (f) tpGuardExpected[name] = { size: f.size, lastModified: f.lastModified };
  }
}

async function tpGuardTick() {
  if (!$('tp-guard').checked || tpGuardBusy || liveSyncBusy) return;
  const custid = $('custid').value.trim();
  if (!/^\d+$/.test(custid)) return;
  tpGuardBusy = true;
  try {
    const handle = await effectivePaintsDir(); // never prompts from a timer
    if (!handle) return;
    let clobbered = null;
    for (const name of paintFilenames(custid)) {
      if (!name) continue;
      const exp = tpGuardExpected[name];
      if (!exp) continue; // guard arms per file once Clearcoat has written it
      const f = await persist.readFileFromFolder(handle, name);
      if (!f || f.size !== exp.size || f.lastModified !== exp.lastModified) { clobbered = name; break; }
    }
    if (clobbered) {
      const ok = await saveToiRacing({ quiet: true }); // rewrite + refresh baseline
      if (ok) {
        tpGuardHits++;
        $('status-fs').textContent = `📁 guarded · put back ${tpGuardHits}×`;
        status(`Trading Paints overwrote ${clobbered} — Clearcoat put your design back (${tpGuardHits}×). "Send to TP" uploads it to Trading Paints for a permanent fix.`, 'ok');
      }
    }
  } catch { /* transient read hiccup — next tick retries */ }
  finally { tpGuardBusy = false; }
}

function setTpGuard(on) {
  clearInterval(tpGuardInterval);
  tpGuardInterval = null;
  if (on) tpGuardInterval = setInterval(tpGuardTick, TP_GUARD_MS);
}

$('tp-guard').addEventListener('change', () => {
  const on = $('tp-guard').checked;
  persist.saveSetting('tpGuard', on).catch(() => {});
  setTpGuard(on);
  if (on) {
    status(Object.keys(tpGuardExpected).length
      ? 'TP Guard on — if Trading Paints overwrites your paint, Clearcoat instantly puts it back.'
      : 'TP Guard on — it arms after your next Save to iRacing.', 'ok');
  } else {
    status('TP Guard off.');
  }
});

// Put the snapshotted originals back and clear the snapshot, so the next
// Clearcoat save re-snapshots whatever is current.
$('btn-restore-original').addEventListener('click', async () => {
  const custid = validCustid();
  if (!custid) return;
  try {
    const handle = await effectivePaintsDir({ requestIfNeeded: true });
    if (!handle) { status('Folder permission lost — click Link Folder again.', 'err'); return; }
    const bdir = await persist.getBackupDir(handle, false);
    let restored = 0;
    if (bdir) {
      for (const name of paintFilenames(custid)) {
        if (!name) continue; // no spec map for this target
        const f = await persist.readFileFromFolder(bdir, name);
        if (!f) continue;
        await persist.writeFileToFolder(handle, name, f);
        await persist.deleteFromFolder(bdir, name);
        restored++;
      }
    }
    // disarm TP Guard — otherwise it would immediately overwrite the restore
    tpGuardExpected = {};
    status(restored
      ? 'Original paint restored.' + ($('tp-guard').checked ? ' TP Guard is disarmed until your next Clearcoat save.' : '')
      : 'No backup found to restore.', restored ? 'ok' : 'err');
    refreshRestoreButton(handle, custid);
  } catch (err) {
    status('Restore failed: ' + err.message, 'err');
  }
});

async function addTgaAsLayer(arrayBuffer, name) {
  // opaque: iRacing/TP paint alpha is sim data (decal masks), not
  // transparency — honoring it would hide most of the livery
  const canvas = tgaToCanvas(arrayBuffer, { opaque: true });
  const src = canvas.toDataURL('image/png');
  const img = await loadImage(src);
  const layer = createImageLayer(img, src, name);
  layer.x = SIZE / 2; layer.y = SIZE / 2; layer.scale = SIZE / img.width; // full sheet
  layer.locked = true; // full-sheet base — don't let it swallow canvas clicks
  doc.layers.push(layer);
  selectLayer(layer.id);
  markDirty();
}

// Custom Number lives in the doc (it decides the export filename, so it
// belongs to the project, like target does)
$('custom-number').addEventListener('change', () => {
  doc.customNumber = $('custom-number').checked;
  scheduleAutosave();
  refreshFsStatus(); // restore button depends on the filenames
});

// ---------- paint target (car / helmet / suit) ----------

// the Custom Number checkbox only applies to car paints
function syncPaintTarget() {
  $('paint-target').value = doc.target;
  $('custom-number').checked = !!doc.customNumber;
  const isCar = doc.target === 'car';
  $('custom-number').disabled = !isCar;
  $('custom-number').closest('.tb-check').classList.toggle('disabled', !isCar);
}

$('paint-target').addEventListener('change', () => {
  doc.target = $('paint-target').value;
  syncPaintTarget();
  scheduleAutosave();
  status(doc.target === 'car'
    ? 'Painting the car — saves car_<id>.tga + spec map.'
    : `Painting the ${doc.target} — saves ${doc.target}_<id>.tga${doc.target === 'helmet' ? ' at 1024×1024' : ''}, no spec map.`);
  refreshFsStatus(); // restore button depends on the target's filenames
});

// Download the sim-generated .mip files — the only way to get a custom spec
// map into Trading Paints (their servers can't create MIPs either).
$('btn-get-mips').addEventListener('click', async () => {
  const custid = validCustid();
  if (!custid) return;
  try {
    const handle = await effectivePaintsDir({ requestIfNeeded: true });
    if (!handle) { status('Link your paints folder first.', 'err'); return; }
    const mips = (await persist.listFolder(handle))
      .filter(n => /\.mip$/i.test(n) && n.includes(custid));
    if (!mips.length) {
      status('No .mip files for your ID yet — Save to iRacing, then open the sim showroom once so it generates them.', 'err');
      return;
    }
    for (const n of mips) {
      const f = await persist.readFileFromFolder(handle, n);
      if (f) downloadBlob(f, n);
    }
    status(`Copied ${mips.length} MIP file(s) to your Downloads — pick the car_spec one in Trading Paints' spec-map upload. The originals stay in your paints folder for the sim.`, 'ok');
  } catch (err) {
    status('MIP download failed: ' + err.message, 'err');
  }
});

// Pull the livery currently in the folder (e.g. your Trading Paints paint)
// into the editor as a full-sheet layer to design on top of.
// Trading Paints writes car_<id>.tga for Sim-Stamped Number paints but
// car_num_<id>.tga for Custom Number paints — try both, then any car TGA,
// then offer a manual file picker.
$('btn-import-paint').addEventListener('click', async () => {
  const custid = validCustid();
  if (!custid) return;
  try {
    const handle = await effectivePaintsDir({ requestIfNeeded: true });
    if (!handle) { status('Link your paints folder first.', 'err'); return; }
    const bdir = await persist.getBackupDir(handle, false);

    const candidates = doc.target === 'car'
      ? [`car_${custid}.tga`, `car_num_${custid}.tga`]
      : [`${doc.target}_${custid}.tga`];
    let file = null, picked = null, note = '';
    for (const name of candidates) {
      const live = await persist.readFileFromFolder(handle, name);
      const backup = bdir && await persist.readFileFromFolder(bdir, name);
      // Use the live folder file — that's what the sim is showing — UNLESS
      // it's provably Clearcoat's own write (TP Guard baseline match), in
      // which case the pristine backup is the user's real TP livery.
      const exp = tpGuardExpected[name];
      const liveIsOurs = live && exp && live.size === exp.size && live.lastModified === exp.lastModified;
      if (live && !liveIsOurs) { file = live; picked = name; break; }
      if (backup) { file = backup; picked = name; note = ' (from clearcoat-backup — the snapshot taken before Clearcoat overwrote it)'; break; }
      if (live) { file = live; picked = name; break; }
    }

    if (!file) {
      // maybe the paint lives in a different car folder under the linked
      // root — scan siblings and switch the dropdown to the first hit
      const root = await persist.getPaintsFolder().catch(() => null);
      if (root) {
        for (const sub of await persist.listSubdirs(root)) {
          if (sub === 'clearcoat-backup') continue;
          try {
            const dh = await root.getDirectoryHandle(sub);
            for (const name of candidates) {
              const f = await persist.readFileFromFolder(dh, name);
              if (f) {
                file = f; picked = name;
                note = ` (found in ${sub}/ — car dropdown switched to it)`;
                await persist.saveSetting('paintsCar', sub);
                refreshFsStatus();
                break;
              }
            }
          } catch { /* unreadable subfolder — skip */ }
          if (file) break;
        }
      }
    }

    if (!file) {
      // fall back: any TGA matching the target's prefix, newest first
      const tgas = (await persist.listFolder(handle)).filter(n => /\.tga$/i.test(n));
      const prefixed = tgas.filter(n => n.toLowerCase().startsWith(doc.target) && !/spec/i.test(n));
      const pool = prefixed.length ? prefixed : tgas;
      let newest = null;
      for (const n of pool) {
        const f = await persist.readFileFromFolder(handle, n);
        if (f && (!newest || f.lastModified > newest.file.lastModified)) newest = { file: f, name: n };
      }
      if (newest) {
        file = newest.file; picked = newest.name;
      } else {
        const all = await persist.listFolder(handle);
        status(`No .tga in the linked folder (${all.length} files: ${all.slice(0, 4).join(', ')}${all.length > 4 ? '…' : ''}) — pick one manually.`, 'err');
        $('file-tga').click(); // manual escape hatch
        return;
      }
    }

    await addTgaAsLayer(await file.arrayBuffer(), picked.replace(/\.tga$/i, ''));
    status(`Imported ${picked}${note} as a layer.`, 'ok');
  } catch (err) {
    status('Import failed: ' + err.message, 'err');
  }
});

// manual TGA import (fallback, and useful on Firefox/Safari)
$('file-tga').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    await addTgaAsLayer(await f.arrayBuffer(), f.name.replace(/\.tga$/i, ''));
    status(`Imported ${f.name} as a layer.`, 'ok');
  } catch (err) {
    status('Import failed: ' + err.message, 'err');
  }
});

// ---------- keyboard ----------

// document shortcuts must not fire behind an open dialog (worst case:
// Delete removing layers behind the Projects modal). Esc still passes
// through — the Escape branch below is what closes them.
function anyModalOpen() {
  return ['help-modal', 'projects-modal', 'maps-modal', 'library-modal', 'advisor-modal', 'ask-modal']
    .some(id => { const el = document.getElementById(id); return el && !el.hidden; });
}

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (anyModalOpen() && e.key !== 'Escape' && e.key !== 'F1') return;

  if (e.code === 'Space') { spaceHeld = true; e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (e.key === 'Escape') {
    if (!askModal.hidden) { closeAsk(null); return; }
    if (!$('help-modal').hidden) { $('help-modal').hidden = true; return; }
    if (!projectsModal.hidden) { closeProjects(); return; }
    if (!mapsModal.hidden) { closeMapsModal(); return; }
    if (!libraryModal.hidden) { closeLibrary(); return; }
    if (annotateMode) { setAnnotateMode(false); return; }
    if (wandMode) { setWandMode(false); return; }
    if (studioView) { setStudioView(false); return; }
    selectLayer(null); return;
  }
  if (e.key === 'w' || e.key === 'W') { setWandMode(!wandMode); return; }
  if (e.key === 'f' || e.key === 'F') { fitView(); return; }
  if (e.key === 's' || e.key === 'S') {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); $('btn-save').click(); return; }
    $('btn-spec-view').click(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelected(); return; }
  if (e.key === 'l' || e.key === 'L') { setShineView(!shineView); return; }

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const targets = selectedLayers().filter(l => !l.locked);
    if (!targets.length) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    for (const l of targets) {
      l.x += dx; l.y += dy;
      if (isRegionLayer(l)) { l.rx += dx; l.ry += dy; }
    }
    syncInspector();
    markDirty();
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

window.addEventListener('resize', requestRender);

// ---------- boot ----------

(async function boot() {
  buildMaterialGrid();
  initAdvisor(() => doc);   // Livery Advisor reads the live doc on demand

  if (!lightSweepSupported()) {
    $('btn-shine-view').disabled = true;
    $('btn-shine-view').title = 'Shine preview needs WebGL';
  }
  if (!studioSupported()) {
    $('btn-studio-view').disabled = true;
    $('btn-studio-view').title = 'Studio preview needs WebGL';
  }

  const savedCustid = await persist.loadSetting('custid').catch(() => null);
  if (savedCustid) $('custid').value = savedCustid;
  // pre-v0.31 stored Custom Number as a global setting; it now lives in the doc
  const legacyCustomNum = await persist.loadSetting('customNumber').catch(() => null);
  const liveSync = await persist.loadSetting('liveSync').catch(() => null);
  if (liveSync && persist.fsSupported()) $('live-sync').checked = true;
  const tpGuard = await persist.loadSetting('tpGuard').catch(() => null);
  if (tpGuard && persist.fsSupported()) { $('tp-guard').checked = true; setTpGuard(true); }

  let auto = await persist.loadAutosave().catch(() => null);
  if (typeof auto === 'string') { try { auto = JSON.parse(auto); } catch { auto = null; } }
  if (auto && (auto.layers?.length || auto.template || auto.baseColor !== '#1a6cff')) {
    try {
      doc = await deserializeDoc(auto);
      // migrate the legacy global Custom Number into a doc that predates the field
      if (legacyCustomNum && !('customNumber' in auto)) doc.customNumber = true;
      status('Restored autosaved project.');
    } catch { /* corrupt autosave — start fresh */ }
  }

  // the autosaved doc wins (crash recovery), but re-associate it with the
  // project it was writing through to so the link survives a browser restart
  const savedProject = await persist.loadSetting('currentProject').catch(() => null);
  if (savedProject) {
    const entry = (await persist.listProjects().catch(() => [])).find(p => p.id === savedProject);
    // set directly — setCurrentProject would redundantly re-save the setting
    if (entry) {
      currentProjectId = entry.id;
      $('current-project-label').textContent = entry.name;
    } else {
      persist.saveSetting('currentProject', null).catch(() => {}); // project was deleted
    }
  }

  afterDocLoad();
  await refreshFsStatus();
})();

// ---------- service worker (offline shell + update notice) ----------
// sw.js precaches the app shell under a versioned cache; bump its VERSION
// together with #app-version on every deploy. Registered with a relative
// path so the scope resolves correctly under the /clearcoat/ subpath.

if ('serviceWorker' in navigator) {
  let swReloaded = false; // guard against controllerchange reload loops
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloaded) return;
    swReloaded = true;
    location.reload();
  });

  const showUpdateToast = (worker) => {
    if (document.getElementById('sw-update-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'sw-update-toast';

    const msg = document.createElement('span');
    msg.textContent = 'New version ready —';

    const reload = document.createElement('button');
    reload.className = 'sm-btn';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => {
      reload.disabled = true;
      worker.postMessage({ type: 'SKIP_WAITING' }); // activation fires controllerchange → reload
    });

    const dismiss = document.createElement('button');
    dismiss.className = 'sm-btn icon';
    dismiss.title = 'Dismiss — the update applies next visit';
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => toast.remove());

    toast.append(msg, reload, dismiss);
    document.body.appendChild(toast);
  };

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // update already downloaded and parked while we weren't looking
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // 'installed' with an existing controller = an update is waiting
          // (without a controller it's the very first install — no toast)
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(worker);
        });
      });
    } catch { /* blocked or unsupported — the app works fine without it */ }
  });
}
