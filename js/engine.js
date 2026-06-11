// Clearcoat render engine — document model, paint compositing, spec map generation.

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
  flake:    { label: 'Flake',    tex: 'flake',   met: 160, rough: 45,  clear: 255, density: 18, contrast: 100 },
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
    baseColor: '#1a6cff',
    baseMaterial: 'gloss',
    baseMatParams: null,
    layers: [],          // bottom → top; image layers only
    template: null,      // { img, src } — viewport reference only
    templateOpacity: 0.75,
    templateColor: '#ffffff',   // recolor linework for contrast; 'original' = multiply as-is
    templateBold: true,         // thicken 1px linework
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
    img, src,
    x: SIZE / 2,
    y: SIZE / 2,
    scale: fit,
    rotation: 0,   // degrees
    flipH: false,
    flipV: false,
  };
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
  };
}

// ---------- compositing ----------

const paintCanvas = document.createElement('canvas');
paintCanvas.width = paintCanvas.height = SIZE;
const specCanvas = document.createElement('canvas');
specCanvas.width = specCanvas.height = SIZE;
const scratch = document.createElement('canvas');
scratch.width = scratch.height = SIZE;

function drawLayer(ctx, layer) {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  if (layer.type === 'pattern') {
    // tiling fill across the whole sheet (seamless textures, e.g. SimTex Pro)
    const pat = ctx.createPattern(layer.img, 'repeat');
    pat.setTransform(new DOMMatrix()
      .translate(layer.x, layer.y)
      .rotate(layer.rotation)
      .scale(layer.scale * (layer.flipH ? -1 : 1), layer.scale * (layer.flipV ? -1 : 1)));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, SIZE, SIZE);
  } else {
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.scale * (layer.flipH ? -1 : 1), layer.scale * (layer.flipV ? -1 : 1));
    ctx.drawImage(layer.img, -layer.img.width / 2, -layer.img.height / 2);
  }
  ctx.restore();
}

export function renderPaint(doc) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = doc.baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if ((MATERIALS[layer.material] || {}).ghost) continue; // spec-only layer
    drawLayer(ctx, layer);
  }
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
    const mat = MATERIALS[layer.material] || MATERIALS.gloss;
    const p = resolveParams(layer.material, layer.matParams);
    // paint the layer's silhouette, then fill it with the material —
    // flat channel values, or a procedural micro-texture for tex materials
    sctx.clearRect(0, 0, SIZE, SIZE);
    drawLayer(sctx, layer);
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    if (mat.tex) {
      sctx.drawImage(specTexture(mat.tex, p), 0, 0);
    } else {
      sctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
      sctx.fillRect(0, 0, SIZE, SIZE);
    }
    sctx.restore();
    ctx.drawImage(scratch, 0, 0);
  }
  return specCanvas;
}

// ---------- template overlay ----------

// Converts the template image into a recolored line overlay: "ink" (distance
// from white) becomes alpha, painted in the chosen color, optionally
// thickened. Cached — recomputed only when template/color/bold change.
let tplCache = { key: null, canvas: null };

export function templateOverlay(doc) {
  if (!doc.template) return null;
  if (doc.templateColor === 'original') {
    return { img: doc.template.img, multiply: true };
  }
  const key = `${doc.template.src.length}:${doc.templateColor}:${doc.templateBold}`;
  if (tplCache.key === key) return { img: tplCache.canvas, multiply: false };

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

  tplCache = { key, canvas: out };
  return { img: out, multiply: false };
}

// ---------- hit testing ----------

// returns topmost layer at doc-space point, or null
export function hitTest(doc, px, py) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible) continue;
    if (l.type === 'pattern') continue; // full-sheet fills — select via layer panel
    const local = toLocal(l, px, py);
    if (Math.abs(local.x) <= l.img.width / 2 && Math.abs(local.y) <= l.img.height / 2) {
      return l;
    }
  }
  return null;
}

export function toLocal(layer, px, py) {
  const dx = px - layer.x;
  const dy = py - layer.y;
  const rad = -layer.rotation * Math.PI / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return {
    x: rx / (layer.scale * (layer.flipH ? -1 : 1)),
    y: ry / (layer.scale * (layer.flipV ? -1 : 1)),
  };
}

// corner positions of a layer in doc space (for selection box / handles)
export function layerCorners(layer) {
  if (layer.type === 'pattern') {
    return [{ x: 0, y: 0 }, { x: SIZE, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }];
  }
  const hw = layer.img.width / 2 * layer.scale;
  const hh = layer.img.height / 2 * layer.scale;
  const rad = layer.rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return pts.map(([x, y]) => ({
    x: layer.x + x * cos - y * sin,
    y: layer.y + x * sin + y * cos,
  }));
}

// ---------- (de)serialization ----------

export function serializeDoc(doc) {
  return {
    format: 'clearcoat/1',
    name: doc.name,
    baseColor: doc.baseColor,
    baseMaterial: doc.baseMaterial,
    baseMatParams: doc.baseMatParams || null,
    templateOpacity: doc.templateOpacity,
    templateColor: doc.templateColor,
    templateBold: doc.templateBold,
    template: doc.template ? doc.template.src : null,
    layers: doc.layers.map(l => ({
      id: l.id, type: l.type, name: l.name,
      visible: l.visible, opacity: l.opacity, material: l.material,
      matParams: l.matParams || null,
      src: l.src,
      x: l.x, y: l.y, scale: l.scale, rotation: l.rotation,
      flipH: l.flipH, flipV: l.flipV,
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

export async function deserializeDoc(data) {
  const doc = createDoc();
  doc.name = data.name || doc.name;
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
  for (const l of (data.layers || [])) {
    try {
      const img = await loadImage(l.src);
      doc.layers.push({
        id: l.id || newId(),
        type: l.type === 'pattern' ? 'pattern' : 'image',
        name: l.name || 'image',
        visible: l.visible !== false, opacity: l.opacity ?? 1,
        material: l.material || 'gloss',
        matParams: l.matParams || null,
        img, src: l.src,
        x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
        scale: l.scale ?? 1, rotation: l.rotation ?? 0,
        flipH: !!l.flipH, flipV: !!l.flipV,
      });
    } catch { /* skip broken layer */ }
  }
  return doc;
}
