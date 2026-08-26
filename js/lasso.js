// Polygon lasso — click points to enclose an arbitrary area of the sheet.
//
// The wand selects by colour, which only works where the thing you want is
// already a distinct colour. Plenty of the areas worth painting are not: a
// shark fin, one winglet, half a door. Those are arbitrary regions of the UV
// sheet with no visible boundary in the paint, and no tolerance setting will
// ever find them. Clicking their outline will.
//
// Output matches wandSelect() exactly — { src, count } — so everything
// downstream (masked pattern fill, material-only layers) works unchanged.

import { SIZE } from './engine.js';

// Screen-space distance within which a click lands "on" the first point and
// closes the loop. Generous, because the handle is small at low zoom.
export const CLOSE_RADIUS = 12;

export function lassoMask(points, feather = 1.2) {
  if (!points || points.length < 3) return null;

  const raw = document.createElement('canvas');
  raw.width = raw.height = SIZE;
  const ctx = raw.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  // non-zero winding: a self-crossing outline stays solid rather than punching
  // holes in itself, which is what a hand-drawn loop usually intends.
  ctx.fill('nonzero');

  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let count = 0;
  for (let p = 0; p < SIZE * SIZE; p++) if (data[p * 4 + 3] > 127) count++;
  if (!count) return null;

  // Match the wand's soft edge so a spec stamp does not alias along the seam.
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const octx = out.getContext('2d');
  if (feather > 0) octx.filter = `blur(${feather}px)`;
  octx.drawImage(raw, 0, 0);

  return { src: out.toDataURL('image/png'), count };
}

// Bounding box of the loop, used to place the resulting layer sensibly.
export function lassoBounds(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Convert a closed loop into a region-map entry so a traced part can be saved
// and reused. Rectangles only in clearcoat-regions/1, so this is the loop's
// bounding box — enough to jump back to the area later.
export function lassoToRegion(points, name) {
  const b = lassoBounds(points);
  return {
    name: name || 'traced area',
    x: Math.round(b.x0), y: Math.round(b.y0),
    w: Math.round(b.x1 - b.x0), h: Math.round(b.y1 - b.y0),
  };
}
