// Prepared for tests/runtime/native-editor-composition; root wires and executes this witness.
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enablePublishing, saveTextStyle } from '../../../src/domain/documents/publishing.js';
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
import { restoreTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  near = (actual, expected, message) =>
    assert(
      Number.isFinite(actual) && Math.abs(actual - expected) < 0.001,
      `${message}: ${actual} versus ${expected}`,
    ),
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  stable = (value) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item,
    );

/** Actual Paragraph Properties/dialog/input witness; assertions specify source/gap
 * behavior without claiming parity with Adobe's paragraph scoring objective. */
export async function verifyNativeWordSpacing({
  host,
  compose,
  insert,
  key,
  save,
  load,
  capture = async () => {},
}) {
  let doc,
    editor,
    frameId,
    history,
    commits,
    changes,
    mountCount = 0,
    authoredFrames,
    authoredPages,
    authoredStyles;
  const calls = [],
    notices = [],
    input = () => host.querySelector('.canvas-flow-input'),
    source = () => doc.textFlows[0].html,
    modal = () => document.querySelector('dialog.publishing-word-spacing-dialog[open]');
  function paragraphs() {
    const root = document.createElement('div');
    root.innerHTML = source();
    return [...root.querySelectorAll('p')];
  }
  function mark(index) {
    return paragraphs()[index]?.getAttribute('data-ivo-wordspace');
  }
  function policy(value) {
    const [minimum, desired, maximum] = value.split(':').map(Number);
    return { minimum, desired, maximum };
  }
  function ownFixture(name, html) {
    editor?.destroy();
    doc = createSceneDocument(name, { width: 600, height: 500 });
    enablePublishing(doc);
    saveTextStyle(doc, 'paragraph', {
      id: 'word-italic-style',
      name: 'Neighbor italic paragraph',
      attributes: { italic: true },
    });
    saveTextStyle(doc, 'paragraph', {
      id: 'word-other-style',
      name: 'Other paragraph',
      attributes: { fontSize: 18, leading: 26, align: 'center' },
    });
    const frame = insertObject(doc, 'text', doc.pages[0].id, {
        x: 48,
        y: 48,
        w: 490,
        h: 360,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 24,
        frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 48, verticalAlign: 'top' },
        html,
      }),
      flow = startTextFlow(doc, frame.id, { automaticPages: false });
    enableNativeComposition(doc, flow, 'paragraph');
    doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
      .documents[0];
    frameId = frame.id;
    resetOwner();
  }
  function resetOwner() {
    history = createDocumentHistory();
    commits = changes = 0;
    notices.length = 0;
    authoredFrames = stable(doc.blocks);
    authoredPages = stable(doc.pages);
    authoredStyles = stable(doc.publishing.paragraphStyles);
  }
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
      textComposition: {
        compose: async (request) => {
          const result = await compose(request);
          calls.push({ request, result });
          return result;
        },
      },
      assets: () => [],
      fonts: () => [],
      initialState: { tool: 'select', selection: [frameId] },
      sessionId: 'native-word-spacing-' + ++mountCount,
      onNotify: (message) => notices.push(message),
      onChange: () => changes++,
      onCommit: (before, metadata) => {
        if (history.record(before, doc, metadata)) commits++;
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
    assert(!failure, 'Native word-spacing editor has a composition error: ' + failure);
  }
  function painted() {
    const token = host.querySelector('svg[data-composed-text]')?.dataset.compositionToken,
      call = calls.findLast((item) => item.result.token === token);
    assert(token && call, 'Word spacing has no matching frozen native ink result.');
    return call;
  }
  function geometry() {
    const { request, result } = painted();
    return stable({
      placements: request.placements,
      lines: result.layout.lines,
      vectors: result.vectors,
    });
  }
  function modelSnapshot() {
    return {
      content: documentContent(doc),
      html: source(),
      history: history.size,
      commits,
      changes,
      calls: calls.length,
      canvasVersion: doc.canvasVersion,
    };
  }
  function assertNoWrite(before, label, { noCalls = true } = {}) {
    const after = modelSnapshot();
    if (!noCalls) {
      delete before.calls;
      delete after.calls;
    }
    assert(stable(before) === stable(after), label + ' changed source/model/history/native calls.');
  }
  function selectedRange() {
    const bookmark = editor.captureView().textSelection;
    return bookmark ? { anchor: bookmark.anchor.index, focus: bookmark.focus.index } : null;
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
          affinity: start === end ? 'forward' : 'backward',
        },
      }),
      'Word-spacing source selection could not be restored.',
    );
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
  }
  async function selectWord(word, { collapsed = false } = {}) {
    await editor.command('document-text');
    await settle();
    const segment = textIndexMap(input()).segments.find((part) => part.node.data.includes(word));
    assert(segment, 'Canonical word-spacing input lacks ' + word);
    const start = segment.start + segment.node.data.indexOf(word);
    await selectIndices(start, collapsed ? start : start + word.length);
    return { start, end: start + word.length };
  }
  async function openDialog() {
    const button = host.querySelector('button[data-canvas-command="word-spacing"]');
    assert(button && !button.disabled, 'Actual Paragraph Properties lacks Word Spacing.');
    for (let owner = button.parentElement; owner && owner !== host; owner = owner.parentElement)
      if (owner.tagName === 'DETAILS') owner.open = true;
    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 96, isPrimary: true, button: 0 }),
    );
    button.click();
    await tick();
    const dialog = modal();
    assert(dialog, 'Word Spacing command did not open its production dialog.');
    return dialog;
  }
  function values(dialog, triple) {
    for (const [index, name] of ['minimum', 'desired', 'maximum'].entries()) {
      const field = dialog.querySelector(`[data-word-spacing-field="${name}"]`);
      assert(field, 'Word Spacing dialog lacks ' + name);
      field.value = String(triple[index]);
    }
    for (const field of dialog.querySelectorAll('[data-word-spacing-field]'))
      field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function apply(triple) {
    const dialog = await openDialog();
    values(dialog, triple);
    const button = dialog.querySelector('[data-word-spacing-apply]');
    assert(button?.type === 'submit', 'Word Spacing Apply is not the actual form submit control.');
    button.click();
    await settle();
    assert(!modal(), 'Valid Word Spacing Apply left its dialog open.');
  }
  async function reset() {
    const dialog = await openDialog(),
      button = dialog.querySelector('[data-word-spacing-reset]');
    assert(button, 'Word Spacing dialog lacks Reset.');
    button.click();
    await settle();
    assert(!modal(), 'Word Spacing Reset did not finish its authored transaction.');
  }
  async function dismissBackdrop(dialog) {
    const bounds = dialog.getBoundingClientRect(),
      x = bounds.left - 8,
      y = bounds.top - 8,
      coordinates = { bubbles: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0 };
    dialog.dispatchEvent(
      new PointerEvent('pointerdown', { ...coordinates, pointerId: 97, isPrimary: true }),
    );
    dialog.dispatchEvent(new MouseEvent('click', coordinates));
    await tick();
    await settle();
    assert(
      !modal(),
      'Word Spacing dialog cannot be dismissed through its production backdrop behavior.',
    );
  }
  function verifyProtocol(expected) {
    const { request, result } = painted();
    assert(
      request.protocol === expected &&
        result.protocol === expected &&
        request.mode === 'planned-lines-proof',
      'Word Spacing used an unexpected native protocol.',
    );
    assert(
      result.layout.coveredLength === request.text.length,
      'Short word-spacing fixture became overset.',
    );
    assert(
      stable(doc.blocks) === authoredFrames && stable(doc.pages) === authoredPages,
      'Word Spacing changed authored frame/page geometry.',
    );
    assert(
      stable(doc.publishing.paragraphStyles) === authoredStyles,
      'A paragraph-local Word Spacing edit changed named style definitions.',
    );
    assert(
      host.querySelector('svg[data-composed-text] use') &&
        !host.querySelector('[data-flow-frame] [data-flow-text]'),
      'Word spacing lost native vectors or added duplicate browser text ink.',
    );
    return painted();
  }
  function lineForParagraph(index) {
    const { request, result } = painted(),
      paragraph = request.paragraphs[index],
      line = result.layout.lines.find(
        (line) => line.start <= paragraph.start && line.end > paragraph.start,
      );
    assert(line, 'No native row for selected paragraph.');
    return { request, result, paragraph, line };
  }
  function gapAdvances(index) {
    const { request, paragraph, line } = lineForParagraph(index),
      gaps = [];
    for (let cursor = paragraph.start; cursor < paragraph.end; cursor++)
      if (request.text[cursor] === ' ') {
        const left = line.carets.find((caret) => caret.index === cursor),
          right = line.carets.find((caret) => caret.index === cursor + 1);
        assert(left && right, 'Native word-space source caret is missing.');
        gaps.push(right.primary - left.primary);
      }
    return gaps;
  }
  function shapeInvariants(before, after) {
    assert(
      before.request.text === after.request.text,
      'Word Spacing changed source characters, leading/trailing spaces or paragraph marks.',
    );
    assert(
      before.result.layout.lines.length === after.result.layout.lines.length,
      'Word spacing wrapped a deliberately generous short paragraph.',
    );
    for (const [index, line] of after.result.layout.lines.entries()) {
      const previous = before.result.layout.lines[index];
      for (const field of ['start', 'end', 'baseline', 'ascent', 'descent', 'leading', 'advance'])
        near(line[field], previous[field], 'Unchanged word-spacing strut/source ' + field);
      const original = previous.runs
          .flatMap((run) => run.glyphs)
          .filter((glyph) => before.request.text.slice(glyph.index, glyph.end).trim()),
        current = line.runs
          .flatMap((run) => run.glyphs)
          .filter((glyph) => after.request.text.slice(glyph.index, glyph.end).trim());
      assert(original.length === current.length, 'Word spacing changed visible glyph count.');
      for (const [j, glyph] of current.entries()) {
        assert(
          glyph.glyph === original[j].glyph && glyph.vector === original[j].vector,
          'Word spacing substituted a visible glyph/vector.',
        );
        near(
          glyph.advance[0],
          original[j].advance[0],
          'Word spacing changed non-space glyph advance',
        );
        near(
          glyph.position[1],
          original[j].position[1],
          'Word spacing changed glyph baseline shift',
        );
      }
      // Space attributes split native runs; compare their source ownership,
      // rather than requiring incidental shaping-run segmentation to be fixed.
      for (let source = line.start; source < line.contentEnd; source++) {
        const oldRun = previous.runs.find((run) => run.start <= source && run.end > source),
          newRun = line.runs.find((run) => run.start <= source && run.end > source);
        assert(oldRun && newRun, 'Word spacing lost a source font run.');
        for (const field of ['font', 'size', 'leading'])
          assert(newRun[field] === oldRun[field], 'Word spacing changed source run ' + field);
        // Protocol3 has line struts; protocol5 additionally exposes run struts.
        for (const field of ['ascent', 'descent'])
          if (oldRun[field] !== undefined)
            near(newRun[field], oldRun[field], 'Unchanged run strut ' + field);
      }
    }
  }
  async function rejectedFixture(name, html) {
    ownFixture(name, html);
    mount();
    await settle();
    verifyProtocol(3);
    await selectWord('Rejected');
    const before = modelSnapshot(),
      dialog = await openDialog();
    values(dialog, [80, 200, 300]);
    dialog.querySelector('[data-word-spacing-apply]').click();
    await settle();
    assertNoWrite(before, name);
    assert(
      notices.length || dialog.querySelector('[role="alert"]')?.textContent.trim(),
      name + ' rollback lacks an explanation.',
    );
    if (modal()) await dismissBackdrop(modal());
    notices.length = 0;
  }
  async function namedStyleDialog() {
    await editor.command('edit-paragraph-style');
    const dialog = document.querySelector('dialog.publishing-style-dialog[open]');
    assert(dialog, 'Named paragraph style dialog did not open.');
    const mode = dialog.querySelector('[data-style-word-spacing-mode]');
    mode.value = 'custom';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    for (const [index, key] of ['minimum', 'desired', 'maximum'].entries())
      dialog.querySelector(`[name="wordSpacing-${key}"]`).value = String([80, 200, 300][index]);
    return dialog;
  }
  async function verifyNamedStyles() {
    ownFixture('Native paragraph spacing style', '<p>Named native text</p>');
    doc.textFlows[0].style.paragraphStyle = 'word-other-style';
    resetOwner();
    mount();
    await settle();
    const before = documentContent(doc),
      beforeCommits = commits,
      dialog = await namedStyleDialog();
    dialog.querySelector('button[type="submit"]').click();
    await settle();
    assert(!dialog.open && commits === beforeCommits + 1, 'Named spacing style was not one edit.');
    assert(
      doc.publishing.paragraphStyles.find((style) => style.id === 'word-other-style').attributes
        .wordSpacing === '80:200:300',
      'Named spacing policy was converted to a scalar or lost.',
    );
    assert(
      painted().request.protocol === 5 &&
        painted().request.paragraphs[0].wordSpacing.desired === 200,
      'Named spacing policy did not reach native composition.',
    );
    await editor.command('undo');
    await settle();
    assert(
      documentContent(doc) === before,
      'Named spacing style undo did not restore the document.',
    );
    editor.destroy();
    insertObject(doc, 'text', doc.pages[0].id, {
      x: 48,
      y: 430,
      w: 490,
      h: 40,
      textStyle: 'cmu-serif',
      paragraphStyle: 'word-other-style',
      html: '<p>Legacy use of shared paragraph style.</p>',
    });
    resetOwner();
    mount();
    await settle();
    const unchanged = documentContent(doc),
      size = history.size,
      rejected = await namedStyleDialog();
    rejected.querySelector('button[type="submit"]').click();
    await settle();
    assert(
      rejected.open && rejected.querySelector('[role="alert"]').textContent.trim(),
      'Shared legacy style spacing was silently ignored.',
    );
    assert(
      documentContent(doc) === unchanged && history.size === size,
      'Rejected shared spacing style modified source/history.',
    );
    rejected.close();
    await tick();
  }
  async function verifyRichPaste() {
    const paste = () => {
      const data = new DataTransfer();
      data.setData('text/html', '<p data-ivo-wordspace="80:150:200">Pasted paragraph</p>');
      data.setData('text/plain', 'Pasted paragraph');
      input().dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      );
    };
    ownFixture('Word spacing rich paste', '<p>Receiving text</p>');
    mount();
    await settle();
    await selectWord('Receiving');
    await selectIndices(0, textIndexMap(input()).boundaries.get(input()).at(-1));
    const before = documentContent(doc),
      beforeHistory = history.size;
    paste();
    await settle();
    assert(
      painted().request.protocol === 5 && source().includes('data-ivo-wordspace="80:150:200"'),
      'Rich paste lost paragraph spacing: ' +
        JSON.stringify({ protocol: painted().request.protocol, html: source(), notices }),
    );
    assert(
      doc.canvasVersion === 9 && archiveVersion([doc]) === 10 && history.size === beforeHistory + 1,
      'Rich paste did not promote capability in the same text transaction.',
    );
    validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
    await editor.command('undo');
    await settle();
    assert(
      documentContent(doc) === before && painted().request.protocol === 3,
      'Rich spacing paste undo did not restore old source/capability.',
    );
    ownFixture('Legacy word spacing paste rollback', '<p>Receiving text</p>');
    delete doc.textFlows[0].composition;
    resetOwner();
    mount();
    await settle();
    await selectWord('Receiving');
    await selectIndices(0, textIndexMap(input()).boundaries.get(input()).at(-1));
    const legacyBefore = documentContent(doc),
      legacyHistory = history.size;
    paste();
    await settle();
    assert(
      documentContent(doc) === legacyBefore && history.size === legacyHistory && notices.length,
      'Unsupported legacy rich spacing paste was ignored or partially applied.',
    );
  }
  try {
    ownFixture(
      'Native paragraph word spacing',
      '<p>  Selected words  </p><p data-ivo-pstyle="word-italic-style">Neighbor italic words.</p><p data-ivo-pstyle="word-other-style">Other styled paragraph.</p>',
    );
    mount();
    await settle();
    const initial = verifyProtocol(3),
      originalHTML = source(),
      originalWords = initial.request.text,
      initialGeometry = geometry(),
      baseGaps = gapAdvances(0),
      neighborGaps = gapAdvances(1),
      originalParagraphs = paragraphs().map((p) => p.outerHTML);
    assert(
      commits === 0 &&
        changes === 0 &&
        history.size === 0 &&
        doc.canvasVersion !== 9 &&
        archiveVersion([doc]) < 10,
      'Default word-spacing read migrated the document or authored history.',
    );
    assert(
      baseGaps.length === 5,
      'Leading, internal and trailing source spaces were not all retained.',
    );
    await selectWord('Selected', { collapsed: true });
    const beforeCancel = modelSnapshot(),
      rangeBeforeCancel = selectedRange(),
      cancelDialog = await openDialog();
    values(cancelDialog, [80, 180, 300]);
    await tick();
    await capture('native-word-spacing-dialog');
    await dismissBackdrop(cancelDialog);
    assertNoWrite(beforeCancel, 'Backdrop cancel');
    assert(
      stable(selectedRange()) === stable(rangeBeforeCancel),
      'Word-spacing cancel lost the source range.',
    );
    const beforeInvalid = modelSnapshot(),
      invalidDialog = await openDialog();
    values(invalidDialog, [300, 100, 200]);
    invalidDialog.querySelector('[data-word-spacing-apply]').click();
    await settle();
    assert(modal() === invalidDialog, 'Crossed word-spacing triple did not keep its dialog open.');
    assertNoWrite(beforeInvalid, 'Crossed word-spacing triple');
    assert(
      invalidDialog.querySelector('[role="alert"]')?.textContent.trim(),
      'Crossed triple lacks an inline explanation.',
    );
    await dismissBackdrop(invalidDialog);
    notices.length = 0;
    const beforeApplyCommits = commits;
    await apply([80, 200, 300]);
    const applied = verifyProtocol(5);
    assert(
      commits === beforeApplyCommits + 1 && history.size === 1,
      'Atomic triple Apply was not exactly one authored undo transaction.',
    );
    assert(
      mark(0) === '80:200:300' && !mark(1) && !mark(2),
      'Word spacing did not target only the selected containing paragraph.',
    );
    assert(
      stable(applied.request.paragraphs[0].wordSpacing) === stable(policy('80:200:300')) &&
        !applied.request.paragraphs[1].wordSpacing &&
        !applied.request.paragraphs[2].wordSpacing,
      'Paragraph word-spacing transport leaked to neighboring styles.',
    );
    near(
      applied.result.layout.lines[0].wordSpacing.percentage,
      200,
      'Native row actual desired percentage',
    );
    shapeInvariants(initial, applied);
    for (const [index, gap] of gapAdvances(0).entries())
      near(
        gap,
        baseGaps[index] * 2,
        'Desired200 must affect every leading/internal/trailing ordinary space',
      );
    assert(
      paragraphs()[1].outerHTML === originalParagraphs[1] &&
        paragraphs()[2].outerHTML === originalParagraphs[2],
      'Word Spacing changed unselected named paragraphs.',
    );
    const appliedHTML = source(),
      appliedGeometry = geometry();
    await editor.command('undo');
    await settle();
    verifyProtocol(3);
    assert(
      source() === originalHTML && geometry() === initialGeometry,
      'Word-spacing Apply undo did not restore exact source/geometry.',
    );
    await editor.command('redo');
    await settle();
    verifyProtocol(5);
    assert(
      source() === appliedHTML && geometry() === appliedGeometry,
      'Word-spacing Apply redo did not restore exact source/geometry.',
    );
    const firstSelection = await selectWord('Selected'),
      neighborSelection = await selectWord('Neighbor');
    await selectIndices(firstSelection.start, neighborSelection.end);
    const beforeMixedHTML = source(),
      beforeMixedGeometry = geometry(),
      beforeMixedCommits = commits;
    await apply([80, 175, 250]);
    verifyProtocol(5);
    assert(
      commits === beforeMixedCommits + 1 &&
        mark(0) === '80:175:250' &&
        mark(1) === '80:175:250' &&
        !mark(2),
      'A mixed-style paragraph range was not one isolated atomic Word Spacing edit.',
    );
    assert(
      paragraphs()[2].outerHTML === originalParagraphs[2],
      'Mixed-range word spacing reached an unselected paragraph.',
    );
    await editor.command('undo');
    await settle();
    assert(
      source() === beforeMixedHTML && geometry() === beforeMixedGeometry,
      'Mixed paragraph Word Spacing undo lost exact source or geometry.',
    );
    await selectWord('Neighbor', { collapsed: true });
    const beforeNeighbor = commits;
    await apply([80, 150, 200]);
    verifyProtocol(5);
    assert(
      commits === beforeNeighbor + 1 &&
        mark(0) === '80:200:300' &&
        mark(1) === '80:150:200' &&
        !mark(2),
      'A different named paragraph did not retain its isolated override.',
    );
    for (const [index, gap] of gapAdvances(1).entries())
      near(gap, neighborGaps[index] * 1.5, 'Neighbor desired150 gap');
    await selectWord('Neighbor', { collapsed: true });
    await reset();
    verifyProtocol(5);
    assert(
      mark(1) === 'normal' && mark(0) === '80:200:300',
      'Neighbor Reset flattened another paragraph or failed to retain an explicit normal reset.',
    );
    await selectWord('Selected');
    const beforeTypingHTML = source(),
      beforeTypingGeometry = geometry(),
      beforeTypingCommits = commits;
    await insert('Edited');
    await settle();
    verifyProtocol(5);
    assert(
      mark(0) === '80:200:300' && commits === beforeTypingCommits + 1,
      'Trusted typing lost paragraph word spacing or authored transaction ownership.',
    );
    assert(
      painted().request.text === originalWords.replace('Selected', 'Edited'),
      'Typing changed unrelated source spaces or neighboring words.',
    );
    const editedHTML = source(),
      editedGeometry = geometry();
    await editor.command('undo');
    await settle();
    assert(
      source() === beforeTypingHTML && geometry() === beforeTypingGeometry,
      'Word-spacing typing undo lost source or native geometry.',
    );
    await editor.command('redo');
    await settle();
    assert(
      source() === editedHTML && geometry() === editedGeometry,
      'Word-spacing typing redo lost source or native geometry.',
    );
    const split = await selectWord('Edited', { collapsed: true });
    await selectIndices(split.start + 3);
    const beforeEnter = commits;
    await key('Enter');
    await settle();
    const splitPlan = painted();
    assert(
      commits === beforeEnter + 1 && splitPlan.request.paragraphs.length === 4,
      'Enter did not create one authored paragraph edit: ' +
        JSON.stringify({
          commits,
          beforeEnter,
          paragraphs: splitPlan.request.paragraphs.length,
          html: source(),
        }),
    );
    assert(
      splitPlan.request.paragraphs
        .slice(0, 2)
        .every((paragraph) => paragraph.wordSpacing?.desired === 200),
      'New paragraph lost its inherited word-spacing policy.',
    );
    assert(
      !splitPlan.request.paragraphs[2].wordSpacing && !splitPlan.request.paragraphs[3].wordSpacing,
      'Enter changed neighboring paragraph policies.',
    );
    await editor.command('undo');
    await settle();
    assert(
      source() === editedHTML && geometry() === editedGeometry,
      'Paragraph split undo lost source or geometry.',
    );
    assert(
      archiveVersion([doc]) === 10 && doc.canvasVersion === 9,
      'Authored word spacing did not gate archive10/canvas9.',
    );
    await capture();
    await save({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
    editor.destroy();
    doc = validateImport(await load()).documents[0];
    resetOwner();
    mount();
    await settle();
    verifyProtocol(5);
    assert(
      source() === editedHTML && geometry() === editedGeometry && commits === 0 && changes === 0,
      'Cold archive10 reopened with different source/geometry/history.',
    );
    await selectWord('Edited', { collapsed: true });
    await reset();
    verifyProtocol(3);
    assert(
      mark(0) === 'normal' && doc.canvasVersion === 9 && archiveVersion([doc]) === 10,
      'Reset did not restore protocol3 while retaining authored format capability.',
    );
    ownFixture(
      'Native character defaults remain protocol4',
      '<p data-ivo-hscale="120">Advanced words retain scaling.</p>',
    );
    mount();
    await settle();
    const advanced = verifyProtocol(4);
    await selectWord('Advanced', { collapsed: true });
    await apply([80, 200, 300]);
    const wordAdvanced = verifyProtocol(5);
    shapeInvariants(advanced, wordAdvanced);
    assert(
      wordAdvanced.request.runs.every((run) => run.horizontalScale === 120),
      'Word spacing lost existing protocol4 character scaling.',
    );
    await selectWord('Advanced', { collapsed: true });
    await reset();
    verifyProtocol(4);
    await rejectedFixture('Unsupported NBSP word spacing', '<p>Rejected\u00a0neighbor</p>');
    await rejectedFixture('Unsupported tab word spacing', '<p>Rejected\tneighbor</p>');
    await rejectedFixture(
      'Unsupported negative tracking word spacing',
      '<p data-ivo-tracking="-20">Rejected gap words</p>',
    );
    await verifyNamedStyles();
    await verifyRichPaste();
    return {
      nativeWordSpacingProperties: true,
      nativeWordSpacingParagraphIsolation: true,
      nativeWordSpacingDesiredGapsAndStruts: true,
      nativeWordSpacingAtomicDialogHistory: true,
      nativeWordSpacingCancelAndInvalidNoop: true,
      nativeWordSpacingTypingArchive10: true,
      nativeWordSpacingParagraphEntry: true,
      nativeWordSpacingConditionalProtocols: true,
      nativeWordSpacingUnsupportedRollback: true,
      nativeWordSpacingNamedStylesAndLegacyRollback: true,
      nativeWordSpacingRichPasteAndCapability: true,
    };
  } finally {
    modal()?.close();
    editor?.destroy();
  }
}
