// Minimal TGA encoder — 24-bit uncompressed BGR, top-left origin.
// iRacing accepts 24-bit uncompressed TGA for car paints and spec maps.

export function canvasToTGA(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const rgba = ctx.getImageData(0, 0, w, h).data;

  const header = new Uint8Array(18);
  header[2] = 2;                  // uncompressed true-color
  header[12] = w & 0xff;
  header[13] = (w >> 8) & 0xff;
  header[14] = h & 0xff;
  header[15] = (h >> 8) & 0xff;
  header[16] = 24;                // bits per pixel
  header[17] = 0x20;              // descriptor: top-left origin

  const body = new Uint8Array(w * h * 3);
  let o = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    body[o++] = rgba[i + 2]; // B
    body[o++] = rgba[i + 1]; // G
    body[o++] = rgba[i];     // R
  }

  const out = new Uint8Array(18 + body.length);
  out.set(header, 0);
  out.set(body, 18);
  return new Blob([out], { type: 'image/x-tga' });
}
