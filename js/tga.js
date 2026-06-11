// Minimal TGA encoder — uncompressed BGR(A), top-left origin.
// Paints export as 24-bit; spec maps as 32-bit with the alpha channel forced
// to 255: iRacing reads spec alpha as "what percentage of metallic/roughness
// applies", so it must be explicit, not left to chance.

// Decode an uncompressed (type 2) or RLE (type 10) truecolor TGA into a
// canvas — enough to read back paints written by iRacing/Trading Paints.
export function tgaToCanvas(buf) {
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
    flat[o++] = px === 4 ? bytes[p + 3] : 255;
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

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const srcY = topLeft ? y : h - 1 - y;
    img.data.set(flat.subarray(srcY * w * 4, (srcY + 1) * w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function canvasToTGA(canvas, { alpha = false } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const rgba = ctx.getImageData(0, 0, w, h).data;
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
  return new Blob([out], { type: 'image/x-tga' });
}
