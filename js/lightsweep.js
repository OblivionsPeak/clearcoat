// Clearcoat light sweep — WebGL preview that shades the flat livery sheet
// per-pixel from the paint + spec maps with a light that sweeps across the
// sheet, so finishes read on screen: gloss flashes, matte stays flat,
// flake sparkles, ghost marks surface inside the highlight.

// iRacing PBR spec convention (see engine.js): R = metallic, G = roughness,
// B = clearcoat strength.

const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uPaint;
uniform sampler2D uSpec;
uniform float uTime;
varying vec2 vUV;

void main() {
  vec3 albedo = texture2D(uPaint, vUV).rgb;
  vec3 spec = texture2D(uSpec, vUV).rgb;
  float metallic  = spec.r;
  float roughness = spec.g;
  float clearcoat = spec.b;

  // light sweeps the sheet on a 3:2 Lissajous loop, ~6 s period
  float t = uTime * 6.2831853 / 6.0;
  vec2 lightXY = vec2(0.5 + 0.46 * sin(t * 1.5), 0.5 + 0.46 * sin(t + 1.3));
  vec3 lightPos = vec3(lightXY, 0.35);

  vec3 toLight = lightPos - vec3(vUV, 0.0);
  float dist = length(toLight);
  vec3 L = toLight / dist;
  vec3 N = vec3(0.0, 0.0, 1.0);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  // soft pool of light rather than uniform wash
  float atten = 1.0 / (1.0 + 9.0 * dist * dist);
  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);

  float shininess = mix(8.0, 512.0, pow(1.0 - roughness, 2.0));
  vec3 specColor = mix(vec3(1.0), albedo, metallic);
  float specStrength = clearcoat * (0.55 + 0.45 * metallic);
  vec3 specular = specColor * pow(NdotH, shininess)
                * specStrength * (1.0 + shininess * 0.012) * atten * NdotL;

  vec3 diffuse = albedo * (0.45 + NdotL * atten * 0.65) * (1.0 - 0.5 * metallic);

  vec3 color = diffuse + specular;
  color = color / (1.0 + color * 0.15);   // gentle tonemap to avoid blowout
  gl_FragColor = vec4(color, 1.0);
}`;

let supportCache = null;
let state = null;     // lazily-built GL state, see initState()
let failed = false;   // a shader/context failure happened — stay dark

export function lightSweepSupported() {
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
    throw new Error('shader compile failed: ' + gl.getShaderInfoLog(sh));
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
  return tex;
}

function initState(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl', { antialias: false, depth: false });
  if (!gl) throw new Error('webgl context unavailable');

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program link failed: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  // full-screen quad as a triangle strip
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // canvas row 0 is the top; GL texture v=0 is the bottom — flip on upload
  // so the rendered output matches the input orientation under drawImage
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const texPaint = createTexture(gl, 0);
  const texSpec = createTexture(gl, 1);
  gl.uniform1i(gl.getUniformLocation(prog, 'uPaint'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uSpec'), 1);

  gl.viewport(0, 0, width, height);

  return {
    canvas, gl, texPaint, texSpec,
    uTime: gl.getUniformLocation(prog, 'uTime'),
    uploaded: false,
  };
}

function uploadTextures(paintCanvas, specCanvas) {
  const gl = state.gl;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texPaint);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintCanvas);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, state.texSpec);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, specCanvas);
  state.uploaded = true;
}

// Renders one shaded frame and returns the module's internal canvas (reused
// across calls — draw it immediately, don't hold a reference). Textures are
// re-uploaded only on the first call or when texturesChanged is true.
// Returns null if WebGL is unavailable or initialization ever failed.
export function lightSweepFrame(paintCanvas, specCanvas, timeSeconds, texturesChanged) {
  if (failed || !lightSweepSupported()) return null;
  try {
    if (!state) state = initState(paintCanvas.width, paintCanvas.height);
    if (texturesChanged || !state.uploaded) uploadTextures(paintCanvas, specCanvas);
    const gl = state.gl;
    gl.uniform1f(state.uTime, timeSeconds);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return state.canvas;
  } catch (err) {
    failed = true;
    console.error('lightsweep: disabled after failure —', err);
    return null;
  }
}
