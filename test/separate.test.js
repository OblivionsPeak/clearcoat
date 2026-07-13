import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPalette, splitByPalette } from '../js/separate.js';

// Build a raster where the left half is one color and the right half another,
// with an optional transparent band.
function raster(w, h, painter) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = painter(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return data;
}

test('detectPalette finds two dominant colors, largest first', () => {
  // 64x64: 3/4 red, 1/4 blue — step 1 so the tiny raster is fully sampled
  const data = raster(64, 64, (x) => x < 48 ? [200, 20, 20, 255] : [20, 20, 200, 255]);
  const pal = detectPalette(data, { step: 1 });
  assert.equal(pal.length, 2);
  assert.ok(pal[0].r > 150 && pal[0].b < 60, 'largest color is the red');
  assert.ok(pal[1].b > 150 && pal[1].r < 60, 'second color is the blue');
  assert.ok(pal[0].count > pal[1].count);
});

test('detectPalette merges near-duplicates and drops sub-minShare specks', () => {
  const data = raster(64, 64, (x, y) => {
    if (y < 2) return [255, 255, 0, 255];        // ~3% yellow — kept at default minShare
    if (x === 0 && y === 2) return [0, 255, 0, 255]; // one green pixel — dropped
    return x < 32 ? [100, 100, 100, 255] : [104, 98, 102, 255]; // two near-grays — merged
  });
  const pal = detectPalette(data, { step: 1 });
  assert.equal(pal.length, 2); // gray + yellow, no green, no second gray
});

test('detectPalette ignores transparent pixels; empty raster gives empty palette', () => {
  const clear = raster(16, 16, () => [255, 0, 0, 0]);
  assert.deepEqual(detectPalette(clear, { step: 1 }), []);
});

test('splitByPalette assigns every opaque pixel to exactly one part, preserving RGBA', () => {
  const data = raster(32, 32, (x, y) =>
    y < 8 ? [0, 0, 0, 0] : x < 16 ? [210, 30, 30, 255] : [30, 30, 210, 200]);
  const pal = detectPalette(data, { step: 1 });
  const parts = splitByPalette(data, pal);
  assert.equal(parts.length, 2);
  const opaque = 32 * 24;
  assert.equal(parts[0].count + parts[1].count, opaque);
  assert.match(parts[0].color, /^#[0-9a-f]{6}$/);
  // pixel (0, 20) is red — present in part 0, absent in part 1, alpha intact
  const i = (20 * 32 + 0) * 4;
  assert.equal(parts[0].data[i], 210);
  assert.equal(parts[0].data[i + 3], 255);
  assert.equal(parts[1].data[i + 3], 0);
  // the blue part keeps its partial alpha
  const j = (20 * 32 + 30) * 4;
  assert.equal(parts[1].data[j + 3], 200);
});

test('splitByPalette drops palette entries that win no pixels', () => {
  const data = raster(8, 8, () => [10, 200, 10, 255]);
  const parts = splitByPalette(data, [
    { r: 10, g: 200, b: 10 },
    { r: 255, g: 0, b: 255 }, // nothing is nearest to magenta here
  ]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].count, 64);
});
