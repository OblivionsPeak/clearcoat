// PSD template import — extracts the wireframe from official iRacing template PSDs
// so users never need Photoshop. Uses ag-psd, lazy-loaded from CDN only when a
// .psd is actually opened (keeps the core app dependency-free).

let agPsdPromise = null;

function loadAgPsd() {
  if (window.agPsd) return Promise.resolve(window.agPsd);
  if (!agPsdPromise) {
    agPsdPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/ag-psd@14/dist/bundle.js';
      s.onload = () => window.agPsd ? resolve(window.agPsd) : reject(new Error('PSD reader failed to initialize'));
      s.onerror = () => { agPsdPromise = null; reject(new Error('Could not load the PSD reader — check your connection')); };
      document.head.appendChild(s);
    });
  }
  return agPsdPromise;
}

// Layer/group names that look like wireframe linework in iRacing template PSDs.
const WIRE_RE = /(wire|outline|line\s?art|\blines?\b|contour|panel\s?lines|template\s?lines)/i;
// Names that are clearly not reference linework even if a parent group matched.
const SKIP_RE = /(background|bkg|paint\s?here|fill|color|colour|sample|example)/i;

// NOTE: official iRacing templates ship the wireframe layer ("Wire") hidden,
// so hidden layers are still collected — visibility only matters for the
// non-wireframe fallback composite.
function collectLayers(children, parentMatched, parentHidden, out) {
  for (const layer of children || []) {
    const name = layer.name || '';
    if (SKIP_RE.test(name)) continue;
    const matched = parentMatched || WIRE_RE.test(name);
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) {
      collectLayers(layer.children, matched, hidden, out);
    } else if (layer.canvas) {
      out.push({ layer, matched, hidden });
    }
  }
}

function drawLayers(ctx, entries) {
  for (const { layer } of entries) {
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  }
  ctx.globalAlpha = 1;
}

// Returns { src (PNG dataURL), usedWireframe (bool) }
export async function psdToTemplate(arrayBuffer) {
  const agPsd = await loadAgPsd();
  const psd = agPsd.readPsd(arrayBuffer);

  const out = document.createElement('canvas');
  out.width = psd.width;
  out.height = psd.height;
  const ctx = out.getContext('2d');
  // white base so the multiply overlay shows only the linework
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);

  const entries = [];
  collectLayers(psd.children, false, false, entries);
  const wires = entries.filter(e => e.matched);

  if (wires.length) {
    drawLayers(ctx, wires);
    return { src: out.toDataURL('image/png'), usedWireframe: true };
  }
  // no wireframe-named layers — fall back to the flattened composite
  if (psd.canvas) {
    ctx.drawImage(psd.canvas, 0, 0);
  } else {
    drawLayers(ctx, entries.filter(e => !e.hidden));
  }
  return { src: out.toDataURL('image/png'), usedWireframe: false };
}
