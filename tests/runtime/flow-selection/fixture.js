import { verifyFlowSelectionBoundaries } from './boundaries.js';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { prepareTextFlowFonts } from '../../../src/rendering/text/flow-layout.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../../src/shared/dom/text-selection.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.addEventListener('error', (event) =>
  console.log(
    'IVO_TEXT_CORE_RESULT:' + JSON.stringify({ error: event.error?.stack || event.message }),
  ),
);
window.addEventListener('unhandledrejection', (event) =>
  console.log(
    'IVO_TEXT_CORE_RESULT:' +
      JSON.stringify({ error: event.reason?.stack || String(event.reason) }),
  ),
);
try {
  await prepareTextFlowFonts();
  const host = document.querySelector('#host');
  host.style.width = '1360px';
  host.style.height = '1000px';
  let doc,
    history = createDocumentHistory(),
    editor,
    commits = 0;
  const reopening = new URL(location.href).searchParams.get('phase') === 'reopen';
  if (reopening) doc = validateImport(await window.textCoreTest.load()).documents[0];
  else {
    doc = createSceneDocument('Threaded selection', { width: 600, height: 420 });
    const a = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 45,
      w: 200,
      h: 125,
      html:
        '<p><em>Heading.</em></p>' +
        Array.from(
          { length: 8 },
          (_, i) =>
            `<p>Paragraph ${i + 1}. Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu.</p>`,
        ).join(''),
    });
    startTextFlow(doc, a.id, { automaticPages: false });
    const b = insertObject(doc, 'text', doc.pages[0].id, { x: 330, y: 65, w: 170, h: 130 });
    threadFrame(doc, a.id, b.id);
    const page = addPage(doc, doc.pages[0].id),
      c = insertObject(doc, 'text', page.id, { x: 90, y: 60, w: 330, h: 180 });
    threadFrame(doc, b.id, c.id);
    insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 255,
      w: 250,
      h: 70,
      html: '<p>Unrelated text must not enter the selection.</p>',
    });
  }
  const flow = doc.textFlows[0],
    a = doc.blocks.find((b) => b.id === flow.frameIds[0]),
    c = doc.blocks.find((b) => b.id === flow.frameIds[2]);
  const mount = () =>
    mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (s) => s,
      editing: true,
      initialState: { tool: 'text', selection: [a.id] },
      sessionId: 'selection-' + reopening,
      onCommit: (before, meta) => {
        commits++;
        history.record(before, doc, meta);
      },
      onChange: () => {},
      onNotify: (m) => {
        throw Error(m);
      },
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
  editor = mount();
  await tick();
  await editor.command('fit-all');
  await tick();
  const preview = (id) => host.querySelector(`[data-flow-frame="${id}"]`);
  function charPoint(id, nearEnd = false) {
    const marks = [...preview(id).querySelectorAll('[data-flow-text]')],
      node = (nearEnd ? marks.at(-1) : marks.find((m) => m.textContent.length > 8) || marks[0])
        .firstChild;
    const range = document.createRange(),
      offset = nearEnd ? Math.max(0, node.length - 8) : Math.min(3, node.length - 1);
    range.setStart(node, offset);
    range.setEnd(node, Math.min(node.length, offset + 1));
    const r = range.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function wordStyles(word) {
    const results = [];
    for (const frame of doc.textFlows[0].frameIds) {
      const root = preview(frame),
        walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()))
        if (node.data.includes(word)) results.push(getComputedStyle(node.parentElement).fontStyle);
    }
    return results;
  }
  function wordPoint(word) {
    const walker = document.createTreeWalker(preview(a.id), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.data.indexOf(word);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + 2);
      range.setEnd(node, index + 3);
      const bounds = range.getBoundingClientRect();
      return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
    }
    throw Error('Missing visible fixture word: ' + word);
  }
  if (reopening) {
    assert(
      wordStyles('bravo').includes('italic'),
      'Persisted partial Cmd+I mark is missing after a fresh window',
    );
    assert(
      wordStyles('charlie').every((s) => s === 'normal'),
      'Cmd+I leaked to following text after reopen',
    );
    await editor.command('document-text');
    await tick();
    const input = host.querySelector('.canvas-flow-input'),
      walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
    let node,
      seen = false;
    while ((node = walker.nextNode()))
      if (node.data.includes('charlie')) {
        assert(
          getComputedStyle(node.parentElement).fontStyle === 'normal',
          'Entering reopened text changes the regular run',
        );
        seen = true;
      }
    assert(seen, 'Reopened canonical text missing');
    editor.destroy();
    console.log(
      'IVO_TEXT_CORE_RESULT:' +
        JSON.stringify({
          ok: true,
          crossPageDrag: true,
          reverseSelection: true,
          rangePaint: true,
          sourceUnchangedBySelection: true,
          nativeCmdI: true,
          saveReopen: true,
          unselectedRunsPreserved: true,
        }),
    );
  } else {
    const beforeClicks = JSON.stringify(doc);
    await editor.command('document-text');
    await tick();
    await window.textCoreTest.select({ from: wordPoint('bravo'), clicks: 2 });
    await tick();
    assert(
      window.getSelection().toString() === 'bravo',
      'Active browser flow double-click did not select the clicked word: ' +
        JSON.stringify(window.getSelection().toString()),
    );
    await window.textCoreTest.select({
      from: wordPoint('bravo'),
      to: wordPoint('charlie'),
      clicks: 2,
    });
    await tick();
    assert(
      window.getSelection().toString() === 'bravo charlie',
      'Browser flow double-click drag did not extend by whole words',
    );
    await window.textCoreTest.select({ from: wordPoint('charlie'), clicks: 3 });
    await tick();
    assert(
      window.getSelection().toString().startsWith('Paragraph 1.') &&
        window.getSelection().toString().includes('zulu.') &&
        !window.getSelection().toString().includes('Paragraph 2.'),
      'Browser flow triple-click did not select its structural paragraph',
    );
    assert(JSON.stringify(doc) === beforeClicks && commits === 0, 'Clicks wrote authored data');
    const source = JSON.stringify(doc),
      from = charPoint(a.id),
      to = charPoint(c.id, true);
    await window.textCoreTest.drag(from, to);
    await tick();
    const input = host.querySelector('.canvas-flow-input'),
      range = captureTextSelection(input);
    assert(
      range && range.focus.index > range.anchor.index,
      'Forward drag did not retain one logical range: ' + JSON.stringify(range),
    );
    assert(
      host.querySelector('.canvas-input-world').classList.contains('flow-range-active'),
      'Cross-frame range lost its retained input owner',
    );
    assert(
      CSS.highlights.get('ivo-flow-selection')?.size >= 3,
      'Range did not paint all sequential frames',
    );
    const painted = [...CSS.highlights.get('ivo-flow-selection')]
      .map((range) => range.toString())
      .join('');
    assert(
      painted === window.getSelection().getRangeAt(0).toString(),
      'Painted selection differs from the logical range at partial frame edges: ' +
        JSON.stringify({
          painted: painted.slice(0, 30),
          end: painted.slice(-30),
          length: painted.length,
          expected: window.getSelection().getRangeAt(0).toString().slice(0, 30),
          expectedEnd: window.getSelection().getRangeAt(0).toString().slice(-30),
          expectedLength: window.getSelection().getRangeAt(0).toString().length,
        }),
    );

    assert(JSON.stringify(doc) === source && commits === 0, 'Selection wrote authored data');
    const transfer = new DataTransfer();
    input.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
    assert(
      transfer.getData('text/plain').includes('Paragraph 2'),
      'Cross-page copy omitted intervening source',
    );
    assert(
      !transfer.getData('text/plain').includes('Unrelated'),
      'Cross-page selection mixed independent text',
    );
    await window.textCoreTest.drag(to, from);
    await tick();
    const backward = captureTextSelection(input);
    assert(
      backward.anchor.index > backward.focus.index,
      'Reverse drag lost anchor/focus direction',
    );
    assert(JSON.stringify(doc) === source, 'Reverse selection changed source');
    const fullSource = doc.textFlows[0].html;
    await window.textCoreTest.key('Backspace');
    await tick();
    assert(
      doc.textFlows[0].html !== fullSource && doc.textFlows[0].html.length < fullSource.length,
      'Deleting a cross-frame range did not change its canonical source',
    );
    await editor.command('undo');
    await tick();
    assert(
      doc.textFlows[0].html === fullSource,
      'Cross-frame delete undo lost source or formatting',
    );

    // Native vertical navigation follows the actual unequal frames, not the hidden input's width.
    const freshInput = host.querySelector('.canvas-flow-input'),
      firstPreview = preview(a.id),
      lastMarker = [...firstPreview.querySelectorAll('[data-flow-text]')].at(-1),
      nearEnd = Number(lastMarker.dataset.flowText) + lastMarker.textContent.length - 1;
    restoreTextSelection(freshInput, {
      anchor: { path: [], offset: 0, kind: 'text', index: nearEnd, affinity: 'backward' },
      focus: { path: [], offset: 0, kind: 'text', index: nearEnd, affinity: 'backward' },
    });
    await tick();
    await window.textCoreTest.key('Down');
    await tick();
    assert(
      captureTextSelection(freshInput).focus.index > nearEnd,
      'Down did not continue into the next linked frame',
    );
    assert(
      editor.getState().activeTextId === flow.frameIds[1],
      'Vertical caret remained in the wrong physical frame',
    );
    await window.textCoreTest.key('Up');
    await tick();
    assert(
      editor.getState().activeTextId === a.id,
      'Up did not return to the preceding linked frame',
    );
    // Collapse/enter at the first frame, select a single word and invoke the real keyboard event.
    await editor.command('tool-select');
    await editor.command('document-text');
    await tick();
    const canonical = host.querySelector('.canvas-flow-input'),
      map = textIndexMap(canonical),
      part = map.segments.find((s) => s.node.data.includes('bravo')),
      offset = part.node.data.indexOf('bravo');
    const selected = document.createRange();
    selected.setStart(part.node, offset);
    selected.setEnd(part.node, offset + 5);
    canonical.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(selected);
    await tick();
    await window.textCoreTest.key('I', ['meta']);
    await tick();
    assert(
      doc.textFlows[0].html.includes('data-ivo-italic="true"'),
      'Native Cmd+I bypassed canonical formatting',
    );
    await editor.command('tool-select');
    await tick();
    assert(wordStyles('bravo').includes('italic'), 'Deselecting lost partial italic');
    assert(
      wordStyles('charlie').every((s) => s === 'normal'),
      'Italic leaked to unselected text on deselect',
    );
    // Re-enter then restore the same word by logical indices and toggle off/on through trusted input.
    await editor.command('document-text');
    await tick();
    const active = host.querySelector('.canvas-flow-input');
    restoreTextSelection(active, {
      anchor: {
        path: [],
        kind: 'text',
        offset: 0,
        index: part.start + offset,
        affinity: 'forward',
      },
      focus: {
        path: [],
        kind: 'text',
        offset: 0,
        index: part.start + offset + 5,
        affinity: 'backward',
      },
    });
    await tick();
    await window.textCoreTest.key('I', ['meta']);
    await tick();
    await editor.command('tool-select');
    await tick();
    assert(
      wordStyles('bravo').every((s) => s === 'normal'),
      'Turning italic off failed',
    );
    await editor.command('document-text');
    await tick();
    restoreTextSelection(host.querySelector('.canvas-flow-input'), {
      anchor: {
        path: [],
        kind: 'text',
        offset: 0,
        index: part.start + offset,
        affinity: 'forward',
      },
      focus: {
        path: [],
        kind: 'text',
        offset: 0,
        index: part.start + offset + 5,
        affinity: 'backward',
      },
    });
    await tick();
    await window.textCoreTest.key('I', ['meta']);
    await tick();
    await editor.command('tool-select');
    await window.textCoreTest.save({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [],
    });
    editor.destroy();
    await verifyFlowSelectionBoundaries(host, window.textCoreTest);
    console.log('IVO_TEXT_CORE_RESULT:' + JSON.stringify({ phase: 'edit' }));
  }
} catch (error) {
  console.log('IVO_TEXT_CORE_RESULT:' + JSON.stringify({ error: error.stack }));
}
