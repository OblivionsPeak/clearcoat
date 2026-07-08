// Minimal TGA encoder — uncompressed BGR(A), top-left origin.
// Paints export as 24-bit; spec maps as 32-bit with the alpha channel forced
// to 255: iRacing reads spec alpha as "what percentage of metallic/roughness
// applies", so it must be explicit, not left to chance.

// Decode an uncompressed (type 2) or RLE (type 10) truecolor TGA into
// top-left-origin RGBA bytes — enough to read back paints written by
// iRacing/Trading Paints. Pure: no canvas, safe under node.
// `opaque` forces alpha to 255: iRacing/Trading Paints 32-bit car paints
// use the alpha channel as sim data (decal masks / legacy shine), NOT
// transparency — honoring it makes most of the livery invisible.
export function decodeTGA(buf, { opaque = false } = {}) {
  const d = new DataView(buf);
  const idLen = d.getUint8(0);
  const cmapType = d.getUint8(1);
  const type = d.getUint8(2);
  const w = d.getUint16(12, true);
  const h = d.getUint16(14, true);
  const bpp = d.getUint8(16);
  const topLeft = (d.getUint8(17) & 0x20) !== 0;
  if (cmapType !== 0 || (type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32)) {
    throw new Error(`Unsupported TGA (type ${type}, ${bpp}bpp)`);
  }

  const bytes = new Uint8Array(buf);
  const px = bpp / 8;
  let p = 18 + idLen;

  // decode into file row order first
  const flat = new Uint8ClampedArray(w * h * 4);
  let o = 0;
  const emit = () => {
    flat[o++] = bytes[p + 2];               // R
    flat[o++] = bytes[p + 1];               // G
    flat[o++] = bytes[p];                   // B
    flat[o++] = (px === 4 && !opaque) ? bytes[p + 3] : 255;
  };
  if (type === 2) {
    for (let i = 0; i < w * h; i++) { emit(); p += px; }
  } else {
    let i = 0;
    while (i < w * h) {
      const head = bytes[p++];
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {                    // run: one pixel repeated
        for (let k = 0; k < count; k++) emit();
        p += px;
      } else {                              // raw: count literal pixels
        for (let k = 0; k < count; k++) { emit(); p += px; }
      }
      i += count;
    }
  }

  // normalise to top-left row order
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcY = topLeft ? y : h - 1 - y;
    rgba.set(flat.subarray(srcY * w * 4, (srcY + 1) * w * 4), y * w * 4);
  }
  return { width: w, height: h, rgba };
}

export function tgaToCanvas(buf, opts) {
  const { width, height, rgba } = decodeTGA(buf, opts);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Encode top-left-origin RGBA bytes as an uncompressed (type 2) truecolor
// TGA. Alpha is forced to 255 in 32-bit output (full spec effect everywhere).
// Pure: no canvas, safe under node.
export function encodeTGA(rgba, w, h, { alpha = false } = {}) {
  const bpp = alpha ? 4 : 3;

  const header = new Uint8Array(18);
  header[2] = 2;                          // uncompressed true-color
  header[12] = w & 0xff;
  header[13] = (w >> 8) & 0xff;
  header[14] = h & 0xff;
  header[15] = (h >> 8) & 0xff;
  header[16] = bpp * 8;                   // bits per pixel
  header[17] = alpha ? 0x28 : 0x20;       // top-left origin (+8 alpha bits)

  const body = new Uint8Array(w * h * bpp);
  let o = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    body[o++] = rgba[i + 2]; // B
    body[o++] = rgba[i + 1]; // G
    body[o++] = rgba[i];     // R
    if (alpha) body[o++] = 255; // full effect everywhere
  }

  const out = new Uint8Array(18 + body.length);
  out.set(header, 0);
  out.set(body, 18);
  return out;
}

export function canvasToTGA(canvas, { alpha = false } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const rgba = ctx.getImageData(0, 0, w, h).data;
  return new Blob([encodeTGA(rgba, w, h, { alpha })], { type: 'image/x-tga' });
}
