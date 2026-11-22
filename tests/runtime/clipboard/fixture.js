import { INLINE_CLIPBOARD_TYPE } from '../../../src/domain/documents/inline-clipboard.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import {
  OBJECT_CLIPBOARD_TYPE,
  copyObjectSelection,
} from '../../../src/domain/documents/clipboard.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
try {
  await document.fonts.ready;
  const host = document.querySelector('#host');
  let doc = createSceneDocument('Clipboard and style regression'),
    history = createDocumentHistory(),
    editor;
  const page = doc.pages[0],
    a = insertObject(doc, 'text', page.id, {
      x: 40,
      y: 50,
      w: 220,
      h: 100,
      italic: true,
      bold: true,
      html: '<p><em>Italic heading</em></p><p>Regular paragraph remains regular. More ordinary words continue here.</p>',
    });
  const flow = startTextFlow(doc, a.id, { automaticPages: false });
  delete flow.style.italic;
  delete flow.style.bold;
  const b = insertObject(doc, 'text', page.id, {
    x: 300,
    y: 50,
    w: 220,
    h: 100,
    italic: true,
    fontSize: 48,
    textStyle: 'sans',
  });
  threadFrame(doc, a.id, b.id);
  const notifications = [],
    assets = [];
  const mount = (initialState) =>
    mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (s) => s,
      editing: true,
      sessionId: 'clipboard-regression',
      initialState,
      assets: () => assets,
      onCommit: (before, metadata) => history.record(before, doc, metadata),
      onChange: () => {},
      onNotify: (message) => notifications.push(message),
      onAsset: async (asset) => {
        assets.push(asset);
      },
      onUndo: () => {
        const result = history.undo(doc);
        if (result) {
          doc = result.document;
          editor.restoreView(result.view);
        }
      },
      onRedo: () => {
        const result = history.redo(doc);
        if (result) {
          doc = result.document;
          editor.restoreView(result.view);
        }
      },
    });
  editor = mount({ selection: [a.id] });
  await tick();
  const original = JSON.stringify(doc);
  function previewStyle(id) {
    const root = host.querySelector(`[data-flow-frame="${id}"]`),
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    const result = [];
    while ((node = walker.nextNode()))
      if (node.textContent.trim()) {
        const style = getComputedStyle(node.parentElement);
        result.push({
          text: node.textContent,
          italic: style.fontStyle,
          weight: style.fontWeight,
          size: style.fontSize,
        });
      }
    return result;
  }
  for (const id of [a.id, b.id])
    for (const part of previewStyle(id)) {
      assert(
        part.italic === (part.text.includes('Italic heading') ? 'italic' : 'normal'),
        'Inactive frame revived stale italic settings',
      );
    }
  for (const id of [a.id, b.id])
    for (const part of previewStyle(id))
      assert(
        part.weight === '400' && part.size === '16px',
        'Frame-local bold/size overrode shared text',
      );
  for (let i = 0; i < 3; i++) {
    await editor.command('document-text');
    const input = host.querySelector('.canvas-flow-input'),
      regular = [...input.querySelectorAll('p')].find((p) => p.textContent.startsWith('Regular'));
    assert(
      getComputedStyle(regular).fontStyle === 'normal',
      'Live text differs from its regular preview',
    );
    await editor.command('tool-select');
    assert(
      previewStyle(a.id).some((p) => p.text.includes('Regular') && p.italic === 'normal'),
      'Exit restored inherited italics',
    );
  }
  assert(JSON.stringify(doc) === original, 'Entering/exiting text changed authored content');
  const moveViewport = host.querySelector('.canvas-viewport'),
    moveObject = host.querySelector(`[data-object="${a.id}"]`),
    box = moveObject.getBoundingClientRect();
  moveViewport.setPointerCapture = () => {};
  moveViewport.releasePointerCapture = () => {};
  const pointer = (type, target, x, y) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );
  pointer('pointerdown', moveObject, box.x + 10, box.y + 10);
  pointer('pointermove', moveViewport, box.x + 25, box.y + 18);
  assert(
    previewStyle(a.id).every(
      (part) => part.italic === (part.text.includes('Italic heading') ? 'italic' : 'normal'),
    ),
    'Dragging revived per-frame italic settings',
  );
  pointer('pointerup', moveViewport, box.x + 25, box.y + 18);
  assert(flow.html === doc.textFlows[0].html, 'A geometry edit changed shared text');
  await editor.command('undo');
  // Native Electron edit commands exercise the same event path as the Edit menu / Cmd+C/V.
  const viewport = host.querySelector('.canvas-viewport');
  viewport.focus();
  let copied = null;
  host.addEventListener('copy', (event) => {
    queueMicrotask(() => {
      copied = event.clipboardData.getData(OBJECT_CLIPBOARD_TYPE);
    });
  });
  await window.clipboardTest.edit('copy');
  await tick();
  // Copy handler is on window, so inspect the native clipboard on the ensuing paste as well.
  let received = '';
  window.addEventListener(
    'paste',
    (event) => {
      received = event.clipboardData.getData(OBJECT_CLIPBOARD_TYPE);
    },
    { once: true },
  );
  const count = doc.blocks.length;
  await window.clipboardTest.edit('paste');
  await tick();
  await editor.flush();
  await tick();
  assert(
    received.length > 0 && doc.blocks.length === count + 1,
    'Native object copy/paste failed: ' +
      JSON.stringify({
        copied: !!copied,
        received: received.length,
        count: doc.blocks.length,
        notifications,
      }),
  );
  const pasted = doc.blocks.find((item) => editor.getState().selection.includes(item.id));
  assert(
    pasted && pasted.id !== a.id && pasted.textFlowId !== flow.id,
    'Pasted frame shares source identity',
  );
  assert(
    doc.textFlows.find((f) => f.id === pasted.textFlowId).html === flow.html,
    'Pasted text content or marks changed',
  );
  await editor.command('undo');
  assert(doc.blocks.length === count, 'Paste was not one undo operation');
  await editor.command('redo');
  assert(doc.blocks.length === count + 1, 'Paste redo failed');
  viewport.focus();
  await window.clipboardTest.edit('cut');
  await tick();
  assert(doc.blocks.length === count, 'Object cut did not remove its selected frame');
  await editor.command('undo');
  assert(doc.blocks.length === count + 1, 'Object cut undo failed');
  // Text selection still uses text copy, and pastes text rather than objects while typing.
  await editor.command('document-text');
  const input = host.querySelector('.canvas-flow-input'),
    range = document.createRange();
  range.selectNodeContents(input.querySelector('em'));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  input.focus();
  const textTransfer = new DataTransfer(),
    textCopy = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: textTransfer,
    });
  input.dispatchEvent(textCopy);
  assert(
    !textTransfer.getData(OBJECT_CLIPBOARD_TYPE) &&
      textTransfer.getData('text/plain') === 'Italic heading',
    'Text copy was replaced with object copy',
  );
  await editor.command('tool-select');
  editor.destroy();
  doc = createSceneDocument('Inline clipboard');
  history = createDocumentHistory();
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>Blue twill.</p><p>Ivory facing.</p>',
  });
  startTextFlow(doc, frame.id, { automaticPages: false });
  const shape = insertObject(doc, 'polygon', doc.pages[0].id, { w: 20, h: 14 });
  editor = mount({ selection: [frame.id] });
  await editor.command('document-text');
  const editing = host.querySelector('.canvas-flow-input');
  editing.focus();
  window.getSelection().collapse(editing.querySelector('p').firstChild, 5);
  const art = new DataTransfer();
  art.setData(OBJECT_CLIPBOARD_TYPE, JSON.stringify(copyObjectSelection(doc, [shape.id])));
  const dispatch = (type, data) =>
    editing.dispatchEvent(
      new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  dispatch('paste', art);
  await editor.flush();
  const marker = editing.querySelector('[data-ivo-anchor]');
  assert(
    marker && doc.blocks.length === 3,
    'Pasting a page object into text failed: ' + notifications.at(-1),
  );
  const markerRange = document.createRange();
  markerRange.selectNodeContents(marker.firstChild);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(markerRange);
  const rangeData = new DataTransfer();
  dispatch('copy', rangeData);
  assert(
    rangeData.getData(INLINE_CLIPBOARD_TYPE),
    'Copying the exact marker lost its asset archive',
  );
  window.getSelection().collapseToEnd();
  // Place the copy at a second insertion point, outside the original marker.
  window.getSelection().selectAllChildren(editing);
  window.getSelection().collapseToEnd();
  dispatch('paste', rangeData);
  await editor.flush();
  const ids = [...editing.querySelectorAll('[data-ivo-anchor]')].map(
    (node) => node.dataset.ivoAnchor,
  );
  assert(
    ids.length === 2 && ids[0] !== ids[1] && doc.blocks.length === 4,
    'Range paste lost or aliased the graphic: ' + notifications.at(-1),
  );
  await editor.command('undo');
  assert(
    doc.blocks.length === 3 && !doc.textFlows[0].html.includes(ids[1]),
    'Inline paste left artwork behind after undo',
  );
  await editor.command('redo');
  assert(
    doc.blocks.length === 4 && doc.textFlows[0].html.includes(ids[1]),
    'Redo did not restore inline art',
  );
  await editor.command('document-text');
  const fullInput = host.querySelector('.canvas-flow-input');
  fullInput.focus();
  window.getSelection().selectAllChildren(fullInput);
  const allData = new DataTransfer();
  fullInput.dispatchEvent(
    new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: allData }),
  );
  const originalHTML = doc.textFlows[0].html;
  window.getSelection().collapseToEnd();
  fullInput.dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: allData }),
  );
  await editor.flush();
  assert(
    doc.blocks.length === 6 &&
      fullInput.querySelectorAll('[data-ivo-anchor]').length === 4 &&
      (doc.textFlows[0].html.match(/Blue/g) || []).length === 2 &&
      (doc.textFlows[0].html.match(/Ivory/g) || []).length === 2,
    'Multiline paste lost text, art or paragraphs: ' + notifications.at(-1),
  );
  await editor.command('undo');
  assert(
    doc.textFlows[0].html === originalHTML && doc.blocks.length === 4,
    'Multiline paste did not undo exactly',
  );
  editor.destroy();
  // Failed resource persistence must not leave half-pasted objects or undo entries.
  doc = createSceneDocument('Failed paste');
  history = createDocumentHistory();
  const source = createSceneDocument('Image source');
  const image = insertObject(source, 'image', source.pages[0].id, { src: 'asset:clipboard-image' });
  const resource = {
    id: 'clipboard-image',
    name: 'Image',
    mimeType: 'image/png',
    data: 'data:image/png;base64,AAAA',
  };
  const payload = JSON.stringify(copyObjectSelection(source, [image.id], [resource]));
  editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    onCommit: () => {
      throw new Error('Failed paste committed');
    },
    onChange: () => {},
    onAsset: async () => {
      throw new Error('Simulated disk failure');
    },
    onNotify: (m) => notifications.push(m),
  });
  const transfer = new DataTransfer();
  transfer.setData(OBJECT_CLIPBOARD_TYPE, payload);
  host
    .querySelector('.canvas-viewport')
    .dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  await editor.flush();
  assert(
    doc.blocks.length === 0 && notifications.includes('Simulated disk failure'),
    'Failed asset save mutated the document',
  );
  editor.destroy();
  doc = createSceneDocument('Delayed paste');
  let release;
  const saved = new Promise((resolve) => {
    release = resolve;
  });
  editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    onCommit: () => {
      throw new Error('Stale paste committed');
    },
    onChange: () => {},
    onAsset: async () => {
      await saved;
    },
    onNotify: (m) => notifications.push(m),
  });
  const delayed = new DataTransfer();
  delayed.setData(OBJECT_CLIPBOARD_TYPE, payload);
  host
    .querySelector('.canvas-viewport')
    .dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: delayed }),
    );
  await tick();
  const authored = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>Keep my newer edit.</p>',
  });
  release();
  await editor.flush();
  assert(
    doc.blocks.length === 1 && doc.blocks[0] === authored,
    'A delayed paste overwrote a newer edit',
  );
  editor.destroy();
  doc = createSceneDocument('Resource paste');
  let savedFirst = false,
    resourceCommits = 0;
  editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    onCommit: () => {
      assert(savedFirst, 'Paste preceded its vault resource');
      resourceCommits++;
    },
    onChange: () => {},
    onAsset: async (asset) => {
      assert(
        doc.blocks.length === 0 && asset.data === resource.data,
        'Resource bytes or save ordering changed',
      );
      savedFirst = true;
    },
    onNotify: (m) => notifications.push(m),
  });
  const successful = new DataTransfer();
  successful.setData(OBJECT_CLIPBOARD_TYPE, payload);
  host
    .querySelector('.canvas-viewport')
    .dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: successful }),
    );
  await editor.flush();
  assert(
    savedFirst && resourceCommits === 1 && doc.blocks[0].src === image.src,
    'Cross-vault image paste failed',
  );
  editor.destroy();
  console.log(
    'IVO_CLIPBOARD_RESULT:' +
      JSON.stringify({
        ok: true,
        nativeObjectCopyPaste: true,
        inlineGraphicCopyPaste: true,
        independentFlow: true,
        cutUndoRedo: true,
        textCopyPreserved: true,
        persistBeforePaste: true,
        crossVaultResources: true,
        delayedPasteGuard: true,
        sharedFlowStyle: true,
        dragPreviewParity: true,
        repeatedEditPreviewParity: true,
        authoredSourceUnchanged: true,
      }),
  );
} catch (error) {
  console.log('IVO_CLIPBOARD_RESULT:' + JSON.stringify({ error: error.stack }));
}
