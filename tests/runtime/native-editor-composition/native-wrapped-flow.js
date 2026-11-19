import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { setTextWrap } from '../../../src/domain/documents/text-wrap.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../../src/domain/history/document-history.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { nativeSourceBoundary } from '../../../src/rendering/text/native-flow-layout.js';
import {
  nativeCaretRect,
  nativeRectScreenBounds,
  hitNativeColumn,
} from '../../../src/features/editor/text/native-composition-geometry.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const words = (length) =>
  Array.from({ length }, (_, index) => 'word' + String(index).padStart(3, '0')).join(' ');

/** Native wrapped-flow acceptance. Call only after the protocol-3 wrap renderer is installed. */
export async function verifyNativeWrappedFlow({ host, compose, insert, drag, key, save, load }) {
  let doc = createSceneDocument('Native wrapped magazine flow', { width: 500, height: 400 }),
    editor,
    history = createDocumentHistory(),
    commits = 0,
    changes = 0,
    writable = true,
    mountCount = 0;
  const first = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: 420,
      h: 260,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 22,
      frameOptions: { verticalAlign: 'top' },
      html: '<p>' + words(70) + '</p>',
    }),
    flow = startTextFlow(doc, first.id, { automaticPages: false }),
    second = insertObject(doc, 'text', addPage(doc, doc.pages[0].id).id, {
      x: 50,
      y: 40,
      w: 340,
      h: 300,
      frameOptions: { verticalAlign: 'top' },
    }),
    obstacle = insertObject(doc, 'polygon', first.pageId, {
      x: 190,
      y: 90,
      w: 100,
      h: 120,
      fill: 'none',
      stroke: 'none',
      strokeWidth: 0,
    });
  obstacle.points = [
    { id: 'wrap-top-left', x: 0, y: 0 },
    { id: 'wrap-top-right', x: 1, y: 0 },
    { id: 'wrap-bottom-left', x: 0, y: 1 },
  ];
  threadFrame(doc, first.id, second.id);
  setTextWrap(doc, [obstacle.id], { mode: 'bounds', side: 'both' });
  enableNativeComposition(doc, flow, 'paragraph');
  doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];
  const calls = [],
    notices = [],
    input = () => host.querySelector('.canvas-flow-input');
  const port = () => async (request) => {
    const result = await compose(request);
    calls.push({ request, result });
    return result;
  };
  let composeOwned = port();
  function step(direction) {
    const next = history[direction](doc);
    if (next) {
      doc = next.document;
      editor.restoreView(next.view);
    }
  }
  function mount({ editing = true } = {}) {
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (value) => value,
      editing,
      canWrite: () => writable,
      assets: () => [],
      fonts: () => [],
      textComposition: { compose: composeOwned },
      sessionId: 'native-wrapped-flow-' + ++mountCount,
      initialState: { tool: 'select', selection: [doc.textFlows[0].frameIds[0]] },
      onNotify: (message) => notices.push(message),
      onChange: () => changes++,
      onCommit: (before, metadata) => {
        if (history.record(before, doc, metadata)) commits++;
      },
      onUndo: () => step('undo'),
      onRedo: () => step('redo'),
    });
  }
  async function settle() {
    await tick();
    await editor.flush();
    await tick();
    const error = host.querySelector('[data-composition-error]')?.dataset.compositionError;
    assert(!error, 'Native wrap composition failed: ' + error);
  }
  function painted(frameId = doc.textFlows[0].frameIds[0]) {
    const token = host.querySelector(`[data-flow-frame="${frameId}"] svg[data-composed-text]`)
        ?.dataset.compositionToken,
      found = calls.findLast((call) => call.result.token === token);
    assert(found, 'Native wrapped frame has no actual composition result: ' + frameId);
    return found;
  }
  function geometry() {
    const { request, result } = painted();
    return JSON.stringify({ placements: request.placements, lines: result.layout.lines });
  }
  function column(frameId = first.id) {
    const { request, result } = painted(frameId),
      lines = result.layout.lines.filter((line) => line.frame === frameId + '-column-0');
    assert(lines.length, 'Native wrapped column is empty: ' + frameId);
    return {
      frameId,
      element: host.querySelector(`[data-flow-column="${frameId}-column-0"]`),
      start: nativeSourceBoundary(request, lines[0].start),
      end: nativeSourceBoundary(request, lines.at(-1).end),
      native: { text: request.text, spans: request.spans, lines },
    };
  }
  function physicalRows(frameId = first.id) {
    const rows = [];
    for (const line of column(frameId).native.lines) {
      const previous = rows.at(-1);
      if (previous && Math.abs(previous.baseline - line.baseline) < 0.001)
        previous.fragments.push(line);
      else rows.push({ baseline: line.baseline, fragments: [line] });
    }
    for (const row of rows) row.fragments.sort((a, b) => a.originX - b.originX);
    return rows;
  }
  function wrappedPair() {
    const rows = physicalRows(),
      index = rows.findIndex(
        (row, at) => row.fragments.length === 2 && rows[at + 1]?.fragments.length === 2,
      );
    assert(index >= 0, 'Native wrap did not produce consecutive two-fragment physical rows');
    return { row: rows[index], next: rows[index + 1] };
  }
  function logical(index) {
    return nativeSourceBoundary(painted().request, index);
  }
  function point(index, affinity = 'forward', frameId = first.id) {
    const col = column(frameId),
      rect = nativeRectScreenBounds(col, nativeCaretRect(col, { index, affinity }));
    assert(
      rect && Number.isFinite(rect.x) && Number.isFinite(rect.y),
      'Native wrapped caret has no screen geometry',
    );
    return [rect.x + 0.3, rect.y + rect.height / 2];
  }
  async function select(start, end = start) {
    input().focus();
    assert(
      restoreTextSelection(input(), {
        anchor: { path: [], offset: 0, kind: 'text', index: start, affinity: 'forward' },
        focus: {
          path: [],
          offset: 0,
          kind: 'text',
          index: end,
          affinity: end === start ? 'forward' : 'backward',
        },
      }),
      'Native wrapped selection could not be restored',
    );
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
  }
  function wordRange(word) {
    const part = textIndexMap(input()).segments.find((segment) => segment.node.data.includes(word));
    assert(part, 'Canonical wrapped source lost word: ' + word);
    const start = part.start + part.node.data.indexOf(word);
    return { start, end: start + word.length };
  }
  function verifyCoverage({ complete = true } = {}) {
    const { request, result } = painted(),
      lines = result.layout.lines;
    assert(
      request.protocol === 3 && request.mode === 'planned-lines-proof',
      'Wrapped source did not use protocol-3 native plans',
    );
    assert(result.protocol === 3, 'Native wrap changed its result protocol');
    let end = 0;
    for (const [index, line] of lines.entries()) {
      const placement = request.placements[index];
      assert(
        line.start === end && line.end === placement.end && line.placementIndex === index,
        'Native wrap lost contiguous source ownership',
      );
      assert(
        line.frame === request.frames[placement.frame]?.id &&
          Math.abs(line.baseline - placement.baseline) < 0.001 &&
          Math.abs(line.availableWidth - placement.width) < 0.001,
        'Native wrap recomposed or moved an owned placement',
      );
      end = line.end;
    }
    assert(
      end === result.layout.coveredLength,
      'Native wrap coverage disagrees with retained lines',
    );
    if (complete)
      assert(end === request.text.length, 'Native wrap fixture is unexpectedly overset');
    assert(
      !host.querySelector('[data-flow-frame] [data-flow-text]'),
      'Native wrapped text paints duplicate browser ink',
    );
    assert(
      host.querySelector('svg[data-composed-text] use'),
      'Native wrapped text lacks vector glyphs',
    );
  }
  function verifyBox() {
    verifyCoverage();
    const rows = column().native.lines;
    for (const line of rows)
      if (line.baseline + line.descent > 50.001 && line.baseline - line.ascent < 169.999)
        assert(
          line.originX + line.visibleWidth <= 150.001 || line.originX >= 249.999,
          'Native glyph advance crosses the independent box exclusion',
        );
    wrappedPair();
  }
  async function selectObstacle() {
    await editor.command('tool-select');
    editor.restoreView({ tool: 'select', selection: [obstacle.id], activePage: first.pageId });
    await settle();
  }
  async function changeMode(mode) {
    await selectObstacle();
    const button = host.querySelector(`[data-text-wrap-mode="${mode}"]`);
    assert(button && !button.disabled, 'Production wrap Inspector lacks mode: ' + mode);
    button.click();
    await settle();
    assert(
      doc.blocks.find((block) => block.id === obstacle.id).textWrap.mode === mode,
      'Production wrap mode command did not apply: ' + mode,
    );
  }
  async function property(name, value) {
    const control = host.querySelector(`[data-object-prop="${name}"]`);
    assert(control && !control.disabled, 'Production wrap fixture lacks property: ' + name);
    control.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 57, button: 0 }),
    );
    control.focus();
    control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  try {
    assert(
      typeof key === 'function',
      'Native wrapped fixture requires native Home/End/Up/Down input',
    );
    mount();
    await settle();
    verifyBox();
    const source = doc.textFlows[0].html,
      originalGeometry = geometry(),
      originalContent = documentContent(doc);
    assert(commits === 0 && history.size === 0, 'Reading native wrap wrote authored history');
    await editor.command('fit-all');
    await editor.command('document-text');
    await settle();
    const { row, next } = wrappedPair(),
      [left, right] = row.fragments,
      leftPoint = left.carets.find(
        (caret) =>
          caret.index > left.start + 1 &&
          caret.index < left.contentEnd &&
          /\S/.test(painted().request.text[caret.index]),
      ),
      start = leftPoint.logicalCandidates.at(-1),
      target = logical(right.start + 3);
    await select(start);
    const beforeDown = point(start);
    await key('Down');
    await tick();
    const down = captureTextSelection(input())?.focus;
    assert(
      down &&
        down.index >= logical(next.fragments[0].start) &&
        down.index <= logical(next.fragments.at(-1).contentEnd),
      'Down visited the other fragment instead of the next physical wrapped row',
    );
    const afterDown = point(down.index, down.affinity);
    assert(
      afterDown[1] > beforeDown[1] + 1 && Math.abs(afterDown[0] - beforeDown[0]) < 12,
      'Native wrap Down did not retain approximate column X',
    );
    await key('Up');
    await tick();
    assert(
      captureTextSelection(input())?.focus.index === start,
      'Native wrap Up did not restore the physical-row caret',
    );
    await key('Left', ['meta']);
    await tick();
    assert(
      captureTextSelection(input())?.focus.index === logical(left.start),
      'Command–Left did not reach the beginning of the whole wrapped row',
    );
    await key('Right', ['meta']);
    await tick();
    assert(
      captureTextSelection(input())?.focus.index === logical(right.contentEnd),
      'Command–Right stopped at the first native wrap fragment',
    );
    const gap = hitNativeColumn(
      column(),
      { x: 200, y: row.baseline },
      { coordinateSpace: 'column' },
    );
    assert(
      gap && gap.index >= logical(left.start) && gap.index <= logical(right.contentEnd),
      'Gap hit chose a different physical row',
    );
    assert(
      gap.index === logical(left.contentEnd) || gap.index === logical(right.start),
      'Gap hit did not choose an adjacent native fragment edge',
    );
    const from = point(start),
      to = point(target, 'backward'),
      selectionBeforeDrag = captureTextSelection(input()),
      dragEvents = [],
      listener = new AbortController(),
      describeElement = (element) =>
        element && {
          tag: element.tagName,
          object: element.closest?.('[data-object]')?.dataset.object,
          flowFrame: element.closest?.('[data-flow-frame]')?.dataset.flowFrame,
          column: element.closest?.('[data-flow-column]')?.dataset.flowColumn,
          className:
            typeof element.className === 'string' ? element.className : element.className?.baseVal,
          html: element.outerHTML?.slice(0, 220),
        },
      endpoint = (coordinates) => {
        const col = column(),
          rounded = coordinates.map(Math.round);
        return {
          screen: coordinates,
          rounded,
          hit: hitNativeColumn(col, { x: coordinates[0], y: coordinates[1] }),
          roundedHit: hitNativeColumn(col, { x: rounded[0], y: rounded[1] }),
          surface: describeElement(document.elementFromPoint(...coordinates)),
          roundedSurface: describeElement(document.elementFromPoint(...rounded)),
        };
      },
      beforeEndpoints = { from: endpoint(from), to: endpoint(to) };
    for (const type of [
      'pointerdown',
      'mousedown',
      'pointermove',
      'pointerup',
      'mouseup',
      'gotpointercapture',
      'lostpointercapture',
    ])
      window.addEventListener(
        type,
        (event) => {
          if (dragEvents.length < 80)
            dragEvents.push({
              type,
              x: event.clientX,
              y: event.clientY,
              buttons: event.buttons,
              pointerId: event.pointerId,
              target: describeElement(event.target),
            });
        },
        { capture: true, signal: listener.signal },
      );
    try {
      await drag(from, to);
      await tick();
    } finally {
      listener.abort();
    }
    const selection = captureTextSelection(input()),
      col = column(),
      matrix = col.element?.querySelector('svg[data-composed-text]')?.getScreenCTM();
    assert(
      selection &&
        Math.abs(selection.anchor.index - start) <= 1 &&
        Math.abs(selection.focus.index - target) <= 1,
      'Trusted native selection failed across the obstacle gap: ' +
        JSON.stringify({
          expected: { start, target },
          selectionBeforeDrag,
          selection,
          beforeEndpoints,
          afterEndpoints: { from: endpoint(from), to: endpoint(to) },
          source: {
            text: painted().request.text,
            logicalLength: painted().request.logicalLength,
            html: doc.textFlows[0].html,
            spans: painted().request.spans,
          },
          column: {
            frameId: first.id,
            start: col.start,
            end: col.end,
            bounds: col.element?.getBoundingClientRect().toJSON(),
            matrix: matrix && {
              a: matrix.a,
              b: matrix.b,
              c: matrix.c,
              d: matrix.d,
              e: matrix.e,
              f: matrix.f,
            },
            rows: [row, next].map((value) => ({
              baseline: value.baseline,
              fragments: value.fragments.map((line) => ({
                start: line.start,
                end: line.end,
                contentEnd: line.contentEnd,
                originX: line.originX,
                visibleWidth: line.visibleWidth,
                availableWidth: line.availableWidth,
                carets: line.carets,
              })),
            })),
          },
          activeElement: describeElement(document.activeElement),
          input: input() && {
            style: input().style.cssText,
            bounds: input().getBoundingClientRect().toJSON(),
          },
          viewport: host.querySelector('.canvas-viewport')?.getBoundingClientRect().toJSON(),
          dragEvents,
        }),
    );
    assert(
      host.querySelectorAll('[data-native-selection="range"]').length >= 2,
      'Native selection paint did not cover both same-baseline fragments',
    );
    assert(
      documentContent(doc) === originalContent && commits === 0 && history.size === 0,
      'Wrapped navigation/selection wrote source or history',
    );
    const selectedText = window.getSelection().toString();
    assert(selectedText.length > 8, 'Cross-fragment native selection is empty');
    await insert('Revised wrapped source ');
    await settle();
    verifyCoverage();
    const editedHTML = doc.textFlows[0].html,
      editedGeometry = geometry();
    assert(
      editedHTML !== source && commits === 1 && history.size === 1,
      'Native wrapped typing was not one source transaction',
    );
    await editor.command('undo');
    await settle();
    assert(
      doc.textFlows[0].html === source && geometry() === originalGeometry,
      'Undo did not restore exact wrapped source/glyph geometry',
    );
    await editor.command('redo');
    await settle();
    assert(
      doc.textFlows[0].html === editedHTML && geometry() === editedGeometry,
      'Redo did not restore exact wrapped source/glyph geometry',
    );
    await save({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
    editor.destroy();
    doc = validateImport(await load()).documents[0];
    history = createDocumentHistory();
    commits = changes = 0;
    composeOwned = port();
    mount();
    await settle();
    verifyCoverage();
    assert(
      doc.textFlows[0].html === editedHTML && geometry() === editedGeometry && commits === 0,
      'Cold archive reopen changed wrapped source/glyph geometry',
    );
    // An actual geometry edit has one history entry. Its derived reflow adds none.
    const beforeMove = geometry(),
      beforeMoveHTML = doc.textFlows[0].html;
    await selectObstacle();
    await property('x', 210);
    assert(
      geometry() !== beforeMove &&
        doc.textFlows[0].html === beforeMoveHTML &&
        commits === 1 &&
        history.size === 1,
      'Moving the obstacle reused stale native layout or authored text/additional history',
    );
    await settle();
    assert(
      commits === 1 && history.size === 1,
      'Derived wrap reflow added another history transaction',
    );
    await editor.command('undo');
    await settle();
    assert(
      geometry() === beforeMove && doc.textFlows[0].html === beforeMoveHTML,
      'Undo obstacle move did not restore native wrap geometry',
    );
    for (const mode of ['contour', 'jump', 'next-column']) {
      const beforeMode = geometry(),
        beforeModeHTML = doc.textFlows[0].html,
        beforeCommits = commits;
      await changeMode(mode);
      verifyCoverage();
      const lines = column().native.lines;
      if (mode === 'contour')
        assert(
          lines.some(
            (line) =>
              line.baseline > 80 && line.baseline < 160 && line.originX > 150 && line.originX < 249,
          ),
          'Native contour wrap still uses its triangle bounding rectangle',
        );
      if (mode === 'jump')
        assert(
          lines.every(
            (line) =>
              line.baseline + line.descent <= 50.001 || line.baseline - line.ascent >= 169.999,
          ),
          'Native jump-object left ink beside the blocker',
        );
      if (mode === 'next-column') {
        assert(
          lines.every((line) => line.baseline + line.descent <= 50.001),
          'Native next-column continued below the blocker in its original frame',
        );
        assert(
          column(second.id).native.lines.length,
          'Native next-column did not flow into the linked frame',
        );
      }
      assert(
        doc.textFlows[0].html === beforeModeHTML &&
          commits === beforeCommits + 1 &&
          history.size === 1,
        'Wrap mode command rewrote source or recorded derived history',
      );
      await editor.command('undo');
      await settle();
      assert(
        geometry() === beforeMode && history.size === 0,
        'Wrap mode undo did not restore the exact native plan',
      );
    }
    await editor.command('document-text');
    await settle();
    const editWord = wordRange('word040');
    await select(editWord.start, editWord.end);
    const beforeRejected = documentContent(doc),
      beforeRejectedHTML = doc.textFlows[0].html,
      beforeRejectedCommits = commits,
      beforeRejectedHistory = history.size;
    await property('fontSize', 22);
    assert(
      documentContent(doc) === beforeRejected &&
        doc.textFlows[0].html === beforeRejectedHTML &&
        commits === beforeRejectedCommits &&
        history.size === beforeRejectedHistory,
      'Rejected mixed-metric wrapped source edit changed canonical source/history',
    );
    assert(notices.length, 'Mixed-metric native wrap rejection was not explained');
    notices.length = 0;
    await editor.command('document-text');
    await settle();
    const tabWord = wordRange('word040');
    await select(tabWord.start);
    await insert('\t');
    await settle();
    assert(
      documentContent(doc) === beforeRejected &&
        doc.textFlows[0].html === beforeRejectedHTML &&
        commits === beforeRejectedCommits &&
        history.size === beforeRejectedHistory,
      'Rejected tab insertion changed canonical wrapped source/history',
    );
    assert(notices.length, 'Unsupported native wrapped tab rejection was not explained');
    notices.length = 0;
    editor.destroy();
    // A read-only view may display a real native prefix but cannot create automatic pages.
    doc = createSceneDocument('Passive native wrapped continuation', { width: 500, height: 300 });
    const passiveFrame = insertObject(doc, 'text', doc.pages[0].id, {
        x: 30,
        y: 30,
        w: 420,
        h: 90,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 22,
        html: '<p>' + words(90) + '</p>',
      }),
      passiveFlow = startTextFlow(doc, passiveFrame.id, { automaticPages: true }),
      passiveObstacle = insertObject(doc, 'polygon', doc.pages[0].id, {
        x: 180,
        y: 30,
        w: 100,
        h: 75,
      });
    setTextWrap(doc, [passiveObstacle.id], { mode: 'bounds' });
    enableNativeComposition(doc, passiveFlow, 'paragraph');
    doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
      .documents[0];
    writable = false;
    history = createDocumentHistory();
    commits = changes = 0;
    composeOwned = port();
    const passiveBefore = documentContent(doc);
    mount({ editing: false });
    await settle();
    verifyCoverage({ complete: false });
    assert(
      painted().result.layout.coveredLength < painted().request.text.length,
      'Passive wrapped fixture did not exercise an overset prefix',
    );
    assert(
      doc.pages.length === 1 &&
        documentContent(doc) === passiveBefore &&
        commits === 0 &&
        changes === 0 &&
        history.size === 0,
      'Passive native wrap appended pages or authored source/history',
    );
    assert(!notices.length, 'Unexpected native wrapped-flow notice: ' + notices.join('; '));
    return {
      nativeObjectWrap: true,
      nativeSameBaselineFragments: true,
      nativeWholeWrappedRowNavigation: true,
      nativeWrapGapHit: true,
      nativeCrossFragmentTypingUndoReopen: true,
      nativeObstacleMoveReflow: true,
      nativeContourJumpNextColumn: true,
      nativeWrappedSourceFailureRollback: true,
      nativeWrappedPassivePrefixNoWrites: true,
    };
  } finally {
    editor?.destroy();
  }
}
