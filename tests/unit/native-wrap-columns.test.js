import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { setTextWrap } from '../../src/domain/documents/text-wrap.js';
import { startTextFlow } from '../../src/domain/documents/text-flows.js';
import { nativeFlowColumns } from '../../src/rendering/text/native-flow-layout.js';
import {
  nativeWrapColumns,
  validateNativeWrapping,
} from '../../src/rendering/text/native-wrap-columns.js';

test('native exclusions convert page, inset, scale and physical column origins exactly once', () => {
  const doc = createSceneDocument('Native wrapped columns'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 20,
      y: 30,
      w: 300,
      h: 200,
      textScale: { x: 2, y: 2 },
      frameOptions: {
        columns: 2,
        gutter: 20,
        insetLeft: 20,
        insetRight: 20,
        insetTop: 10,
        insetBottom: 10,
      },
    }),
    flow = startTextFlow(doc, frame.id),
    object = insertObject(doc, 'polygon', doc.pages[0].id, {
      x: 120,
      y: 50,
      w: 80,
      h: 40,
      stroke: 'none',
    });
  object.strokeWidth = 0;
  setTextWrap(doc, [object.id], { mode: 'bounds' });
  const before = structuredClone(doc),
    columns = nativeWrapColumns(doc, nativeFlowColumns(doc, flow));
  assert.deepEqual(
    columns.map((c) => ({ width: c.width, left: c.left, top: c.top })),
    [
      { width: 60, left: 10, top: 5 },
      { width: 60, left: 80, top: 5 },
    ],
  );
  assert.deepEqual(
    columns.map((c) => c.obstacles[0].bounds),
    [
      { left: 40, top: 5, right: 80, bottom: 25 },
      { left: -30, top: 5, right: 10, bottom: 25 },
    ],
  );
  assert.deepEqual(doc, before);
  frame.ignoreTextWrap = true;
  assert(nativeWrapColumns(doc, nativeFlowColumns(doc, flow)).every((c) => !c.obstacles.length));
});

test('native wrapping source admission preserves unsupported source and exact geometry', () => {
  const source = {
      text: 'Plain text\u2029',
      paragraphs: [{ start: 0, end: 11, align: 'left' }],
      runs: [{ start: 0, end: 11, font: 'cmu', size: 16, leading: 0, autoLeading: 120 }],
    },
    columns = [{ width: 300, height: 200, verticalAlign: 'top', obstacles: [{ id: 'blocker' }] }],
    before = structuredClone(source);
  validateNativeWrapping(source, columns);
  assert.deepEqual(source, before);
  const styled = structuredClone(source);
  styled.paragraphs[0].align = 'center';
  styled.runs[0].horizontalScale = 125;
  styled.runs[0].features = { smcp: true };
  styled.runs = [
    { ...styled.runs[0], end: 5 },
    { ...styled.runs[0], start: 5, font: 'other', size: 30 },
  ];
  validateNativeWrapping(styled, columns);
  for (const mutate of [
    (s) => {
      s.runs[0].verticalScale = 125;
    },
    (s) => {
      s.runs[0].baselineShift = 3;
    },
    (s) => {
      s.text = 'With\ttabs\u2029';
    },
  ]) {
    const candidate = structuredClone(source);
    mutate(candidate);
    const saved = structuredClone(candidate);
    assert.throws(() => validateNativeWrapping(candidate, columns), /does not yet support/);
    assert.deepEqual(candidate, saved);
    validateNativeWrapping(candidate, [{ ...columns[0], obstacles: [] }]);
  }
  assert.throws(
    () => validateNativeWrapping(source, [{ ...columns[0], verticalAlign: 'center' }]),
    /vertically aligned/,
  );
});
