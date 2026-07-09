// Magic wand — color-based selection over the composited paint.
// Click → contiguous flood fill from that pixel; global mode → every pixel
// on the sheet matching the sampled color. The result is a full-sheet alpha
// mask canvas, used as a "material only" layer so finishes apply to existing
// artwork without repainting it.

import { SIZE } from './engine.js';

// squared per-pixel color distance threshold from a 0-100 tolerance setting
function threshold(tolerance) {
  const t = tolerance * 2.2; // 0-100 → 0-220 channel distance
  return t * t * 3;
}

function matches(data, i, r0, g0, b0, t2) {
  const dr = data[i] - r0, dg = data[i + 1] - g0, db = data[i + 2] - b0;
  return dr * dr + dg * dg + db * db <= t2;
}

// contiguous region (4-connected flood fill, iterative)
function floodMask(data, sx, sy, tolerance) {
  const w = SIZE, h = SIZE;
  const mask = new Uint8Array(w * h);
  const i0 = (sy * w + sx) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2];
  const t2 = threshold(tolerance);
  const stack = [sy * w + sx];
  mask[sy * w + sx] = 1;
  let count = 0;
  while (stack.length) {
    const p = stack.pop();
    count++;
    const x = p % w, y = (p - x) / w;
    if (x > 0     && !mask[p - 1] && matches(data, (p - 1) * 4, r0, g0, b0, t2)) { mask[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !mask[p + 1] && matches(data, (p + 1) * 4, r0, g0, b0, t2)) { mask[p + 1] = 1; stack.push(p + 1); }
    if (y > 0     && !mask[p - w] && matches(data, (p - w) * 4, r0, g0, b0, t2)) { mask[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !mask[p + w] && matches(data, (p + w) * 4, r0, g0, b0, t2)) { mask[p + w] = 1; stack.push(p + w); }
  }
  return { mask, count };
}

// every matching pixel on the sheet, regardless of connectivity
function colorMask(data, sx, sy, tolerance) {
  const mask = new Uint8Array(SIZE * SIZE);
  const i0 = (sy * SIZE + sx) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2];
  const t2 = threshold(tolerance);
  let count = 0;
  for (let p = 0; p < mask.length; p++) {
    if (matches(data, p * 4, r0, g0, b0, t2)) { mask[p] = 1; count++; }
  }
  return { mask, count };
}

// binary erosion (4-neighbour): pulls the selection edge in by one pixel per
// pass, so adjacent selections on soft-gradient artwork stop fighting over
// the same boundary pixels (matte halos muting a pearl region, etc.)
function erode(mask, passes) {
  const w = SIZE, h = SIZE;
  let cur = mask;
  for (let n = 0; n < passes; n++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!cur[p]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1
            || !cur[p - 1] || !cur[p + 1] || !cur[p - w] || !cur[p + w]) {
          next[p] = 0;
        }
      }
    }
    cur = next;
  }
  return cur;
}

// Returns { src (PNG dataURL of the white-on-transparent mask), count, color }
// or null when nothing matched. paintCanvas is the 2048² composited paint.
// shrink: erosion passes (px) applied to the mask edge — 0 disables.
export function wandSelect(paintCanvas, x, y, tolerance, global, shrink = 0) {
  const sx = Math.max(0, Math.min(SIZE - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(SIZE - 1, Math.round(y)));
  const data = paintCanvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;

  let { mask, count } = global
    ? colorMask(data, sx, sy, tolerance)
    : floodMask(data, sx, sy, tolerance);
  if (!count) return null;
  if (shrink > 0) {
    mask = erode(mask, Math.min(6, shrink));
    count = 0;
    for (let p = 0; p < mask.length; p++) if (mask[p]) count++;
    if (!count) return null;
  }

  const i0 = (sy * SIZE + sx) * 4;
  const color = '#' + [data[i0], data[i0 + 1], data[i0 + 2]]
    .map(v => v.toString(16).padStart(2, '0')).join('');

  const raw = document.createElement('canvas');
  raw.width = raw.height = SIZE;
  const rctx = raw.getContext('2d');
  const img = rctx.createImageData(SIZE, SIZE);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) {
      const i = p * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 255;
    }
  }
  rctx.putImageData(img, 0, 0);

  // slight feather so the spec stamp doesn't alias along the selection edge
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const octx = out.getContext('2d');
  octx.filter = 'blur(0.6px)';
  octx.drawImage(raw, 0, 0);

  return { src: out.toDataURL('image/png'), count, color };
}
