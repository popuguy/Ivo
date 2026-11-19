import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { setTextWrap } from '../../../src/domain/documents/text-wrap.js';
import { layoutDocumentTextFlows } from '../../../src/rendering/text/flow-layout.js';
import { textIndexMap } from '../../../src/shared/dom/text-selection.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const signature = (plan, id) =>
  JSON.stringify(
    plan.fragments.get(id).columns.map(({ start, end, left, top, width }) => ({
      start,
      end,
      left: Math.round(left * 1000) / 1000,
      top: Math.round(top * 1000) / 1000,
      width: Math.round(width * 1000) / 1000,
    })),
  );

export function verifyClippedGraphics({ verifyCoverage, paintFrame }) {
  const doc = createSceneDocument('Clipped graphic wrapping'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 30,
      y: 30,
      w: 550,
      h: 690,
      fontSize: 16,
      leading: 20,
      html: '<p>' + 'Alpha beta gamma delta epsilon zeta. '.repeat(18) + '</p>',
    }),
    mask = insertObject(doc, 'polygon', frame.pageId, {
      x: 190,
      y: 120,
      w: 220,
      h: 260,
    });
  mask.points = [
    { id: 'a', x: 0.5, y: 0 },
    { id: 'b', x: 1, y: 0.5 },
    { id: 'c', x: 0.5, y: 1 },
    { id: 'd', x: 0, y: 0.5 },
  ];
  mask.stroke = 'none';
  mask.strokeWidth = 0;
  const image = insertObject(doc, 'image', frame.pageId, {
    parentId: mask.id,
    x: -40,
    y: -40,
    w: 300,
    h: 340,
  });
  setTextWrap(doc, [mask.id], { mode: 'contour' });
  const base = layoutDocumentTextFlows(doc, { allowPages: false }),
    shape = signature(base, frame.id);
  setTextWrap(doc, [image.id], { mode: 'contour' });
  const before = JSON.stringify(doc),
    clipped = layoutDocumentTextFlows(doc, { allowPages: false });
  assert(signature(clipped, frame.id) === shape, 'Hidden image bounds overrode the polygon wrap');
  assert(JSON.stringify(doc) === before, 'Clipped-image paint changed authored data');
  verifyCoverage(doc, clipped);
  const source = document.createElement('div');
  source.innerHTML = doc.textFlows[0].html;
  const map = textIndexMap(source),
    characters = new Map();
  for (const segment of map.segments)
    for (let i = 0; i < segment.node.length; i++)
      characters.set(segment.start + i, segment.node.data[i]);
  for (const part of clipped.fragments.get(frame.id).columns)
    assert(
      !/[A-Za-z]/.test(characters.get(part.end - 1) || '') ||
        !/[A-Za-z]/.test(characters.get(part.end) || ''),
      'Unhyphenated word split across a contour gap at ' + part.end,
    );
  const paint = paintFrame(doc, clipped, frame.id);
  for (const marker of paint.querySelectorAll('[data-flow-text]')) {
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const part = marker.closest('[data-flow-column]').getBoundingClientRect();
      for (let i = 0; i < node.length; i++) {
        if (!/\S/.test(node.data[i])) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const ink = range.getBoundingClientRect();
        assert(
          ink.left >= part.left - 0.05 && ink.right <= part.right + 0.05,
          'A whole word overflowed and was clipped by its contour segment',
        );
      }
    }
  }
  setTextWrap(doc, [mask.id], { mode: 'none' });
  setTextWrap(doc, [image.id], { mode: 'bounds' });
  assert(
    signature(layoutDocumentTextFlows(doc, { allowPages: false }), frame.id) === shape,
    'Graphic Box wrap did not honor its clipping frame',
  );
  setTextWrap(doc, [image.id], {
    mode: 'contour',
    offsets: { top: 8, right: 8, bottom: 8, left: 8 },
  });
  assert(
    signature(layoutDocumentTextFlows(doc, { allowPages: false }), frame.id) !== shape,
    'Clipping incorrectly consumed the graphic wrap offset',
  );
  const unfit = createSceneDocument('Unbreakable overset'),
    unfitFrame = insertObject(unfit, 'text', unfit.pages[0].id, {
      x: 20,
      y: 20,
      w: 40,
      h: 100,
      html: '<p>' + 'W'.repeat(200) + '</p>',
    }),
    flow = startTextFlow(unfit, unfitFrame.id, { automaticPages: true }),
    blocker = insertObject(unfit, 'image', unfitFrame.pageId, {
      x: 30,
      y: 40,
      w: 10,
      h: 10,
    });
  setTextWrap(unfit, [blocker.id], { mode: 'bounds' });
  const unfitPlan = layoutDocumentTextFlows(unfit);
  assert(
    unfitPlan.status.get(flow.id).overset && unfit.pages.length <= 2,
    'An unfit whole word generated an unbounded chain of empty automatic pages',
  );
  assert(flow.html.includes('W'.repeat(200)), 'Unfit word source was discarded');
  return { clippedGraphicContour: true, wholeWordsAroundContours: true, unfitWordOverset: true };
}
