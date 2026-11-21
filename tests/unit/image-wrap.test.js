import test from 'node:test';
import assert from 'node:assert/strict';
import { traceRasterContour } from '../../src/domain/geometry/raster-contour.js';
import { compoundWrapPieces } from '../../src/domain/geometry/compound-contour.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { setTextWrap } from '../../src/domain/documents/text-wrap.js';
import { textWrapObstacles, availableWrapSegments } from '../../src/domain/geometry/text-wrap.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';

function trace(size, sample, source) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) pixels.set(sample(x, y), 4 * (y * size + x));
  return { width: size, height: size, ...traceRasterContour(pixels, size, size, source) };
}
function fixture() {
  const doc = createSceneDocument('Image wrap'),
    page = doc.pages[0].id;
  const frame = insertObject(doc, 'text', page, { x: 0, y: 0, w: 200, h: 160 });
  const img = insertObject(doc, 'image', page, {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: 'asset:wrap-pic',
  });
  setTextWrap(doc, [img.id], { mode: 'contour', contour: { source: 'alpha' } });
  return { doc, frame, img };
}
const intervals = (obstacles, top = 50, bottom = 51) =>
  availableWrapSegments(obstacles, { top, bottom, left: 0, right: 200 }).map((s) => [
    s.left,
    s.right,
  ]);
test('image transparency, white edges and interior counters are independent choices', () => {
  const ring = (x, y) =>
    x >= 10 && x < 90 && y >= 10 && y < 90 && !(x >= 30 && x < 70 && y >= 30 && y < 70);
  const { frame, img, doc } = fixture();
  const measure = (image) =>
    intervals(textWrapObstacles(doc, frame, { imageContours: { get: () => image } }));
  const cutout = trace(100, (x, y) => [0, 0, 0, ring(x, y) ? 255 : 0], 'alpha');
  assert.deepEqual(measure(cutout), [
    [0, 10],
    [90, 200],
  ]);
  setTextWrap(doc, [img.id], { contour: { insideEdges: true } });
  assert.deepEqual(measure(cutout), [
    [0, 10],
    [30, 70],
    [90, 200],
  ]);
  const white = (x, y) => (ring(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.deepEqual(measure(trace(100, white, 'alpha')), [[100, 200]]);
  setTextWrap(doc, [img.id], { contour: { source: 'edges' } });
  assert.deepEqual(measure(trace(100, white, 'edges')), [
    [0, 10],
    [30, 70],
    [90, 200],
  ]);
  const roundTrip = validateImport({
    schemaVersion: archiveVersion([doc]),
    documents: [doc],
    assets: [{ id: 'wrap-pic', mimeType: 'image/png', data: 'data:image/png;base64,AAAA' }],
  });
  assert.equal(
    roundTrip.documents[0].blocks.find((b) => b.id === img.id).textWrap.contour.insideEdges,
    true,
  );
  assert.throws(() => validateImport({ ...roundTrip, schemaVersion: 26 }), /archive 27/);
  setTextWrap(doc, [img.id], { contour: { source: 'frame' } });
  assert.deepEqual(img.textWrap.contour, { source: 'frame' });
});
test('cropping, contain, and clip-before-offset apply in placement units', () => {
  const { frame, img, doc } = fixture();
  const image = {
    ...trace(10, (x) => [0, 0, 0, x < 5 ? 255 : 0], 'alpha'),
    width: 200,
    height: 100,
  };
  const measure = (top) =>
    intervals(textWrapObstacles(doc, frame, { imageContours: { get: () => image } }), top, top + 1);
  img.fit = 'contain';
  assert.deepEqual(measure(5), [[0, 200]]);
  assert.deepEqual(measure(50), [[50, 200]]);
  img.fit = 'cover';
  img.crop = { x: 100, y: 50 };
  assert.deepEqual(measure(50), [[0, 200]]);
  img.crop.x = 0;
  setTextWrap(doc, [img.id], { offsets: { left: 5, right: 5, top: 5, bottom: 5 } });
  assert.deepEqual(measure(50), [[105, 200]]);
});
test('eroding a narrow neck splits a concave contour while keeping both lobes', () => {
  const contour = [
    [0, 0],
    [40, 0],
    [40, 18],
    [60, 18],
    [60, 0],
    [100, 0],
    [100, 40],
    [60, 40],
    [60, 22],
    [40, 22],
    [40, 40],
    [0, 40],
  ].map(([x, y]) => ({ x, y }));
  const polygons = compoundWrapPieces([contour], [], -3);
  const gaps = intervals(
    [
      {
        mode: 'contour',
        side: 'both',
        invert: false,
        polygons,
        bounds: { left: 3, right: 97, top: 3, bottom: 37 },
      },
    ],
    19,
    21,
  );
  assert.deepEqual(gaps, [
    [0, 3],
    [37, 63],
    [97, 200],
  ]);
});

test('a bordered picture uses the actual inner image viewport and caption bounds', () => {
  const { doc, frame, img } = fixture();
  img.frameOptions = { strokeWidth: 5, stroke: 'none' };
  img.caption = 'Caption';
  const decoded = { ...trace(10, (x) => [0, 0, 0, x < 5 ? 255 : 0], 'alpha'), viewportHeight: 60 };
  img.fit = 'contain';
  const obstacles = textWrapObstacles(doc, frame, { imageContours: { get: () => decoded } });
  assert.deepEqual(intervals(obstacles, 30, 32), [
    [0, 20],
    [50, 200],
  ]);
  assert.deepEqual(intervals(obstacles, 66, 70), [[0, 200]]);
  assert.deepEqual(intervals(obstacles, 80, 82), [
    [0, 5],
    [95, 200],
  ]);
});
