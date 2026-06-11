// Clearcoat render engine — document model, paint compositing, spec map generation.

export const SIZE = 2048;

// iRacing spec map convention: R = specular intensity, G = glossiness, B = metallic.
export const MATERIALS = {
  gloss:    { label: 'Gloss',    r: 130, g: 200, b: 0   },
  matte:    { label: 'Matte',    r: 40,  g: 40,  b: 0   },
  metallic: { label: 'Metallic', r: 170, g: 210, b: 160 },
  chrome:   { label: 'Chrome',   r: 255, g: 255, b: 255 },
};

let nextId = 1;
export function newId() { return 'L' + (nextId++) + '-' + Date.now().toString(36); }

export function createDoc() {
  return {
    name: 'untitled livery',
    baseColor: '#1a6cff',
    baseMaterial: 'gloss',
    layers: [],          // bottom → top; image layers only
    template: null,      // { img, src } — viewport reference only
    templateOpacity: 0.55,
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
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation * Math.PI / 180);
  ctx.scale(layer.scale * (layer.flipH ? -1 : 1), layer.scale * (layer.flipV ? -1 : 1));
  ctx.drawImage(layer.img, -layer.img.width / 2, -layer.img.height / 2);
  ctx.restore();
}

export function renderPaint(doc) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = doc.baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    drawLayer(ctx, layer);
  }
  return paintCanvas;
}

export function renderSpec(doc) {
  const ctx = specCanvas.getContext('2d');
  const base = MATERIALS[doc.baseMaterial] || MATERIALS.gloss;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const sctx = scratch.getContext('2d');
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const mat = MATERIALS[layer.material] || MATERIALS.gloss;
    // paint the layer's silhouette in its material color, then stamp it on
    sctx.clearRect(0, 0, SIZE, SIZE);
    drawLayer(sctx, layer);
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = `rgb(${mat.r},${mat.g},${mat.b})`;
    sctx.fillRect(0, 0, SIZE, SIZE);
    sctx.restore();
    ctx.drawImage(scratch, 0, 0);
  }
  return specCanvas;
}

// ---------- hit testing ----------

// returns topmost layer at doc-space point, or null
export function hitTest(doc, px, py) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible) continue;
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
    templateOpacity: doc.templateOpacity,
    template: doc.template ? doc.template.src : null,
    layers: doc.layers.map(l => ({
      id: l.id, type: l.type, name: l.name,
      visible: l.visible, opacity: l.opacity, material: l.material,
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
  doc.templateOpacity = data.templateOpacity ?? doc.templateOpacity;
  if (data.template) {
    try {
      doc.template = { img: await loadImage(data.template), src: data.template };
    } catch { /* template image failed — drop it */ }
  }
  for (const l of (data.layers || [])) {
    try {
      const img = await loadImage(l.src);
      doc.layers.push({
        id: l.id || newId(), type: 'image', name: l.name || 'image',
        visible: l.visible !== false, opacity: l.opacity ?? 1,
        material: l.material || 'gloss',
        img, src: l.src,
        x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
        scale: l.scale ?? 1, rotation: l.rotation ?? 0,
        flipH: !!l.flipH, flipV: !!l.flipV,
      });
    } catch { /* skip broken layer */ }
  }
  return doc;
}
