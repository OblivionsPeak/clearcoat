// Color separation — detect the dominant palette of a raster and split it
// into one full-sheet raster per color, so a flat import (e.g. a baked TP
// paint) becomes independently editable color layers again.
//
// Pure functions over pixel arrays — no DOM. Canvas plumbing lives in main.js.

// 4-bit-per-channel histogram key
const binKey = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

// Detect up to maxColors dominant colors covering at least minShare of the
// opaque pixels. Returns [{ r, g, b, count }] sorted by coverage, largest
// first. Sampling every `step` pixels keeps a 2048² scan instant.
export function detectPalette(data, opts = {}) {
  const maxColors = opts.maxColors ?? 8;
  const minShare = opts.minShare ?? 0.01;
  const step = opts.step ?? 4;
  const bins = new Map();
  let total = 0;
  for (let p = 0; p < data.length; p += 4 * step) {
    if (data[p + 3] < 128) continue;
    total++;
    const key = binKey(data[p], data[p + 1], data[p + 2]);
    let b = bins.get(key);
    if (!b) bins.set(key, b = { count: 0, r: 0, g: 0, b: 0 });
    b.count++; b.r += data[p]; b.g += data[p + 1]; b.b += data[p + 2];
  }
  if (!total) return [];

  // biggest bins first; nearby bins fold into an existing palette color
  // (weighted) so anti-aliased ramps don't spawn phantom colors
  const cand = [...bins.values()]
    .map(b => ({ count: b.count, r: b.r / b.count, g: b.g / b.count, b: b.b / b.count }))
    .sort((a, b) => b.count - a.count);
  const MERGE2 = 44 * 44;
  const palette = [];
  for (const c of cand) {
    let near = null;
    for (const p of palette) {
      const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
      if (dr * dr + dg * dg + db * db <= MERGE2) { near = p; break; }
    }
    if (near) {
      const n = near.count + c.count;
      near.r = (near.r * near.count + c.r * c.count) / n;
      near.g = (near.g * near.count + c.g * c.count) / n;
      near.b = (near.b * near.count + c.b * c.count) / n;
      near.count = n;
    } else if (palette.length < maxColors * 2) {
      palette.push({ ...c }); // headroom so late merges can still land
    }
  }
  return palette
    .filter(p => p.count / total >= minShare)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map(p => ({ r: Math.round(p.r), g: Math.round(p.g), b: Math.round(p.b), count: p.count }));
}

const hex = (c) =>
  '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');

// Split a raster into one pixel array per palette color. Every opaque pixel
// is assigned to its NEAREST palette color — no gaps, no overlaps — and
// keeps its original RGBA, so anti-aliasing and shading inside each color
// region survive the split. Returns [{ color, data, count }] in palette
// order; entries that received no pixels are dropped.
export function splitByPalette(data, palette) {
  const parts = palette.map(() => new Uint8ClampedArray(data.length));
  const counts = new Array(palette.length).fill(0);
  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3];
    if (!a) continue;
    let best = 0, bd = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const dr = data[p] - palette[k].r;
      const dg = data[p + 1] - palette[k].g;
      const db = data[p + 2] - palette[k].b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = k; }
    }
    const out = parts[best];
    out[p] = data[p]; out[p + 1] = data[p + 1]; out[p + 2] = data[p + 2]; out[p + 3] = a;
    counts[best]++;
  }
  return palette
    .map((c, k) => ({ color: hex(c), data: parts[k], count: counts[k] }))
    .filter(part => part.count > 0);
}
