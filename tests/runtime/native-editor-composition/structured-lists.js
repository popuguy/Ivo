import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { nativeCaretRect } from '../../../src/features/editor/text/native-composition-geometry.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { textIndexMap } from '../../../src/shared/dom/text-selection.js';

export async function verifyStructuredLists(host, bridge, compose) {
  const assert = (test, message) => {
    if (!test) throw Error(message);
  };
  const tick = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const original = '<p>Alpha</p><p><em>Bravo</em></p><p>Charlie</p><p>Delta</p>';
  let doc = createSceneDocument('List counters'),
    editor,
    geometry;
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    x: 40,
    y: 40,
    w: 360,
    h: 400,
    html: original,
    textStyle: 'cmu-serif',
  });
  enableNativeComposition(doc, startTextFlow(doc, frame.id), 'paragraph');
  const history = createDocumentHistory(),
    notices = [];
  const html = () => doc.textFlows[0].html;
  const input = () => host.querySelector('.canvas-flow-input');
  const painted = () =>
    [...host.querySelectorAll('svg[data-composed-text]')]
      .map((svg) => svg.getAttribute('aria-label'))
      .join('');
  const archive = () => ({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
  const undo = (direction) => {
    const saved = history[direction](doc);
    if (saved) {
      doc = saved.document;
      editor.restoreView(saved.view);
    }
  };
  const settle = async () => {
    await tick();
    await editor.flush();
    await tick();
    assert(
      !notices.length && !host.querySelector('[data-composition-error]'),
      'Native list edit failed: ' +
        (notices.join(' / ') ||
          host.querySelector('[data-composition-error]')?.dataset.compositionError),
    );
  };
  const select = async (start, end = start) => {
    const root = input();
    const segments = textIndexMap(root).segments;
    const a = segments.find((s) => s.node.data.includes(start))?.node;
    const b = segments.find((s) => s.node.data.includes(end))?.node;
    assert(a && b, 'Missing list text: ' + html());
    root.focus({ preventScroll: true });
    getSelection().setBaseAndExtent(a, 0, b, start === end ? 0 : b.length);
    await tick();
  };
  const action = async (name) => {
    await editor.command(name);
    await settle();
  };
  const mount = () => {
    editor = mountCanvasEditor(host, {
      editing: true,
      getDocument: () => doc,
      documents: [doc],
      source: (s) => s,
      fonts: () => [],
      assets: () => [],
      initialState: { tool: 'text', selection: [frame.id] },
      sessionId: 'structured-lists',
      textComposition: {
        compose: async (req) => {
          const result = await compose(req);
          if (req.mode === 'planned-lines-proof') geometry = { req, result };
          return result;
        },
      },
      onChange: () => {},
      onNotify: (s) => notices.push(s),
      onCommit: (before, meta) => history.record(before, doc, meta),
      onUndo: () => undo('undo'),
      onRedo: () => undo('redo'),
    });
  };
  try {
    mount();
    await action('document-text');
    await select('Alpha', 'Delta');
    await action('apply-numbering');
    assert(
      geometry?.req.protocol === 8 &&
        geometry.req.text === '1.\tAlpha\u20292.\tBravo\u20293.\tCharlie\u20294.\tDelta\u2029',
      'Default generated numbers did not compose: ' + geometry?.req.text,
    );
    await select('Bravo');
    await action('increase-list-level');
    assert(
      html().includes('<li>Alpha<ol><li><em>Bravo</em></li></ol></li>') &&
        geometry.req.text.includes('1.\tBravo\u20292.\tCharlie'),
      'Nested levels lost source order or formatting: ' + html(),
    );
    const bravoMarker = geometry.req.spans.filter((s) => s.kind === 'list-marker')[1];
    const faceAt = (at) => geometry.req.runs.find((run) => run.start <= at && run.end > at)?.font;
    assert(
      faceAt(bravoMarker.start) === faceAt(bravoMarker.end) &&
        faceAt(0) !== faceAt(bravoMarker.start),
      'Generated label lost the initial italic character face',
    );
    const nested = html();
    await action('decrease-list-level');
    assert(!html().includes('Alpha<ol>'), 'List did not outdent');
    await action('undo');
    assert(html() === nested, 'Undo lost list structure');
    await select('Charlie');
    await action('restart-numbering');
    assert(
      geometry.req.text.includes('1.\tCharlie\u20292.\tDelta') && html().includes('value="1"'),
      'Restart failed',
    );
    const saved = html();
    assert(
      archive().schemaVersion === 20 && doc.canvasVersion === 19,
      'List capability floor lost',
    );
    let denied = false;
    try {
      validateImport({ ...archive(), schemaVersion: 19 });
    } catch {
      denied = true;
    }
    assert(denied, 'Stale readers accepted authored counters');
    await action('continue-numbering');
    assert(
      painted().includes('2.\tCharlie\u20293.\tDelta') && !html().includes('value='),
      'Continue failed: ' + html() + ' / ' + painted(),
    );
    await action('undo');
    assert(html() === saved, 'Undo lost restart');
    await bridge.save(archive());
    editor.destroy();
    editor = null;
    host.replaceChildren();
    doc = validateImport(await bridge.load()).documents[0];
    assert(
      html() === saved && cleanHTML(saved) === saved,
      'Numbered source failed actual save/reopen',
    );
    mount();
    await action('document-text');
    await select('Bravo');
    await bridge.insert('A');
    await settle();
    assert(
      html().includes('<em>ABravo</em>') && !html().includes('1.'),
      'Generated prefix became editable or italic run lost: ' + html(),
    );
    const marker = geometry.req.spans.find((s) => s.kind === 'list-marker');
    const lines = geometry.result.layout.lines;
    assert(lines.length, 'Missing native lines for list caret');
    const caret = nativeCaretRect(
      { native: { lines, spans: geometry.req.spans } },
      { index: marker.logicalStart, affinity: 'forward' },
    );
    const row = lines[0].carets.find((c) => c.index === marker.end);
    assert(
      caret && row && Math.abs(caret.x - row.primary) < 0.01,
      'Caret drawn inside generated label',
    );
    await select('Delta');
    await action('convert-list-to-text');
    assert(
      html().includes('<p>2.\tDelta</p>'),
      'Explicit conversion lost printed label: ' + html(),
    );
    await select('Charlie');
    await action('remove-list');
    await select('Delta');
    await action('apply-numbering');
    assert(
      painted().includes('Charlie\u20292.\t2.\tDelta'),
      'Default list did not resume past an ordinary paragraph: ' + painted(),
    );
    // Delete the earlier numbered item: later generated ordinals recalculate without editing their text.
    await select('Alpha');
    await action('remove-list');
    assert(
      painted().includes('Charlie\u20291.\t2.\tDelta'),
      'Later separated numbering became a frozen numeral: ' + painted(),
    );
    return true;
  } finally {
    editor?.destroy();
    host.replaceChildren();
  }
}
