// Clearcoat studio — orbitable 3D material proofing bench. Wraps the live
// paint + spec maps around curved geometry (sphere / cylinder / door panel)
// under a procedural showroom environment, so finishes that only read on
// curvature — pearl, candy, flake, chrome — proof like they will in the
// iRacing showroom instead of on a flat sheet.

// iRacing PBR spec convention (see engine.js): R = metallic, G = roughness,
// B = clearcoat strength.

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUV;
void main() {
  vNormal = aNormal;
  vPos = aPos;
  vUV = aUV;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uPaint;
uniform sampler2D uSpec;
uniform vec3 uEye;
uniform float uEnv;        // 0 showroom, 1 neutral, 2 dusk
uniform vec4 uRegion;      // sheet-region rect: x, y, w, h in 0-1 sheet coords
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUV;

// Procedural environment — smooth functions of direction, no textures.
vec3 env(vec3 d) {
  float h = d.y;
  if (uEnv < 0.5) {
    // showroom: warm ~5500K key from above, warm horizon band, cool floor
    vec3 c = mix(vec3(0.10, 0.11, 0.14),                       // floor bounce
                 vec3(1.30, 1.16, 0.92),                       // warm ceiling
                 smoothstep(-0.35, 0.85, h));
    c += vec3(1.45, 1.30, 1.00) * pow(max(h, 0.0), 6.0);       // overhead key pool
    c += vec3(0.34, 0.22, 0.10) * exp(-14.0 * h * h);          // warm horizon band
    c += vec3(0.04, 0.07, 0.11) * smoothstep(-0.2, -1.0, h);   // cool ground bounce
    return c;
  } else if (uEnv < 1.5) {
    // neutral: soft grey dome, slightly darker floor
    return mix(vec3(0.16, 0.17, 0.18), vec3(0.85, 0.86, 0.88),
               smoothstep(-0.6, 0.9, h));
  }
  // dusk: blue sky over an orange horizon split
  vec3 c = mix(vec3(0.05, 0.05, 0.08),                          // dark ground
               vec3(0.14, 0.26, 0.62),                          // blue sky
               smoothstep(-0.15, 0.7, h));
  c += vec3(1.15, 0.46, 0.12) * exp(-22.0 * h * h);             // orange horizon
  c += vec3(0.30, 0.36, 0.70) * pow(max(h, 0.0), 3.0);          // zenith blue
  return c;
}

void main() {
  vec2 sheet = uRegion.xy + vUV * uRegion.zw;
  // textures are uploaded with FLIP_Y, so sheet y (top-down) flips to GL v
  vec2 uv = vec2(sheet.x, 1.0 - sheet.y);
  vec3 albedo = texture2D(uPaint, uv).rgb;
  vec3 spec = texture2D(uSpec, uv).rgb;
  float metallic  = spec.r;
  float roughness = spec.g;
  float clearcoat = spec.b;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vPos);
  if (dot(N, V) < 0.0) N = -N;       // open cylinder: shade inside faces too
  vec3 R = reflect(-V, N);
  float NdotV = max(dot(N, V), 0.0);

  // crude hemispheric irradiance: env at the normal pulled toward the average
  vec3 irr = mix(env(N), env(vec3(0.0, 1.0, 0.0)) * 0.5 + env(vec3(0.0, -1.0, 0.0)) * 0.5, 0.5);

  // diffuse — metals barely diffuse
  vec3 diffuse = albedo * irr * (1.0 - 0.96 * metallic);

  // base specular: env along the reflect vector, blurred toward the
  // hemispheric average by roughness (single sample + mix — no mips)
  float r2 = roughness * roughness;
  vec3 specEnv = mix(env(R), irr, clamp(roughness * 1.15 - 0.05, 0.0, 1.0));
  float f0 = mix(0.04, 1.0, metallic);
  float fres = f0 + (1.0 - f0) * pow(1.0 - NdotV, 5.0);
  vec3 specTint = mix(vec3(1.0), albedo, metallic);
  vec3 specular = specEnv * specTint * fres * (1.0 - 0.55 * r2);

  // clearcoat: second, sharper, untinted lobe with its own fresnel —
  // this is what makes glaze/pearl pop on curvature
  vec3 ccEnv = mix(env(R), irr, 0.06);
  float ccFres = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
  vec3 coat = ccEnv * clearcoat * ccFres * 1.35;

  vec3 color = diffuse + specular + coat;
  color *= 1.30;                       // slight exposure lift
  color = color / (1.0 + color);       // Reinhard-ish tonemap
  gl_FragColor = vec4(color, 1.0);
}`;

// ---------- geometry ----------
// Each builder returns { verts: Float32Array (pos3 normal3 uv2), idx: Uint16Array }.
// UV convention: u 0→1 left→right, v 0→1 TOP→bottom of the mapped sheet region.

function buildSphere(segU, segV) {
  const verts = [], idx = [];
  for (let j = 0; j <= segV; j++) {
    const t = j / segV;                  // 0 top pole → 1 bottom pole
    const phi = t * Math.PI;
    for (let i = 0; i <= segU; i++) {
      const s = i / segU;
      const th = s * Math.PI * 2;
      const x = Math.sin(phi) * Math.sin(th);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.cos(th);
      verts.push(x, y, z, x, y, z, s, t); // unit sphere: normal = position
    }
  }
  pushGrid(idx, segU, segV);
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

function buildCylinder(seg) {
  const verts = [], idx = [];
  const R = 0.85, H = 1.5;
  for (let j = 0; j <= 1; j++) {
    const y = H / 2 - j * H;             // top row first → v=0 at the top
    for (let i = 0; i <= seg; i++) {
      const s = i / seg;
      const th = s * Math.PI * 2;
      const nx = Math.sin(th), nz = Math.cos(th);
      verts.push(nx * R, y, nz * R, nx, 0, nz, s, j);
    }
  }
  pushGrid(idx, seg, 1);
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

// door-like 16:10 panel bulged outward on both axes (~10% compound curve)
function buildPanel(seg) {
  const verts = [], idx = [];
  const W = 1.6, H = 1.0, D = 0.16;
  const zAt = (a, b) => D * (1 - a * a) * (1 - b * b); // a,b ∈ [-1,1]
  for (let j = 0; j <= seg; j++) {
    const v = j / seg;
    const b = v * 2 - 1;                 // v=0 top → b=-1
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const a = u * 2 - 1;
      const x = a * W / 2, y = -b * H / 2, z = zAt(a, b);
      // analytic partials of z(a,b), chain-ruled into x/y space
      const dzdx = (-2 * a * (1 - b * b)) * D * (2 / W);
      const dzdy = (-2 * b * (1 - a * a)) * D * (-2 / H);
      const len = Math.hypot(dzdx, dzdy, 1);
      verts.push(x, y, z, -dzdx / len, -dzdy / len, 1 / len, u, v);
    }
  }
  pushGrid(idx, seg, seg);
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

function pushGrid(idx, cols, rows) {
  const stride = cols + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
}

// ---------- minimal mat4 ----------

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ];
}

function mat4mul(a, b) { // a * b, column-major
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

// ---------- module state ----------

const ENVS = { showroom: 0, neutral: 1, dusk: 2 };

let supportCache = null;
let state = null;        // lazily-built GL state
let failed = false;      // shader/context failure — stay closed
let isOpen = false;
let rafId = 0;
let getMapsCb = null;
let shapeName = 'sphere';
let envId = 0;
let region = [0, 0, 1, 1];
const orbit = { yaw: 0.6, pitch: 0.25, dist: 3.0 };
let dragging = false;
let lastInteract = -1e9;  // far past — auto-rotate from the first frame
let lastFrameT = 0;

export function studioSupported() {
  if (supportCache === null) {
    const probe = document.createElement('canvas');
    let gl = null;
    try { gl = probe.getContext('webgl'); } catch { /* blocked context */ }
    supportCache = !!gl;
  }
  return supportCache;
}

function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('studio shader compile failed: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createTexture(gl, unit) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // mid-grey placeholder until the first map upload lands
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([110, 110, 116, 255]));
  return tex;
}

function uploadMesh(gl, mesh) {
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
  return { vbo, ibo, count: mesh.idx.length };
}

function initState() {
  const size = Math.round(340 * Math.min(devicePixelRatio || 1, 2));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.className = 'studio-3d-canvas';
  const gl = canvas.getContext('webgl', { antialias: true, depth: true });
  if (!gl) throw new Error('webgl context unavailable');

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('studio program link failed: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  gl.enable(gl.DEPTH_TEST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // see shader uv flip note

  const texPaint = createTexture(gl, 0);
  const texSpec = createTexture(gl, 1);
  gl.uniform1i(gl.getUniformLocation(prog, 'uPaint'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uSpec'), 1);

  const meshes = {
    sphere: uploadMesh(gl, buildSphere(48, 32)),
    cylinder: uploadMesh(gl, buildCylinder(64)),
    panel: uploadMesh(gl, buildPanel(32)),
  };

  const attribs = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aNormal: gl.getAttribLocation(prog, 'aNormal'),
    aUV: gl.getAttribLocation(prog, 'aUV'),
  };
  gl.viewport(0, 0, size, size);

  bindInteraction(canvas);

  return {
    canvas, gl, texPaint, texSpec, meshes, attribs,
    uMVP: gl.getUniformLocation(prog, 'uMVP'),
    uEye: gl.getUniformLocation(prog, 'uEye'),
    uEnv: gl.getUniformLocation(prog, 'uEnv'),
    uRegion: gl.getUniformLocation(prog, 'uRegion'),
    uploaded: false,
  };
}

// ---------- interaction: drag orbits, wheel zooms ----------

function bindInteraction(canvas) {
  let lastX = 0, lastY = 0;
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    lastInteract = performance.now();
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit.yaw -= (e.clientX - lastX) * 0.01;
    orbit.pitch += (e.clientY - lastY) * 0.01;
    orbit.pitch = Math.max(-1.35, Math.min(1.35, orbit.pitch));
    lastX = e.clientX; lastY = e.clientY;
    lastInteract = performance.now();
  });
  const release = () => { dragging = false; lastInteract = performance.now(); canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist *= e.deltaY > 0 ? 1.1 : 1 / 1.1;
    orbit.dist = Math.max(1.7, Math.min(6.5, orbit.dist));
    lastInteract = performance.now();
  }, { passive: false });
}

// ---------- render loop ----------

function uploadMaps(paint, spec) {
  const gl = state.gl;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texPaint);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, state.texSpec);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, spec);
  state.uploaded = true;
}

function frame(now) {
  if (!isOpen) return;
  rafId = requestAnimationFrame(frame);
  try {
    const dt = lastFrameT ? Math.min((now - lastFrameT) / 1000, 0.1) : 0;
    lastFrameT = now;

    const maps = getMapsCb ? getMapsCb() : { changed: false };
    if (maps && maps.paint && (maps.changed || !state.uploaded)) {
      uploadMaps(maps.paint, maps.spec);
    }

    // auto-rotate (~20 s/rev) when idle for 3 s and not dragging
    if (!dragging && now - lastInteract > 3000) {
      orbit.yaw += dt * Math.PI * 2 / 20;
    }

    const gl = state.gl;
    const eye = [
      orbit.dist * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
      orbit.dist * Math.sin(orbit.pitch),
      orbit.dist * Math.cos(orbit.pitch) * Math.cos(orbit.yaw),
    ];
    const mvp = mat4mul(
      perspective(0.7, 1, 0.1, 30),
      lookAt(eye, [0, 0, 0], [0, 1, 0]),
    );

    gl.clearColor(0.05, 0.055, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const mesh = state.meshes[shapeName] || state.meshes.sphere;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    const A = state.attribs;
    gl.enableVertexAttribArray(A.aPos);
    gl.vertexAttribPointer(A.aPos, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(A.aNormal);
    gl.vertexAttribPointer(A.aNormal, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(A.aUV);
    gl.vertexAttribPointer(A.aUV, 2, gl.FLOAT, false, 32, 24);

    gl.uniformMatrix4fv(state.uMVP, false, mvp);
    gl.uniform3fv(state.uEye, eye);
    gl.uniform1f(state.uEnv, envId);
    gl.uniform4fv(state.uRegion, region);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  } catch (err) {
    failed = true;
    console.error('studio: disabled after failure —', err);
    closeStudio();
  }
}

// ---------- public API ----------

// The canvas the studio renders into — place it in the DOM before opening.
export function studioCanvas() {
  if (failed || !studioSupported()) return null;
  try {
    if (!state) state = initState();
    return state.canvas;
  } catch (err) {
    failed = true;
    console.error('studio: init failed —', err);
    return null;
  }
}

// getMaps: callback returning { paint, spec, changed } — 2048² canvases plus
// whether they need re-uploading. Called every frame; return changed: false
// (paint/spec may be omitted) to skip the texture upload and the map renders.
export function openStudio(getMaps) {
  if (failed || !studioSupported() || !studioCanvas()) return false;
  getMapsCb = getMaps;
  if (isOpen) return true;
  isOpen = true;
  lastFrameT = 0;
  rafId = requestAnimationFrame(frame);
  return true;
}

export function closeStudio() {
  isOpen = false;
  getMapsCb = null;
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}

export function studioSetShape(name) {
  if (name === 'sphere' || name === 'cylinder' || name === 'panel') shapeName = name;
}

export function studioSetEnv(name) {
  if (name in ENVS) envId = ENVS[name];
}

// Which part of the UV sheet wraps the geometry (0-1 sheet coords, origin
// top-left). Default: the full sheet.
export function studioSetRegion(u, v, w, h) {
  region = [u, v, w, h];
}
