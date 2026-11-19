import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { promoteTextLayout } from '../../../src/domain/documents/derived-text-layout.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function sourceLines(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const br of root.querySelectorAll('br')) {
    if (br.parentElement.matches('p,div') && br.parentElement.childNodes.length === 1) br.remove();
    else br.replaceWith('\n');
  }
  return [...root.children]
    .map((node) => node.textContent)
    .join('\n')
    .replaceAll('\u00a0', ' ');
}

// Click the actual first glyph on page two. A visual line or page edge must
// never isolate preceding authored text from the editor's ordinary delete.
export async function verifyThreadedDeletion(host, bridge, composer = 'browser', native) {
  const cases = [
    ['automatic page', '<p><em>First</em> line.</p><p>Second line.</p>', 250, 25],
    ['paragraph', '<p><em>First</em> line.</p><p>Second line.</p><p>Third line.</p>', 250, 25],
    ['soft return', '<p><em>First</em> line.<br>Second line.</p><p>Third line.</p>', 250, 25],
    [
      'blank paragraphs',
      '<p><em>First</em> line.</p><p><br></p><p><br></p><p>Second line.</p><p>Third line.</p>',
      250,
      65,
    ],
    [
      'wrapped line',
      '<p>Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima.</p>',
      105,
      25,
    ],
  ];
  for (const [kind, html, w, h] of cases) {
    let doc = createSceneDocument('Threaded deletion', { width: 400, height: 240 });
    const a = insertObject(doc, 'text', doc.pages[0].id, {
        x: 20,
        y: 20,
        w,
        h,
        fontSize: 16,
        leading: 20,
        paragraphAfter: 0,
        textStyle: 'cmu-serif',
        html,
      }),
      automatic = kind === 'automatic page',
      flow = startTextFlow(doc, a.id, { automaticPages: automatic });
    if (!automatic) {
      const page = addPage(doc, doc.pages[0].id),
        next = insertObject(doc, 'text', page.id, { x: 20, y: 20, w: 275, h: 150 });
      threadFrame(doc, a.id, next.id);
    }
    if (native) enableNativeComposition(doc, flow, composer);
    const original = flow.html,
      history = createDocumentHistory();
    const assert = (ok, message) => {
      if (!ok) throw Error(composer + ' ' + kind + ': ' + message);
    };
    function restore(action) {
      const record = history[action](doc);
      if (record) {
        doc = record.document;
        editor.restoreView(record.view);
      }
    }
    const editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing: true,
      source: (s) => s,
      textComposition: native,
      initialState: { tool: 'text', selection: [a.id] },
      sessionId: 'boundary-' + composer + kind,
      onChange: () => {},
      onCommit: (before, meta) => {
        promoteTextLayout(before, doc);
        history.record(before, doc, meta);
      },
      onUndo: () => restore('undo'),
      onRedo: () => restore('redo'),
      onNotify: (message) => {
        throw Error(message);
      },
    });
    async function settle() {
      await tick();
      await editor.flush();
      await tick();
    }
    try {
      await settle();
      await editor.command('fit-all');
      await settle();
      const nextId = doc.textFlows[0].frameIds[1],
        frame = host.querySelector('[data-flow-frame="' + nextId + '"]');
      assert(frame, 'Continuation frame was not painted');
      const first = frame.querySelector(native ? 'use[data-glyph-offset]' : '[data-flow-text]');
      assert(first, 'No continuation glyph on page two');
      let bounds, visible;
      if (native) {
        bounds = first.getBoundingClientRect();
        visible = frame.querySelector('svg').getAttribute('aria-label');
      } else {
        const range = document.createRange();
        range.setStart(first.firstChild, 0);
        range.setEnd(first.firstChild, 1);
        bounds = range.getBoundingClientRect();
        visible = first.textContent;
      }
      const before = sourceLines(original);
      const suffix = kind !== 'wrapped line' ? 'Second' : visible.trimStart().split(/\s/)[0],
        at = before.indexOf(suffix);
      assert(
        at > 0 && visible.startsWith(suffix),
        'Unexpected frame break ' + JSON.stringify(visible),
      );
      await bridge.select({ from: [bounds.left + 0.5, bounds.top + bounds.height / 2] });
      await settle();
      const sel = getSelection();
      assert(
        editor.getState().activeTextId === nextId &&
          sel.isCollapsed &&
          sel.focusNode?.textContent.slice(sel.focusOffset).startsWith(suffix),
        'Click did not reach the first character: ' +
          JSON.stringify([sel.focusOffset, sel.focusNode?.textContent]),
      );
      for (let i = 1; i <= 3; i++) {
        await bridge.key('Backspace');
        await settle();
        const expected = before.slice(0, at - i) + before.slice(at),
          actual = sourceLines(doc.textFlows[0].html);
        assert(
          actual === expected,
          'Backspace ' +
            i +
            ' expected ' +
            JSON.stringify(expected) +
            ' but got ' +
            JSON.stringify(actual),
        );
        if (i === 1) {
          if (kind === 'paragraph' || kind === 'soft return' || automatic) {
            const upstream = host.querySelector('[data-flow-frame="' + a.id + '"]');
            const ink = native
              ? upstream.querySelector('svg').getAttribute('aria-label')
              : upstream.textContent;
            assert(
              ink.includes('Second') && editor.getState().activeTextId === a.id,
              'Ink and caret must move together into the preceding frame',
            );
          }
          const firstEdit = doc.textFlows[0].html;
          await editor.command('undo');
          await settle();
          assert(doc.textFlows[0].html === original, 'Undo did not restore the exact source');
          await editor.command('redo');
          await settle();
          assert(doc.textFlows[0].html === firstEdit, 'Redo did not restore the edited source');
        }
      }
      const edited = doc.textFlows[0].html;
      assert(
        doc.textFlows[0].frameIds.join() === (automatic ? [a.id] : [a.id, nextId]).join() &&
          doc.pages.length === (automatic ? 1 : 2),
        'Authored frames were unthreaded',
      );
      assert(
        edited.includes('<em>First</em>') || kind === 'wrapped line',
        'Untouched emphasis changed',
      );
    } finally {
      editor.destroy();
      host.replaceChildren();
    }
  }
}
