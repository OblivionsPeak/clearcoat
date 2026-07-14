// Shader ball — renders the material swatches as actual shaded spheres using
// the material's spec channel values and the current paint color, so the
// picker shows (approximately) what the finish does to *your* color.

import { MATERIALS, specTexture, resolveParams } from './engine.js';

const BALL = 56; // canvas px — swatches display at 28 CSS px (2x for sharpness)

// Per-material 56² spec sample: flat channel values, or the procedural
// micro-texture downsampled with nearest-neighbour so flake speckle survives.
const specSamples = new Map();
function specSample(key, p) {
  const cacheKey = `${key}|${p.met}|${p.rough}|${p.clear}|${p.scale || 0}|${p.density || 0}|${p.contrast || 0}`;
  if (specSamples.has(cacheKey)) return specSamples.get(cacheKey);
  if (specSamples.size > 24) specSamples.clear();
  const mat = MATERIALS[key];
  const c = document.createElement('canvas');
  c.width = c.height = BALL;
  const ctx = c.getContext('2d');
  if (mat.tex) {
    ctx.imageSmoothingEnabled = false;
    // sample a small crop so per-pixel detail isn't averaged away
    ctx.drawImage(specTexture(mat.tex, p), 0, 0, BALL * 4, BALL * 4, 0, 0, BALL, BALL);
  } else {
    ctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
    ctx.fillRect(0, 0, BALL, BALL);
  }
  const data = ctx.getImageData(0, 0, BALL, BALL).data;
  specSamples.set(cacheKey, data);
  return data;
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

// key light upper-left, faint rim lower-right
const L1 = normalize([-0.5, -0.6, 0.62]);
const L2 = normalize([0.45, 0.55, 0.35]);
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

// `params` overrides the material's default recipe (per-layer fine-tuning);
// pass null to render the preset.
export function renderBall(canvas, materialKey, albedoHex, params = null) {
  canvas.width = canvas.height = BALL;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(BALL, BALL);
  const d = out.data;
  const spec = specSample(materialKey, params || resolveParams(materialKey, null));
  const albedo = hexToRgb(albedoHex);
  const ghost = !!MATERIALS[materialKey].ghost;
  const neon = materialKey === 'neon';
  const R = BALL / 2 - 1;

  for (let y = 0; y < BALL; y++) {
    for (let x = 0; x < BALL; x++) {
      const i = (y * BALL + x) * 4;
      const nx = (x - BALL / 2 + 0.5) / R;
      const ny = (y - BALL / 2 + 0.5) / R;
      const rr = nx * nx + ny * ny;
      if (rr > 1) { d[i + 3] = 0; continue; }
      const nz = Math.sqrt(1 - rr);

      const metallic = spec[i] / 255;
      const roughness = spec[i + 1] / 255;
      const clearcoat = spec[i + 2] / 255;
      const shininess = 4 + 252 * (1 - roughness) * (1 - roughness);

      // ghost layers carry no paint — show the finish on a neutral dark base
      const alb = ghost ? [0.16, 0.17, 0.19] : albedo;
      const specCol = [
        1 + (alb[0] - 1) * metallic,
        1 + (alb[1] - 1) * metallic,
        1 + (alb[2] - 1) * metallic,
      ];

      let r = 0, g = 0, b = 0;
      // neon is self-lit: strong albedo-colored emission that fades toward
      // the rim, so the ball reads as glowing rather than merely glossy
      if (neon) {
        const em = 0.85 * (0.55 + 0.45 * nz);
        r += alb[0] * em; g += alb[1] * em; b += alb[2] * em;
      }
      for (const [light, kDiff, kSpec] of [[L1, 0.7, 1.0], [L2, 0.18, 0.35]]) {
        const ndl = Math.max(0, nz * light[2] + nx * light[0] + ny * light[1]);
        // Blinn half vector with view = (0,0,1)
        const h = normalize([light[0], light[1], light[2] + 1]);
        const ndh = Math.max(0, nx * h[0] + ny * h[1] + nz * h[2]);
        const specAmt = Math.pow(ndh, shininess) * (0.25 + clearcoat * 0.9 + metallic * 0.35) * kSpec;
        const diff = (0.22 + ndl * kDiff) * (1 - metallic * 0.55);
        r += alb[0] * diff + specCol[0] * specAmt;
        g += alb[1] * diff + specCol[1] * specAmt;
        b += alb[2] * diff + specCol[2] * specAmt;
      }

      // gentle tonemap to keep chrome highlights from clipping flat
      d[i]     = Math.min(255, (r / (1 + r * 0.12)) * 255);
      d[i + 1] = Math.min(255, (g / (1 + g * 0.12)) * 255);
      d[i + 2] = Math.min(255, (b / (1 + b * 0.12)) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// Average color of a layer image — what the ball uses as albedo for image
// layers. Cached on the layer object.
export function layerAlbedo(layer, fallback = '#9aa0ab') {
  if (layer && layer.type === 'fill') return layer.color || fallback;
  if (!layer || !layer.img) return fallback;
  if (layer._albedo) return layer._albedo;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(layer.img, 0, 0, 8, 8);
    const px = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < px.length; i += 4) {
      const w = px[i + 3] / 255;
      r += px[i] * w; g += px[i + 1] * w; b += px[i + 2] * w; a += w;
    }
    if (a < 0.5) return fallback;
    const hex = (v) => Math.round(v / a).toString(16).padStart(2, '0');
    layer._albedo = '#' + hex(r) + hex(g) + hex(b);
    return layer._albedo;
  } catch {
    return fallback;
  }
}
