// Minimal TGA encoder — uncompressed BGR(A), top-left origin.
// Paints export as 24-bit; spec maps as 32-bit with the alpha channel forced
// to 255: iRacing reads spec alpha as "what percentage of metallic/roughness
// applies", so it must be explicit, not left to chance.

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
