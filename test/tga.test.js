import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTGA, decodeTGA } from '../js/tga.js';

// 2x2 RGBA test image, rows top to bottom:
//   red        green
//   blue       white
const RGBA_2x2 = new Uint8ClampedArray([
  255, 0, 0, 255,   0, 255, 0, 255,
  0, 0, 255, 255,   255, 255, 255, 255,
]);

// Build a minimal TGA header for hand-crafted decode fixtures.
function header({ type = 2, w, h, bpp = 24, descriptor = 0x20, idLen = 0, cmapType = 0 }) {
  const hd = new Uint8Array(18);
  hd[0] = idLen;
  hd[1] = cmapType;
  hd[2] = type;
  hd[12] = w & 0xff;
  hd[13] = (w >> 8) & 0xff;
  hd[14] = h & 0xff;
  hd[15] = (h >> 8) & 0xff;
  hd[16] = bpp;
  hd[17] = descriptor;
  return hd;
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

test('encodeTGA 24-bit: header bytes, BGR order, top-left origin flag', () => {
  const out = encodeTGA(RGBA_2x2, 2, 2, { alpha: false });
  assert.ok(out instanceof Uint8Array);
  assert.equal(out.length, 18 + 2 * 2 * 3);
  assert.equal(out[0], 0);      // no image ID
  assert.equal(out[1], 0);      // no color map
  assert.equal(out[2], 2);      // uncompressed true-color
  assert.equal(out[12], 2);     // width lo
  assert.equal(out[13], 0);     // width hi
  assert.equal(out[14], 2);     // height lo
  assert.equal(out[15], 0);     // height hi
  assert.equal(out[16], 24);    // bpp
  assert.equal(out[17], 0x20);  // top-left origin, no alpha bits
  // first pixel is red → stored BGR = 0,0,255
  assert.deepEqual([...out.slice(18, 21)], [0, 0, 255]);
  // second pixel green → 0,255,0
  assert.deepEqual([...out.slice(21, 24)], [0, 255, 0]);
});

test('encodeTGA 32-bit: descriptor 0x28 and alpha forced to 255', () => {
  const src = new Uint8ClampedArray(RGBA_2x2);
  src[3] = 17; // non-opaque source alpha must be overwritten
  const out = encodeTGA(src, 2, 2, { alpha: true });
  assert.equal(out.length, 18 + 2 * 2 * 4);
  assert.equal(out[16], 32);
  assert.equal(out[17], 0x28);  // top-left origin + 8 alpha bits
  for (let p = 18; p < out.length; p += 4) {
    assert.equal(out[p + 3], 255);
  }
  // first pixel red → BGRA = 0,0,255,255
  assert.deepEqual([...out.slice(18, 22)], [0, 0, 255, 255]);
});

test('roundtrip encode→decode, 24-bit', () => {
  const buf = encodeTGA(RGBA_2x2, 2, 2, { alpha: false });
  const { width, height, rgba } = decodeTGA(buf.buffer);
  assert.equal(width, 2);
  assert.equal(height, 2);
  assert.ok(rgba instanceof Uint8ClampedArray);
  assert.deepEqual([...rgba], [...RGBA_2x2]);
});

test('roundtrip encode→decode, 32-bit', () => {
  const buf = encodeTGA(RGBA_2x2, 2, 2, { alpha: true });
  const { width, height, rgba } = decodeTGA(buf.buffer);
  assert.equal(width, 2);
  assert.equal(height, 2);
  assert.deepEqual([...rgba], [...RGBA_2x2]);
});

test('decodeTGA type-10 RLE: run packet + raw packet', () => {
  // 4x1, 24-bit, top-left origin.
  // Run packet: header 0x81 (run of 2), one BGR pixel = red.
  // Raw packet: header 0x01 (2 literal pixels): green, blue.
  const body = new Uint8Array([
    0x81, 0, 0, 255,          // run: 2× red
    0x01, 0, 255, 0,          // raw: green
    255, 0, 0,                //      blue
  ]);
  const buf = concat(header({ type: 10, w: 4, h: 1 }), body);
  const { width, height, rgba } = decodeTGA(buf);
  assert.equal(width, 4);
  assert.equal(height, 1);
  assert.deepEqual([...rgba], [
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
  ]);
});

test('decodeTGA bottom-left origin flips rows to top-left', () => {
  // 1x2, 24-bit, bottom-left origin (descriptor 0x00):
  // file rows bottom-up → first stored row is the BOTTOM row.
  const body = new Uint8Array([
    0, 0, 255,    // bottom row: red
    0, 255, 0,    // top row: green
  ]);
  const buf = concat(header({ type: 2, w: 1, h: 2, descriptor: 0x00 }), body);
  const { rgba } = decodeTGA(buf);
  assert.deepEqual([...rgba], [
    0, 255, 0, 255,   // top-left row is green
    255, 0, 0, 255,   // bottom row is red
  ]);
});

test('decodeTGA rejects unsupported images', () => {
  // color-mapped (type 1)
  assert.throws(
    () => decodeTGA(concat(header({ type: 1, w: 1, h: 1, cmapType: 1, bpp: 8 }), new Uint8Array(1))),
    /Unsupported TGA/,
  );
  // grayscale (type 3)
  assert.throws(
    () => decodeTGA(concat(header({ type: 3, w: 1, h: 1, bpp: 8 }), new Uint8Array(1))),
    /Unsupported TGA/,
  );
  // truecolor but 16bpp
  assert.throws(
    () => decodeTGA(concat(header({ type: 2, w: 1, h: 1, bpp: 16 }), new Uint8Array(2))),
    /Unsupported TGA/,
  );
});
