import {
  SIZE, MATERIALS, createDoc, createImageLayer, createPatternLayer, createFillLayer,
  createTextLayer, regenerateText, fillShapePath, fillPaintStyle,
  GOOGLE_FONTS, registerCustomFont,
  renderPaint, renderSpec, hitTest, hitTestAll, layerCorners, isRegionLayer,
  serializeDoc, deserializeDoc, loadImage,
  templateOverlay, defaultParams, resolveParams, mixHex,
} from './engine.js';
import { canvasToTGA, tgaToCanvas } from './tga.js';
import { psdToTemplate } from './psd.js';
import { renderBall, layerAlbedo } from './shaderball.js';
import { lightSweepSupported, lightSweepFrame } from './lightsweep.js';
import * as persist from './persist.js';
import { LIBRARY, libraryItemToLayerSource } from './library.js';

// ---------- state ----------

let doc = createDoc();
let selectedId = null;        // primary selection: layer id, 'base', or null
const selectedIds = new Set(); // multi-select (layer ids only, never 'base')
let specView = false;
let shineView = false;
let shineStart = 0;
let dirty = true;             // composite needs re-render
let autosaveTimer = null;

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

function fitView() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  view.zoom = Math.min(w / SIZE, h / SIZE) * 0.92;
  view.x = (w / view.zoom - SIZE) / 2;
  view.y = (h / view.zoom - SIZE) / 2;
  requestRender();
}

function setZoom(z, cx, cy) {
  // keep doc point under (cx, cy) fixed
  const before = screenToDoc(cx, cy);
  view.zoom = Math.max(0.05, Math.min(8, z));
  const after = screenToDoc(cx, cy);
  view.x += after.x - before.x;
  view.y += after.y - before.y;
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
  requestRender();
  scheduleAutosave();
}

// ---------- undo / redo ----------
// Snapshot-based: the autosave debounce also captures history, so one undo
// step ≈ one settled action (a slider drag, a move, a delete).

const undoStack = [];
const redoStack = [];
let suppressHistory = false;

function captureHistory() {
  if (suppressHistory) return;
  const snap = JSON.stringify(serializeDoc(doc));
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function updateUndoButtons() {
  $('btn-undo').disabled = undoStack.length < 2;
  $('btn-redo').disabled = redoStack.length === 0;
}

async function applyHistory(snap) {
  suppressHistory = true;
  try {
    doc = await deserializeDoc(JSON.parse(snap));
    selectedId = null;
    selectedIds.clear();
    syncDocUI();
    markDirty();
  } finally {
    // lift suppression after the autosave debounce would have fired
    setTimeout(() => { suppressHistory = false; }, 1500);
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

function draw() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (viewport.width !== w * devicePixelRatio || viewport.height !== h * devicePixelRatio) {
    viewport.width = w * devicePixelRatio;
    viewport.height = h * devicePixelRatio;
  }
  vctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  vctx.clearRect(0, 0, w, h);

  let composite;
  if (specView) {
    composite = renderSpec(doc);
  } else if (shineView) {
    const frame = lightSweepFrame(
      renderPaint(doc), renderSpec(doc),
      (performance.now() - shineStart) / 1000, dirty,
    );
    composite = frame || renderPaint(doc); // WebGL unavailable → plain paint
  } else {
    composite = renderPaint(doc);
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

// ---------- pointer interaction ----------

let drag = null; // { mode: 'move'|'scale'|'rotate'|'pan', ... }

function handleAt(sx, sy) {
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
  return null;
}

viewport.addEventListener('pointerdown', (e) => {
  viewport.setPointerCapture(e.pointerId);
  const sx = e.offsetX, sy = e.offsetY;

  if (e.button === 1 || e.button === 2 || spaceHeld) {
    drag = { mode: 'pan', startX: sx, startY: sy, vx: view.x, vy: view.y };
    viewport.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;

  const handle = handleAt(sx, sy);
  const sel = selectedLayer();
  if (handle && sel) {
    const p = screenToDoc(sx, sy);
    if (handle.type === 'rotate') {
      drag = {
        mode: 'rotate', layer: sel,
        startAngle: Math.atan2(p.y - sel.y, p.x - sel.x) * 180 / Math.PI - sel.rotation,
      };
    } else if (handle.type === 'region') {
      // anchor = the corner opposite the grabbed one
      const corners = layerCorners(sel);
      const anchor = corners[(handle.corner + 2) % 4];
      drag = { mode: 'region', layer: sel, anchor };
    } else {
      drag = {
        mode: 'scale', layer: sel,
        startDist: Math.hypot(p.x - sel.x, p.y - sel.y),
        startScale: sel.scale,
      };
    }
    return;
  }

  const p = screenToDoc(sx, sy);
  const hits = hitTestAll(doc, p.x, p.y);
  let hit = hits[0] || null;
  // clicking again on an already-selected spot cycles down the stack
  if (hits.length > 1) {
    const idx = hits.findIndex(l => l.id === selectedId);
    if (idx !== -1) hit = hits[(idx + 1) % hits.length];
  }
  if (hit) {
    // dragging within a multi-selection moves the whole selection
    if (selectedIds.has(hit.id) && selectedIds.size > 1) {
      drag = {
        mode: 'move-multi', startP: p,
        starts: selectedLayers().filter(l => !l.locked).map(l => ({
          layer: l, x: l.x, y: l.y, rx: l.rx, ry: l.ry,
        })),
      };
      return;
    }
    selectLayer(hit.id);
    drag = isRegionLayer(hit)
      ? { mode: 'move-region', layer: hit, offX: p.x - hit.rx, offY: p.y - hit.ry }
      : { mode: 'move', layer: hit, offX: p.x - hit.x, offY: p.y - hit.y };
  } else {
    selectLayer(null);
    drag = { mode: 'pan', startX: sx, startY: sy, vx: view.x, vy: view.y };
    viewport.classList.add('panning');
  }
});

viewport.addEventListener('pointermove', (e) => {
  const sx = e.offsetX, sy = e.offsetY;
  const p = screenToDoc(sx, sy);
  $('status-pos').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;

  if (!drag) {
    viewport.classList.toggle('over-layer', !!handleAt(sx, sy) || !!hitTest(doc, p.x, p.y));
    return;
  }

  switch (drag.mode) {
    case 'pan':
      view.x = drag.vx + (sx - drag.startX) / view.zoom;
      view.y = drag.vy + (sy - drag.startY) / view.zoom;
      requestRender();
      break;
    case 'move':
      drag.layer.x = Math.round(p.x - drag.offX);
      drag.layer.y = Math.round(p.y - drag.offY);
      syncInspector();
      markDirty();
      break;
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
      const nx = Math.round(p.x - drag.offX);
      const ny = Math.round(p.y - drag.offY);
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
        drag.layer.scale = Math.max(0.01, drag.startScale * dist / drag.startDist);
        syncInspector();
        markDirty();
      }
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
  }
});

window.addEventListener('pointerup', () => {
  drag = null;
  viewport.classList.remove('panning');
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoom(view.zoom * factor, e.offsetX, e.offsetY);
  $('zoom-readout').textContent = Math.round(view.zoom * 100) + '%';
}, { passive: false });

viewport.addEventListener('contextmenu', (e) => e.preventDefault());

let spaceHeld = false;

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

function selectLayer(id) {
  selectedId = id;
  selectedIds.clear();
  if (id && id !== 'base') selectedIds.add(id);
  rebuildLayerList();
  syncInspector();
  requestRender();
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

    li.append(thumb, name, mat, dup, lock, vis, order);
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
    }
    for (const [id, prop] of [['ins-x', 'x'], ['ins-y', 'y'], ['ins-scale', 'scale'], ['ins-rot', 'rotation'], ['ins-skx', 'skewX'], ['ins-sky', 'skewY']]) {
      const el = $(id);
      if (document.activeElement !== el) {
        el.value = prop === 'scale' ? sel[prop].toFixed(3) : Math.round((sel[prop] || 0) * 10) / 10;
      }
    }
    // skew only makes sense for image-like layers (patterns/fills are regions)
    $('ins-skx-wrap').hidden = $('ins-sky-wrap').hidden = sel.type !== 'image' && sel.type !== 'text';
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
  if (sel) sel.specBlend = 'replace';
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
for (const [id, prop] of [['ins-x', 'x'], ['ins-y', 'y'], ['ins-scale', 'scale'], ['ins-rot', 'rotation'], ['ins-skx', 'skewX'], ['ins-sky', 'skewY']]) {
  $(id).addEventListener('input', () => {
    const sel = selectedLayer(); if (!sel) return;
    const v = parseFloat($(id).value);
    if (!Number.isFinite(v)) return;
    if (prop === 'scale') sel[prop] = Math.max(0.01, v);
    else if (prop === 'skewX' || prop === 'skewY') sel[prop] = Math.max(-80, Math.min(80, v));
    else sel[prop] = v;
    markDirty();
  });
}
$('ins-spec-only').addEventListener('change', () => {
  const sel = selectedLayer(); if (!sel) return;
  sel.specOnly = $('ins-spec-only').checked;
  markDirty();
});
$('ins-flip-h').addEventListener('click', () => { const s = selectedLayer(); if (s) { s.flipH = !s.flipH; markDirty(); } });
$('ins-flip-v').addEventListener('click', () => { const s = selectedLayer(); if (s) { s.flipV = !s.flipV; markDirty(); } });
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

// ---------- HUD ----------

$('btn-fit').addEventListener('click', fitView);
$('btn-zoom-in').addEventListener('click', () => { setZoom(view.zoom * 1.25, viewport.clientWidth / 2, viewport.clientHeight / 2); $('zoom-readout').textContent = Math.round(view.zoom * 100) + '%'; });
$('btn-zoom-out').addEventListener('click', () => { setZoom(view.zoom / 1.25, viewport.clientWidth / 2, viewport.clientHeight / 2); $('zoom-readout').textContent = Math.round(view.zoom * 100) + '%'; });
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
    afterDocLoad();
    status(`Opened "${doc.name}".`, 'ok');
  } catch {
    status('That file is not a valid Clearcoat project.', 'err');
  }
});

$('btn-new').addEventListener('click', () => {
  if (doc.layers.length && !confirm('Start a new livery? Unsaved changes are kept only in autosave.')) return;
  doc = createDoc();
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
}

// ---------- autosave ----------

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    captureHistory();
    try {
      await persist.saveAutosave(serializeDoc(doc));
      $('status-autosave').textContent = 'autosaved ' + new Date().toLocaleTimeString();
    } catch { /* quota or private mode — non-fatal */ }
  }, 1200);
}

// ---------- exports ----------

$('btn-export-png').addEventListener('click', () => {
  renderPaint(doc).toBlob((blob) => {
    downloadBlob(blob, safeName() + '.png');
    status('PNG exported.', 'ok');
  }, 'image/png');
});

$('btn-export-tga').addEventListener('click', () => {
  downloadBlob(canvasToTGA(exportPaintCanvas(renderPaint(doc))), safeName() + '.tga');
  if (doc.target === 'car') {
    downloadBlob(canvasToTGA(renderSpec(doc), { alpha: true }), safeName() + '_spec.tga');
    status('Paint + spec TGAs exported.', 'ok');
  } else {
    status(`${doc.target === 'helmet' ? 'Helmet' : 'Suit'} paint TGA exported.`, 'ok');
  }
});

// ---------- File System Access: save into iRacing ----------

async function refreshFsStatus() {
  if (!persist.fsSupported()) {
    $('status-fs').textContent = 'live save needs Chrome/Edge';
    const why = 'This browser does not expose the File System Access API. Use Chrome or Edge; in Brave enable it via brave://flags ("File System Access API"). Firefox/Safari cannot link folders — use Export TGA instead.';
    $('btn-link-folder').disabled = true;
    $('btn-link-folder').title = why;
    $('btn-save-iracing').disabled = true;
    $('btn-save-iracing').title = why;
    return;
  }
  const handle = await persist.getPaintsFolder().catch(() => null);
  if (handle) {
    $('status-fs').textContent = '📁 ' + handle.name;
    $('btn-save-iracing').disabled = false;
    $('btn-get-mips').disabled = false;
    refreshRestoreButton(handle, $('custid').value.trim()).catch(() => {});
  } else {
    $('status-fs').textContent = 'no folder linked';
    $('btn-save-iracing').disabled = true;
    $('btn-get-mips').disabled = true;
    $('btn-restore-original').hidden = true;
  }
}

$('btn-link-folder').addEventListener('click', async () => {
  try {
    const handle = await persist.pickPaintsFolder();
    status(`Linked folder "${handle.name}". Save to iRacing is live.`, 'ok');
  } catch { /* user cancelled */ }
  refreshFsStatus();
});

// [paintName, specName] for the active target. Custom Number paints use the
// car_num_ prefix; helmets and suits have no spec map (specName = null).
function paintFilenames(custid) {
  if (doc.target === 'helmet') return [`helmet_${custid}.tga`, null];
  if (doc.target === 'suit') return [`suit_${custid}.tga`, null];
  const num = $('custom-number').checked;
  return [`car_${num ? 'num_' : ''}${custid}.tga`, `car_spec_${custid}.tga`];
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

$('btn-save-iracing').addEventListener('click', async () => {
  const custid = validCustid();
  if (!custid) return;
  try {
    const handle = await persist.getPaintsFolder({ requestIfNeeded: true });
    if (!handle) { status('Folder permission lost — click Link Folder again.', 'err'); refreshFsStatus(); return; }
    const backed = await backupOriginals(handle, custid);
    const [paintName, specName] = paintFilenames(custid);
    await persist.writeFileToFolder(handle, paintName, canvasToTGA(exportPaintCanvas(renderPaint(doc))));
    if (specName) await persist.writeFileToFolder(handle, specName, canvasToTGA(renderSpec(doc), { alpha: true }));
    const btn = $('btn-save-iracing');
    btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
    status(backed
      ? `Saved ${paintName} — your previous paint is kept in clearcoat-backup/. Use Restore to swap back.`
      : `Saved ${paintName}${specName ? ' + spec' : ''} — check the showroom.`, 'ok');
    refreshRestoreButton(handle, custid);
  } catch (err) {
    status('Write failed: ' + err.message, 'err');
  }
});

// Put the snapshotted originals back and clear the snapshot, so the next
// Clearcoat save re-snapshots whatever is current.
$('btn-restore-original').addEventListener('click', async () => {
  const custid = validCustid();
  if (!custid) return;
  try {
    const handle = await persist.getPaintsFolder({ requestIfNeeded: true });
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
    status(restored ? 'Original paint restored.' : 'No backup found to restore.', restored ? 'ok' : 'err');
    refreshRestoreButton(handle, custid);
  } catch (err) {
    status('Restore failed: ' + err.message, 'err');
  }
});

async function addTgaAsLayer(arrayBuffer, name) {
  const canvas = tgaToCanvas(arrayBuffer);
  const src = canvas.toDataURL('image/png');
  const img = await loadImage(src);
  const layer = createImageLayer(img, src, name);
  layer.x = SIZE / 2; layer.y = SIZE / 2; layer.scale = SIZE / img.width; // full sheet
  layer.locked = true; // full-sheet base — don't let it swallow canvas clicks
  doc.layers.push(layer);
  selectLayer(layer.id);
  markDirty();
}

$('custom-number').addEventListener('change', () => {
  persist.saveSetting('customNumber', $('custom-number').checked).catch(() => {});
});

// ---------- paint target (car / helmet / suit) ----------

// the Custom Number checkbox only applies to car paints
function syncPaintTarget() {
  $('paint-target').value = doc.target;
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
    const handle = await persist.getPaintsFolder({ requestIfNeeded: true });
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
    status(`Downloaded ${mips.length} MIP file(s) — upload the car_spec one to Trading Paints.`, 'ok');
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
    const handle = await persist.getPaintsFolder({ requestIfNeeded: true });
    if (!handle) { status('Link your paints folder first.', 'err'); return; }
    const bdir = await persist.getBackupDir(handle, false);

    const candidates = doc.target === 'car'
      ? [`car_${custid}.tga`, `car_num_${custid}.tga`]
      : [`${doc.target}_${custid}.tga`];
    let file = null, picked = null;
    for (const name of candidates) {
      // prefer the pristine backup if one exists (folder copy may be ours)
      file = (bdir && await persist.readFileFromFolder(bdir, name))
          || await persist.readFileFromFolder(handle, name);
      if (file) { picked = name; break; }
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
    status(`Imported ${picked} as a layer.`, 'ok');
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

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.code === 'Space') { spaceHeld = true; e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (e.key === 'Escape') {
    if (!libraryModal.hidden) { closeLibrary(); return; }
    selectLayer(null); return;
  }
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

  if (!lightSweepSupported()) {
    $('btn-shine-view').disabled = true;
    $('btn-shine-view').title = 'Shine preview needs WebGL';
  }

  const savedCustid = await persist.loadSetting('custid').catch(() => null);
  if (savedCustid) $('custid').value = savedCustid;
  const customNum = await persist.loadSetting('customNumber').catch(() => null);
  if (customNum) $('custom-number').checked = true;

  const auto = await persist.loadAutosave().catch(() => null);
  if (auto && (auto.layers?.length || auto.template || auto.baseColor !== '#1a6cff')) {
    try {
      doc = await deserializeDoc(auto);
      status('Restored autosaved project.');
    } catch { /* corrupt autosave — start fresh */ }
  }

  afterDocLoad();
  await refreshFsStatus();
})();
