import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enablePublishing, saveTextStyle } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../../src/domain/history/document-history.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../../src/shared/dom/text-selection.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
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
const equal = (a, b, message) => assert(stable(a) === stable(b), message);

/** Actual canvas/Properties/input regression, using only a disposable CMU flow. */
export async function verifyNativeParagraphEditing({
  host,
  compose,
  insert,
  capture = async () => {},
}) {
  let doc = createSceneDocument('Native paragraph controls', { width: 500, height: 600 }),
    editor,
    mountCount = 0,
    commits = 0,
    history = createDocumentHistory();
  const calls = [],
    notices = [];
  enablePublishing(doc);
  const named = saveTextStyle(doc, 'paragraph', {
      name: 'Fixture paragraph',
      attributes: {
        align: 'left',
        leftIndent: 18,
        rightIndent: 8,
        firstLineIndent: 6,
        paragraphBefore: 0,
        paragraphAfter: 3,
      },
    }),
    originalDefinition = JSON.stringify(named),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 45,
      y: 50,
      w: 340,
      h: 420,
      rotation: 8,
      textScale: { x: 1.05, y: 0.95 },
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 20,
      paragraphStyle: named.id,
      html:
        '<p>First paragraph has carefully positioned words and exact native glyphs.</p>' +
        '<p>Second paragraph retains its own spacing, indentation and paragraph alignment.</p>' +
        '<p>Third paragraph remains unchanged while its neighbor is edited.</p>',
    }),
    flow = startTextFlow(doc, frame.id, { automaticPages: false });
  enableNativeComposition(doc, flow, 'paragraph');
  const currentFlow = () => doc.textFlows[0],
    input = () => host.querySelector('.canvas-flow-input'),
    sourceRoot = () => {
      const root = document.createElement('div');
      root.innerHTML = currentFlow().html;
      return root;
    };
  function step(direction) {
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
      editing: true,
      source: (value) => value,
      textComposition: {
        compose: async (request) => {
          const result = await compose(request);
          calls.push({ request, result });
          return result;
        },
      },
      assets: () => [],
      fonts: () => [],
      sessionId: 'paragraph-controls-' + ++mountCount,
      initialState: { tool: 'select', selection: [frame.id] },
      onNotify: (message) => notices.push(message),
      onChange: () => {},
      onCommit: (before, meta) => {
        if (history.record(before, doc, meta)) commits++;
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
    assert(!error, 'Paragraph-control composition failed: ' + error);
  }
  function painted() {
    const token = host.querySelector('[data-composed-text]')?.dataset.compositionToken,
      result = calls.findLast((call) => call.result.token === token);
    assert(result, 'Paragraph controls painted geometry with no matching native request');
    return result;
  }
  async function property(key, value) {
    const control = host.querySelector(`[data-object-prop="${key}"]`);
    assert(control, 'Missing actual Properties paragraph control: ' + key);
    for (let owner = control.parentElement; owner && owner !== host; owner = owner.parentElement)
      if (owner.tagName === 'DETAILS') owner.open = true;
    control.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 19, button: 0 }),
    );
    control.focus();
    control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  function wordRange(word) {
    const segment = textIndexMap(input()).segments.find((part) => part.node.data.includes(word));
    assert(segment, 'Canonical paragraph source lost word: ' + word);
    const start = segment.start + segment.node.data.indexOf(word);
    return { start, end: start + word.length };
  }
  async function selectWord(word, collapsed = false) {
    await editor.command('document-text');
    await settle();
    const { start, end } = wordRange(word);
    input().focus();
    restoreTextSelection(input(), {
      anchor: { path: [], offset: 0, kind: 'text', index: start, affinity: 'forward' },
      focus: {
        path: [],
        offset: 0,
        kind: 'text',
        index: collapsed ? start : end,
        affinity: 'forward',
      },
    });
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    return { start, end };
  }
  function verifyOneInk() {
    const visible = host.querySelector('[data-flow-frame]');
    assert(
      visible?.querySelector('[data-composed-text] use'),
      'Native paragraph glyphs are absent',
    );
    assert(
      !visible.querySelector('[data-flow-text]'),
      'Paragraph preview duplicated browser glyphs',
    );
    assert(
      getComputedStyle(input()).opacity === '0',
      'Canonical input paints duplicate paragraph text',
    );
  }
  async function verifyCaretQuery(word) {
    await selectWord(word, true);
    const selection = captureTextSelection(input());
    assert(selection?.anchor.index === selection?.focus.index, 'Paragraph caret did not collapse');
    const marker = host.querySelector('[data-native-selection="caret"]');
    assert(marker, 'Transformed paragraph caret was not painted');
    const paintedRect = marker.getBoundingClientRect(),
      range = window.getSelection().getRangeAt(0).cloneRange(),
      query = [...range.getClientRects()].find((rect) => rect.height > 0);
    assert(query, 'Retained input has no native caret query rectangle');
    assert(
      Math.abs(query.left - paintedRect.left) < 2 &&
        Math.abs(query.bottom - paintedRect.bottom) < 2,
      'Paragraph indentation/alignment disagrees with the transformed native caret query: ' +
        JSON.stringify({ query: query.toJSON(), painted: paintedRect.toJSON() }),
    );
  }
  try {
    mount();
    await settle();
    const originalWords = sourceRoot().textContent;
    await property('align', 'center');
    await property('leftIndent', 24);
    assert(
      commits === 2 && history.size === 2,
      'Whole-frame paragraph changes were not authored once',
    );
    assert(
      sourceRoot().textContent === originalWords,
      'Whole-frame paragraph formatting changed words',
    );
    let projection = painted().request.paragraphs;
    assert(
      projection.length === 3 &&
        projection.every((p) => p.align === 'center' && p.leftIndent === 24),
      'Whole-frame Properties did not reach every native paragraph',
    );
    equal(
      currentFlow().style.textOverrides,
      { align: 'center', leftIndent: 24 },
      'Named style override expanded unrelated fields',
    );
    assert(
      JSON.stringify(doc.publishing.paragraphStyles[0]) === originalDefinition,
      'Direct formatting rewrote its named paragraph style',
    );

    await selectWord('Second');
    await property('align', 'right');
    await selectWord('Second');
    await property('paragraphBefore', 12);
    await selectWord('Second');
    await property('paragraphAfter', 9);
    await selectWord('Second');
    await property('firstLineIndent', -8);
    projection = painted().request.paragraphs;
    assert(
      projection[0].align === 'center' &&
        projection[1].align === 'right' &&
        projection[2].align === 'center' &&
        projection[0].paragraphBefore === 0 &&
        projection[1].paragraphBefore === 12 &&
        projection[2].paragraphBefore === 0 &&
        projection[0].paragraphAfter === 3 &&
        projection[1].paragraphAfter === 9 &&
        projection[2].paragraphAfter === 3 &&
        projection[0].firstLineIndent === 6 &&
        projection[1].firstLineIndent === -8 &&
        projection[2].firstLineIndent === 6,
      'A range paragraph command changed a neighboring paragraph or lost native settings',
    );
    const paragraphs = [...sourceRoot().children];
    assert(
      paragraphs[1].dataset.ivoBefore === '12' && !paragraphs[0].hasAttribute('data-ivo-before'),
      'Range spacing did not remain on its canonical paragraph',
    );
    const beforeTyping = documentContent(doc),
      beforeTypingCommits = commits;
    await selectWord('Second');
    await insert('Revised second');
    await settle();
    assert(
      commits === beforeTypingCommits + 1,
      'Trusted paragraph typing did not make one history edit',
    );
    assert(
      currentFlow().html.includes('Revised second'),
      'Trusted typing missed the retained native source',
    );
    projection = painted().request.paragraphs;
    assert(
      projection[1].align === 'right' &&
        projection[1].firstLineIndent === -8 &&
        projection[1].paragraphBefore === 12,
      'Typing reset paragraph typography',
    );
    verifyOneInk();
    const afterTyping = documentContent(doc),
      finalSource = currentFlow().html,
      finalStyle = structuredClone(currentFlow().style);
    host.querySelector('.canvas-viewport').focus();
    await editor.command('undo');
    await settle();
    assert(documentContent(doc) === beforeTyping, 'Undo changed paragraph source or styles');
    await editor.command('redo');
    await settle();
    assert(
      documentContent(doc) === afterTyping,
      'Redo did not restore exact paragraph source and styles',
    );
    await verifyCaretQuery('Revised');
    verifyOneInk();
    const savedLayout = JSON.stringify(painted().result.layout),
      archive = validateImport({
        schemaVersion: archiveVersion([doc]),
        documents: [doc],
        assets: [],
      });
    assert(
      archive.documents[0].textFlows[0].html === finalSource,
      'Archive round trip rewrote paragraph source',
    );
    equal(
      archive.documents[0].textFlows[0].style,
      finalStyle,
      'Archive round trip changed sparse paragraph settings: ' +
        JSON.stringify({ saved: archive.documents[0].textFlows[0].style, original: finalStyle }),
    );
    editor.destroy();
    editor = null;
    host.replaceChildren();
    doc = archive.documents[0];
    history = createDocumentHistory();
    commits = 0;
    mount();
    await settle();
    assert(
      JSON.stringify(painted().result.layout) === savedLayout,
      'Cold editor reopening changed paragraph geometry',
    );
    await verifyCaretQuery('Revised');
    await editor.command('tool-select');
    await settle();
    const beforeInvalid = documentContent(doc),
      beforeCalls = calls.length,
      beforeHistory = history.size;
    await property('leftIndent', 1000);
    assert(
      documentContent(doc) === beforeInvalid && history.size === beforeHistory && commits === 0,
      'Invalid paragraph width changed source, style or authored history',
    );
    assert(calls.length === beforeCalls, 'Invalid paragraph width reached the native backend');
    assert(
      notices.length === 1 && /indent|width|area/i.test(notices[0]),
      'Invalid paragraph area was not explained',
    );
    notices.length = 0;
    await verifyCaretQuery('Revised');
    verifyOneInk();
    assert(!notices.length, 'Unexpected paragraph-control notice: ' + notices.join('; '));
    await capture();
    // An otherwise positive width can place text beyond a clipped column.
    // Reject that authoring request before source/history/backend work.
    await editor.command('tool-select');
    await settle();
    const beforeOverhang = documentContent(doc),
      callsBeforeOverhang = calls.length;
    await property('firstLineIndent', -100);
    assert(
      documentContent(doc) === beforeOverhang && calls.length === callsBeforeOverhang,
      'Out-of-column paragraph ink was accepted then hidden by the frame clip',
    );
    assert(
      notices.length === 1 && /indent|width|area/i.test(notices[0]),
      'Overhang was not explained',
    );
    notices.length = 0;
    editor.destroy();
    editor = null;
    currentFlow().html = '<p>First\u2029Second</p>';
    history = createDocumentHistory();
    commits = 0;
    mount();
    await settle();
    await selectWord('Second');
    const beforeLiteral = documentContent(doc),
      callsBeforeLiteral = calls.length;
    await property('align', 'right');
    assert(
      documentContent(doc) === beforeLiteral && commits === 0 && history.size === 0,
      'Literal-separator paragraph formatting changed a neighboring native paragraph',
    );
    assert(calls.length === callsBeforeLiteral, 'Ambiguous paragraph scope reached the backend');
    assert(
      notices.length === 1 && /Unicode separators/i.test(notices[0]),
      'Ambiguous literal paragraph formatting was not explained',
    );
    notices.length = 0;
    return {
      nativeParagraphProperties: true,
      nativeParagraphRangeScope: true,
      nativeParagraphSparseStyleOverrides: true,
      nativeParagraphTrustedTypingUndoReopen: true,
      nativeParagraphWidthRollbackBeforeBackend: true,
      nativeParagraphTransformedCaretQuery: true,
      nativeParagraphSingleInk: true,
      nativeParagraphOverhangFence: true,
      nativeLiteralParagraphScopeFence: true,
    };
  } finally {
    editor?.destroy();
    host.replaceChildren();
  }
}
