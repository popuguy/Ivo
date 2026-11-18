import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompositionPDFLayers } from '../../desktop/composition-pdf-layers.mjs';
const token = 'ct1-' + 'a'.repeat(64),
  bytes = Buffer.from('%PDF-1.7\nowned native PDF');
const value = () => ({ token, mimeType: 'application/pdf', data: bytes.toString('base64') });
const placement = () => ({
  sourcePageIndex: 0,
  destinationPageIndex: 0,
  matrix: [1, 0, 0, 1, 30, 40],
  clips: [
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ],
  ],
});
const manifest = () => ({ pages: [{}], composedText: [{ token, placements: [placement()] }] });

test('PDF native layer resolver preserves placements and reads a repeated immutable token once', async () => {
  const input = manifest();
  input.composedText.push({
    token,
    placements: [{ ...placement(), matrix: [0, 1, -1, 0, 100, 40] }],
  });
  let reads = 0;
  const layers = await resolveCompositionPDFLayers(input, async (requested) => {
    assert.equal(requested, token);
    reads++;
    return value();
  });
  assert.equal(reads, 1);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].placements.length, 2);
  assert.deepEqual(layers[0].bytes, bytes);
  input.composedText[0].placements[0].matrix[0] = 99;
  assert.equal(
    layers[0].placements[0].matrix[0],
    1,
    'Validated placement must be frozen from renderer data',
  );
  assert.deepEqual(await resolveCompositionPDFLayers({ pages: [{}] }), []);
});

test('invalid native PDF selectors and affine geometry reject before fetching text', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return value();
  };
  for (const mutate of [
    (m) => (m.composedText[0].path = '/arbitrary.pdf'),
    (m) => (m.composedText[0].token = 'guess'),
    (m) => (m.composedText[0].placements[0].matrix = [1, 1, 1, 1, 0, 0]),
    (m) => (m.composedText[0].placements[0].matrix[4] = Infinity),
    (m) => (m.composedText[0].placements[0].destinationPageIndex = 1),
    (m) => (m.composedText[0].placements[0].sourcePageIndex = 128),
    (m) => (m.composedText[0].placements[0].clips[0][0].path = '/file'),
  ]) {
    const input = manifest();
    mutate(input);
    await assert.rejects(
      resolveCompositionPDFLayers(input, read),
      /Invalid composed text PDF manifest/,
    );
  }
  assert.equal(reads, 0);
  await assert.rejects(resolveCompositionPDFLayers(manifest()), /Invalid/);
  await assert.rejects(
    resolveCompositionPDFLayers(manifest(), async () => ({ ...value(), token: 'different' })),
    /Invalid/,
  );
});
