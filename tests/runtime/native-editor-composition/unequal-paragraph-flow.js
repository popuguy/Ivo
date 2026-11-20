import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../../src/domain/history/document-history.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { nativeSourceBoundary } from '../../../src/rendering/text/native-flow-layout.js';
import {
  nativeCaretRect,
  nativeRectScreenBounds,
} from '../../../src/features/editor/text/native-composition-geometry.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const near = (actual, expected, message) =>
  assert(Math.abs(actual - expected) < 0.001, `${message}: ${actual} versus ${expected}`);
const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
function valueDifferences(before, after, path = '') {
  if (stable(before) === stable(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object')
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      valueDifferences(before[key], after[key], path + '.' + key),
    );
  return [{ path, before, after }];
}

/** Disposable real-editor witness: one canonical paragraph flow across unequal native areas. */
export async function verifyUnequalParagraphFlow({ host, compose, insert, drag, save, load }) {
  let doc = createSceneDocument('Unequal native magazine flow', { width: 500, height: 400 }),
    editor,
    history = createDocumentHistory(),
    commits = 0,
    changes = 0,
    mountCount = 0;
  const first = insertObject(doc, 'text', doc.pages[0].id, {
      x: 38,
      y: 42,
      w: 176,
      h: 110,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 20,
      frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 40, verticalAlign: 'top' },
      html:
        '<p data-ivo-left="12" data-ivo-right="8" data-ivo-first="6" data-ivo-after="5"><span data-ivo-size="26" data-ivo-leading="30">Large</span> <em>ink</em> for a carefully positioned fashion layout. Narrow opening frames retain the original source while larger linked frames carry every remaining word without substitution.</p>' +
        '<p data-ivo-align="center" data-ivo-left="18" data-ivo-right="10" data-ivo-first="4" data-ivo-before="8" data-ivo-after="6">The velvet sample needs precise spacing between its descriptive caption and the adjoining image. A portable serif and italic accents remain consistent as the text moves across pages.</p>' +
        '<p data-ivo-align="right" data-ivo-left="10" data-ivo-right="12" data-ivo-before="7">Final notes describe fabric weight, color, proportion and finish. The last generous frame keeps this complete paragraph aligned at the bottom without changing the authored boxes or their order.</p>',
    }),
    flow = startTextFlow(doc, first.id, { automaticPages: false }),
    second = insertObject(doc, 'text', addPage(doc, doc.pages[0].id).id, {
      x: 52,
      y: 46,
      w: 246,
      h: 134,
      frameOptions: { firstBaseline: 'ascent', verticalAlign: 'center' },
    }),
    third = insertObject(doc, 'text', addPage(doc, doc.pages[1].id).id, {
      x: 44,
      y: 40,
      w: 316,
      h: 300,
      frameOptions: { firstBaseline: 'ascent', verticalAlign: 'bottom' },
    });
  threadFrame(doc, first.id, second.id);
  threadFrame(doc, second.id, third.id);
  enableNativeComposition(doc, flow, 'paragraph');
  // Start from the same complete schema representation as an opened vault document.
  doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];
  const frameIds = [first.id, second.id, third.id],
    authoredBoxes = stable(doc.blocks),
    authoredPages = stable(doc.pages),
    calls = [],
    notices = [],
    input = () => host.querySelector('.canvas-flow-input');
  const port = () => async (request) => {
    const result = await compose(request);
    calls.push({ request, result });
    return result;
  };
  let composeOwned = port();
  function moveHistory(direction) {
    const result = history[direction](doc);
    if (result) {
      doc = result.document;
      editor.restoreView(result.view);
    }
  }
  function mount() {
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (value) => value,
      editing: true,
      textComposition: { compose: composeOwned },
      assets: () => [],
      fonts: () => [],
      initialState: { tool: 'select', selection: [first.id] },
      sessionId: 'unequal-native-flow-' + ++mountCount,
      onNotify: (message) => notices.push(message),
      onChange: () => changes++,
      onCommit: (before, meta) => {
        if (history.record(before, doc, meta)) commits++;
      },
      onUndo: () => moveHistory('undo'),
      onRedo: () => moveHistory('redo'),
    });
  }
  async function settle() {
    await tick();
    await editor.flush();
    await tick();
    const failure = host.querySelector('[data-composition-error]')?.dataset.compositionError;
    assert(!failure, 'Unequal native flow failed: ' + failure);
  }
  function painted() {
    const token = host.querySelector('svg[data-composed-text]')?.dataset.compositionToken,
      value = calls.findLast((call) => call.result.token === token);
    assert(value, 'Unequal native flow has no matching painted result');
    return value;
  }
  const geometry = () => {
    const { request, result } = painted();
    return JSON.stringify({
      placements: request.placements,
      lines: result.layout.lines.map((line) => ({
        start: line.start,
        end: line.end,
        frame: line.frame,
        baseline: line.baseline,
        ascent: line.ascent,
        descent: line.descent,
        originX: line.originX,
        availableWidth: line.availableWidth,
        visibleWidth: line.visibleWidth,
        carets: line.carets,
        runs: line.runs,
      })),
    });
  };
  function paragraphShapingIdentity(request, paragraph) {
    const runs = request.runs
        .filter((run) => run.end > paragraph.start && run.start < paragraph.end)
        .map((run) => ({
          ...run,
          start: Math.max(run.start, paragraph.start) - paragraph.start,
          end: Math.min(run.end, paragraph.end) - paragraph.start,
        })),
      fonts = new Set(runs.map((run) => run.font));
    return JSON.stringify({
      protocol: request.protocol,
      allowFallback: request.allowFallback,
      text: request.text.slice(paragraph.start, paragraph.end),
      runs,
      resources: request.resources
        .filter((resource) => fonts.has(resource.id))
        .map(({ data: _data, ...identity }) => identity)
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  function measuredAlternative(request, line) {
    const paragraph = request.paragraphs.find(
        (item) => item.start <= line.start && item.end > line.start,
      ),
      identity = paragraphShapingIdentity(request, paragraph);
    for (const call of calls) {
      if (call.request.mode !== 'measure-lines-proof') continue;
      for (const previous of call.request.paragraphs) {
        if (paragraphShapingIdentity(call.request, previous) !== identity) continue;
        const measured = call.result.measurements.find(
          (candidate) =>
            candidate.start - previous.start === line.start - paragraph.start &&
            candidate.end - previous.start === line.end - paragraph.start,
        );
        if (measured) return measured;
      }
    }
    return null;
  }
  function verifyPlan() {
    const { request, result } = painted(),
      lines = result.layout.lines;
    assert(
      request.protocol === 3 && request.mode === 'planned-lines-proof',
      'Unequal flow did not use exact native placements',
    );
    assert(result.protocol === 3, 'Unequal native result lost its protocol');
    assert(
      result.layout.coveredLength === request.text.length,
      'Unequal fixture is unexpectedly overset',
    );
    assert(
      request.placements.length === lines.length,
      'Native result changed the planned line count',
    );
    let end = 0;
    for (const [index, line] of lines.entries()) {
      const placement = request.placements[index],
        frame = request.frames[placement.frame];
      assert(
        line.start === end && line.end === placement.end,
        'Native unequal lines lost contiguous source coverage',
      );
      assert(
        line.placementIndex === index && line.frame === frame.id,
        'Native unequal line changed its planned frame',
      );
      near(line.baseline, placement.baseline, 'Native unequal line changed its planned baseline');
      near(line.availableWidth, placement.width, 'Native unequal line changed its available width');
      assert(
        line.originX >= placement.left - 0.001 &&
          line.originX + line.visibleWidth <= placement.left + placement.width + 0.001,
        'Native unequal glyphs exceed their line area',
      );
      assert(
        line.baseline - line.ascent >= -0.001 &&
          line.baseline + (frame.verticalAlign === 'top' ? line.descent : 0) <=
            frame.height + 0.001,
        'Native unequal line exceeds its column height: ' +
          JSON.stringify({
            frame: line.frame,
            start: line.start,
            end: line.end,
            baseline: line.baseline,
            ascent: line.ascent,
            descent: line.descent,
            height: frame.height,
          }),
      );
      end = line.end;
    }
    const own = frameIds.map((id) => lines.filter((line) => line.frame === id + '-column-0'));
    assert(
      own.every((rows) => rows.length),
      'Unequal fixture did not exercise all three linked frames',
    );
    near(own[0][0].baseline, 40, 'Fixed first baseline');
    near(
      own[1][0].baseline - own[1][0].ascent,
      request.frames[1].height - own[1].at(-1).baseline,
      'Centered column has unequal top/bottom slack',
    );
    near(
      own[2].at(-1).baseline,
      request.frames[2].height,
      'Bottom-aligned column lost its final baseline',
    );
    const runs = lines.flatMap((line) => line.runs);
    assert(
      runs.some((run) => run.size === 26) &&
        runs.some((run) => run.size === 16) &&
        runs.some((run) => /CMUSerif-Italic/.test(run.font)),
      'Actual mixed CMU size/italic glyph runs were not used',
    );
    for (const line of lines) {
      const measured = measuredAlternative(request, line);
      assert(measured, 'A native line has no independently measured source alternative');
      near(line.ascent, measured.ascent, 'Native plan used estimated ascent');
      near(line.descent, measured.descent, 'Native plan used estimated descent');
    }
    for (const paragraph of request.paragraphs.slice(1)) {
      const index = lines.findIndex((line) => line.start === paragraph.start);
      if (index > 0 && lines[index].frame === lines[index - 1].frame) {
        const previous = request.paragraphs.find(
            (item) => item.start <= lines[index - 1].start && item.end > lines[index - 1].start,
          ),
          leading = Math.max(
            ...request.runs
              .filter((run) => run.start < lines[index].end && run.end > lines[index].start)
              .map((run) =>
                run.leading > 0 ? run.leading : (run.size * (run.autoLeading || 120)) / 100,
              ),
          );
        near(
          lines[index].baseline - lines[index - 1].baseline,
          leading + previous.paragraphAfter + paragraph.paragraphBefore,
          'Paragraph before/after spacing',
        );
      }
    }
    assert(
      stable(doc.blocks) === authoredBoxes && stable(doc.pages) === authoredPages,
      'Native composition changed authored frames or pages: ' +
        JSON.stringify({
          frames: valueDifferences(JSON.parse(authoredBoxes), doc.blocks),
          pages: valueDifferences(JSON.parse(authoredPages), doc.pages),
        }),
    );
    assert(!notices.length, 'Unexpected unequal-flow notification: ' + notices.join('; '));
  }
  function column(frameId) {
    const { request, result } = painted(),
      lines = result.layout.lines.filter((line) => line.frame === frameId + '-column-0');
    return {
      element: host.querySelector(`[data-flow-column="${frameId}-column-0"]`),
      start: nativeSourceBoundary(request, lines[0].start),
      end: nativeSourceBoundary(request, lines.at(-1).end),
      native: { lines, spans: request.spans, text: request.text },
    };
  }
  function pointer(frameId, index, affinity) {
    const col = column(frameId),
      rect = nativeRectScreenBounds(col, nativeCaretRect(col, { index, affinity }));
    assert(
      rect && Number.isFinite(rect.x) && Number.isFinite(rect.y),
      'Unequal native selection lost screen geometry',
    );
    return [rect.x + 0.3, rect.y + rect.height / 2];
  }
  try {
    mount();
    await settle();
    verifyPlan();
    const originalHTML = doc.textFlows[0].html,
      originalGeometry = geometry(),
      originalDocument = JSON.stringify(doc),
      originalContent = documentContent(doc),
      measured = calls.filter((call) => call.request.mode === 'measure-lines-proof').length;
    assert(commits === 0 && changes === 0, 'Cold unequal layout authored document history');
    editor.destroy();
    mount();
    await settle();
    assert(
      geometry() === originalGeometry,
      'Warm unequal layout changed line/glyph/caret positions',
    );
    assert(
      calls.filter((call) => call.request.mode === 'measure-lines-proof').length === measured,
      'Warm unequal layout remeasured unchanged paragraphs',
    );
    assert(JSON.stringify(doc) === originalDocument, 'Warm unequal layout changed the document');
    await editor.command('fit-all');
    await editor.command('document-text');
    await settle();
    const firstColumn = column(first.id),
      lastColumn = column(third.id),
      from = firstColumn.native.lines[0].carets
        .find((caret) => caret.index > 2)
        .logicalCandidates.at(-1),
      to = lastColumn.native.lines
        .at(-1)
        .carets.findLast((caret) => caret.index < lastColumn.native.lines.at(-1).contentEnd)
        .logicalCandidates[0];
    await drag(pointer(first.id, from, 'forward'), pointer(third.id, to, 'backward'));
    await tick();
    const selected = captureTextSelection(input());
    assert(
      selected?.anchor.index < firstColumn.end && selected?.focus.index >= lastColumn.start,
      'Trusted selection did not span unequal native frames',
    );
    assert(
      host.querySelectorAll('[data-native-selection="range"]').length >= 3,
      'Native selection paint did not cover three unequal frames',
    );
    const selectionDifferences = [];
    function changedFields(before, after, path = '') {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      if (before && after && typeof before === 'object' && typeof after === 'object') {
        for (const field of new Set([...Object.keys(before), ...Object.keys(after)]))
          changedFields(before[field], after[field], path + '.' + field);
      } else selectionDifferences.push({ path, before, after });
    }
    changedFields(JSON.parse(originalDocument), doc);
    assert(
      documentContent(doc) === originalContent &&
        doc.textFlows[0].html === originalHTML &&
        stable(doc.blocks) === authoredBoxes &&
        stable(doc.pages) === authoredPages &&
        commits === 0 &&
        history.size === 0,
      'Selecting unequal text changed source/history: ' +
        JSON.stringify({ commits, changes, history: history.size, selectionDifferences }),
    );
    const segment = textIndexMap(input()).segments.find((part) =>
      part.node.data.includes('velvet'),
    );
    assert(segment, 'Unequal source lost its editable caption word');
    const start = segment.start + segment.node.data.indexOf('velvet');
    input().focus();
    restoreTextSelection(input(), {
      anchor: { path: [], offset: 0, kind: 'text', index: start, affinity: 'forward' },
      focus: { path: [], offset: 0, kind: 'text', index: start + 6, affinity: 'backward' },
    });
    await insert('velvet atelier');
    await settle();
    verifyPlan();
    const editedHTML = doc.textFlows[0].html,
      editedGeometry = geometry();
    assert(
      editedHTML !== originalHTML && commits === 1 && history.size === 1,
      'Unequal paragraph edit did not create one authored change',
    );
    await editor.command('undo');
    await settle();
    assert(
      doc.textFlows[0].html === originalHTML && geometry() === originalGeometry,
      'Undo did not restore exact unequal source/glyph/caret geometry',
    );
    await editor.command('redo');
    await settle();
    assert(
      doc.textFlows[0].html === editedHTML && geometry() === editedGeometry,
      'Redo did not restore exact unequal source/glyph/caret geometry',
    );
    await save({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
    editor.destroy();
    doc = validateImport(await load()).documents[0];
    composeOwned = port();
    history = createDocumentHistory();
    changes = commits = 0;
    mount();
    await settle();
    verifyPlan();
    assert(
      doc.textFlows[0].html === editedHTML && geometry() === editedGeometry,
      'Cold archive reopen changed unequal source/glyph/caret geometry',
    );
    assert(commits === 0 && changes === 0, 'Cold archive reopening authored history');
    return {
      unequalParagraphFrames: true,
      plannedNativeLinePlacement: true,
      mixedNativeMetrics: true,
      nativeFirstBaselineSpacingVerticalAlignment: true,
      unequalNativeCrossPageSelection: true,
      unequalNativeColdWarmEditUndoReopen: true,
    };
  } finally {
    editor?.destroy();
  }
}
