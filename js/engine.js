// Clearcoat render engine — document model, paint compositing, spec map generation.

import { parseRegionMap } from './regions.js';

export const SIZE = 2048;

// iRacing PBR spec map convention (per official template PSDs):
// R = metallic, G = roughness, B = clearcoat strength.
// `tex` materials bake a procedural per-pixel micro-texture into the spec
// channels instead of flat values. `ghost` layers are skipped in the paint
// map entirely — the design exists only in reflections.
// Per iRacing's docs the blue (clearcoat) channel should stay white unless
// deliberately reduced. Every material is a *starting recipe* — per-layer
// matParams (met/rough/clear + texture knobs) override these defaults.
export const MATERIALS = {
  gloss:    { label: 'Gloss',    met: 0,   rough: 40,  clear: 255 },
  matte:    { label: 'Matte',    met: 0,   rough: 230, clear: 60  },
  satin:    { label: 'Satin',    met: 0,   rough: 120, clear: 150 },
  metallic: { label: 'Metallic', met: 180, rough: 70,  clear: 255 },
  chrome:   { label: 'Chrome',   met: 255, rough: 10,  clear: 255 },
  candy:    { label: 'Candy',    met: 220, rough: 25,  clear: 255 },
  pearl:    { label: 'Pearl',    met: 190, rough: 60,  clear: 255 },
  // pearl over existing artwork without muting it — values validated in-sim
  glaze:    { label: 'Glaze',    met: 75,  rough: 55,  clear: 255 },
  flake:    { label: 'Flake',    tex: 'flake',   met: 160, rough: 45,  clear: 255, density: 18, contrast: 100 },
  glitter:  { label: 'Glitter',  tex: 'glitter', met: 170, rough: 60,  clear: 255, density: 30, scale: 4, contrast: 100 },
  brushed:  { label: 'Brushed',  tex: 'brushed', met: 205, rough: 110, clear: 130, scale: 2,  contrast: 100 },
  carbon:   { label: 'Carbon',   tex: 'carbon',  met: 40,  rough: 85,  clear: 210, scale: 16, contrast: 100 },
  ghost:    { label: 'Ghost',    met: 255, rough: 10, clear: 255, ghost: true },
};

// fresh copy of a material's editable parameters
export function defaultParams(key) {
  const m = MATERIALS[key] || MATERIALS.gloss;
  const p = { met: m.met, rough: m.rough, clear: m.clear };
  if (m.density !== undefined) p.density = m.density;
  if (m.scale !== undefined) p.scale = m.scale;
  if (m.contrast !== undefined) p.contrast = m.contrast;
  return p;
}

export function resolveParams(materialKey, matParams) {
  return { ...defaultParams(materialKey), ...(matParams || {}) };
}

// ---------- procedural spec micro-textures ----------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const texCache = new Map();

export function specTexture(key, p) {
  const cacheKey = `${key}|${p.met}|${p.rough}|${p.clear}|${p.scale || 0}|${p.density || 0}|${p.contrast || 0}`;
  if (texCache.has(cacheKey)) return texCache.get(cacheKey);
  if (texCache.size > 8) texCache.clear(); // slider scrubbing — keep memory flat

  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(SIZE, SIZE);
  const d = id.data;
  const rand = mulberry32(0xC0FFEE); // seeded — identical output every export
  const k = (p.contrast ?? 100) / 100;

  if (key === 'flake') {
    // sparkle speckle: random pixels spike metallic and drop roughness
    const density = Math.max(0.01, (p.density ?? 18) / 100);
    const thr = 1 - density;
    for (let i = 0; i < d.length; i += 4) {
      const f = rand();
      const s = (f > thr ? (f - thr) / density : 0) * k;
      d[i]     = clamp255(p.met + (255 - p.met) * s);
      d[i + 1] = clamp255(p.rough * (1 - 0.85 * s));
      d[i + 2] = p.clear;
      d[i + 3] = 255;
    }
  } else if (key === 'glitter') {
    // coarse sparkle: multi-pixel chips (flake's loud cousin). Each chip
    // spikes metallic and carries its OWN roughness, so different chips
    // catch the light at different angles — the tumbling-glitter look.
    ctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const size = Math.max(2, Math.round(p.scale ?? 4));
    const density = Math.max(1, Math.min(80, p.density ?? 30));
    const count = Math.round((SIZE * SIZE * (density / 100)) / (size * size));
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rand() * SIZE);
      const y = Math.floor(rand() * SIZE);
      const flash = rand() * k;                       // how hard this chip flashes
      const met = clamp255(p.met + (255 - p.met) * (0.4 + 0.6 * flash));
      const rough = clamp255(p.rough * (1 - 0.9 * flash) + rand() * 30);
      const s = Math.max(1, Math.round(size * (0.7 + rand() * 0.6)));
      ctx.fillStyle = `rgb(${met},${rough},${p.clear})`;
      ctx.fillRect(x, y, s, s);
    }
    texCache.set(cacheKey, c);
    return c; // drawn with fillRect — skip the ImageData path below
  } else if (key === 'brushed') {
    // grain bands of `scale` px plus per-pixel jitter in the roughness channel
    const band = Math.max(1, Math.round(p.scale ?? 2));
    let row = 0;
    for (let y = 0; y < SIZE; y++) {
      if (y % band === 0) row = (rand() - 0.5) * 140 * k;
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        d[i]     = p.met;
        d[i + 1] = clamp255(p.rough + row + (rand() - 0.5) * 40 * k);
        d[i + 2] = p.clear;
        d[i + 3] = 255;
      }
    }
  } else if (key === 'carbon') {
    // 2x2 twill: alternating cells with opposing roughness gradients
    const cell = Math.max(2, Math.round(p.scale ?? 16));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        const weave = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) === 0;
        const fx = (x % cell) / cell;
        const swing = weave ? (-35 + fx * 70) : (35 - fx * 70);
        d[i]     = p.met;
        d[i + 1] = clamp255(p.rough + swing * k);
        d[i + 2] = p.clear;
        d[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(id, 0, 0);
  texCache.set(cacheKey, c);
  return c;
}

let nextId = 1;
export function newId() { return 'L' + (nextId++) + '-' + Date.now().toString(36); }

export function createDoc() {
  return {
    name: 'untitled livery',
    target: 'car',       // what this project paints: 'car' | 'helmet' | 'suit'
    customNumber: false, // iRacing Custom Number paints export car_num_<id>.tga
    baseColor: '#1a6cff',
    baseMaterial: 'gloss',
    baseMatParams: null,
    layers: [],          // bottom → top; image layers only
    template: null,      // { img, src } — viewport reference only
    templateOpacity: 0.75,
    templateColor: '#ffffff',   // recolor linework for contrast; 'original' = multiply as-is
    templateBold: true,         // thicken 1px linework
    customFonts: [],            // { name, data (base64) } — uploaded fonts travel with the project
    regionMap: null,            // parsed clearcoat-regions/1 map (see regions.js)
  };
}

export function createImageLayer(img, src, name) {
  // start centered, scaled to fit within half the sheet
  const fit = Math.min(1, (SIZE / 2) / Math.max(img.width, img.height));
  return {
    id: newId(),
    type: 'image',
    name: name || 'image',
    visible: true,
    opacity: 1,
    material: 'gloss',
    fx: null,          // optional layer effects (stroke/shadow/glow)
    img, src,
    x: SIZE / 2,
    y: SIZE / 2,
    scale: fit,
    rotation: 0,   // degrees
    skewX: 0,      // degrees
    skewY: 0,
    flipH: false,
    flipV: false,
  };
}

// full local→doc transform for an image layer (skew sits between rotation
// and scale so its angles act on the unscaled axes)
export function layerMatrix(l) {
  return new DOMMatrix()
    .translate(l.x, l.y)
    .rotate(l.rotation)
    .skewX(l.skewX || 0)
    .skewY(l.skewY || 0)
    .scale(l.scale * (l.flipH ? -1 : 1), l.scale * (l.flipV ? -1 : 1));
}

export const TEXT_FONTS = ['Arial Black', 'Impact', 'Georgia', 'Courier New', 'Verdana', 'Trebuchet MS'];

// curated livery-friendly Google Fonts — loaded on demand (see main.js)
export const GOOGLE_FONTS = [
  'Anton', 'Archivo Black', 'Bebas Neue', 'Black Ops One', 'Bungee', 'Faster One',
  'Monoton', 'Orbitron', 'Oswald', 'Permanent Marker', 'Racing Sans One', 'Russo One',
];

// decode a stored custom font (base64) and register it with the page;
// throws if the data doesn't parse as a font
export async function registerCustomFont(name, base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const face = new FontFace(name, bytes.buffer);
  await face.load();
  document.fonts.add(face);
}

// text layer — rasterized into img/src so the whole image pipeline
// (transform, hit-test, materials, thumbnails) treats it like any image
export function createTextLayer() {
  const layer = {
    id: newId(),
    type: 'text',
    name: 'text',
    visible: true,
    opacity: 1,
    material: 'gloss',
    img: null, src: null,
    text: 'TEXT',
    font: 'Arial Black',
    fontSize: 160,
    textColor: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 0,
    italic: false,
    letterSpacing: 0,
    curve: 0,          // arc bend in degrees; 0 = straight, + arches up, − arches down
    fx: null,          // optional layer effects (stroke/shadow/glow)
    x: SIZE / 2,
    y: SIZE / 2,
    scale: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    flipH: false,
    flipV: false,
  };
  regenerateText(layer);
  return layer;
}

// re-rasterize after any text property change; the canvas is sized to the
// text so the layer's center (x, y) stays put
export function regenerateText(layer) {
  const lines = String(layer.text ?? '').split('\n');
  const size = Math.max(40, Math.min(400, layer.fontSize || 160));
  const outline = Math.max(0, Math.min(30, layer.outlineWidth || 0));
  const fontStr = `${layer.italic ? 'italic ' : ''}${size}px "${layer.font || 'Arial Black'}"`;
  const spacing = `${Math.max(0, Math.min(40, layer.letterSpacing || 0))}px`;
  const lineH = size * 1.2;
  const curve = Math.max(-180, Math.min(180, Number(layer.curve) || 0));
  const margin = Math.ceil(outline) + Math.ceil(size * 0.15); // outline + italic overhang
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!curve) {
    // straight text — original rendering path
    ctx.font = fontStr;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing;
    const maxW = Math.max(1, ...lines.map(t => ctx.measureText(t).width));
    c.width = Math.ceil(maxW) + margin * 2;
    c.height = Math.ceil(lineH * lines.length) + margin * 2;
    // resizing reset the context — set everything again
    ctx.font = fontStr;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.fillStyle = layer.textColor || '#ffffff';
    ctx.strokeStyle = layer.outlineColor || '#000000';
    ctx.lineWidth = outline * 2; // half the stroke falls outside the glyph
    lines.forEach((line, i) => {
      const y = margin + lineH * (i + 0.5);
      if (outline > 0) ctx.strokeText(line, c.width / 2, y);
      ctx.fillText(line, c.width / 2, y);
    });
  } else {
    // curved text — glyphs laid glyph-by-glyph along a circular arc whose
    // total angle is `curve` degrees. Positive arches upward (bends along the
    // top of a circle), negative arches downward. Letter-spacing gaps are
    // inserted manually between glyphs so measurement stays exact.
    const spacingPx = Math.max(0, Math.min(40, layer.letterSpacing || 0));
    const theta = Math.abs(curve) * Math.PI / 180;
    const dir = curve > 0 ? 1 : -1;
    ctx.font = fontStr;
    const lineData = lines.map(text => {
      const chars = Array.from(text);
      const widths = chars.map(ch => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + spacingPx * Math.max(0, chars.length - 1);
      return { chars, widths, total };
    });
    // arc bounding box: chord extent horizontally, sagitta (arc rise) vertically
    let maxW = 1, maxSag = 0;
    for (const ld of lineData) {
      const R = Math.max(ld.total, 1) / theta;
      const half = theta / 2;
      const xExt = (half >= Math.PI / 2 ? R : R * Math.sin(half)) + size;
      const sag = R * (1 - Math.cos(Math.min(half, Math.PI)));
      maxW = Math.max(maxW, xExt * 2);
      maxSag = Math.max(maxSag, sag);
    }
    c.width = Math.ceil(maxW) + margin * 2;
    c.height = Math.ceil(lineH * lines.length + maxSag) + margin * 2;
    // resizing reset the context — set everything again
    ctx.font = fontStr;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; // gaps applied manually
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.fillStyle = layer.textColor || '#ffffff';
    ctx.strokeStyle = layer.outlineColor || '#000000';
    ctx.lineWidth = outline * 2; // half the stroke falls outside the glyph
    lineData.forEach((ld, i) => {
      if (!ld.chars.length) return;
      const R = Math.max(ld.total, 1) / theta;
      const sag = R * (1 - Math.cos(Math.min(theta / 2, Math.PI)));
      // center each line's arc vertically on its nominal line slot
      const lineY = margin + maxSag / 2 + lineH * (i + 0.5) - dir * sag / 2;
      let s = -ld.total / 2; // arc-length cursor from the line's midpoint
      ld.chars.forEach((ch, j) => {
        const phi = (s + ld.widths[j] / 2) / R; // signed angle from arc midpoint
        ctx.save();
        ctx.translate(c.width / 2 + R * Math.sin(phi), lineY + dir * R * (1 - Math.cos(phi)));
        ctx.rotate(dir * phi);
        if (outline > 0) ctx.strokeText(ch, 0, 0);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        s += ld.widths[j] + spacingPx;
      });
    });
  }
  layer.img = c;
  layer.src = c.toDataURL('image/png');
  delete layer._albedo; // shader-ball albedo cache is stale now
}

export function createPatternLayer(img, src, name) {
  return {
    id: newId(),
    type: 'pattern',
    name: name || 'pattern',
    visible: true,
    opacity: 1,
    material: 'gloss',
    img, src,
    x: 0,          // tile offset
    y: 0,
    scale: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    rx: 0, ry: 0, rw: SIZE, rh: SIZE,  // region the tiled fill covers
  };
}

// wand-selection pattern fill: tile `img` across the whole sheet, clipped to
// the alpha of a SIZE×SIZE selection mask, baked into a normal image layer
export function createMaskedPatternLayer(maskCanvas, img, name) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ctx.createPattern(img, 'repeat');
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const layer = createImageLayer(c, c.toDataURL('image/png'), name || 'pattern fill');
  // the canvas is already in doc space — undo createImageLayer's auto-fit
  layer.x = SIZE / 2;
  layer.y = SIZE / 2;
  layer.scale = 1;
  return layer;
}

// solid-color material patch — a resizable shape carrying its own color
// and material, so finishes (pearl, flake…) can be placed without an image
export function createFillLayer(color = '#e8e6e1') {
  return {
    id: newId(),
    type: 'fill',
    name: 'fill',
    visible: true,
    opacity: 1,
    material: 'gloss',
    color,
    shape: 'rect',         // rect | ellipse | triangle | diamond | stripe
    fillType: 'solid',     // solid | linear | radial
    color2: '#101114',     // gradient end color
    colorMid: null,        // optional third gradient stop (hex) — null = two-stop
    midPos: 0.5,           // mid stop position 0–1
    gradAngle: 0,          // linear gradient angle in degrees, 0 = left → right
    x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false,
    rx: SIZE / 2 - 300, ry: SIZE / 2 - 200, rw: 600, rh: 400,
  };
}

// shape silhouette for a fill layer, built inside an arbitrary rect (the
// layer's region, or a thumbnail box)
export function fillShapePath(shape, rx, ry, rw, rh) {
  const p = new Path2D();
  switch (shape) {
    case 'ellipse':
      p.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle': // isoceles, pointing up
      p.moveTo(rx + rw / 2, ry);
      p.lineTo(rx + rw, ry + rh);
      p.lineTo(rx, ry + rh);
      p.closePath();
      break;
    case 'diamond':
      p.moveTo(rx + rw / 2, ry);
      p.lineTo(rx + rw, ry + rh / 2);
      p.lineTo(rx + rw / 2, ry + rh);
      p.lineTo(rx, ry + rh / 2);
      p.closePath();
      break;
    case 'stripe': { // parallelogram slanted 45°, clamped to stay in the region
      const sh = Math.min(rh, rw);
      p.moveTo(rx + sh, ry);
      p.lineTo(rx + rw, ry);
      p.lineTo(rx + rw - sh, ry + rh);
      p.lineTo(rx, ry + rh);
      p.closePath();
      break;
    }
    default:
      p.rect(rx, ry, rw, rh);
  }
  return p;
}

// solid color or a color → color2 gradient spanning the given rect
export function fillPaintStyle(ctx, layer, rx, ry, rw, rh) {
  const color = layer.color || '#ffffff';
  if ((layer.fillType || 'solid') === 'solid') return color;
  const cx = rx + rw / 2, cy = ry + rh / 2;
  let g;
  if (layer.fillType === 'radial') {
    // region center out to the farthest corner
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(rw, rh) / 2);
  } else {
    const a = (layer.gradAngle || 0) * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(dx) * rw + Math.abs(dy) * rh) / 2;
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  g.addColorStop(0, color);
  if (layer.colorMid) {
    const mid = Math.max(0.02, Math.min(0.98, layer.midPos ?? 0.5));
    g.addColorStop(mid, layer.colorMid);
  }
  g.addColorStop(1, layer.color2 || '#101114');
  return g;
}

export const isRegionLayer = (l) => l.type === 'pattern' || l.type === 'fill';

// Paint blend modes — separable modes only: on a transparent backdrop they
// degrade to plain source-over, so the spec-map silhouette pass (which draws
// each layer onto an empty scratch canvas) is unaffected by a layer's blend.
export const BLEND_MODES = {
  normal: { label: 'Normal', op: 'source-over' },
  multiply: { label: 'Multiply', op: 'multiply' },
  screen: { label: 'Screen', op: 'screen' },
  overlay: { label: 'Overlay', op: 'overlay' },
  'soft-light': { label: 'Soft light', op: 'soft-light' },
};

// ---------- compositing ----------

const paintCanvas = document.createElement('canvas');
paintCanvas.width = paintCanvas.height = SIZE;
const specCanvas = document.createElement('canvas');
specCanvas.width = specCanvas.height = SIZE;
const scratch = document.createElement('canvas');
scratch.width = scratch.height = SIZE;
// dedicated fx scratch canvases — drawLayer is itself called with `scratch`
// as the target (applyTint, renderSpec), so effects need their own buffers
const fxScratch = document.createElement('canvas');
fxScratch.width = fxScratch.height = SIZE;
const fxTint = document.createElement('canvas');
fxTint.width = fxTint.height = SIZE;

// the layer's own pixels, without opacity/blend/effects
function drawLayerContent(ctx, layer) {
  if (layer.type === 'fill') {
    const rx = layer.rx ?? 0, ry = layer.ry ?? 0, rw = layer.rw ?? SIZE, rh = layer.rh ?? SIZE;
    ctx.fillStyle = fillPaintStyle(ctx, layer, rx, ry, rw, rh);
    ctx.fill(fillShapePath(layer.shape, rx, ry, rw, rh));
  } else if (layer.type === 'pattern') {
    // tiling fill across a region (seamless textures, e.g. SimTex Pro)
    const pat = ctx.createPattern(layer.img, 'repeat');
    pat.setTransform(new DOMMatrix()
      .translate(layer.x, layer.y)
      .rotate(layer.rotation)
      .scale(layer.scale * (layer.flipH ? -1 : 1), layer.scale * (layer.flipV ? -1 : 1)));
    ctx.fillStyle = pat;
    ctx.fillRect(layer.rx ?? 0, layer.ry ?? 0, layer.rw ?? SIZE, layer.rh ?? SIZE);
  } else {
    ctx.save();
    const m = layerMatrix(layer);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(layer.img, -layer.img.width / 2, -layer.img.height / 2);
    ctx.restore();
  }
}

function drawLayer(ctx, layer, forSpec = false) {
  // layer effects apply only to raster layers (image/text). Stroke changes
  // the design silhouette so it renders in both paint and spec passes;
  // shadow and glow are paint-only cosmetics.
  const fx = layer.fx;
  const hasImgFx = fx && layer.img && (layer.type === 'image' || layer.type === 'text');
  const doStroke = hasImgFx && fx.strokeW > 0;
  const doShadow = hasImgFx && !forSpec && fx.shadow > 0;
  const doGlow = hasImgFx && !forSpec && fx.glow > 0;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = (BLEND_MODES[layer.blend] || BLEND_MODES.normal).op;
  if (!doStroke && !doShadow && !doGlow) {
    drawLayerContent(ctx, layer);
    ctx.restore();
    return;
  }
  // render the transformed layer once into a doc-space buffer, then stamp
  // effects (bottom → top: shadow, glow, stroke) beneath the layer itself
  const rctx = fxScratch.getContext('2d');
  rctx.clearRect(0, 0, SIZE, SIZE);
  drawLayerContent(rctx, layer);
  if (doShadow) {
    // draw the buffer fully off-canvas and let the shadow land in view
    ctx.save();
    ctx.shadowColor = fx.shadowColor || '#000000';
    ctx.shadowBlur = Math.max(0, Math.min(60, fx.shadow));
    ctx.shadowOffsetX = SIZE + (fx.shadowDX ?? 8);
    ctx.shadowOffsetY = fx.shadowDY ?? 8;
    ctx.drawImage(fxScratch, -SIZE, 0);
    ctx.restore();
  }
  if (doGlow) {
    ctx.save();
    ctx.shadowColor = fx.glowColor || '#ffffff';
    ctx.shadowBlur = Math.max(1, Math.min(60, fx.glow));
    ctx.shadowOffsetX = SIZE; // zero net offset — glow sits behind the layer
    ctx.shadowOffsetY = 0;
    for (let i = 0; i < 3; i++) ctx.drawImage(fxScratch, -SIZE, 0); // stamped for intensity
    ctx.restore();
  }
  if (doStroke) {
    const w = Math.max(0, Math.min(40, fx.strokeW));
    // silhouette tinted with the stroke color (applyTint's source-in trick)
    const tctx = fxTint.getContext('2d');
    tctx.clearRect(0, 0, SIZE, SIZE);
    tctx.save();
    tctx.drawImage(fxScratch, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = fx.strokeColor || '#000000';
    tctx.fillRect(0, 0, SIZE, SIZE);
    tctx.restore();
    // stamp around a circle; intermediate radii close gaps on wide strokes
    const radii = w > 12 ? [w, w * 2 / 3, w / 3] : w > 4 ? [w, w / 2] : [w];
    const steps = Math.max(12, Math.ceil(w * 1.5));
    for (const r of radii) {
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        ctx.drawImage(fxTint, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
  }
  ctx.drawImage(fxScratch, 0, 0);
  ctx.restore();
}

export function mixHex(hexA, hexB, t) {
  const a = [1, 3, 5].map(i => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map(i => parseInt(hexB.slice(i, i + 2), 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// material tint: a color wash over the layer's paint — at high metallic the
// sim colors reflections from the paint underneath, so this is how you shift
// what a pearl/candy/flake finish reads as (e.g. pearl drifting warm/yellow
// under showroom lighting → tint it cool).
function applyTint(ctx, layer) {
  const p = layer.matParams;
  const amt = (p?.tintAmt || 0) / 100;
  if (!amt || !p.tint) return;
  const sctx = scratch.getContext('2d');
  sctx.clearRect(0, 0, SIZE, SIZE);
  drawLayer(sctx, layer, false);
  sctx.save();
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = p.tint;
  sctx.fillRect(0, 0, SIZE, SIZE);
  sctx.restore();
  ctx.save();
  ctx.globalAlpha = amt;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

// ghost material and "material only" layers exist solely in the spec map
function inPaintMap(layer) {
  return layer.visible && !(MATERIALS[layer.material] || {}).ghost && !layer.specOnly;
}

function paintBase(ctx, doc) {
  const bp = doc.baseMatParams;
  ctx.fillStyle = (bp?.tintAmt && bp.tint)
    ? mixHex(doc.baseColor, bp.tint, bp.tintAmt / 100)
    : doc.baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

function paintLayerInto(ctx, layer) {
  drawLayer(ctx, layer, false);
  applyTint(ctx, layer);
}

export function renderPaint(doc) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  paintBase(ctx, doc);
  for (const layer of doc.layers) {
    if (inPaintMap(layer)) paintLayerInto(ctx, layer);
  }
  return paintCanvas;
}

// ---------- drag composite cache ----------
// While layers are being dragged, everything beneath and above them is
// static. buildDragCache pre-renders those two slabs once; renderPaintWithDrag
// then draws slab → moving layers → slab per frame instead of recompositing
// the whole stack. Returns null (caller falls back to renderPaint) when the
// moving layers aren't a contiguous run of the paint-visible stack, or when a
// layer above them uses a blend mode — a blended layer baked against a
// transparent backdrop wouldn't composite the same as against real paint.

const dragBelow = document.createElement('canvas');
dragBelow.width = dragBelow.height = SIZE;
const dragAbove = document.createElement('canvas');
dragAbove.width = dragAbove.height = SIZE;

export function buildDragCache(doc, movingIds) {
  const idxs = [];
  doc.layers.forEach((l, i) => { if (movingIds.has(l.id)) idxs.push(i); });
  if (!idxs.length) return null;
  const lo = idxs[0], hi = idxs[idxs.length - 1];
  for (let i = lo; i <= hi; i++) {
    const l = doc.layers[i];
    if (!movingIds.has(l.id) && inPaintMap(l)) return null; // static layer interleaved
  }
  for (let i = hi + 1; i < doc.layers.length; i++) {
    const l = doc.layers[i];
    if (inPaintMap(l) && l.blend && l.blend !== 'normal') return null;
  }

  const bctx = dragBelow.getContext('2d');
  bctx.clearRect(0, 0, SIZE, SIZE);
  paintBase(bctx, doc);
  for (let i = 0; i < lo; i++) {
    if (inPaintMap(doc.layers[i])) paintLayerInto(bctx, doc.layers[i]);
  }
  const actx = dragAbove.getContext('2d');
  actx.clearRect(0, 0, SIZE, SIZE);
  for (let i = hi + 1; i < doc.layers.length; i++) {
    if (inPaintMap(doc.layers[i])) paintLayerInto(actx, doc.layers[i]);
  }
  return { movingIds };
}

export function renderPaintWithDrag(doc, cache) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(dragBelow, 0, 0);
  for (const layer of doc.layers) {
    if (cache.movingIds.has(layer.id) && inPaintMap(layer)) paintLayerInto(ctx, layer);
  }
  ctx.drawImage(dragAbove, 0, 0);
  return paintCanvas;
}

export function renderSpec(doc) {
  const ctx = specCanvas.getContext('2d');
  const base = MATERIALS[doc.baseMaterial] || MATERIALS.gloss;
  const baseP = resolveParams(doc.baseMaterial, doc.baseMatParams);
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (base.tex) {
    ctx.drawImage(specTexture(base.tex, baseP), 0, 0);
  } else {
    ctx.fillStyle = `rgb(${baseP.met},${baseP.rough},${baseP.clear})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  const sctx = scratch.getContext('2d');
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    // paint-only layers tint the color map but never stamp the spec — the
    // finish of whatever sits beneath them survives untouched
    if (layer.paintOnly) continue;
    const mat = MATERIALS[layer.material] || MATERIALS.gloss;
    const p = resolveParams(layer.material, layer.matParams);
    // paint the layer's silhouette, then fill it with the material —
    // flat channel values, or a procedural micro-texture for tex materials
    sctx.clearRect(0, 0, SIZE, SIZE);
    drawLayer(sctx, layer, true); // silhouette pass — stroke fx included, shadow/glow not
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    if (mat.tex) {
      sctx.drawImage(specTexture(mat.tex, p), 0, 0);
    } else {
      sctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
      sctx.fillRect(0, 0, SIZE, SIZE);
    }
    sctx.restore();
    // spec stacking: Replace overwrites, Add brightens channels where layers
    // overlap (compound coats), Multiply darkens
    ctx.save();
    ctx.globalCompositeOperation =
      layer.specBlend === 'add' ? 'lighter' :
      layer.specBlend === 'multiply' ? 'multiply' : 'source-over';
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }
  return specCanvas;
}

// ---------- template overlay ----------

// Converts the template image into a recolored line overlay: "ink" (distance
// from white) becomes alpha, painted in the chosen color, optionally
// thickened. Cached — keyed on the template object's identity (a new load
// always creates a new object) plus the style settings.
let tplCache = { tpl: null, color: null, bold: null, canvas: null };

export function templateOverlay(doc) {
  if (!doc.template) return null;
  if (doc.templateColor === 'original') {
    return { img: doc.template.img, multiply: true };
  }
  if (tplCache.tpl === doc.template && tplCache.color === doc.templateColor
      && tplCache.bold === doc.templateBold) {
    return { img: tplCache.canvas, multiply: false };
  }

  const img = doc.template.img;
  const w = img.width, h = img.height;
  const work = document.createElement('canvas');
  work.width = w; work.height = h;
  const wctx = work.getContext('2d');
  wctx.drawImage(img, 0, 0);
  const data = wctx.getImageData(0, 0, w, h);
  const px = data.data;

  const tint = doc.templateColor;
  const tr = parseInt(tint.slice(1, 3), 16);
  const tg = parseInt(tint.slice(3, 5), 16);
  const tb = parseInt(tint.slice(5, 7), 16);
  for (let i = 0; i < px.length; i += 4) {
    // ink = how far the pixel is from pure white, scaled by its own alpha
    const ink = (255 - Math.min(px[i], px[i + 1], px[i + 2])) * (px[i + 3] / 255);
    px[i] = tr; px[i + 1] = tg; px[i + 2] = tb;
    px[i + 3] = ink;
  }
  wctx.putImageData(data, 0, 0);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const offsets = doc.templateBold
    ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
    : [[0, 0]];
  for (const [dx, dy] of offsets) octx.drawImage(work, dx, dy);

  tplCache = { tpl: doc.template, color: doc.templateColor, bold: doc.templateBold, canvas: out };
  return { img: out, multiply: false };
}

// ---------- hit testing ----------

// Downsampled per-layer alpha map for hit testing — cached on the layer and
// invalidated by img reference, so re-rasterized text layers refresh
// automatically. Never serialized (serializeDoc whitelists fields).
const HIT_MAX = 256;

function layerHitData(l) {
  if (l._hit && l._hit.img === l.img) return l._hit;
  try {
    const s = Math.min(1, HIT_MAX / Math.max(l.img.width, l.img.height));
    const w = Math.max(1, Math.round(l.img.width * s));
    const h = Math.max(1, Math.round(l.img.height * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cctx = c.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(l.img, 0, 0, w, h);
    l._hit = { img: l.img, w, h, data: cctx.getImageData(0, 0, w, h).data };
  } catch {
    l._hit = { img: l.img, w: 0, h: 0, data: null }; // unreadable — treat as opaque
  }
  return l._hit;
}

// true when the layer has visible pixels at (or one sample around) a point in
// layer-local coords — so clicking a PNG's transparent corner falls through
function layerOpaqueAt(l, lx, ly) {
  const hd = layerHitData(l);
  if (!hd.data) return true;
  const px = Math.round((lx + l.img.width / 2) * (hd.w / l.img.width));
  const py = Math.round((ly + l.img.height / 2) * (hd.h / l.img.height));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= hd.w || y >= hd.h) continue;
      if (hd.data[(y * hd.w + x) * 4 + 3] > 12) return true;
    }
  }
  return false;
}

// all layers under a doc-space point, in selection-priority order: image
// layers top-down first (so region fills never block logo dragging), then
// pattern/fill regions top-down
export function hitTestAll(doc, px, py) {
  const hits = [];
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible || l.locked || isRegionLayer(l)) continue;
    const local = toLocal(l, px, py);
    if (Math.abs(local.x) <= l.img.width / 2 && Math.abs(local.y) <= l.img.height / 2
        && layerOpaqueAt(l, local.x, local.y)) {
      hits.push(l);
    }
  }
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible || l.locked || !isRegionLayer(l)) continue;
    if (px >= l.rx && px <= l.rx + l.rw && py >= l.ry && py <= l.ry + l.rh) hits.push(l);
  }
  return hits;
}

export function hitTest(doc, px, py) {
  return hitTestAll(doc, px, py)[0] || null;
}

export function toLocal(layer, px, py) {
  const pt = layerMatrix(layer).inverse().transformPoint(new DOMPoint(px, py));
  return { x: pt.x, y: pt.y };
}

// corner positions of a layer in doc space (for selection box / handles)
export function layerCorners(layer) {
  if (isRegionLayer(layer)) {
    const { rx = 0, ry = 0, rw = SIZE, rh = SIZE } = layer;
    return [{ x: rx, y: ry }, { x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }];
  }
  const hw = layer.img.width / 2;
  const hh = layer.img.height / 2;
  const m = layerMatrix(layer);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
    const pt = m.transformPoint(new DOMPoint(x, y));
    return { x: pt.x, y: pt.y };
  });
}

// ---------- (de)serialization ----------

export function serializeDoc(doc) {
  return {
    format: 'clearcoat/1',
    name: doc.name,
    target: doc.target,
    customNumber: !!doc.customNumber,
    baseColor: doc.baseColor,
    baseMaterial: doc.baseMaterial,
    baseMatParams: doc.baseMatParams || null,
    templateOpacity: doc.templateOpacity,
    templateColor: doc.templateColor,
    templateBold: doc.templateBold,
    template: doc.template ? doc.template.src : null,
    customFonts: (doc.customFonts || []).map(f => ({ name: f.name, data: f.data })),
    regionMap: doc.regionMap || null,
    layers: doc.layers.map(l => ({
      id: l.id, type: l.type, name: l.name,
      visible: l.visible, locked: !!l.locked, opacity: l.opacity, material: l.material,
      blend: l.blend || 'normal',
      matParams: l.matParams || null,
      specBlend: l.specBlend || 'replace',
      specOnly: !!l.specOnly,
      paintOnly: !!l.paintOnly,
      fx: l.fx || null,
      color: l.color,
      shape: l.shape, fillType: l.fillType, color2: l.color2, gradAngle: l.gradAngle,
      colorMid: l.colorMid ?? null, midPos: l.midPos ?? 0.5,
      src: l.src,
      text: l.text, font: l.font, fontSize: l.fontSize,
      textColor: l.textColor, outlineColor: l.outlineColor, outlineWidth: l.outlineWidth,
      italic: l.italic, letterSpacing: l.letterSpacing,
      curve: l.curve || 0,
      x: l.x, y: l.y, scale: l.scale, rotation: l.rotation,
      skewX: l.skewX || 0, skewY: l.skewY || 0,
      flipH: l.flipH, flipV: l.flipV,
      rx: l.rx, ry: l.ry, rw: l.rw, rh: l.rh,
    })),
  };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

// restore a saved fx block, coercing missing sub-fields to the UI defaults
function normalizeFx(fx) {
  if (!fx || typeof fx !== 'object') return null;
  return {
    strokeW: fx.strokeW ?? 0,
    strokeColor: fx.strokeColor || '#000000',
    shadow: fx.shadow ?? 0,
    shadowDX: fx.shadowDX ?? 8,
    shadowDY: fx.shadowDY ?? 8,
    shadowColor: fx.shadowColor || '#000000',
    glow: fx.glow ?? 0,
    glowColor: fx.glowColor || '#ffffff',
  };
}

export async function deserializeDoc(data) {
  const doc = createDoc();
  doc.name = data.name || doc.name;
  doc.target = ['car', 'helmet', 'suit'].includes(data.target) ? data.target : 'car';
  doc.customNumber = !!data.customNumber;
  doc.baseColor = data.baseColor || doc.baseColor;
  doc.baseMaterial = data.baseMaterial || doc.baseMaterial;
  doc.baseMatParams = data.baseMatParams || null;
  doc.templateOpacity = data.templateOpacity ?? doc.templateOpacity;
  doc.templateColor = data.templateColor || doc.templateColor;
  doc.templateBold = data.templateBold ?? doc.templateBold;
  if (data.template) {
    try {
      doc.template = { img: await loadImage(data.template), src: data.template };
    } catch { /* template image failed — drop it */ }
  }
  if (data.regionMap) {
    try {
      doc.regionMap = parseRegionMap(data.regionMap);
    } catch { /* bad region map — drop it */ }
  }
  // custom fonts must be live before text layers regenerate below
  doc.fontWarnings = [];
  for (const f of (data.customFonts || [])) {
    if (!f || !f.name || !f.data) continue;
    doc.customFonts.push({ name: f.name, data: f.data }); // keep the data even if it fails — don't lose it on resave
    try {
      await registerCustomFont(f.name, f.data);
    } catch {
      doc.fontWarnings.push(f.name); // bad font — its text falls back to a default face
    }
  }
  for (const l of (data.layers || [])) {
    try {
      if (l.type === 'fill') {
        doc.layers.push({
          ...createFillLayer(l.color || '#e8e6e1'),
          id: l.id || newId(), name: l.name || 'fill',
          visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1,
          material: l.material || 'gloss',
          blend: BLEND_MODES[l.blend] ? l.blend : 'normal',
          matParams: l.matParams || null,
          specBlend: l.specBlend || 'replace',
          specOnly: !!l.specOnly,
          paintOnly: !!l.paintOnly,
          shape: l.shape || 'rect',
          fillType: l.fillType || 'solid',
          color2: l.color2 || '#101114',
          colorMid: l.colorMid || null,
          midPos: l.midPos ?? 0.5,
          gradAngle: l.gradAngle ?? 0,
          rx: l.rx ?? 0, ry: l.ry ?? 0, rw: l.rw ?? SIZE, rh: l.rh ?? SIZE,
        });
        continue;
      }
      if (l.type === 'text') {
        const layer = {
          id: l.id || newId(), type: 'text', name: l.name || 'text',
          visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1,
          material: l.material || 'gloss',
          blend: BLEND_MODES[l.blend] ? l.blend : 'normal',
          matParams: l.matParams || null,
          specBlend: l.specBlend || 'replace',
          specOnly: !!l.specOnly,
          paintOnly: !!l.paintOnly,
          img: null, src: l.src || null,
          text: l.text ?? 'TEXT', font: l.font || 'Arial Black',
          fontSize: l.fontSize ?? 160,
          textColor: l.textColor || '#ffffff',
          outlineColor: l.outlineColor || '#000000',
          outlineWidth: l.outlineWidth ?? 0,
          italic: !!l.italic, letterSpacing: l.letterSpacing ?? 0,
          curve: l.curve ?? 0,
          fx: normalizeFx(l.fx),
          x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
          scale: l.scale ?? 1, rotation: l.rotation ?? 0,
          skewX: l.skewX ?? 0, skewY: l.skewY ?? 0,
          flipH: !!l.flipH, flipV: !!l.flipV,
        };
        try {
          regenerateText(layer);
          doc.layers.push(layer);
          continue;
        } catch { /* regeneration failed — fall through to the saved raster */ }
      }
      const img = await loadImage(l.src);
      doc.layers.push({
        id: l.id || newId(),
        type: l.type === 'pattern' ? 'pattern' : 'image',
        name: l.name || 'image',
        visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1,
        material: l.material || 'gloss',
        blend: BLEND_MODES[l.blend] ? l.blend : 'normal',
        matParams: l.matParams || null,
        specBlend: l.specBlend || 'replace',
        specOnly: !!l.specOnly,
        paintOnly: !!l.paintOnly,
        fx: normalizeFx(l.fx),
        img, src: l.src,
        x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
        scale: l.scale ?? 1, rotation: l.rotation ?? 0,
        skewX: l.skewX ?? 0, skewY: l.skewY ?? 0,
        flipH: !!l.flipH, flipV: !!l.flipV,
        rx: l.rx ?? 0, ry: l.ry ?? 0, rw: l.rw ?? SIZE, rh: l.rh ?? SIZE,
      });
    } catch { /* skip broken layer */ }
  }
  return doc;
}
