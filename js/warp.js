// Corner pin — drag an image's four corners independently.
//
// The existing transform is affine (translate/rotate/skew/scale), and affine
// maps parallel lines to parallel lines. That is fine for a parallelogram and
// useless for a trapezoid: you cannot make one edge shorter than its opposite,
// which is exactly what fitting artwork to a tapering panel — a fin, a wing, a
// door that narrows — requires.
//
// So the four corners get a projective (homography) mapping instead. Canvas 2D
// has no perspective transform, so the unit square is subdivided into a grid,
// each vertex is pushed through the homography, and every cell is drawn as two
// affine triangles. With enough cells that is visually indistinguishable from a
// true perspective draw, and it needs no per-pixel loop.

const GRID = 18;          // cells per side; 18 is smooth well past normal use

// Solve the 8 unknowns of the homography taking the unit square to `d`,
// d = [topLeft, topRight, bottomRight, bottomLeft].
export function homography(d) {
  const [p0, p1, p2, p3] = d;
  // x = (a·u + b·v + c) / (g·u + i·v + 1),  y = (d·u + e·v + f) / (…)
  // rearranged to be linear in the unknowns [a,b,c,d,e,f,g,i]:
  //   a·u + b·v + c − g·u·x − i·v·x = x
  //   d·u + e·v + f − g·u·y − i·v·y = y
  // evaluated at the unit-square corners (0,0) (1,0) (1,1) (0,1).
  const A = [
    [0, 0, 1, 0, 0, 0, 0, 0],                       // p0.x, u=0 v=0
    [0, 0, 0, 0, 0, 1, 0, 0],                       // p0.y
    [1, 0, 1, 0, 0, 0, -p1.x, 0],                   // p1.x, u=1 v=0
    [0, 0, 0, 1, 0, 1, -p1.y, 0],                   // p1.y
    [1, 1, 1, 0, 0, 0, -p2.x, -p2.x],               // p2.x, u=1 v=1
    [0, 0, 0, 1, 1, 1, -p2.y, -p2.y],               // p2.y
    [0, 1, 1, 0, 0, 0, 0, -p3.x],                   // p3.x, u=0 v=1
    [0, 0, 0, 0, 1, 1, 0, -p3.y],                   // p3.y
  ];
  const b = [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y];
  const n = 8;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (Math.abs(A[piv][i]) < 1e-12) return null;      // degenerate quad
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return { a: h[0], b: h[1], c: h[2], d: h[3], e: h[4], f: h[5], g: h[6], i: h[7] };
}

function project(H, u, v) {
  const w = H.g * u + H.i * v + 1;
  return { x: (H.a * u + H.b * v + H.c) / w, y: (H.d * u + H.e * v + H.f) / w };
}

// Draw one source triangle into one destination triangle. Solves the affine
// map between them, clips, and lets drawImage do the sampling.
function tri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(den) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
  const b = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
  const c = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;

  // Nudge each vertex outward from the centroid before clipping. Neighbouring
  // cells share an edge, and two antialiased edges meeting exactly leave a
  // semi-transparent hairline — a visible grid over the whole warp. Half a
  // pixel of overlap hides it without smearing the artwork.
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p) => {
    const dx = p.x - cx, dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 0.5, y: p.y + (dy / len) * 0.5 };
  };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y);
  ctx.lineTo(g1.x, g1.y);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, c, b, d,
    d0.x - a * s0.x - b * s0.y,
    d0.y - c * s0.x - d * s0.y);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Draw `img` so its corners land on `corners` = [TL, TR, BR, BL] in ctx space. */
export function drawWarped(ctx, img, corners) {
  const H = homography(corners);
  if (!H) return false;
  const iw = img.width, ih = img.height;

  // Pre-compute the mapped grid so each vertex is projected once.
  const pts = [];
  for (let r = 0; r <= GRID; r++) {
    const row = [];
    for (let c = 0; c <= GRID; c++) row.push(project(H, c / GRID, r / GRID));
    pts.push(row);
  }

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const u0 = (c / GRID) * iw, u1 = ((c + 1) / GRID) * iw;
      const v0 = (r / GRID) * ih, v1 = ((r + 1) / GRID) * ih;
      const s00 = { x: u0, y: v0 }, s10 = { x: u1, y: v0 };
      const s11 = { x: u1, y: v1 }, s01 = { x: u0, y: v1 };
      const d00 = pts[r][c], d10 = pts[r][c + 1];
      const d11 = pts[r + 1][c + 1], d01 = pts[r + 1][c];
      tri(ctx, img, s00, s10, s11, d00, d10, d11);
      tri(ctx, img, s00, s11, s01, d00, d11, d01);
    }
  }
  return true;
}

/** The layer's current affine rectangle, as the starting quad for a corner pin. */
export function cornersFromMatrix(m, w, h) {
  const hw = w / 2, hh = h / 2;
  return [
    { x: -hw, y: -hh }, { x: hw, y: -hh },
    { x: hw, y: hh }, { x: -hw, y: hh },
  ].map(p => {
    const pt = m.transformPoint(new DOMPoint(p.x, p.y));
    return { x: pt.x, y: pt.y };
  });
}
