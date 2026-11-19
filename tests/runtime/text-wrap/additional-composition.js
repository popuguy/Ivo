import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { setTextWrap } from '../../../src/domain/documents/text-wrap.js';
import { layoutDocumentTextFlows } from '../../../src/rendering/text/flow-layout.js';
import { textIndexMap } from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
function sourceLength(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return textIndexMap(root).boundaries.get(root).at(-1);
}
function wordRect(root, word) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const start = node.data.indexOf(word);
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + word.length);
    const rect = range.getBoundingClientRect(),
      origin = root.getBoundingClientRect();
    return {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    };
  }
  throw Error('Wrapped structured fixture did not paint word: ' + word);
}

export function verifyAdditionalComposition({ verifyCoverage, verifyInkOutside, paintFrame }) {
  const narrow = createSceneDocument('Narrow wrap regions'),
    narrowFrame = insertObject(narrow, 'text', narrow.pages[0].id, {
      x: 40,
      y: 40,
      w: 200,
      h: 200,
      fontSize: 16,
      leading: 20,
      html: '<p>WWW</p>',
    }),
    blocker = insertObject(narrow, 'polygon', narrow.pages[0].id, {
      x: 43,
      y: 40,
      w: 194,
      h: 60,
      stroke: 'none',
      strokeWidth: 0,
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
        { id: 'c', x: 1, y: 1 },
        { id: 'd', x: 0, y: 1 },
      ],
    });
  setTextWrap(narrow, [blocker.id], { mode: 'bounds' });
  const narrowPlan = layoutDocumentTextFlows(narrow, { allowPages: false });
  assert(
    narrowPlan.fragments.get(narrowFrame.id).columns.every((p) => p.top >= 60),
    'A whole grapheme was squeezed/clipped into an unusably narrow wrap side',
  );
  verifyCoverage(narrow, narrowPlan);
  verifyInkOutside(
    paintFrame(narrow, narrowPlan, narrowFrame.id),
    { left: 43, top: 40, right: 237, bottom: 100 },
    2,
  );
  const shifted = createSceneDocument('Wrapped baseline shifts', { width: 600, height: 660 }),
    shiftSource =
      '<p>Intro line<br>base <span data-ivo-baseline="6">raise</span> <span data-ivo-baseline="-4">lower</span> tail</p>',
    shiftFrame = insertObject(shifted, 'text', shifted.pages[0].id, {
      x: 40,
      y: 40,
      w: 440,
      h: 200,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 20,
      html: shiftSource,
    }),
    shiftObstacle = insertObject(shifted, 'polygon', shiftFrame.pageId, {
      x: 360,
      y: 40,
      w: 60,
      h: 100,
      stroke: 'none',
      strokeWidth: 0,
    });
  startTextFlow(shifted, shiftFrame.id, { automaticPages: false });
  setTextWrap(shifted, [shiftObstacle.id], { mode: 'bounds' });
  const shiftBefore = JSON.stringify(shifted),
    shiftLayout = layoutDocumentTextFlows(shifted, { allowPages: false });
  verifyCoverage(shifted, shiftLayout);
  const shiftParts = shiftLayout.fragments.get(shiftFrame.id).columns,
    shiftedRow = shiftParts.filter((part) => /base|raise|lower|tail/.test(part.html));
  assert(
    shiftedRow.length === 1 &&
      ['base', 'raise', 'lower', 'tail'].every((word) => shiftedRow[0].html.includes(word)),
    'Baseline-shift runs were incorrectly split onto separate layout rows',
  );
  const shiftPaint = paintFrame(shifted, shiftLayout, shiftFrame.id),
    base = wordRect(shiftPaint, 'base'),
    raised = wordRect(shiftPaint, 'raise'),
    lowered = wordRect(shiftPaint, 'lower'),
    tail = wordRect(shiftPaint, 'tail');
  assert(
    Math.abs(base.y - tail.y) < 0.2 &&
      Math.abs(base.y - raised.y - 6) < 0.2 &&
      Math.abs(lowered.y - base.y - 4) < 0.2,
    'Painted baseline-shift runs did not share their unshifted row: ' +
      JSON.stringify({ base, raised, lowered, tail }),
  );
  verifyInkOutside(shiftPaint, { left: 360, top: 40, right: 420, bottom: 140 }, 15);
  assert(JSON.stringify(shifted) === shiftBefore, 'Baseline-shift layout rewrote source or model');
  const multi = createSceneDocument('Wrapped paragraphs', { width: 600, height: 660 }),
    html =
      '<p data-ivo-before="8" data-ivo-after="12">First paragraph.</p><p><br></p>' +
      '<p data-ivo-before="6" data-ivo-after="10"><em>Italic beginning after the empty paragraph.</em> ' +
      '<span data-ivo-size="10">small detail beside </span><span data-ivo-size="30">LARGE TYPE</span> ' +
      'returns to the base size and continues through the wrapped frame. BeforeBreak<br>AfterBreak ' +
      'the soft return preserves the same paragraph and exact text source. ' +
      'More varied text flows around the object without colliding with its padded edges. '.repeat(
        3,
      ) +
      '</p>' +
      '<p data-ivo-before="4" data-ivo-after="9">Final paragraph retains its own spacing and style.</p>',
    first = insertObject(multi, 'text', multi.pages[0].id, {
      x: 40,
      y: 40,
      w: 440,
      h: 420,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 20,
      html,
    }),
    flow = startTextFlow(multi, first.id, { automaticPages: false }),
    page = addPage(multi, multi.pages[0].id),
    second = insertObject(multi, 'text', page.id, { x: 40, y: 40, w: 440, h: 580 }),
    obstacle = insertObject(multi, 'polygon', first.pageId, {
      x: 190,
      y: 100,
      w: 140,
      h: 160,
      stroke: 'none',
      strokeWidth: 0,
    });
  threadFrame(multi, first.id, second.id);
  setTextWrap(multi, [obstacle.id], {
    mode: 'bounds',
    offsets: { top: 10, right: 10, bottom: 10, left: 10 },
  });
  const before = JSON.stringify(multi),
    layout = layoutDocumentTextFlows(multi, { allowPages: false });
  verifyCoverage(multi, layout);
  let end = 0;
  for (const id of flow.frameIds)
    for (const part of layout.fragments.get(id).columns || []) {
      assert(
        part.start === end && part.end > part.start,
        'Paragraph/blank/break source intervals were dropped or repeated',
      );
      end = part.end;
    }
  assert(end === sourceLength(html), 'Structured wrapped source was not fully consumed');
  const painted = paintFrame(multi, layout, first.id);
  verifyInkOutside(painted, { left: 180, right: 340, top: 90, bottom: 270 });
  const intro = wordRect(painted, 'First'),
    italic = wordRect(painted, 'Italic'),
    small = wordRect(painted, 'small'),
    large = wordRect(painted, 'LARGE'),
    beforeBreak = wordRect(painted, 'BeforeBreak'),
    afterBreak = wordRect(painted, 'AfterBreak');
  assert(
    large.height > 25 && small.height < 15 && large.height > small.height * 2,
    'Mixed-size wrapped text lost its actual glyph metrics: ' + JSON.stringify({ small, large }),
  );
  assert(
    italic.y - intro.y >= 54,
    'Blank paragraph and explicit spacing collapsed: ' + JSON.stringify({ intro, italic }),
  );
  assert(
    afterBreak.y > beforeBreak.y + 10,
    'Soft return did not advance to a new painted row: ' +
      JSON.stringify({ beforeBreak, afterBreak }),
  );
  const zeroSpace = structuredClone(multi);
  zeroSpace.textFlows[0].html = html.replace(/data-ivo-(before|after)="\d+"/g, 'data-ivo-$1="0"');
  const zeroLayout = layoutDocumentTextFlows(zeroSpace, { allowPages: false }),
    zeroItalic = wordRect(paintFrame(zeroSpace, zeroLayout, first.id), 'Italic');
  assert(
    italic.y - zeroItalic.y >= 24 && italic.y - zeroItalic.y <= 28,
    'Paragraph before/after spacing was not applied once to painted rows: ' +
      JSON.stringify({ italic, zeroItalic }),
  );
  assert(
    flow.html === html && JSON.stringify(multi) === before,
    'Structured wrapping rewrote source, typography or document data',
  );

  const automatic = createSceneDocument('Wrapped automatic pages', { width: 600, height: 500 }),
    longHTML =
      '<p>' +
      Array.from({ length: 100 }, (_, i) => 'a' + String(i).padStart(3, '0')).join(' ') +
      '</p>',
    autoFirst = insertObject(automatic, 'text', automatic.pages[0].id, {
      x: 40,
      y: 40,
      w: 320,
      h: 80,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 20,
      html: longHTML,
    }),
    autoFlow = startTextFlow(automatic, autoFirst.id, {
      automaticPages: true,
      deleteEmptyPages: true,
    }),
    unownedPage = addPage(automatic, automatic.pages[0].id),
    autoObstacle = insertObject(automatic, 'polygon', autoFirst.pageId, {
      x: 170,
      y: 55,
      w: 70,
      h: 70,
      stroke: 'none',
      strokeWidth: 0,
    });
  setTextWrap(automatic, [autoObstacle.id], { mode: 'bounds' });
  const passive = structuredClone(automatic),
    passiveBefore = JSON.stringify(passive),
    passiveLayout = layoutDocumentTextFlows(passive, { allowPages: false });
  assert(
    JSON.stringify(passive) === passiveBefore && passiveLayout.status.get(autoFlow.id).overset,
    'Passive wrapped overflow created pages or hid overset',
  );
  const originalFirst = structuredClone(autoFirst),
    grown = layoutDocumentTextFlows(automatic, { allowPages: true });
  assert(
    grown.changed && autoFlow.autoPages.length >= 2 && autoFlow.autoPages.length <= 12,
    'Wrapped automatic text did not create bounded owned continuation pages: ' +
      JSON.stringify({ status: grown.status.get(autoFlow.id), pages: autoFlow.autoPages.length }),
  );
  assert(
    autoFlow.html === longHTML && JSON.stringify(autoFirst) === JSON.stringify(originalFirst),
    'Automatic wrap growth changed original frame or text source',
  );
  verifyCoverage(automatic, grown);
  const owned = structuredClone(autoFlow.autoPages),
    protectedPage = owned[0],
    authored = insertObject(automatic, 'polygon', protectedPage.pageId, {
      x: 450,
      y: 350,
      w: 30,
      h: 30,
    }),
    authoredBefore = JSON.stringify(authored);
  autoFlow.html = '<p>Short</p>';
  const passiveShort = structuredClone(automatic),
    passiveShortBefore = JSON.stringify(passiveShort);
  layoutDocumentTextFlows(passiveShort, { allowPages: false });
  assert(
    JSON.stringify(passiveShort) === passiveShortBefore,
    'Passive short wrapped flow trimmed pages',
  );
  const shortened = layoutDocumentTextFlows(automatic, { allowPages: true });
  assert(
    shortened.changed &&
      autoFlow.autoPages.length === 1 &&
      autoFlow.autoPages[0].pageId === protectedPage.pageId,
    'Short wrapped text did not trim only its blank owned continuation pages',
  );
  assert(
    automatic.pages.some((p) => p.id === unownedPage.id) &&
      automatic.pages.some((p) => p.id === protectedPage.pageId) &&
      automatic.blocks.some((b) => b.id === protectedPage.frameId) &&
      JSON.stringify(automatic.blocks.find((b) => b.id === authored.id)) === authoredBefore,
    'Wrap trimming removed an unowned page or user content on an owned continuation',
  );
  for (const item of owned.slice(1))
    assert(
      !automatic.pages.some((p) => p.id === item.pageId) &&
        !automatic.blocks.some((b) => b.id === item.frameId),
      'Empty owned wrap continuation was left behind',
    );
  assert(autoFlow.html === '<p>Short</p>', 'Trimming rewrote shortened source');
  verifyCoverage(automatic, shortened);
  return {
    structuredParagraphs: true,
    blankAndSoftBreak: true,
    mixedFontBands: true,
    explicitParagraphSpacing: true,
    automaticGrowthTrim: true,
    passiveNoWrites: true,
    grownOwnedPages: owned.length,
    retainedAuthoredContinuation: true,
    sourceBaselineShiftRow: true,
    noClippedGraphemes: true,
  };
}
