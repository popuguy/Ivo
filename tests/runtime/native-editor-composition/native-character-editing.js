import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../../src/domain/history/document-history.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
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
const near = (actual, expected, message, tolerance = 0.001) =>
  assert(
    Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < tolerance,
    `${message}: ${actual} versus ${expected}`,
  );
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

/** Actual Properties/input/ink witness for conditional native character protocol4. */
export async function verifyNativeCharacterEditing({
  host,
  compose,
  insert,
  key,
  save,
  load,
  capture = async () => {},
}) {
  let doc = createSceneDocument('Native character controls', { width: 600, height: 560 }),
    editor,
    history = createDocumentHistory(),
    commits = 0,
    changes = 0,
    mountCount = 0;
  // Author the publishing/layer capability before any frame snapshots or editor commands.
  enablePublishing(doc);
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 48,
      y: 48,
      w: 490,
      h: 420,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 24,
      frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 48, verticalAlign: 'top' },
      html:
        '<p>Raised sample preserves the strut.</p><p>Lowered sample preserves the strut.</p>' +
        '<p>Wide sample preserves the strut.</p><p>Tall sample preserves the strut.</p>' +
        '<p>smallcaps 012345 alternate a shape.</p><p>Editable inherits careful transforms.</p>' +
        '<p>Plain neighboring source remains regular.</p>',
    }),
    flow = startTextFlow(doc, frame.id, { automaticPages: false });
  enableNativeComposition(doc, flow, 'paragraph');
  doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];
  const calls = [],
    notices = [],
    input = () => host.querySelector('.canvas-flow-input'),
    source = () => doc.textFlows[0].html,
    port = () => async (request) => {
      const result = await compose(request);
      calls.push({ request, result });
      return result;
    };
  let composeOwned = port();
  function historyStep(direction) {
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
      initialState: { tool: 'select', selection: [frame.id] },
      sessionId: 'native-character-editing-' + ++mountCount,
      onNotify: (message) => notices.push(message),
      onChange: () => changes++,
      onCommit: (before, metadata) => {
        if (history.record(before, doc, metadata)) commits++;
      },
      onUndo: () => historyStep('undo'),
      onRedo: () => historyStep('redo'),
    });
  }
  async function settle() {
    await tick();
    await editor.flush();
    await tick();
    const error = host.querySelector('[data-composition-error]')?.dataset.compositionError;
    assert(!error, 'Native character composition failed: ' + error);
  }
  function painted() {
    const token = host.querySelector('svg[data-composed-text]')?.dataset.compositionToken,
      value = calls.findLast((call) => call.result.token === token);
    assert(value, 'Character controls painted native ink without a matching result');
    return value;
  }
  function geometry() {
    const { request, result } = painted();
    return stable({
      protocol: request.protocol,
      placements: request.placements,
      lines: result.layout.lines,
      vectors: result.vectors,
    });
  }
  function nativeWord(word) {
    const { request, result } = painted(),
      start = request.text.indexOf(word),
      end = start + word.length,
      line = result.layout.lines.find((item) => item.start <= start && item.end > start),
      run = line?.runs.find((item) => item.start <= start && item.end > start),
      transport = request.runs.find((item) => item.start <= start && item.end > start),
      glyphs = line?.runs
        .flatMap((item) => item.glyphs)
        .filter((glyph) => glyph.index >= start && glyph.index < end);
    assert(
      start >= 0 && run && transport && glyphs.length,
      'Native character word is absent: ' + word,
    );
    return { request, result, start, end, line, run, transport, glyphs };
  }
  function wordGeometry(word) {
    const value = nativeWord(word),
      svg = host.querySelector('svg[data-composed-text]'),
      glyph = svg.querySelector(`use[data-composed-index="${value.glyphs[0].index}"]`),
      box = glyph?.getBBox(),
      matrix = glyph?.transform.baseVal.consolidate()?.matrix,
      first = value.line.carets.find((caret) => caret.index === value.start),
      last = value.line.carets.find((caret) => caret.index === value.end);
    assert(box && matrix && first && last, 'Native painted character geometry is absent: ' + word);
    return {
      ...value,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
      caretWidth: last.primary - first.primary,
    };
  }
  async function selectIndices(start, end = start) {
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
      'Native character selection could not be restored',
    );
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
  }
  async function selectWord(word, { collapsed = false } = {}) {
    await editor.command('document-text');
    await settle();
    const segment = textIndexMap(input()).segments.find((part) => part.node.data.includes(word));
    assert(segment, 'Canonical character source lost word: ' + word);
    const start = segment.start + segment.node.data.indexOf(word);
    await selectIndices(start, collapsed ? start : start + word.length);
    return { start, end: start + word.length };
  }
  async function selectAll() {
    await editor.command('document-text');
    await settle();
    const range = document.createRange();
    range.selectNodeContents(input());
    input().focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
  }
  async function property(name, value) {
    const control = host.querySelector(`[data-object-prop="${name}"]`);
    assert(control && !control.disabled, 'Production Character Properties lacks: ' + name);
    for (let owner = control.parentElement; owner && owner !== host; owner = owner.parentElement)
      if (owner.tagName === 'DETAILS') owner.open = true;
    control.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 74, button: 0 }),
    );
    control.focus();
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  async function feature(name, enabled, { hidden = false } = {}) {
    await editor.command('type-options');
    await tick();
    const control = host.querySelector(`[data-type-feature="${name}"]`),
      row = control?.closest('[data-feature-row]');
    assert(
      control && !control.disabled && row && (hidden || !row.hidden),
      'Production OpenType option is unavailable: ' + name,
    );
    control.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 75, button: 0 }),
    );
    control.checked = enabled;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return host.querySelector(`[data-type-feature="${name}"]`);
  }
  function verifyPlan(expectedProtocol = 4) {
    const { request, result } = painted();
    assert(
      request.protocol === expectedProtocol &&
        result.protocol === expectedProtocol &&
        request.mode === 'planned-lines-proof',
      'Character edit did not use its conditional planned protocol: ' +
        JSON.stringify({
          expectedProtocol,
          request: request.protocol,
          result: result.protocol,
          mode: request.mode,
        }),
    );
    assert(
      result.layout.coveredLength === request.text.length,
      'Character fixture is unexpectedly overset',
    );
    assert(
      result.layout.lines.length === 7 && request.placements.length === 7,
      'Short character paragraphs changed line count',
    );
    for (const [index, line] of result.layout.lines.entries()) {
      assert(
        line.placementIndex === index && line.end === request.placements[index].end,
        'Character shaping changed the owned source plan',
      );
      near(
        line.baseline,
        48 + index * 24,
        'Character scale/shift changed a declared strut baseline',
      );
      near(
        line.baseline,
        request.placements[index].baseline,
        'Character shaping moved a planned baseline',
      );
    }
    assert(
      !host.querySelector('[data-flow-frame] [data-flow-text]'),
      'Advanced native text paints duplicate browser ink',
    );
    assert(
      host.querySelector('svg[data-composed-text] use'),
      'Advanced native text has no vector ink',
    );
    assert(!notices.length, 'Unexpected character notification: ' + notices.join('; '));
  }
  async function verifyCaretQuery(word) {
    const position = await selectWord(word, { collapsed: true }),
      { request, result } = painted(),
      col = {
        element: host.querySelector(`[data-flow-column="${frame.id}-column-0"]`),
        start: nativeSourceBoundary(request, result.layout.lines[0].start),
        end: nativeSourceBoundary(request, result.layout.lines.at(-1).end),
        native: { lines: result.layout.lines, spans: request.spans, text: request.text },
      },
      local = nativeCaretRect(col, { index: position.start, affinity: 'forward' }),
      expected = nativeRectScreenBounds(col, local),
      selection = captureTextSelection(input()),
      marker = host.querySelector('[data-native-selection="caret"]'),
      paintedRect = marker?.getBoundingClientRect(),
      range = window.getSelection().getRangeAt(0),
      query = [...range.getClientRects()].find((rect) => rect.height > 0);
    assert(
      expected &&
        paintedRect &&
        query &&
        selection?.anchor.index === position.start &&
        selection.focus.index === position.start,
      'Advanced native caret/query geometry is absent',
    );
    const selectedRun = nativeWord(word);
    near(
      local.y,
      selectedRun.line.baseline - selectedRun.run.inkAscent,
      'Caret does not use the affinity-owned run signed ink top',
    );
    near(
      local.height,
      Math.max(1, selectedRun.run.inkAscent + selectedRun.run.inkDescent),
      'Caret does not use the affinity-owned run signed ink height',
    );
    for (const [label, actual] of [
      ['painted', paintedRect],
      ['retained input', query],
    ]) {
      near(actual.left, expected.x, label + ' character caret x', 2);
      near(actual.top, expected.y, label + ' character caret top', 2);
      near(actual.height, expected.height, label + ' character caret height', 2);
    }
    assert(
      getComputedStyle(input()).opacity === '0',
      'Advanced canonical input paints duplicate glyphs',
    );
  }
  try {
    mount();
    await settle();
    verifyPlan(3);
    const initialSource = source(),
      originalWords = painted().request.text,
      originalFrames = stable(doc.blocks),
      originalPages = stable(doc.pages),
      control = Object.fromEntries(
        ['Raised', 'Lowered', 'Wide', 'Tall', 'smallcaps', '012345', 'alternate'].map((word) => [
          word,
          wordGeometry(word),
        ]),
      );
    assert(commits === 0 && changes === 0, 'Initial character composition wrote authored history');
    await selectWord('Raised');
    await property('baselineShift', 6);
    verifyPlan();
    let raised = wordGeometry('Raised');
    near(raised.run.baselineShift, 6, 'Raised native run shift');
    assert(raised.run.inkDescent < 0, 'Raised native run lost its signed negative ink descent');
    near(raised.run.inkAscent, raised.run.ascent + 6, 'Raised native ink ascent');
    near(
      raised.glyphs[0].position[1] - control.Raised.glyphs[0].position[1],
      6,
      'Raised glyph position',
    );
    near(
      raised.matrix.f,
      raised.line.baseline - raised.glyphs[0].position[1],
      'Raised SVG glyph translation',
    );
    await verifyCaretQuery('Raised');
    await selectWord('Lowered');
    await property('baselineShift', -6);
    verifyPlan();
    const lowered = wordGeometry('Lowered');
    near(lowered.run.baselineShift, -6, 'Lowered native run shift');
    near(lowered.run.inkDescent, lowered.run.descent + 6, 'Lowered native ink descent');
    near(
      lowered.glyphs[0].position[1] - control.Lowered.glyphs[0].position[1],
      -6,
      'Lowered glyph position',
    );
    await verifyCaretQuery('Lowered');
    await selectWord('Wide');
    await property('horizontalScale', 150);
    verifyPlan();
    const wide = wordGeometry('Wide');
    near(wide.transport.horizontalScale, 150, 'Horizontal scale was not transported');
    near(wide.caretWidth, control.Wide.caretWidth * 1.5, 'Scaled native source caret width');
    near(wide.box.width, control.Wide.box.width * 1.5, 'Actual native vector width', 0.02);
    near(
      wide.box.height,
      control.Wide.box.height,
      'Horizontal scaling changed vector height',
      0.02,
    );
    await verifyCaretQuery('Wide');
    await selectWord('Tall');
    await property('verticalScale', 125);
    verifyPlan();
    const tall = wordGeometry('Tall');
    near(tall.transport.verticalScale, 125, 'Vertical scale was not transported');
    near(tall.box.height, control.Tall.box.height * 1.25, 'Actual native vector height', 0.02);
    near(tall.box.width, control.Tall.box.width, 'Vertical scaling changed vector width', 0.02);
    near(
      tall.run.ascent,
      control.Tall.line.ascent,
      'Vertical scaling changed the declared font strut',
    );
    near(tall.run.inkAscent, tall.run.ascent * 1.25, 'Vertical native ink ascent');
    await verifyCaretQuery('Tall');
    for (const [word, field, tag, substitution] of [
      ['smallcaps', 'smallCaps', 'smcp', true],
      ['012345', 'oldstyleFigures', 'onum', true],
      ['alternate', 'stylisticAlternates', 'salt', false],
    ]) {
      await selectWord(word);
      const checkbox = await feature(field, true);
      verifyPlan();
      const changed = nativeWord(word);
      assert(
        changed.transport.features?.[tag] === true &&
          checkbox.checked &&
          checkbox.closest('[data-feature-row]').dataset.checked === 'true',
        'OpenType native transport/checked feedback is missing: ' + tag,
      );
      if (substitution)
        assert(
          stable(changed.glyphs.map((glyph) => glyph.glyph)) !==
            stable(control[word].glyphs.map((glyph) => glyph.glyph)),
          'Declared OpenType feature did not substitute its test glyphs: ' + tag,
        );
    }
    // Signed ink boxes and decorations must follow the shifted run, rather than a stale line box.
    await selectWord('Raised');
    await property('highlight', '#fff176');
    await selectWord('Raised');
    await property('underline', true);
    verifyPlan();
    raised = nativeWord('Raised');
    const svg = host.querySelector('svg[data-composed-text]'),
      highlight = [...svg.querySelectorAll('rect')].find(
        (rect) => rect.getAttribute('fill') === '#fff176',
      ),
      underline = [...svg.querySelectorAll('rect')].find(
        (rect) =>
          rect.getAttribute('fill') === '#252525' && Number(rect.getAttribute('height')) < 3,
      );
    assert(highlight && underline, 'Native character decorations were not painted');
    near(
      Number(highlight.getAttribute('y')),
      raised.line.baseline - raised.run.inkAscent,
      'Shifted highlight top',
    );
    near(
      Number(highlight.getAttribute('height')),
      raised.run.inkAscent + raised.run.inkDescent,
      'Signed shifted highlight height',
    );
    near(
      Number(underline.getAttribute('y')),
      raised.line.baseline - 6 - raised.run.underlinePosition,
      'Shifted underline position',
    );
    await selectWord('Editable');
    await property('baselineShift', 6);
    await selectWord('Editable');
    await property('horizontalScale', 150);
    await selectWord('Editable');
    await property('verticalScale', 125);
    await selectWord('Editable');
    await key('I', ['meta']);
    await settle();
    verifyPlan();
    const transformed = nativeWord('Editable');
    assert(
      /Italic/.test(transformed.run.font) &&
        transformed.transport.baselineShift === 6 &&
        transformed.transport.horizontalScale === 150 &&
        transformed.transport.verticalScale === 125,
      'Range italics lost native character transforms',
    );
    const beforeTypingHTML = source(),
      beforeTypingGeometry = geometry(),
      beforeTypingCommits = commits;
    await selectWord('Editable');
    await insert('Edited');
    await settle();
    verifyPlan();
    const edited = nativeWord('Edited');
    assert(
      /Italic/.test(edited.run.font) &&
        edited.transport.baselineShift === 6 &&
        edited.transport.horizontalScale === 150 &&
        edited.transport.verticalScale === 125,
      'Trusted typing reset inherited native character attributes',
    );
    assert(
      commits === beforeTypingCommits + 1,
      'Trusted transformed typing was not one authored transaction',
    );
    const plain = nativeWord('Plain');
    assert(
      !/Italic/.test(plain.run.font) &&
        !plain.transport.baselineShift &&
        !plain.transport.horizontalScale &&
        !plain.transport.verticalScale,
      'Advanced range styling leaked to neighboring source',
    );
    const editedHTML = source(),
      editedGeometry = geometry();
    await editor.command('undo');
    await settle();
    assert(
      source() === beforeTypingHTML && geometry() === beforeTypingGeometry,
      'Undo lost exact transformed source/glyph/caret geometry',
    );
    await editor.command('redo');
    await settle();
    assert(
      source() === editedHTML && geometry() === editedGeometry,
      'Redo lost exact transformed source/glyph/caret geometry',
    );
    await verifyCaretQuery('Edited');
    await capture();
    // A stale/programmatic unsupported control still cannot bypass exact-font admission.
    await selectWord('Plain');
    await editor.command('type-options');
    await tick();
    const absent = host.querySelector('[data-type-feature="discretionaryLigatures"]');
    assert(
      absent?.closest('[data-feature-row]').hidden,
      'Missing CMU dlig was exposed as an available feature',
    );
    const beforeRejected = documentContent(doc),
      rejectedSource = source(),
      rejectedHistory = history.size,
      rejectedCommits = commits;
    await feature('discretionaryLigatures', true, { hidden: true });
    assert(
      documentContent(doc) === beforeRejected &&
        source() === rejectedSource &&
        history.size === rejectedHistory &&
        commits === rejectedCommits,
      'Missing CMU dlig changed model/source/history',
    );
    assert(notices.length, 'Missing CMU dlig rejection was not explained');
    notices.length = 0;
    await save({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
    editor.destroy();
    doc = validateImport(await load()).documents[0];
    history = createDocumentHistory();
    commits = changes = 0;
    composeOwned = port();
    mount();
    await settle();
    verifyPlan();
    assert(
      source() === editedHTML && geometry() === editedGeometry && commits === 0 && changes === 0,
      'Cold archive reopen changed advanced character source/glyph geometry',
    );
    assert(
      stable(doc.blocks) === originalFrames && stable(doc.pages) === originalPages,
      'Character editing changed authored frame/page geometry: ' +
        JSON.stringify({
          frames: valueDifferences(JSON.parse(originalFrames), doc.blocks),
          pages: valueDifferences(JSON.parse(originalPages), doc.pages),
        }),
    );
    for (const [field, value] of [
      ['baselineShift', 0],
      ['horizontalScale', 100],
      ['verticalScale', 100],
    ]) {
      await selectAll();
      await property(field, value);
    }
    for (const field of ['smallCaps', 'oldstyleFigures', 'stylisticAlternates']) {
      await selectAll();
      await feature(field, false, { hidden: true });
    }
    verifyPlan(3);
    assert(
      painted().request.runs.every(
        (run) =>
          !run.baselineShift &&
          !run.horizontalScale &&
          !run.verticalScale &&
          !Object.values(run.features || {}).some(Boolean),
      ),
      'Reset character defaults left advanced native fields active',
    );
    assert(
      painted().request.text === originalWords.replace('Editable', 'Edited'),
      'Character formatting/reset rewrote source characters',
    );
    assert(source() !== initialSource, 'Transformed typing unexpectedly lost its authored edit');
    return {
      nativeCharacterProperties: true,
      conditionalCharacterProtocol: true,
      nativeSignedCharacterInk: true,
      nativeCharacterVectorsCaretsInput: true,
      nativeOpenTypeSubstitutionAndFeedback: true,
      nativeShiftedDecorations: true,
      nativeCharacterTypingItalicUndoReopen: true,
      missingFontFeatureTransactionRollback: true,
      nativeCharacterResetProtocol: true,
    };
  } finally {
    editor?.destroy();
  }
}
