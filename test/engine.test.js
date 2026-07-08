import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js creates a handful of scratch canvases at module scope; stub just
// enough DOM for the module to import in Node. Only pure (non-canvas)
// functions are exercised here.
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
// loadImage stub — resolves immediately so image layers deserialize
globalThis.Image = class {
  set src(v) { queueMicrotask(() => this.onload && this.onload()); }
};

const {
  createDoc,
  createFillLayer,
  serializeDoc,
  deserializeDoc,
  mixHex,
  resolveParams,
  defaultParams,
} = await import('../js/engine.js');

// Layers built by hand (factory functions for image/text need real canvas).
function fakeTextLayer(overrides = {}) {
  return {
    id: 'T1', type: 'text', name: 'text', visible: true, opacity: 1,
    material: 'gloss', img: {}, src: 'data:image/png;base64,x',
    text: 'TEXT', font: 'Arial Black', fontSize: 160,
    textColor: '#ffffff', outlineColor: '#000000', outlineWidth: 0,
    italic: false, letterSpacing: 0, curve: 0, fx: null,
    x: 1024, y: 1024, scale: 1, rotation: 0, skewX: 0, skewY: 0,
    flipH: false, flipV: false,
    ...overrides,
  };
}

test('serializeDoc round-trips curve on text layers (default 0)', () => {
  const doc = createDoc();
  doc.layers.push(fakeTextLayer({ curve: -45 }), fakeTextLayer({ id: 'T2' }));
  const out = serializeDoc(doc);
  assert.equal(out.layers[0].curve, -45);
  assert.equal(out.layers[1].curve, 0);
});

test('serializeDoc carries fx as-is, null when absent', () => {
  const fx = {
    strokeW: 6, strokeColor: '#ff0000',
    shadow: 20, shadowDX: 8, shadowDY: 8, shadowColor: '#000000',
    glow: 0, glowColor: '#ffffff',
  };
  const doc = createDoc();
  doc.layers.push(fakeTextLayer({ fx }), fakeTextLayer({ id: 'T2', fx: null }));
  const out = serializeDoc(doc);
  assert.deepEqual(out.layers[0].fx, fx);
  assert.equal(out.layers[1].fx, null);
});

test('createFillLayer initializes colorMid/midPos and serializeDoc keeps them', () => {
  const fill = createFillLayer('#123456');
  assert.equal(fill.colorMid, null);
  assert.equal(fill.midPos, 0.5);
  fill.colorMid = '#00ff00';
  fill.midPos = 0.25;
  const doc = createDoc();
  doc.layers.push(fill);
  const out = serializeDoc(doc);
  assert.equal(out.layers[0].colorMid, '#00ff00');
  assert.equal(out.layers[0].midPos, 0.25);
});

test('deserializeDoc restores fill colorMid/midPos with defaults', async () => {
  const doc = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'fill', color: '#112233', fillType: 'linear', colorMid: '#abcdef', midPos: 0.7 },
      { type: 'fill', color: '#112233', fillType: 'linear' }, // pre-feature save
    ],
  });
  assert.equal(doc.layers[0].colorMid, '#abcdef');
  assert.equal(doc.layers[0].midPos, 0.7);
  assert.equal(doc.layers[1].colorMid, null);
  assert.equal(doc.layers[1].midPos, 0.5);
});

test('deserializeDoc coerces partial fx blocks to full defaults', async () => {
  const doc = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'image', src: 'data:x', fx: { strokeW: 10, glow: 30 } },
      { type: 'image', src: 'data:x' }, // pre-feature save
    ],
  });
  assert.deepEqual(doc.layers[0].fx, {
    strokeW: 10, strokeColor: '#000000',
    shadow: 0, shadowDX: 8, shadowDY: 8, shadowColor: '#000000',
    glow: 30, glowColor: '#ffffff',
  });
  assert.equal(doc.layers[1].fx, null);
});

test('mixHex interpolates channels', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#ff0000', '#00ff00', 0), '#ff0000');
  assert.equal(mixHex('#ff0000', '#00ff00', 1), '#00ff00');
});

test('resolveParams overlays matParams on material defaults', () => {
  assert.deepEqual(defaultParams('gloss'), { met: 0, rough: 40, clear: 255 });
  assert.deepEqual(resolveParams('gloss', { rough: 99 }), { met: 0, rough: 99, clear: 255 });
});
