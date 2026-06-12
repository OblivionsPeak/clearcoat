// Clearcoat region maps — labeled rectangles over the 2048 UV sheet with
// mirror relationships ("Left Door mirrors Right Door"). Pure data helpers;
// all coordinates are in 2048-sheet space, rectangles only (v1).

export const REGIONS_FORMAT = 'clearcoat-regions/1';

export function createRegionMap(car) {
  return { format: REGIONS_FORMAT, car: car || 'unknown car', regions: [] };
}

// validate + normalize a parsed JSON value into a region map; throws with a
// readable message on anything malformed
export function parseRegionMap(data) {
  if (!data || typeof data !== 'object') throw new Error('not a region map object');
  if (data.format !== REGIONS_FORMAT) throw new Error(`unknown format "${data.format}" (expected ${REGIONS_FORMAT})`);
  if (!Array.isArray(data.regions)) throw new Error('missing "regions" array');
  const seen = new Set();
  const regions = data.regions.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`region ${i} is not an object`);
    if (typeof r.id !== 'string' || !r.id) throw new Error(`region ${i} has no id`);
    if (seen.has(r.id)) throw new Error(`duplicate region id "${r.id}"`);
    seen.add(r.id);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (!Number.isFinite(r[k])) throw new Error(`region "${r.id}" has a bad "${k}"`);
    }
    if (r.w <= 0 || r.h <= 0) throw new Error(`region "${r.id}" has a non-positive size`);
    const out = {
      id: r.id,
      name: typeof r.name === 'string' && r.name ? r.name : r.id,
      x: r.x, y: r.y, w: r.w, h: r.h,
    };
    if (typeof r.mirror === 'string' && r.mirror) out.mirror = r.mirror;
    return out;
  });
  for (const r of regions) {
    if (r.mirror && !seen.has(r.mirror)) throw new Error(`region "${r.id}" mirrors unknown id "${r.mirror}"`);
  }
  return {
    format: REGIONS_FORMAT,
    car: typeof data.car === 'string' && data.car ? data.car : 'unknown car',
    regions,
  };
}

export function regionById(map, id) {
  return map.regions.find(r => r.id === id) || null;
}

// topmost-last: later entries win where rectangles overlap
export function regionAt(map, x, y) {
  const rs = map.regions;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  return null;
}

// map a point through a mirror pair by relative position:
// (u, v) within src → (1 - u, v) within dst
export function mirrorPoint(src, dst, x, y) {
  const u = src.w ? (x - src.x) / src.w : 0;
  const v = src.h ? (y - src.y) / src.h : 0;
  return { x: dst.x + (1 - u) * dst.w, y: dst.y + v * dst.h };
}

// the { src, dst } mirror pair containing a point, or null
export function mirrorPairAt(map, x, y) {
  const src = regionAt(map, x, y);
  if (!src || !src.mirror) return null;
  const dst = regionById(map, src.mirror);
  return dst ? { src, dst } : null;
}

// given a layer whose center (x, y) lies in a region with a mirror partner,
// the mirrored placement — the mirrored copy also gets flipH toggled
export function mirrorLayerPlacement(map, layer) {
  const pair = mirrorPairAt(map, layer.x, layer.y);
  if (!pair) return null;
  const p = mirrorPoint(pair.src, pair.dst, layer.x, layer.y);
  return { x: Math.round(p.x), y: Math.round(p.y), flip: true };
}

// slug a display name into an id that doesn't collide with the map's regions
export function uniqueRegionId(name, map) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'region';
  let id = base, n = 2;
  while (map.regions.some(r => r.id === id)) id = base + '_' + (n++);
  return id;
}
