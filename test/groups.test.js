import test from 'node:test';
import assert from 'node:assert/strict';
// engine.js builds scratch canvases at module scope — same minimal DOM stub
// engine.test.js uses, since nothing here touches a real canvas.
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};

const { createDoc, createFillLayer, serializeDoc, deserializeDoc } = await import('../js/engine.js');

// Fill layers are the only layer kind that deserializes without a DOM Image,
// so every round-trip here uses them.
function docWithGroup() {
  const doc = createDoc();
  const a = { ...createFillLayer('#ff0000'), id: 'L1', name: 'a' };
  const b = { ...createFillLayer('#00ff00'), id: 'L2', name: 'b' };
  const c = { ...createFillLayer('#0000ff'), id: 'L3', name: 'c' };
  doc.layers = [a, b, c];
  doc.groups = [{ id: 'G1', name: 'Sponsors', collapsed: true }];
  a.groupId = 'G1';
  b.groupId = 'G1';
  return doc;
}

test('a new doc starts with no groups', () => {
  assert.deepEqual(createDoc().groups, []);
});

test('groups and membership survive a serialize → deserialize round trip', async () => {
  const back = await deserializeDoc(serializeDoc(docWithGroup()));
  assert.deepEqual(back.groups, [{ id: 'G1', name: 'Sponsors', collapsed: true }]);
  assert.equal(back.layers.find(l => l.id === 'L1').groupId, 'G1');
  assert.equal(back.layers.find(l => l.id === 'L2').groupId, 'G1');
  assert.equal(back.layers.find(l => l.id === 'L3').groupId, null);
});

test('a group whose members all vanished is dropped on load', async () => {
  const data = serializeDoc(docWithGroup());
  data.layers = data.layers.filter(l => l.groupId !== 'G1'); // members lost
  const back = await deserializeDoc(data);
  assert.deepEqual(back.groups, []);
  assert.equal(back.layers.length, 1);
});

test('a groupId pointing at an undeclared group is cleared, not kept', async () => {
  const data = serializeDoc(docWithGroup());
  data.groups = []; // group record lost, layers still reference it
  const back = await deserializeDoc(data);
  assert.deepEqual(back.groups, []);
  for (const l of back.layers) assert.equal(l.groupId, null);
});

test('duplicate group ids collapse to the first declaration', async () => {
  const data = serializeDoc(docWithGroup());
  data.groups.push({ id: 'G1', name: 'Impostor', collapsed: false });
  const back = await deserializeDoc(data);
  assert.equal(back.groups.length, 1);
  assert.equal(back.groups[0].name, 'Sponsors');
});

test('docs saved before groups existed load with none', async () => {
  const data = serializeDoc(docWithGroup());
  delete data.groups;
  for (const l of data.layers) delete l.groupId;
  const back = await deserializeDoc(data);
  assert.deepEqual(back.groups, []);
  assert.equal(back.layers.length, 3);
  for (const l of back.layers) assert.equal(l.groupId, null);
});
