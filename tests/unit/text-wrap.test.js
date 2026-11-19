import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneDocument,
  insertObject,
  addPage,
  isSceneDocument,
  releaseMask,
} from '../../src/domain/documents/scene.js';
import {
  addLayer,
  createParent,
  applyParent,
  commitParentDefinition,
} from '../../src/domain/documents/publishing.js';
import {
  normalizeTextWrap,
  normalizeTextWrapPreferences,
  setTextWrap,
  setIgnoreTextWrap,
  setTextWrapPreferences,
  setLayerIgnoreWrap,
  ensureTextWrapFlows,
} from '../../src/domain/documents/text-wrap.js';
import {
  textWrapObstacles,
  textWrapBand,
  availableWrapSegments,
  textWrapPageSide,
} from '../../src/domain/geometry/text-wrap.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import {
  archiveVersion,
  markTypographyVersion,
  CURRENT_ARCHIVE_VERSION,
  CURRENT_CANVAS_VERSION,
} from '../../src/domain/documents/capabilities.js';
import {
  startTextFlow,
  enableNativeComposition,
  appendTextFlowPage,
} from '../../src/domain/documents/text-flows.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
} from '../../src/domain/documents/clipboard.js';
const offsets = (value) => ({ top: value, right: value, bottom: value, left: value });
const rectangle = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const concave = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0.7, y: 1 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.3 },
  { x: 0.3, y: 1 },
  { x: 0, y: 1 },
];
function fixture(points = rectangle) {
  const doc = createSceneDocument('Wrapping'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 0,
      y: 0,
      w: 300,
      h: 250,
      html: '<p>Keep <em>this source.</em></p>',
    }),
    object = insertObject(doc, 'polygon', doc.pages[0].id, {
      x: 40,
      y: 30,
      w: 100,
      h: 100,
      stroke: 'none',
      strokeWidth: 0,
    });
  object.points = points.map((p, i) => ({ ...p, id: object.id + '-vertex-' + i }));
  object.stroke = 'none';
  object.strokeWidth = 0;
  return { doc, frame, object };
}
const band = (top = 40, bottom = 50) => ({ left: 0, right: 300, top, bottom });
const segments = (doc, frame, value = band()) =>
  availableWrapSegments(textWrapObstacles(doc, frame), value);

function rectangleObstacle(left, top, right, bottom, extra = {}) {
  return {
    mode: 'bounds',
    side: 'both',
    bounds: { left, top, right, bottom },
    polygons: [
      [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    ],
    ...extra,
  };
}

/** Coordinate-cell oracle, independent of interval subtraction/union code. */
function rectangleCells(obstacles, query) {
  const active = obstacles
      .map((obstacle) => obstacle.bounds)
      .filter(
        (bounds) =>
          bounds.top < query.bottom &&
          bounds.bottom > query.top &&
          bounds.left < query.right &&
          bounds.right > query.left,
      ),
    endpoints = [
      ...new Set([
        query.left,
        query.right,
        ...active.flatMap((bounds) => [
          Math.max(query.left, bounds.left),
          Math.min(query.right, bounds.right),
        ]),
      ]),
    ].sort((a, b) => a - b),
    output = [];
  for (let index = 0; index < endpoints.length - 1; index++) {
    const left = endpoints[index],
      right = endpoints[index + 1],
      midpoint = (left + right) / 2;
    if (active.some((bounds) => bounds.left < midpoint && bounds.right > midpoint)) continue;
    const previous = output.at(-1);
    if (previous && previous.right === left) previous.right = right;
    else output.push({ left, right });
  }
  return output;
}

test('many simultaneous rectangle exclusions agree with an independent coordinate-cell oracle', () => {
  for (const count of [1, 16, 128, 650, 1024]) {
    const query = { left: 0, right: 14400, top: 20, bottom: 35 },
      obstacles = Array.from({ length: count }, (_, index) =>
        rectangleObstacle(
          ((index + 0.5) * query.right) / count,
          0,
          ((index + 1) * query.right) / count,
          100,
        ),
      ),
      before = structuredClone(obstacles),
      expected = rectangleCells(obstacles, query),
      actual = textWrapBand(obstacles, query);
    assert.deepEqual(actual.segments, expected, `${count} rectangles`);
    assert.deepEqual(textWrapBand([...obstacles].reverse(), query), actual);
    assert.equal(actual.nextY, 100);
    assert.deepEqual(obstacles, before);
  }
  for (let seed = 1; seed <= 20; seed++) {
    const query = { left: 10, right: 300, top: 10, bottom: 25 },
      obstacles = Array.from({ length: 80 }, (_, index) => {
        const left = ((index * 71 + seed * 11) % 370) - 30;
        return rectangleObstacle(
          left,
          (index % 3) * 20,
          left + 1 + ((index * 13 + seed) % 35),
          (index % 3) * 20 + 15 + (index % 4) * 20,
        );
      });
    assert.deepEqual(textWrapBand(obstacles, query).segments, rectangleCells(obstacles, query));
  }
});

test('batched ordinary exclusions commute with side and multiple inverse constraints', () => {
  const left = rectangleObstacle(20, 0, 100, 100),
    right = rectangleObstacle(150, 0, 250, 100),
    obstacles = [
      rectangleObstacle(40, 0, 60, 100),
      rectangleObstacle(90, 0, 160, 100),
      rectangleObstacle(170, 0, 190, 100),
      rectangleObstacle(220, 0, 240, 100, { side: 'left' }),
      {
        ...left,
        invert: true,
        bounds: { left: 20, top: 0, right: 250, bottom: 100 },
        polygons: [...left.polygons, ...right.polygons],
      },
      rectangleObstacle(30, 0, 230, 100, { invert: true }),
    ],
    query = { left: 0, right: 300, top: 40, bottom: 50 },
    expected = [
      { left: 30, right: 40 },
      { left: 60, right: 90 },
      { left: 160, right: 170 },
      { left: 190, right: 220 },
    ],
    before = structuredClone(obstacles);
  for (let offset = 0; offset < obstacles.length; offset++) {
    const ordered = obstacles.slice(offset).concat(obstacles.slice(0, offset));
    assert.deepEqual(textWrapBand(ordered, query), {
      segments: expected,
      nextColumn: false,
      nextY: 100,
    });
    assert.deepEqual(textWrapBand([...ordered].reverse(), query).segments, expected);
  }
  assert.deepEqual(obstacles, before);
});

test('normal-exclusion sweep preserves page-side choices, jump flags and boundary events', () => {
  const query = { left: 0, right: 300, top: 40, bottom: 50, pageSide: 'left' },
    normal = rectangleObstacle(180, 0, 200, 100),
    inside = rectangleObstacle(140, 0, 160, 100, { side: 'inside' }),
    inverted = rectangleObstacle(20, 0, 280, 100, { invert: true });
  assert.deepEqual(textWrapBand([normal, inside, inverted], query).segments, [
    { left: 160, right: 180 },
    { left: 200, right: 280 },
  ]);
  for (const mode of ['jump', 'next-column']) {
    const obstacle = rectangleObstacle(100, 0, 130, 80, { mode });
    for (const ordered of [
      [normal, inside, inverted, obstacle],
      [obstacle, inverted, inside, normal],
    ])
      assert.deepEqual(textWrapBand(ordered, query), {
        segments: [],
        nextColumn: mode === 'next-column',
        nextY: 80,
      });
  }
  const touching = [
    rectangleObstacle(40, 0, 50, 100),
    rectangleObstacle(50 + 0.00000005, 0, 60, 100),
  ];
  assert.deepEqual(textWrapBand(touching, query).segments, [
    { left: 0, right: 40 },
    { left: 60, right: 300 },
  ]);
});

test('text-wrap options are typed, mode-specific and reject unimplemented contour sources', () => {
  assert.deepEqual(normalizeTextWrap(), {
    mode: 'none',
    offsets: offsets(0),
    side: 'both',
    invert: false,
    contour: { source: 'frame' },
  });
  assert.deepEqual(normalizeTextWrapPreferences(), {
    onlyBelow: false,
    facingPages: false,
    firstPageSide: 'right',
  });
  for (const input of [
    null,
    [],
    { mode: 'magic' },
    { mode: null },
    { side: 'top' },
    { invert: 'false' },
    { offsets: null },
    { offsets: { left: NaN } },
    { offsets: { left: null } },
    { offsets: { right: 2001 } },
    { offsets: { unknown: 0 } },
    { contour: { source: 'alpha' } },
    { version: 2 },
  ])
    assert.throws(() => normalizeTextWrap(input));
  assert.throws(() => normalizeTextWrap({ mode: 'contour', offsets: { left: 2 } }), /uniform/);
  assert.equal(normalizeTextWrap({ mode: 'contour', offsets: offsets(-2.25) }).offsets.left, -2.25);
  assert.throws(() => normalizeTextWrapPreferences({ onlyBelow: 'false' }));
  assert.throws(() => normalizeTextWrapPreferences({ firstPageSide: null }));
});

test('wrap commands validate all selected objects before mutation and preserve source', () => {
  const { doc, frame, object } = fixture(),
    before = structuredClone(doc);
  assert.throws(() => setTextWrap(doc, [object.id, 'missing'], { mode: 'bounds' }));
  assert.deepEqual(doc, before);
  assert.throws(() => setIgnoreTextWrap(doc, [object.id], true));
  assert.deepEqual(doc, before);
  setTextWrap(doc, [object.id], { mode: 'bounds', offsets: { left: 4.25, right: -2 } });
  assert.equal(doc.canvasVersion, 8);
  assert.equal(archiveVersion([doc]), 9);
  assert.ok(isSceneDocument(doc));
  assert.equal(doc.textFlows[0].html, before.blocks[0].html);
  assert.equal(frame.html, '');
  assert.throws(() => setTextWrap(doc, [object.id], { mode: 'contour' }), /uniform/);
  setTextWrap(doc, [object.id], { mode: 'none' });
  markTypographyVersion(doc);
  assert.equal(doc.canvasVersion, 8);
  assert.equal(archiveVersion([doc]), 9);
  object.locked = true;
  assert.throws(() => setTextWrap(doc, [object.id], { mode: 'bounds' }), /unlocked/);
});

test('bounding wrap includes visible stroke, independent offsets and complete band contact', () => {
  const { doc, frame, object } = fixture();
  Object.assign(frame, { x: 36, y: 36, w: 464, h: 364 });
  Object.assign(object, { x: 50, y: 50, w: 190, h: 90, stroke: '#000000', strokeWidth: 1 });
  setTextWrap(doc, [object.id], { mode: 'bounds', offsets: offsets(8), side: 'right' });
  assert.deepEqual(
    availableWrapSegments(textWrapObstacles(doc, frame), {
      left: 0,
      right: 464,
      top: 0,
      bottom: 20,
    }),
    [{ left: 212.5, right: 464 }],
  );
  assert.deepEqual(
    availableWrapSegments(textWrapObstacles(doc, frame), {
      left: 0,
      right: 464,
      top: 112.5,
      bottom: 130,
    }),
    [{ left: 0, right: 464 }],
  );
  setTextWrap(doc, [object.id], {
    side: 'both',
    offsets: { top: 0, right: 4, bottom: 0, left: 2 },
  });
  assert.deepEqual(
    availableWrapSegments(textWrapObstacles(doc, frame), {
      left: 0,
      right: 464,
      top: 20,
      bottom: 30,
    }),
    [
      { left: 0, right: 11.5 },
      { left: 208.5, right: 464 },
    ],
  );
});

test('shape wrap follows full-band triangle extrema and preserves concave openings', () => {
  const { doc, frame, object } = fixture([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  setTextWrap(doc, [object.id], { mode: 'contour' });
  assert.deepEqual(segments(doc, frame, band(30, 50)), [
    { left: 0, right: 40 },
    { left: 60, right: 300 },
  ]);
  const next = fixture(concave);
  setTextWrap(next.doc, [next.object.id], { mode: 'contour' });
  assert.deepEqual(segments(next.doc, next.frame, band(80, 100)), [
    { left: 0, right: 40 },
    { left: 70, right: 110 },
    { left: 140, right: 300 },
  ]);
  setTextWrap(next.doc, [next.object.id], { invert: true });
  assert.deepEqual(segments(next.doc, next.frame, band(80, 100)), [
    { left: 40, right: 70 },
    { left: 110, right: 140 },
  ]);
});

test('a masked image wraps visible clipped geometry, while parent Box remains a rectangle', () => {
  const {
      doc,
      frame,
      object: mask,
    } = fixture([
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 },
    ]),
    image = insertObject(doc, 'image', mask.pageId, {
      parentId: mask.id,
      x: -20,
      y: -20,
      w: 140,
      h: 140,
    }),
    row = band(30, 40);
  setTextWrap(doc, [mask.id, image.id], { mode: 'contour' });
  const source = JSON.stringify(doc),
    shape = segments(doc, frame, row);
  assert.deepEqual(shape, [
    { left: 0, right: 80 },
    { left: 100, right: 300 },
  ]);
  assert.equal(JSON.stringify(doc), source, 'Clipping is a read-only layout projection');
  setTextWrap(doc, [mask.id], { mode: 'none' });
  assert.deepEqual(segments(doc, frame, row), shape, 'Image wrap survives parent None');
  setTextWrap(doc, [image.id], { mode: 'bounds' });
  assert.deepEqual(segments(doc, frame, row), shape, 'Graphic Box honors its containing clip');
  setTextWrap(doc, [image.id], { mode: 'none' });
  setTextWrap(doc, [mask.id], { mode: 'bounds' });
  assert.deepEqual(segments(doc, frame, row), [
    { left: 0, right: 40 },
    { left: 140, right: 300 },
  ]);
  setTextWrap(doc, [mask.id], { mode: 'none' });
  setTextWrap(doc, [image.id], { mode: 'contour', offsets: offsets(8) });
  const padded = segments(doc, frame, band(75, 85));
  assert.ok(padded[0].right < 40 && padded[1].left > 140, 'Offset must expand AFTER clipping');
  setTextWrap(doc, [image.id], { offsets: offsets(0) });
  image.x = 500;
  assert.deepEqual(segments(doc, frame, row), [{ left: 0, right: 300 }]);
  releaseMask(doc, mask.id);
  assert.equal(textWrapObstacles(doc, frame).length, 1, 'Release restores independent image wrap');
});

test('nested rotated clipping, concave openings and empty intersections bound image exclusions', () => {
  const { doc, frame, object: mask } = fixture(concave),
    image = insertObject(doc, 'image', mask.pageId, {
      parentId: mask.id,
      x: -10,
      y: -10,
      w: 120,
      h: 120,
    });
  setTextWrap(doc, [image.id], { mode: 'contour' });
  assert.deepEqual(segments(doc, frame, band(80, 100)), [
    { left: 0, right: 40 },
    { left: 70, right: 110 },
    { left: 140, right: 300 },
  ]);
  const nested = insertObject(doc, 'polygon', mask.pageId, {
    parentId: mask.id,
    x: 20,
    y: 20,
    w: 60,
    h: 60,
    rotation: 33,
  });
  image.parentId = nested.id;
  nested.clip = true;
  Object.assign(image, { x: -100, y: -100, w: 300, h: 300 });
  const clipped = textWrapObstacles(doc, frame)[0];
  const c = Math.cos((33 * Math.PI) / 180),
    s = Math.sin((33 * Math.PI) / 180);
  for (const p of clipped.polygons.flat()) {
    const dx = p.x - 90,
      dy = p.y - 80;
    assert.ok(Math.abs(c * dx + s * dy) <= 30 + 1e-6);
    assert.ok(Math.abs(-s * dx + c * dy) <= 30 + 1e-6);
  }
  image.x = 1000;
  assert.deepEqual(textWrapObstacles(doc, frame), []);
  image.textWrap.invert = true;
  assert.deepEqual(segments(doc, frame), [], 'Empty inverted clip admits no text');
});

test('convex contour expansion/contraction is explicit and concave offset limitations reject atomically', () => {
  const { doc, frame, object } = fixture();
  setTextWrap(doc, [object.id], { mode: 'contour', offsets: offsets(5) });
  assert.deepEqual(segments(doc, frame), [
    { left: 0, right: 35 },
    { left: 145, right: 300 },
  ]);
  setTextWrap(doc, [object.id], { offsets: offsets(-10) });
  assert.deepEqual(segments(doc, frame, band(50, 60)), [
    { left: 0, right: 50 },
    { left: 130, right: 300 },
  ]);
  setTextWrap(doc, [object.id], { offsets: offsets(-60) });
  assert.deepEqual(segments(doc, frame), [{ left: 0, right: 300 }]);
  setTextWrap(doc, [object.id], { invert: true });
  assert.deepEqual(segments(doc, frame), []);
  const other = fixture(concave),
    before = structuredClone(other.doc);
  assert.throws(
    () => setTextWrap(other.doc, [other.object.id], { mode: 'contour', offsets: offsets(2) }),
    /Concave/,
  );
  assert.deepEqual(other.doc, before);
  other.object.stroke = '#000000';
  other.object.strokeWidth = 1;
  assert.throws(
    () => setTextWrap(other.doc, [other.object.id], { mode: 'contour' }),
    /stroke expansion/,
  );
});

test('side, inverse, spine and largest choices leave deterministic legal segments', () => {
  const { doc, frame, object } = fixture();
  setTextWrap(doc, [object.id], { mode: 'bounds', side: 'left' });
  assert.deepEqual(segments(doc, frame), [{ left: 0, right: 40 }]);
  setTextWrap(doc, [object.id], { side: 'right' });
  assert.deepEqual(segments(doc, frame), [{ left: 140, right: 300 }]);
  setTextWrap(doc, [object.id], { side: 'largest' });
  assert.deepEqual(segments(doc, frame), [{ left: 140, right: 300 }]);
  setTextWrap(doc, [object.id], { side: 'inside' });
  assert.deepEqual(segments(doc, frame), [{ left: 0, right: 40 }]);
  setTextWrapPreferences(doc, { facingPages: true, firstPageSide: 'left' });
  assert.deepEqual(segments(doc, frame), [{ left: 140, right: 300 }]);
  const next = addPage(doc, doc.pages[0].id);
  assert.equal(textWrapPageSide(doc, next.id), 'right');
  setTextWrap(doc, [object.id], { side: 'outside' });
  assert.deepEqual(segments(doc, frame), [{ left: 0, right: 40 }]);
  setTextWrap(doc, [object.id], { invert: true });
  assert.deepEqual(segments(doc, frame), [{ left: 40, right: 140 }]);
  assert.deepEqual(segments(doc, frame, band(0, 10)), []);
});

test('jump and next-column signal only overlapping bands and frame ignore wins', () => {
  const { doc, frame, object } = fixture();
  setTextWrap(doc, [object.id], {
    mode: 'jump',
    offsets: { top: 5, bottom: 10, left: 200, right: 200 },
  });
  assert.deepEqual(textWrapBand(textWrapObstacles(doc, frame), band()), {
    segments: [],
    nextColumn: false,
    nextY: 140,
  });
  assert.deepEqual(segments(doc, frame, band(140, 150)), [{ left: 0, right: 300 }]);
  setTextWrap(doc, [object.id], { mode: 'next-column', offsets: offsets(0) });
  assert.equal(textWrapBand(textWrapObstacles(doc, frame), band()).nextColumn, true);
  assert.equal(textWrapBand(textWrapObstacles(doc, frame), band(0, 10)).nextColumn, false);
  setIgnoreTextWrap(doc, [frame.id], true);
  assert.deepEqual(textWrapObstacles(doc, frame), []);
});

test('hidden-layer suppression, stack preference and locked/hidden obstacles remain distinct', () => {
  const { doc, frame, object } = fixture();
  setTextWrap(doc, [object.id], { mode: 'bounds' });
  object.hidden = true;
  object.locked = true;
  assert.equal(textWrapObstacles(doc, frame).length, 1);
  const layer = doc.publishing.layers[0];
  layer.visible = false;
  assert.equal(textWrapObstacles(doc, frame).length, 1);
  setLayerIgnoreWrap(doc, layer.id, true);
  assert.equal(textWrapObstacles(doc, frame).length, 0);
  layer.visible = true;
  assert.equal(textWrapObstacles(doc, frame).length, 1);
  doc.blocks = [object, frame];
  setTextWrapPreferences(doc, { onlyBelow: true });
  assert.equal(textWrapObstacles(doc, frame).length, 0);
  const top = addLayer(doc, 'Above');
  object.layerId = top.id;
  assert.equal(textWrapObstacles(doc, frame).length, 1);
});

test('hierarchy transforms cancel into text-local coordinates and exclude a group own text', () => {
  const { doc, frame, object } = fixture();
  const group = insertObject(doc, 'polygon', doc.pages[0].id, {
    x: 100,
    y: 200,
    w: 300,
    h: 300,
    rotation: 35,
    clip: true,
    stroke: 'none',
  });
  group.clip = true;
  group.stroke = 'none';
  frame.parentId = object.parentId = group.id;
  Object.assign(frame, { x: 10, y: 20, textScale: { x: 2, y: 2 } });
  Object.assign(object, { x: 70, y: 50 });
  setTextWrap(doc, [object.id, group.id], { mode: 'bounds' });
  const obstacles = textWrapObstacles(doc, frame, { column: { left: 10, top: 5 } });
  assert.equal(obstacles.length, 1);
  // Bounds wrap is the world-axis bounding box of the transformed object, then
  // mapped back into this frame; contour wrap instead follows its rotated path.
  setTextWrap(doc, [object.id], { mode: 'contour' });
  const bounds = textWrapObstacles(doc, frame, { column: { left: 10, top: 5 } })[0].bounds;
  for (const [key, value] of Object.entries({ left: 20, top: 10, right: 70, bottom: 60 }))
    assert.ok(Math.abs(bounds[key] - value) < 1e-6, key);
  assert.equal(textWrapObstacles(doc, group).length, 0);
});

// Frozen old representation: native composition exists, object wrap does not.
const archive8 = JSON.parse(
  '{"schemaVersion":8,"documents":[{"id":"frozen-wrap-before","title":"Before wrapping","canvasVersion":7,"pages":[{"id":"frozen-wrap-page","name":"Page 1","width":612,"height":792}],"blocks":[{"id":"frozen-wrap-frame","type":"text","textKind":"area","textFlowId":"frozen-wrap-flow","pageId":"frozen-wrap-page","x":40.125,"y":50.25,"w":300.5,"h":200.75,"html":"","textStyle":"cmu-serif","fontSize":16}],"textFlows":[{"id":"frozen-wrap-flow","html":"<p>Keep <em>original</em> source.</p>","frameIds":["frozen-wrap-frame"],"style":{"textStyle":"cmu-serif","fontSize":16,"align":"left"},"composition":{"version":1,"composer":"single-line"},"automaticPages":true,"deleteEmptyPages":true,"autoPages":[]}],"extensions":{"kept":{"x":1}}}],"assets":[]}',
);
test('frozen archive8 opens without wrap opt-in or input mutation', () => {
  const before = JSON.stringify(archive8),
    decoded = validateImport(archive8);
  assert.equal(JSON.stringify(archive8), before);
  assert.equal(decoded.schemaVersion, 8);
  const doc = decoded.documents[0];
  assert.equal(doc.canvasVersion, 7);
  assert.equal(archiveVersion([doc]), 8);
  assert.equal(doc.textWrapPreferences, undefined);
  assert.equal(doc.blocks[0].textWrap, undefined);
  assert.deepEqual(validateImport(decoded), decoded);
});

test('archive9 round trips wrap, preferences, layers, parents, native flows and copied objects', () => {
  const { doc, frame, object } = fixture();
  const parent = createParent(doc, doc.pages[0].id, 'Wrap parent');
  setTextWrap(doc, [object.id], { mode: 'bounds', offsets: offsets(2.125) });
  setIgnoreTextWrap(doc, [frame.id], true);
  setTextWrapPreferences(doc, { onlyBelow: true });
  setLayerIgnoreWrap(doc, doc.publishing.layers[0].id, true);
  parent.blocks[1].textWrap = structuredClone(object.textWrap);
  applyParent(doc, doc.pages[0].id, parent.id);
  const decoded = validateImport({ schemaVersion: 9, documents: [doc], assets: [] });
  assert.deepEqual(validateImport(decoded), decoded);
  assert.equal(decoded.documents[0].publishing.parents[0].blocks[1].textWrap.offsets.left, 2.125);
  const copied = copyDocument(doc);
  assert.equal(copied.blocks[1].textWrap.offsets.left, 2.125);
  const clipboard = readObjectClipboard(
      JSON.stringify(copyObjectSelection(doc, [frame.id, object.id])),
    ),
    dest = createSceneDocument('Destination');
  pasteObjectSelection(dest, clipboard, { pageId: dest.pages[0].id });
  assert.equal(dest.canvasVersion, 8);
  assert.equal(dest.blocks[1].textWrap.offsets.left, 2.125);
  const flow = startTextFlow(doc, frame.id);
  enableNativeComposition(doc, flow, 'single-line');
  const continuation = appendTextFlowPage(doc, flow);
  assert.equal(continuation.ignoreTextWrap, true);
  assert.equal(
    validateImport({ schemaVersion: 9, documents: [doc], assets: [] }).documents[0].textFlows[0]
      .composition.composer,
    'single-line',
  );
  const proxy = structuredClone(doc);
  proxy.textFlows = [];
  proxy.blocks = parent.blocks.map((b) => ({ ...structuredClone(b), pageId: parent.id }));
  proxy.pages = [{ id: parent.id, name: parent.name, width: parent.width, height: parent.height }];
  commitParentDefinition(doc, parent.id, proxy);
  assert.equal(doc.canvasVersion, 8);
});

test('new wrap declarations reject under old gates and malformed new source never normalizes away', () => {
  const { doc, object } = fixture();
  setTextWrap(doc, [object.id], { mode: 'bounds' });
  assert.throws(
    () => validateImport({ schemaVersion: 8, documents: [doc], assets: [] }),
    /schema 9/,
  );
  const old = structuredClone(doc);
  old.canvasVersion = 7;
  assert.throws(
    () => validateImport({ schemaVersion: 9, documents: [old], assets: [] }),
    /archive 9/,
  );
  for (const mutate of [
    (d) => {
      d.blocks[1].textWrap.offsets.left = Infinity;
    },
    (d) => {
      d.blocks[1].textWrap.contour.source = 'alpha';
    },
    (d) => {
      d.blocks[1].ignoreTextWrap = true;
    },
    (d) => {
      d.publishing.layers[0].ignoreWrap = 'false';
    },
    (d) => {
      d.textWrapPreferences = { onlyBelow: 1 };
    },
  ]) {
    const invalid = structuredClone(doc);
    mutate(invalid);
    assert.throws(() => validateImport({ schemaVersion: 9, documents: [invalid], assets: [] }));
  }
  const bad = structuredClone(doc);
  bad.canvasVersion = CURRENT_CANVAS_VERSION + 1;
  assert.throws(
    () => validateImport({ schemaVersion: 9, documents: [bad], assets: [] }),
    /supported canvas/,
  );
  assert.throws(
    () => validateImport({ schemaVersion: CURRENT_ARCHIVE_VERSION + 1, documents: [], assets: [] }),
    /unsupported schema/,
  );
  assert.equal(doc.textFlows[0].html, '<p>Keep <em>this source.</em></p>');
});

test('wrap adoption creates one canonical area-flow owner in the authored transaction, preserving point text and quote style', () => {
  const { doc, frame, object } = fixture(),
    original = frame.html;
  const point = insertObject(doc, 'text', doc.pages[0].id, { html: 'Point', textKind: 'point' }),
    quote = insertObject(doc, 'quote', doc.pages[0].id, {
      html: '<p>Quote <strong>source.</strong></p>',
    });
  setTextWrap(doc, [object.id], { mode: 'bounds' });
  assert.equal(doc.textFlows.length, 2);
  assert.equal(doc.textFlows.find((flow) => flow.frameIds.includes(frame.id)).html, original);
  const quoteFlow = doc.textFlows.find((flow) => flow.frameIds.includes(quote.id));
  assert.equal(quoteFlow.style.italic, true);
  assert.equal(quoteFlow.html, '<p>Quote <strong>source.</strong></p>');
  assert.equal(quoteFlow.automaticPages, false);
  assert.equal(point.textFlowId, undefined);
  assert.equal(point.html, 'Point');
  const before = structuredClone(doc);
  assert.deepEqual(ensureTextWrapFlows(doc), []);
  assert.deepEqual(doc, before);
  const extra = insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Added later</p>' });
  assert.throws(
    () => validateImport({ schemaVersion: 9, documents: [doc], assets: [] }),
    /canonical text flows/,
  );
  assert.equal(extra.textFlowId, undefined, 'Validation must not migrate malformed new source');
  assert.equal(ensureTextWrapFlows(doc).length, 1);
  assert.equal(
    doc.textFlows.find((flow) => flow.frameIds.includes(extra.id)).html,
    '<p>Added later</p>',
  );
  const ready = structuredClone(doc);
  validateImport({ schemaVersion: 9, documents: [doc], assets: [] });
  assert.deepEqual(doc, ready);
});

test('parent templates retain direct source while applying their wrap promotes real page frames only', () => {
  const { doc, frame } = fixture(),
    parent = createParent(doc, doc.pages[0].id, 'Inherited wrap');
  const proxy = {
    ...structuredClone(doc),
    id: 'parent-edit-wrap',
    pages: [{ id: parent.id, name: parent.name, width: parent.width, height: parent.height }],
    blocks: parent.blocks.map((block) => ({ ...structuredClone(block), pageId: parent.id })),
    textFlows: [],
  };
  setTextWrap(proxy, [proxy.blocks[1].id], { mode: 'bounds' });
  assert.equal(proxy.textFlows.length, 0);
  assert.equal(proxy.blocks[0].html, frame.html);
  commitParentDefinition(doc, parent.id, proxy);
  applyParent(doc, doc.pages[0].id, parent.id);
  assert.equal(ensureTextWrapFlows(doc).length, 1);
  assert.equal(doc.textFlows[0].html, '<p>Keep <em>this source.</em></p>');
  const decoded = validateImport({ schemaVersion: 9, documents: [doc], assets: [] }).documents[0];
  assert.equal(decoded.publishing.parents[0].blocks[0].textFlowId, undefined);
  assert.equal(decoded.publishing.parents[0].blocks[0].html, '<p>Keep <em>this source.</em></p>');
  assert.ok(
    textWrapObstacles(doc, frame).some((obstacle) =>
      obstacle.id.startsWith(doc.pages[0].id + '--'),
    ),
  );
});

test('pentagrams and overlapping contours reject before commands, import and triangulation despite same-sign local turns', () => {
  const vertices = Array.from({ length: 5 }, (_, i) => ({
    x: 0.5 + 0.45 * Math.cos((i * Math.PI * 2) / 5),
    y: 0.5 + 0.45 * Math.sin((i * Math.PI * 2) / 5),
  }));
  const pentagram = [0, 2, 4, 1, 3].map((i) => vertices[i]);
  const turns = pentagram.map((a, i) => {
    const b = pentagram[(i + 1) % 5],
      c = pentagram[(i + 2) % 5];
    return Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  });
  assert.ok(
    turns.every((value) => value === turns[0] && value !== 0),
    'Witness must defeat a local-turn-only test',
  );
  for (const points of [
    pentagram,
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
    ],
  ]) {
    const { doc, frame, object } = fixture(points);
    setTextWrap(doc, [object.id], { mode: 'bounds' });
    const before = structuredClone(doc);
    assert.throws(() => setTextWrap(doc, [object.id], { mode: 'contour' }), /Self-/);
    assert.deepEqual(doc, before, 'Rejected contour must not change authored state or ownership');
    object.textWrap = normalizeTextWrap({ mode: 'contour' });
    assert.throws(
      () => validateImport({ schemaVersion: 9, documents: [doc], assets: [] }),
      /Self-/,
    );
    assert.throws(() => textWrapObstacles(doc, frame), /Self-/);
  }
  const simple = fixture(concave);
  setTextWrap(simple.doc, [simple.object.id], { mode: 'contour' });
  assert.doesNotThrow(() =>
    validateImport({ schemaVersion: 9, documents: [simple.doc], assets: [] }),
  );
  assert.deepEqual(segments(simple.doc, simple.frame, band(80, 100)), [
    { left: 0, right: 40 },
    { left: 70, right: 110 },
    { left: 140, right: 300 },
  ]);
  const collinear = fixture([
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  setTextWrap(collinear.doc, [collinear.object.id], { mode: 'contour' });
  assert.deepEqual(segments(collinear.doc, collinear.frame), [
    { left: 0, right: 40 },
    { left: 140, right: 300 },
  ]);
  const nearCollinear = fixture([
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 + Number.EPSILON / 2 },
    { x: 0, y: 1 },
  ]);
  setTextWrap(nearCollinear.doc, [nearCollinear.object.id], { mode: 'contour' });
  assert.doesNotThrow(() =>
    validateImport({ schemaVersion: 9, documents: [nearCollinear.doc], assets: [] }),
  );
  assert.doesNotThrow(
    () => textWrapObstacles(nearCollinear.doc, nearCollinear.frame),
    'A valid tiny turn must not be guessed collinear by an epsilon',
  );
});

test('commands and archive validation share unsupported cross-field contour rules, including parent templates', () => {
  const unsupported = [
    {
      change: (object) => {
        object.frameOptions = { corner: 4 };
      },
      patch: { mode: 'contour' },
      error: /Rounded-frame/,
    },
    {
      change: (object) => {
        object.points = concave.map((p, i) => ({ ...p, id: object.id + '-bad-' + i }));
      },
      patch: { mode: 'contour', offsets: offsets(2) },
      error: /Concave/,
    },
    {
      change: (object) => {
        object.points = concave.map((p, i) => ({ ...p, id: object.id + '-bad-' + i }));
        object.stroke = '#000000';
        object.strokeWidth = 1;
      },
      patch: { mode: 'contour' },
      error: /stroke expansion/,
    },
    { change: () => {}, patch: { mode: 'jump', invert: true }, error: /Inverted jump/ },
    { change: () => {}, patch: { mode: 'next-column', invert: true }, error: /Inverted jump/ },
  ];
  for (const { change, patch, error } of unsupported) {
    const { doc, frame, object } = fixture();
    const parent = createParent(doc, doc.pages[0].id, 'Template proof');
    setTextWrap(doc, [object.id], { mode: 'bounds' });
    change(object);
    const before = structuredClone(doc);
    assert.throws(() => setTextWrap(doc, [object.id], patch), error);
    assert.deepEqual(doc, before);
    object.textWrap = normalizeTextWrap(patch);
    assert.throws(() => validateImport({ schemaVersion: 9, documents: [doc], assets: [] }), error);
    assert.throws(() => textWrapObstacles(doc, frame), error);
    object.textWrap = normalizeTextWrap({ mode: 'bounds' });
    change(parent.blocks[1]);
    parent.blocks[1].textWrap = normalizeTextWrap(patch);
    assert.throws(
      () => validateImport({ schemaVersion: 9, documents: [doc], assets: [] }),
      error,
      'Parent-template context must not skip object/contour validation',
    );
  }
});

test('object paste atomically adopts destination area frames when it introduces active wrap', () => {
  const source = fixture();
  setTextWrap(source.doc, [source.object.id], { mode: 'bounds', offsets: offsets(3) });
  const clipboard = readObjectClipboard(
      JSON.stringify(copyObjectSelection(source.doc, [source.object.id])),
    ),
    destination = createSceneDocument('Paste wrap'),
    area = insertObject(destination, 'text', destination.pages[0].id, {
      html: '<p>Destination <em>source</em></p>',
    }),
    point = insertObject(destination, 'text', destination.pages[0].id, {
      html: 'Point',
      textKind: 'point',
    });
  const originalId = area.id;
  pasteObjectSelection(destination, clipboard, { pageId: destination.pages[0].id });
  assert.equal(area.id, originalId); // References held before the atomic replacement remain untouched.
  const adopted = destination.blocks.find((block) => block.id === originalId);
  assert.equal(destination.textFlows.length, 1);
  assert.equal(destination.textFlows[0].frameIds[0], originalId);
  assert.equal(destination.textFlows[0].html, '<p>Destination <em>source</em></p>');
  assert.equal(adopted.html, '');
  assert.equal(adopted.textFlowId, destination.textFlows[0].id);
  assert.equal(destination.blocks.find((block) => block.id === point.id).textFlowId, undefined);
  assert.deepEqual(ensureTextWrapFlows(destination), []);
  assert.doesNotThrow(() =>
    validateImport({ schemaVersion: 9, documents: [destination], assets: [] }),
  );
  const existingFlow = destination.textFlows[0].id,
    plain = createSceneDocument('Plain source'),
    plainFrame = insertObject(plain, 'text', plain.pages[0].id, {
      html: '<p>Another independent area frame</p>',
    });
  pasteObjectSelection(
    destination,
    readObjectClipboard(JSON.stringify(copyObjectSelection(plain, [plainFrame.id]))),
    { pageId: destination.pages[0].id },
  );
  assert.equal(destination.textFlows.length, 2);
  assert.equal(destination.textFlows[0].id, existingFlow);
  assert.equal(destination.textFlows[1].html, '<p>Another independent area frame</p>');
  assert.doesNotThrow(() =>
    validateImport({ schemaVersion: 9, documents: [destination], assets: [] }),
  );
});
