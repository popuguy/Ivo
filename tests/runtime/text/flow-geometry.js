import {
  measureFlowCaretLines,
  flowParagraphRanges,
} from '../../../src/rendering/text/flow-geometry.js';
import {
  layoutDocumentTextFlows,
  prepareTextFlowFonts,
} from '../../../src/rendering/text/flow-layout.js';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { applyFrameTypography } from '../../../src/rendering/text/format.js';
import { applyNamedTextStyles } from '../../../src/rendering/text/styles.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { captureTextSelection } from '../../../src/shared/dom/text-selection.js';

/** Native Range geometry only; call inside the parent's sequential GUI fixture. */
export async function verifyFlowCaretGeometry() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await prepareTextFlowFonts();
  const doc = createSceneDocument('Caret geometry'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: 180,
      h: 90,
      html: '<p><u>Alpha 👩🏽‍💻 e\u0301 starts a wrapped paragraph with several words to fill its first frame.</u></p><p><br></p><p>Second paragraph after the blank line.<br>After explicit break.</p>',
    }),
    flow = startTextFlow(doc, frame.id, { automaticPages: false }),
    secondPage = addPage(doc, doc.pages[0].id),
    second = insertObject(doc, 'text', secondPage.id, { x: 40, y: 40, w: 260, h: 200 });
  threadFrame(doc, frame.id, second.id);
  const original = JSON.stringify(doc),
    plan = layoutDocumentTextFlows(doc, { allowPages: false }),
    camera = document.createElement('div');
  camera.style.cssText =
    'position:fixed;left:20px;top:20px;transform-origin:0 0;transform:translate3d(40px,30px,0) scale(1.5)';
  document.body.append(camera);
  const columns = [frame, second].map((item, columnOrder) => {
    const part = plan.fragments.get(item.id),
      element = document.createElement('div');
    element.className = 'rich-text canvas-text flow-fragment';
    element.style.cssText = `position:absolute;left:${columnOrder * 320}px;top:0;width:${item.w}px;height:${item.h}px;overflow:hidden`;
    element.innerHTML = part.html;
    camera.append(element);
    applyFrameTypography(element, flow.style);
    applyNamedTextStyles(element, doc);
    return {
      frameId: item.id,
      column: 0,
      start: part.start,
      end: part.end,
      sourceStart: part.start,
      sourceEnd: part.end,
      element,
    };
  });
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.innerHTML = '<p>Preserve this selection.</p>';
  camera.append(input);
  input.focus({ preventScroll: true });
  const range = document.createRange();
  range.setStart(input.firstChild.firstChild, 1);
  range.setEnd(input.firstChild.firstChild, 5);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const beforeSelection = captureTextSelection(input),
    beforeHTML = columns.map((c) => c.element.innerHTML);
  try {
    assert(
      plan.fragments.get(frame.id).end > 0 && plan.fragments.get(second.id).start > 0,
      'Fixture did not produce sequential unequal frames',
    );
    assert(
      columns.some((c) => c.element.querySelector('[data-flow-block-start]')) &&
        columns.some((c) => c.element.querySelector('br[data-flow-break]')),
      'Derived structural provenance was not exported',
    );
    const paragraphs = flowParagraphRanges(columns);
    assert(
      paragraphs.length === 3,
      'Derived fragments were mistaken for separate authored paragraphs',
    );
    assert(
      paragraphs[0].contentStart === paragraphs[0].start + 1 &&
        paragraphs[0].contentEnd === paragraphs[0].end - 1,
      'Paragraph provenance lost structural mark boundaries',
    );
    assert(
      paragraphs[1].contentEnd - paragraphs[1].contentStart === 1,
      'Explicit BR blank paragraph lost its independent source range',
    );
    const measured = measureFlowCaretLines(columns);
    assert(
      measured.lines.length > 2 && measured.measuredStops > 20 && !measured.truncated,
      'Native caret geometry did not measure wrapped lines',
    );
    assert(
      measured.lines.some((line) => line.frameId === frame.id) &&
        measured.lines.some((line) => line.frameId === second.id),
      'Geometry skipped an unequal linked frame',
    );
    assert(
      measured.lines.every((line) =>
        line.stops.every(
          (stop) => Number.isFinite(stop.x) && Number.isFinite(stop.y) && stop.height > 0,
        ),
      ),
      'Caret geometry contains invalid local coordinates',
    );
    assert(
      measured.lines.every(
        (line) =>
          line.sourceStart === columns.find((c) => c.frameId === line.frameId).start &&
          line.sourceEnd === columns.find((c) => c.frameId === line.frameId).end,
      ),
      'Geometry confused original column source bounds with measured line ranges',
    );
    assert(
      columns.every((c, i) => c.element.innerHTML === beforeHTML[i]) &&
        JSON.stringify(doc) === original,
      'Measurement mutated authored source or preview DOM',
    );
    const afterSelection = captureTextSelection(input);
    assert(
      beforeSelection.anchor.index === afterSelection.anchor.index &&
        beforeSelection.focus.index === afterSelection.focus.index,
      'Geometry measurement moved the native selection',
    );
    const snapshot = measured.lines.map((line) => ({
      frameId: line.frameId,
      stops: line.stops.map((stop) => ({ index: stop.index, x: stop.x, y: stop.y })),
    }));
    camera.style.transform = 'translate3d(140px,130px,0)';
    camera.style.zoom = '2';
    const afterZoom = measureFlowCaretLines(columns);
    assert(
      afterZoom.lines.length === snapshot.length &&
        afterZoom.lines.every(
          (line, i) =>
            line.stops.length === snapshot[i].stops.length &&
            line.stops.every(
              (stop, j) =>
                Math.abs(stop.x - snapshot[i].stops[j].x) < 0.05 &&
                Math.abs(stop.y - snapshot[i].stops[j].y) < 0.05 &&
                stop.index === snapshot[i].stops[j].index,
            ),
        ),
      'Camera transforms leaked into source-local caret geometry',
    );
    const allText = columns
      .flatMap((c) => [...c.element.querySelectorAll('[data-flow-text]')])
      .find((node) => node.textContent.includes('👩🏽‍💻'));
    assert(allText, 'Emoji did not survive decorated frame composition');
    const emojiStart = Number(allText.dataset.flowText) + allText.textContent.indexOf('👩🏽‍💻');
    assert(
      !afterZoom.lines
        .flatMap((line) => line.stops)
        .some((stop) => stop.index > emojiStart && stop.index < emojiStart + '👩🏽‍💻'.length),
      'Caret stop splits a Unicode grapheme',
    );
    const limited = measureFlowCaretLines(columns, { maxStops: 1 });
    assert(
      limited.truncated && limited.measuredStops === 1,
      'Measurement budget silently dropped caret coverage',
    );
    camera.style.transform = 'rotate(10deg)';
    const rotated = measureFlowCaretLines(columns);
    assert(
      !rotated.lines.length && rotated.limitations.includes('rotated-or-sheared-column'),
      'Rotated native rectangles were guessed as axis-aligned carets',
    );
    assert(
      !/data-flow-(?:block|break)/.test(
        cleanHTML(columns.map((c) => c.element.innerHTML).join('')),
      ),
      'Derived structural metadata entered canonical text',
    );
    return {
      nativeCaretLines: true,
      unequalFrameGeometry: true,
      graphemeStops: true,
      structuralProvenance: true,
      cameraIndependent: true,
      measurementPure: true,
      boundedCoverage: true,
    };
  } finally {
    camera.remove();
  }
}
