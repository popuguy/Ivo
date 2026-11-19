import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { promoteTextLayout } from '../../../src/domain/documents/derived-text-layout.js';
import { compositionSource } from '../../../src/rendering/text/composition-source.js';
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
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { verifyParagraphProjection } from './paragraph-projection.js';
import { verifyNativeParagraphEditing } from './paragraph-editing.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  report = (value) => console.log('IVO_NATIVE_EDITOR_RESULT:' + JSON.stringify(value));
window.addEventListener('error', (event) => report({ error: event.error?.stack || event.message }));
window.addEventListener('unhandledrejection', (event) =>
  report({ error: event.reason?.stack || String(event.reason) }),
);
try {
  await document.fonts.ready;
  const paragraphProjection = verifyParagraphProjection();
  const host = document.querySelector('#host'),
    notices = [],
    mouseTrace = [],
    calls = [],
    measurements = [],
    phase = new URL(location.href).searchParams.get('phase');
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'lostpointercapture'])
    window.addEventListener(
      type,
      (event) => {
        mouseTrace.push({
          type,
          detail: event.detail,
          target: event.target
            .closest?.('[data-flow-frame],.canvas-flow-input')
            ?.outerHTML.slice(0, 160),
          x: event.clientX,
          y: event.clientY,
        });
        if (mouseTrace.length > 30) mouseTrace.shift();
      },
      { capture: true },
    );
  let doc,
    editor,
    commits = 0,
    changes = 0,
    writable = true,
    paragraphEditing = {},
    held = null,
    history = createDocumentHistory();
  const native = {
    compose: async (request) => {
      const result = await window.nativeEditorTest.compose(request);
      const gate = held;
      if (gate && !gate.started && request.mode !== 'measure-lines-proof') {
        gate.started = { request, result };
        await gate.wait;
      }
      if (request.mode === 'measure-lines-proof') measurements.push({ request, result });
      else calls.push({ request, result });
      return result;
    },
  };
  function holdNextComposition() {
    assert(!held, 'A delayed composition is already active');
    let release;
    const gate = {
      started: null,
      wait: new Promise((resolve) => {
        release = resolve;
      }),
    };
    held = gate;
    return {
      gate,
      release() {
        if (held === gate) held = null;
        release();
      },
      async started() {
        for (let i = 0; i < 150; i++) {
          if (gate.started) return gate.started;
          await tick();
        }
        throw Error('The deliberately delayed composition did not start');
      },
    };
  }
  function project(html) {
    const root = document.createElement('div');
    root.innerHTML = html;
    return compositionSource(root, {
      id: 'source-projection',
      doc: doc || createSceneDocument(),
      settings: { textStyle: 'cmu-serif', fontSize: 16 },
      fontFor: (style) => (style.italic ? 'cmu-italic' : 'cmu-regular'),
    });
  }
  const ascii = project('   '),
    nbsp = project('\u00a0'),
    indented = project('\n  <p>A</p>\n  <p>B</p>\n'),
    mixed = project('first<div>second</div>'),
    blank = project('<p><br></p>'),
    italic = project('<p><em>italic</em> regular</p>');
  assert(ascii.text === '   \u2029', 'Root-only spaces were dropped');
  assert(nbsp.text === '\u00a0\u2029', 'Root NBSP was dropped');
  assert(
    indented.text === 'A\u2029B\u2029' && indented.spans.some((s) => s.kind === 'whitespace'),
    'Formatting indentation entered native text',
  );
  assert(
    mixed.text === 'first\u2029second\u2029' &&
      mixed.spans.some((s) => s.kind === 'paragraph' && s.logicalStart === s.logicalEnd),
    'Mixed inline/div source lost generated paragraph',
  );
  assert(
    blank.text === '\u2029' && blank.spans.some((s) => s.kind === 'placeholder'),
    'Blank paragraph lost placeholder provenance',
  );
  assert(
    italic.runs.some((r) => r.font === 'cmu-italic') &&
      italic.runs.some((r) => r.font === 'cmu-regular'),
    'Semantic italic source lost distinct native font',
  );
  for (const html of [
    '   ',
    '\u00a0',
    '\n  <p>A</p>\n  <p>B</p>\n',
    'first<div>second</div>',
    '<p><br></p>',
  ]) {
    const root = document.createElement('div');
    root.innerHTML = html;
    assert(
      project(html).sourceHTML === root.innerHTML,
      'Projection changed canonical DOM source HTML',
    );
  }
  function mount({ editing = true } = {}) {
    const first = doc.textFlows[0].frameIds[0];
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (s) => s,
      editing,
      canWrite: () => writable,
      textComposition: native,
      assets: () => [],
      fonts: () => [],
      initialState: { tool: 'text', selection: [first] },
      sessionId: 'native-editor-' + phase + '-' + doc.id,
      onCommit: (before, meta) => {
        promoteTextLayout(before, doc);
        if (history.record(before, doc, meta)) commits++;
      },
      onChange: () => {
        changes++;
      },
      onNotify: (m) => notices.push(m),
      onUndo: () => {
        const r = history.undo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
      onRedo: () => {
        const r = history.redo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
    });
  }
  async function settle() {
    await tick();
    await editor.flush();
    await tick();
    const error = host.querySelector('[data-composition-error]')?.dataset.compositionError;
    assert(!error, 'Native editor composition failed: ' + error);
  }
  async function choose(composer) {
    const control = host.querySelector('[data-flow-composer]');
    assert(control, 'Text composer control is missing');
    control.value = composer;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 80 && !doc.textFlows[0].composition; i++) {
      await tick();
      if (notices.length) break;
    }
    await settle();
  }
  function latest(frameId = doc.textFlows[0].frameIds[0]) {
    const token = host.querySelector(`[data-flow-frame="${frameId}"] svg[data-composed-text]`)
      ?.dataset.compositionToken;
    const value = calls.findLast((call) => call.result.token === token);
    assert(value, 'The painted native result has no matching request: ' + frameId);
    return value;
  }
  function column(frameId) {
    const { request, result } = latest(frameId),
      id = frameId + '-column-0',
      element = host.querySelector(`[data-flow-column="${id}"]`),
      lines = result.layout.lines.filter((line) => line.frame === id),
      all = result.layout.lines,
      before = all.findIndex((line) => line.frame === id),
      source = { text: request.text, logicalLength: request.logicalLength, spans: request.spans },
      start = nativeSourceBoundary(source, before > 0 ? all[before - 1].end : 0),
      end = nativeSourceBoundary(source, lines.at(-1)?.end || 0);
    assert(element && lines.length, 'Composed column is absent: ' + frameId);
    return {
      element,
      frameId,
      start,
      end,
      native: { lines, spans: request.spans, text: request.text },
    };
  }
  function point(frameId, point) {
    const col = column(frameId),
      rect = nativeCaretRect(col, point),
      screen = nativeRectScreenBounds(col, rect);
    assert(
      screen && [screen.x, screen.y].every(Number.isFinite),
      'Native pointer geometry is absent',
    );
    return [screen.x + 0.3, screen.y + screen.height / 2];
  }
  function input() {
    return host.querySelector('.canvas-flow-input');
  }
  function selectIndices(start, end = start) {
    const root = input();
    root.focus();
    restoreTextSelection(root, {
      anchor: { path: [], offset: 0, kind: 'text', index: start, affinity: 'forward' },
      focus: { path: [], offset: 0, kind: 'text', index: end, affinity: 'backward' },
    });
  }
  function wordIndices(word) {
    const root = input(),
      map = textIndexMap(root),
      part = map.segments.find((s) => s.node.data.includes(word));
    assert(part, 'Canonical source word missing: ' + word);
    const offset = part.node.data.indexOf(word);
    return { start: part.start + offset, end: part.start + offset + word.length };
  }
  function selectWord(word) {
    const indices = wordIndices(word);
    selectIndices(indices.start, indices.end);
    return indices;
  }
  function nativeWordFont(word) {
    const { request, result } = latest(),
      index = request.text.indexOf(word);
    const fonts = result.layout.lines
      .flatMap((line) => line.runs)
      .filter((r) => r.start <= index && r.end > index)
      .map((r) => r.font);
    assert(
      index >= 0 && fonts.length > 0,
      'Native glyph runs are missing the asserted source word: ' + word,
    );
    return fonts;
  }
  function verifyInk() {
    const svgs = [...host.querySelectorAll('[data-composed-text]')];
    assert(
      svgs.length && svgs.some((svg) => svg.querySelector('use')),
      'Native vector ink was not mounted',
    );
    assert(
      host.querySelector('[data-flow-frame]').querySelectorAll('[data-flow-text]').length === 0,
      'Browser-shaped flow text remains visible beside native ink',
    );
    assert(
      getComputedStyle(input()).opacity === '0',
      'Canonical input is painting duplicate browser ink',
    );
  }
  if (phase === 'reopen') {
    doc = validateImport(await window.nativeEditorTest.load()).documents[0];
    mount();
    await settle();
    await editor.command('document-text');
    await settle();
    verifyInk();
    assert(
      nativeWordFont('bravo').every((font) => /Italic/.test(font)),
      'Reopened partial italic is missing from native glyph runs',
    );
    assert(
      nativeWordFont('charlie').every((font) => !/Italic/.test(font)),
      'Reopen leaked italic into regular source',
    );
    editor.destroy();
  } else {
    doc = createSceneDocument('Native actual editor', { width: 600, height: 350 });
    const a = insertObject(doc, 'text', doc.pages[0].id, {
        x: 40,
        y: 35,
        w: 200,
        h: 105,
        textStyle: 'cmu-serif',
        fontSize: 16,
        html:
          '<p><em>Heading.</em> Alpha bravo charlie delta echo foxtrot golf hotel india juliet.</p>' +
          Array.from(
            { length: 3 },
            (_, i) =>
              `<p>Paragraph ${i + 1}. Shared native text remains editable and precisely selectable through linked frames and separate pages with exact portable fonts.</p>`,
          ).join(''),
      }),
      flow = startTextFlow(doc, a.id, { automaticPages: false }),
      page = addPage(doc, doc.pages[0].id),
      b = insertObject(doc, 'text', page.id, { x: 60, y: 35, w: 260, h: 270 });
    threadFrame(doc, a.id, b.id);
    mount();
    await tick();
    const beforeRejected = JSON.stringify(doc);
    await choose('paragraph');
    assert(
      !doc.textFlows[0].composition && JSON.stringify(doc) === beforeRejected,
      'Rejected native preflight changed source/capability',
    );
    assert(
      notices.some((n) => n.includes('unequal column widths')),
      'Unsupported paragraph geometry was not explained',
    );
    notices.length = 0;
    await choose('single-line');
    assert(flow.composition?.composer === 'single-line', 'UI did not opt into native composer');
    await editor.command('fit-all');
    await editor.command('document-text');
    await settle();
    verifyInk();
    const doubleWord = selectWord('charlie'),
      doublePoint = point(a.id, { index: doubleWord.start + 2, affinity: 'forward' }),
      beforeDoubleClick = JSON.stringify(doc),
      beforeDoubleHistory = commits;
    await editor.command('tool-select');
    await tick();
    await window.nativeEditorTest.doubleClick(doublePoint);
    await tick();
    assert(
      window.getSelection().toString() === 'charlie',
      'Object-tool double-click did not enter the clicked native word',
    );
    const activeWord = wordIndices('bravo');
    await window.nativeEditorTest.doubleClick(
      point(a.id, { index: activeWord.start + 2, affinity: 'forward' }),
    );
    await tick();
    assert(
      window.getSelection().toString() === 'bravo',
      'Double-click inside the active native editor did not select the clicked word: ' +
        JSON.stringify(window.getSelection().toString()),
    );
    const endWord = wordIndices('foxtrot');
    await window.nativeEditorTest.select({
      from: point(a.id, { index: activeWord.start + 2, affinity: 'forward' }),
      to: point(a.id, { index: endWord.start + 2, affinity: 'forward' }),
      clicks: 2,
    });
    await tick();
    assert(
      window.getSelection().toString() === 'bravo charlie delta echo foxtrot',
      'Native double-click drag did not extend by complete words: ' +
        JSON.stringify({ text: window.getSelection().toString(), mouseTrace }),
    );
    await window.nativeEditorTest.select({ from: doublePoint, clicks: 3 });
    await tick();
    assert(
      window.getSelection().toString().startsWith('Heading.') &&
        window.getSelection().toString().includes('juliet.') &&
        !window.getSelection().toString().includes('Paragraph 1'),
      'Native triple-click did not select the containing paragraph',
    );
    assert(
      JSON.stringify(doc) === beforeDoubleClick && commits === beforeDoubleHistory,
      'Native double-click changed source/history',
    );
    const oldHit = point(b.id, { index: column(b.id).start + 8, affinity: 'forward' }),
      delayed = holdNextComposition();
    selectWord('charlie');
    await window.nativeEditorTest.insert('charlie PENDING');
    await delayed.started();
    await tick();
    const pendingSelection = captureTextSelection(input()),
      pendingHTML = doc.textFlows[0].html;
    assert(editor.pending, 'The delayed native composition was not pending');
    assert(
      !host.querySelector('[data-native-selection="caret"]'),
      'A stale native caret remained active while source composition was pending',
    );
    assert(
      !input().style.translate || input().style.translate === 'none',
      'Stale native geometry still translated the canonical caret while pending',
    );
    await window.nativeEditorTest.drag(oldHit, [oldHit[0] + 35, oldHit[1] + 5]);
    await tick();
    const afterPendingHit = captureTextSelection(input());
    assert(
      afterPendingHit?.anchor.index === pendingSelection?.anchor.index &&
        afterPendingHit?.focus.index === pendingSelection?.focus.index,
      'A stale native hit moved the canonical source selection while pending: ' +
        JSON.stringify({ pendingSelection, afterPendingHit }),
    );
    assert(doc.textFlows[0].html === pendingHTML, 'A stale native hit changed pending source');
    delayed.release();
    await settle();
    await editor.command('document-text');
    selectWord('charlie PENDING');
    await window.nativeEditorTest.insert('charlie');
    await settle();
    const originalInput = input(),
      source = flow.html,
      originalCommits = commits,
      firstCol = column(a.id),
      secondCol = column(b.id),
      fromIndex = firstCol.native.lines[0].carets.find((c) => c.index > 2).logicalCandidates.at(-1),
      toIndex = secondCol.native.lines
        .at(-1)
        .carets.findLast((c) => c.index < secondCol.native.lines.at(-1).contentEnd)
        .logicalCandidates[0];
    await window.nativeEditorTest.drag(
      point(a.id, { index: fromIndex, affinity: 'forward' }),
      point(b.id, { index: toIndex, affinity: 'backward' }),
    );
    await tick();
    const selection = captureTextSelection(input());
    assert(
      selection && selection.focus.index > selection.anchor.index,
      'Trusted drag did not select across native frames/pages: ' +
        JSON.stringify({
          selection,
          from: point(a.id, { index: fromIndex, affinity: 'forward' }),
          to: point(b.id, { index: toIndex, affinity: 'backward' }),
          viewport: host.querySelector('.canvas-viewport').getBoundingClientRect().toJSON(),
          state: editor.getState(),
          mouseTrace,
        }),
    );
    assert(
      selection.anchor.index < firstCol.end && selection.focus.index >= secondCol.start,
      'Trusted selection endpoints did not span the two composed physical frames',
    );
    assert(
      host.querySelectorAll('.canvas-native-selection [data-native-selection="range"]').length >= 2,
      'Native range paint did not reach multiple frames',
    );
    assert(
      flow.html === source && commits === originalCommits,
      'Native range selection wrote authored source',
    );
    assert(input() === originalInput, 'Native pointer selection replaced canonical input owner');
    await editor.command('tool-select');
    await editor.command('document-text');
    await tick();
    selectWord('bravo');
    await tick();
    await window.nativeEditorTest.key('I', ['meta']);
    await settle();
    assert(
      flow.html.includes('data-ivo-italic="true"'),
      'Trusted Command-I did not author canonical partial italic',
    );
    await editor.command('tool-select');
    await settle();
    assert(
      nativeWordFont('bravo').every((font) => /Italic/.test(font)),
      'Exiting text lost native italic rendering',
    );
    assert(
      nativeWordFont('charlie').every((font) => !/Italic/.test(font)),
      'Exiting text leaked italic into next native run',
    );
    await editor.command('document-text');
    await settle();
    assert(
      nativeWordFont('bravo').every((font) => /Italic/.test(font)),
      'Re-entering text changed native formatting',
    );
    selectWord('charlie');
    await tick();
    await window.nativeEditorTest.insert('CHARLIE');
    await settle();
    assert(
      doc.textFlows[0].html.includes('CHARLIE'),
      'Trusted insertText did not reach canonical source',
    );
    assert(input() === originalInput, 'Native typing replaced the canonical input');
    const typed = doc.textFlows[0].html;
    await editor.command('undo');
    await settle();
    assert(
      doc.textFlows[0].html.includes('charlie') && !doc.textFlows[0].html.includes('CHARLIE'),
      'Undo did not restore typed source',
    );
    await editor.command('redo');
    await settle();
    assert(doc.textFlows[0].html === typed, 'Redo did not restore typed source exactly');
    // Retain the regular word used by the fresh-window style assertion.
    await editor.command('undo');
    await settle();
    await editor.command('document-text');
    await tick();
    selectWord('bravo');
    await tick();
    const beforeUnsupported = JSON.stringify(doc),
      beforeUnsupportedHistory = history.size,
      baselineShift = host.querySelector('[data-object-prop="baselineShift"]');
    assert(baselineShift, 'The baseline shift control is absent from native text properties');
    baselineShift.value = '3';
    baselineShift.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const unsupportedDifferences = [];
    function diff(a, b, path = '') {
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
          diff(a[key], b[key], path + '.' + key);
      } else unsupportedDifferences.push({ path, before: a, after: b });
    }
    diff(JSON.parse(beforeUnsupported), doc);
    assert(
      JSON.stringify(doc) === beforeUnsupported && history.size === beforeUnsupportedHistory,
      'Unsupported native formatting changed authored HTML/style or history: ' +
        JSON.stringify({
          unsupportedDifferences,
          beforeUnsupportedHistory,
          afterHistory: history.size,
          notices,
        }),
    );
    assert(
      notices.some((message) => message.includes('baseline shift')),
      'Unsupported native formatting was not explained',
    );
    notices.length = 0;
    await window.nativeEditorTest.save({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [],
    });
    editor.destroy();
    report({ phase: 'edit' });
  }
  if (phase === 'reopen') {
    paragraphEditing = await verifyNativeParagraphEditing({
      host,
      compose: native.compose,
      insert: window.nativeEditorTest.insert,
      capture: window.nativeEditorTest.capture,
    });
    doc = createSceneDocument('Native automatic pages', { width: 400, height: 260 });
    const a = insertObject(doc, 'text', doc.pages[0].id, {
      x: 30,
      y: 30,
      w: 300,
      h: 180,
      textStyle: 'cmu-serif',
      fontSize: 16,
      html: '<p>short</p>',
    });
    startTextFlow(doc, a.id, { automaticPages: true });
    history = createDocumentHistory();
    commits = 0;
    calls.length = 0;
    mount();
    await tick();
    notices.length = 0;
    await choose('paragraph');
    assert(
      doc.textFlows[0].composition?.composer === 'paragraph',
      'Equal-width paragraph opt-in failed',
    );
    await editor.command('document-text');
    await settle();
    const initial = doc.textFlows[0].html,
      initialHistory = history.size,
      root = input(),
      range = document.createRange();
    range.selectNodeContents(root);
    root.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const long = Array(30)
      .fill('Portable native text flows across automatically owned pages.')
      .join(' ');
    await window.nativeEditorTest.insert(long);
    await settle();
    assert(doc.pages.length > 1, 'Native source growth did not append automatic pages');
    assert(history.size === initialHistory + 1, 'Derived page growth polluted authored history');
    const grown = doc.textFlows[0].html,
      grownPages = doc.pages.length;
    await editor.command('undo');
    await settle();
    assert(
      doc.textFlows[0].html === initial && doc.pages.length === 1,
      'Undo after derived page growth lost history/source',
    );
    await editor.command('redo');
    await settle();
    assert(
      doc.textFlows[0].html === grown && doc.pages.length === grownPages,
      'Redo did not restore automatic continuation',
    );
    await editor.command('document-text');
    await tick();
    const active = input(),
      all = document.createRange();
    all.selectNodeContents(active);
    active.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(all);
    await window.nativeEditorTest.insert('short again');
    await settle();
    assert(doc.pages.length === 1, 'Native source shrink did not trim owned pages');
    await editor.command('undo');
    await settle();
    assert(
      doc.textFlows[0].html === grown && doc.pages.length === grownPages,
      'Undo after derived trim failed',
    );
    assert(!notices.length, 'Unexpected native editor notifications: ' + notices.join('; '));
    editor.destroy();
    doc = createSceneDocument('Incremental paragraph editing', { width: 400, height: 300 });
    const incremental = insertObject(doc, 'text', doc.pages[0].id, {
      x: 30,
      y: 30,
      w: 300,
      h: 220,
      textStyle: 'cmu-serif',
      fontSize: 16,
      html:
        '<p>First paragraph has carefully positioned words.</p>' +
        '<p>Second paragraph keeps its original text and exact font.</p>' +
        '<p>Third paragraph remains unchanged through the edit.</p>',
    });
    enableNativeComposition(
      doc,
      startTextFlow(doc, incremental.id, { automaticPages: true }),
      'paragraph',
    );
    history = createDocumentHistory();
    changes = commits = 0;
    mount();
    await settle();
    const beforeIncremental = doc.textFlows[0].html,
      firstComposition = latest(incremental.id),
      sourceStart = firstComposition.request.text.indexOf('\u2029') + 1,
      measuredBefore = measurements.length;
    await editor.command('document-text');
    await tick();
    selectWord('Second');
    await window.nativeEditorTest.insert('Revised second');
    await settle();
    const afterIncremental = doc.textFlows[0].html,
      secondComposition = latest(incremental.id),
      sourceEnd = secondComposition.request.text.indexOf('\u2029', sourceStart) + 1,
      newMeasurements = measurements.slice(measuredBefore);
    assert(
      newMeasurements.length === 1 &&
        newMeasurements[0].request.candidates.every(
          ({ start, end }) => start >= sourceStart && end <= sourceEnd,
        ),
      'Typing in one paragraph remeasured unchanged paragraphs',
    );
    assert(
      newMeasurements[0].request.text === secondComposition.request.text,
      'Incremental measurements used a substitute paragraph source',
    );
    assert(
      afterIncremental !== beforeIncremental && commits === 1,
      'Incremental composition changed the authored history boundary',
    );
    const measuredAfter = measurements.length;
    await editor.command('undo');
    await settle();
    assert(
      doc.textFlows[0].html === beforeIncremental && measurements.length === measuredAfter,
      'Undo lost source or failed to reuse earlier paragraph measurements',
    );
    await editor.command('redo');
    await settle();
    assert(
      doc.textFlows[0].html === afterIncremental && measurements.length === measuredAfter,
      'Redo lost source or failed to reuse edited paragraph measurements',
    );
    await window.nativeEditorTest.save({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [],
    });
    const reopenedIncremental = validateImport(await window.nativeEditorTest.load());
    assert(
      reopenedIncremental.documents[0].textFlows[0].html === afterIncremental,
      'Incremental paragraph source changed across archive reopen',
    );
    editor.destroy();
    const passive = createSceneDocument('Passive native reader', { width: 400, height: 260 }),
      passiveFrame = insertObject(passive, 'text', passive.pages[0].id, {
        x: 30,
        y: 30,
        w: 300,
        h: 80,
        html:
          '<p>' +
          Array(10).fill('A passive window must never author derived automatic pages.').join(' ') +
          '</p>',
        textStyle: 'cmu-serif',
        fontSize: 16,
      }),
      passiveFlow = startTextFlow(passive, passiveFrame.id, { automaticPages: true });
    enableNativeComposition(passive, passiveFlow, 'single-line');
    doc = passive;
    writable = false;
    changes = commits = 0;
    history = createDocumentHistory();
    const passiveBefore = JSON.stringify(doc);
    mount({ editing: false });
    await settle();
    assert(
      host.querySelector('[data-composed-text]'),
      'Passive native reader did not compose visible text',
    );
    assert(
      JSON.stringify(doc) === passiveBefore && changes === 0 && commits === 0,
      'A passive native reader appended/trimmed pages or notified authored changes',
    );
    editor.destroy();
    doc = structuredClone(passive);
    doc.id = 'lost-lease-native';
    doc.textFlows[0].id += '-lease';
    doc.blocks[0].textFlowId = doc.textFlows[0].id;
    writable = true;
    changes = commits = 0;
    history = createDocumentHistory();
    const leaseBefore = JSON.stringify(doc),
      leaseDelay = holdNextComposition();
    mount();
    await leaseDelay.started();
    writable = false;
    leaseDelay.release();
    await settle();
    assert(
      JSON.stringify(doc) === leaseBefore && changes === 0 && commits === 0,
      'A native layout result applied derived pages after its writer lease was lost',
    );
    editor.destroy();
    doc = createSceneDocument('Native blank paragraph');
    const blank = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: 300,
      h: 120,
      fontSize: 16,
      html: '<p data-ivo-size="28"><br></p>',
    });
    enableNativeComposition(
      doc,
      startTextFlow(doc, blank.id, { automaticPages: false }),
      'single-line',
    );
    writable = true;
    changes = commits = 0;
    history = createDocumentHistory();
    mount();
    await settle();
    await editor.command('document-text');
    await tick();
    assert(
      captureTextSelection(input())?.focus.index === 1,
      'Native empty paragraph opened outside its styled placeholder',
    );
    await window.nativeEditorTest.insert('Blank');
    await settle();
    assert(
      latest(blank.id).request.runs.every((run) => run.size === 28),
      'Native blank-paragraph insertion reverted to the frame default font size',
    );
    assert(commits === 1, 'Entering a native blank paragraph added an extra authored edit');
    const beforePaste = doc.textFlows[0].html,
      transfer = new DataTransfer(),
      pasteRange = document.createRange();
    transfer.setData('text/html', ' <em>Native</em>');
    transfer.setData('text/plain', ' Native');
    pasteRange.selectNodeContents(input());
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(pasteRange);
    input().dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
    await settle();
    const pasted = latest(blank.id),
      nativeLine = pasted.result.layout.lines[0];
    assert(
      pasted.request.text.startsWith(' Native'),
      'Native paste lost its literal leading space',
    );
    assert(
      nativeLine.carets.find((c) => c.index === 1).primary >
        nativeLine.carets.find((c) => c.index === 0).primary,
      'Native leading space did not advance the painted caret',
    );
    assert(
      nativeWordFont('Native').every((font) => /Italic/.test(font)),
      'Native rich paste lost its exact italic font',
    );
    const pastedSource = doc.textFlows[0].html,
      reopenedPaste = validateImport(
        JSON.parse(
          JSON.stringify({
            schemaVersion: archiveVersion([doc]),
            documents: [doc],
            assets: [],
          }),
        ),
      ).documents[0];
    assert(
      reopenedPaste.textFlows[0].html === pastedSource,
      'Native paste changed after archive reopen',
    );
    await editor.command('undo');
    await settle();
    assert(doc.textFlows[0].html === beforePaste, 'Native paste did not undo in one step');
    await editor.command('redo');
    await settle();
    assert(doc.textFlows[0].html === pastedSource, 'Native paste redo lost source spacing');
    editor.destroy();
    report({
      ok: true,
      sourceProjection: true,
      ...paragraphProjection,
      ...paragraphEditing,
      realNativeBridge: true,
      composerPreflight: true,
      vectorInk: true,
      trustedCrossPageDrag: true,
      nativeObjectToolDoubleClick: true,
      activeEditorWordAndParagraphSelection: true,
      wordGranularityDrag: true,
      styledBlankParagraphInsertion: true,
      nativeRichClipboardWhitespace: true,
      trustedTyping: true,
      partialItalic: true,
      serializeReopen: true,
      undoRedo: true,
      automaticPageGrowthShrink: true,
      incrementalParagraphEditing: true,
      incrementalUndoRedoReopen: true,
      derivedHistory: true,
      pendingGeometryFence: true,
      passiveReaderNoWrites: true,
      lostLeaseFence: true,
      unsupportedFormattingRollback: true,
    });
  }
} catch (error) {
  report({ error: error.stack || String(error) });
}
