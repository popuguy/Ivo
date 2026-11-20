import { CURRENT_ARCHIVE_VERSION } from '../../../src/domain/documents/capabilities.js';
import { verifyFindChange } from './find-change.js';
import { verifyFlowCaretGeometry } from './flow-geometry.js';
import { verifyTextDecorations } from './decorations.js';
import { verifyNativeTextFormatting } from './native-format.js';
import { verifyClipboardWhitespace } from './clipboard-whitespace.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import {
  captureTextSelection,
  restoreTextSelection,
} from '../../../src/shared/dom/text-selection.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = async (predicate) => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error('Timed out waiting for application state');
};
try {
  await verifyFindChange();
  await verifyClipboardWhitespace();
  verifyNativeTextFormatting();
  await verifyTextDecorations();
  await verifyFlowCaretGeometry();
  const a = createSceneDocument('A text test'),
    b = createSceneDocument('B text test');
  a.id = 'text-a';
  b.id = 'text-b';
  a.createdAt = '2020-01-01T00:00:00.000Z';
  b.createdAt = '2020-01-02T00:00:00.000Z';
  const text = insertObject(a, 'text', a.pages[0].id, {
    x: 70,
    y: 80,
    w: 260,
    h: 280,
    fontSize: 18,
    textStyle: 'cmu-serif',
    html: '<p>Alpha <strong>bravo</strong> charlie.</p><p>Second paragraph.</p>',
  });
  const polygon = insertObject(a, 'polygon', a.pages[0].id, { x: 380, y: 100, w: 100, h: 100 });
  insertObject(b, 'text', b.pages[0].id, { html: '<p>Document B remains intact.</p>' });
  const documents = new Map([a, b].map((d) => [d.id, structuredClone(d)])),
    meta = new Map([['initialized', true]]);
  const menuStates = [];
  let nativeCommand,
    holdMetadata = false,
    metadataHeld = false,
    releaseMetadata;
  globalThis.ivoNative = {
    platform: 'macos',
    exportPDF: async (snapshot) => {
      globalThis.__pdfSnapshot = snapshot;
      return {
        canceled: false,
        pages: snapshot.documents.reduce((sum, doc) => sum + doc.pages.length, 0),
        warnings: [],
      };
    },
    updateHistory: (state) => menuStates.push(state),
    zoomFactor: () => 1,
    onCommand: (callback) => {
      nativeCommand = callback;
    },
    onPrepareClose: () => {},
    store: {
      loadDocuments: async () => structuredClone([...documents.values()]),
      loadAssets: async () => [],
      loadAsset: async () => null,
      saveAsset: async () => {},
      saveDocument: async (d) => {
        validateImport({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents: [d], assets: [] });
        documents.set(d.id, structuredClone(d));
      },
      getMeta: async (id) => {
        if (holdMetadata && id.startsWith('history:')) {
          holdMetadata = false;
          metadataHeld = true;
          await new Promise((resolve) => (releaseMetadata = resolve));
        }
        return meta.has(id) ? { id, value: structuredClone(meta.get(id)) } : null;
      },
      putMeta: async (id, value) => meta.set(id, structuredClone(value)),
      saveImport: async (payload) => {
        for (const d of payload.documents) documents.set(d.id, structuredClone(d));
      },
    },
  };
  localStorage.setItem('ivo:snapping', 'false');
  await import('../../../src/app/main.js');
  await wait(() => document.querySelector('.canvas-world'));
  await document.fonts.ready;
  await nativeCommand('toggle-edit');
  await nativeCommand('show-panel-properties');
  await tick();
  const surface = () => document.querySelector(`[data-scene-text="${text.id}"]`),
    viewport = () => document.querySelector('.canvas-viewport');
  const enter = () => {
    const el = surface(),
      r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 }),
    );
    return surface();
  };
  const selectRange = (el, node, start, end = start) => {
    el.focus();
    window.getSelection().setBaseAndExtent(node, start, node, end);
    document.dispatchEvent(new Event('selectionchange'));
  };
  const type = (value) => {
    const el = surface(),
      before = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: value,
        bubbles: true,
        cancelable: true,
      });
    if (el.dispatchEvent(before)) {
      const selection = window.getSelection(),
        range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(value);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(
        new InputEvent('input', { inputType: 'insertText', data: value, bubbles: true }),
      );
    }
  };
  let el = enter(),
    first = el.querySelector('p').firstChild;
  selectRange(el, first, 0);
  type('x');
  type('y');
  assert(surface().textContent.startsWith('xyAlpha'), 'Contiguous text was not inserted');
  await nativeCommand('undo');
  assert(surface().textContent.startsWith('Alpha'), 'Typing group did not undo together');
  assert(document.activeElement === surface(), 'Text undo lost focus');
  await nativeCommand('redo');
  assert(surface().textContent.startsWith('xyAlpha'), 'Typing did not redo');
  await nativeCommand('undo');
  el = surface();
  first = el.querySelector('p').firstChild;
  selectRange(el, first, 0, 5);
  const originalNode = el,
    field = document.querySelector('[data-object-prop="fontSize"]');
  field.focus();
  assert(document.activeElement === field, 'The visible font size field must own input');
  await nativeCommand('select-all');
  document.execCommand('insertText', false, '28');
  assert(field.value === '28', 'Native Select All did not replace the inspector number');
  field.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-object-prop="leading"]').focus();
  assert(surface() === originalNode, 'Font change replaced live text DOM');
  assert(
    el.querySelector('[data-ivo-size="28"]')?.textContent === 'Alpha',
    'Font change did not target selected text',
  );
  assert(
    getComputedStyle(el.querySelector('strong')).fontSize === '18px',
    'Selected-run formatting changed unrelated text',
  );
  await nativeCommand('undo');
  assert(
    !surface().querySelector('[data-ivo-size]'),
    'Committed inspector formatting did not undo',
  );
  assert(window.getSelection().toString() === 'Alpha', 'Undo did not restore text selection');
  await nativeCommand('redo');
  assert(surface().querySelector('[data-ivo-size="28"]'), 'Formatting did not redo');
  await nativeCommand('undo');
  el = surface();
  selectRange(el, el.querySelector('p').firstChild, 0, 5);
  const alignment = document.querySelector('[data-object-prop="align"]');
  alignment.value = 'right';
  alignment.dispatchEvent(new Event('change', { bubbles: true }));
  assert(
    surface().querySelector('p').style.textAlign === 'right',
    'Paragraph alignment did not apply to the selected paragraph',
  );
  assert(
    !surface().querySelectorAll('p')[1].style.textAlign,
    'Paragraph alignment leaked to another paragraph',
  );
  await nativeCommand('undo');
  el = surface();
  const rootCaret = document.createRange();
  rootCaret.selectNodeContents(el);
  rootCaret.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(rootCaret);
  document.dispatchEvent(new Event('selectionchange'));
  const rootBookmark = captureTextSelection(el);
  assert(
    rootBookmark && restoreTextSelection(el, rootBookmark),
    'Element-container caret bookmark failed',
  );
  const size = document.querySelector('[data-object-prop="fontSize"]');
  size.value = '36';
  size.dispatchEvent(new Event('change', { bubbles: true }));
  type('Z');
  assert(
    surface().querySelector('[data-ivo-size="36"]')?.textContent === 'Z',
    'Insertion-point font did not apply to new text',
  );
  await nativeCommand('undo');
  assert(!surface().textContent.endsWith('Z'), 'Styled insertion did not undo');
  el = surface();
  selectRange(el, el.querySelector('strong').firstChild, 0, 5);
  const beforeLink = el.innerHTML,
    linkPending = nativeCommand('link');
  await wait(() => document.querySelector('#dialog').open);
  assert(
    menuStates.at(-1).canUndo === false && menuStates.at(-1).canRedo === false,
    'Native undo menu remained enabled behind a modal',
  );
  await nativeCommand('undo');
  await nativeCommand('delete');
  assert(surface().innerHTML === beforeLink, 'Native menu mutated document behind dialog');
  document.querySelector('[data-link-to="text-b"]').click();
  await linkPending;
  assert(surface().querySelector('a')?.textContent === 'bravo', 'Link did not wrap selected text');
  assert(surface().querySelector('a strong,strong a'), 'Link lost bold source');
  await nativeCommand('undo');
  assert(
    !surface().querySelector('a') && window.getSelection().toString() === 'bravo',
    'Link undo did not share the text timeline and bookmark',
  );
  await nativeCommand('redo');
  assert(surface().querySelector('a'), 'Link redo failed');
  // Character formatting across paragraphs must preserve valid block structure and every break.
  el = surface();
  el.focus();
  const across = document.createRange();
  across.selectNodeContents(el);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(across);
  document.dispatchEvent(new Event('selectionchange'));
  const sourceParagraphs = [...el.querySelectorAll('p')].map((p) => p.textContent);
  const acrossSize = document.querySelector('[data-object-prop="fontSize"]');
  acrossSize.value = '23';
  acrossSize.dispatchEvent(new Event('change', { bubbles: true }));
  const normalized = document.createElement('div');
  normalized.innerHTML = cleanHTML(surface().innerHTML);
  assert(
    JSON.stringify([...normalized.querySelectorAll('p')].map((p) => p.textContent)) ===
      JSON.stringify(sourceParagraphs),
    'Cross-paragraph character styling changed block structure',
  );
  assert(!normalized.querySelector('p p,span p'), 'Character formatting nested paragraph blocks');
  await nativeCommand('undo');
  // Composition has one history entry and blocks native menu undo until final input.
  el = surface();
  selectRange(el, el.querySelector('p').firstChild, 0);
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  el.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'insertCompositionText',
      data: '漢',
      bubbles: true,
    }),
  );
  el.prepend(document.createTextNode('漢'));
  window.getSelection().setBaseAndExtent(el.firstChild, 1, el.firstChild, 1);
  el.dispatchEvent(
    new InputEvent('input', {
      inputType: 'insertCompositionText',
      data: '漢',
      isComposing: true,
      bubbles: true,
    }),
  );
  await nativeCommand('undo');
  assert(surface().textContent.startsWith('漢'), 'Native undo interrupted composition');
  el.dispatchEvent(new CompositionEvent('compositionend', { data: '漢', bubbles: true }));
  await nativeCommand('undo');
  assert(
    !surface().textContent.startsWith('漢'),
    'Completed composition did not undo as one action',
  );
  // Native structural actions relinquish the old edit owner; undo restores it.
  el = surface();
  await nativeCommand('duplicate');
  assert(
    !document.querySelector('[contenteditable="true"]'),
    'Duplicate left stale editable ownership',
  );
  await nativeCommand('undo');
  assert(document.querySelectorAll('.object-text').length === 1, 'Duplicate undo failed');
  await nativeCommand('delete');
  assert(
    !document.querySelector(`[data-object="${text.id}"]`),
    'Delete did not remove selected frame',
  );
  await nativeCommand('undo');
  assert(
    surface() && document.querySelectorAll('.object-text').length === 1,
    'Delete undo did not restore one text frame',
  );
  // A suspended view change cannot acquire a new pointer gesture or change another document.
  holdMetadata = true;
  const pendingToggle = nativeCommand('toggle-edit');
  await wait(() => metadataHeld);
  assert(
    document.querySelector('.scene-editor').inert,
    'Async transition did not suspend input synchronously',
  );
  document.querySelector('[data-open="text-b"]').click();
  const box = document.querySelector(`[data-object="${polygon.id}"]`).getBoundingClientRect();
  for (const [type, x, y, buttons] of [
    ['pointerdown', box.x + 5, box.y + 5, 1],
    ['pointermove', box.x + 200, box.y + 300, 1],
    ['pointerup', box.x + 200, box.y + 300, 0],
  ])
    viewport().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 3,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      }),
    );
  releaseMetadata();
  await pendingToggle;
  await wait(() => document.querySelector('[data-document-title]')?.value === 'B text test');
  await wait(() => !document.querySelector('.scene-editor').inert);
  assert(
    document.querySelector('[data-action="toggle-edit"]').ariaLabel.includes('reading'),
    'Old toggle command changed the newly opened document',
  );
  await nativeCommand('undo');
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert(
    documents.get('text-b').blocks[0].html === '<p>Document B remains intact.</p>',
    'Undo crossed document ownership',
  );
  assert(
    documents.get('text-a').blocks.find((x) => x.id === polygon.id).x === 380,
    'Pointer during transition moved artwork',
  );
  const scratch = document.createElement('div');
  scratch.dataset.sceneText = 'bookmark-scratch';
  scratch.contentEditable = 'true';
  scratch.innerHTML = '<p>A</p><p><br></p><p><strong>Word</strong> end</p>';
  document.body.append(scratch);
  const split = document.createTextNode('B');
  scratch.querySelector('p').append(split);
  scratch.focus();
  window.getSelection().setBaseAndExtent(split, 1, split, 1);
  const normalizedCaret = captureTextSelection(scratch);
  scratch.innerHTML = cleanHTML(scratch.innerHTML);
  assert(
    restoreTextSelection(scratch, normalizedCaret) &&
      window.getSelection().anchorNode.data === 'AB' &&
      window.getSelection().anchorOffset === 2,
    'Caret did not survive adjacent text-node serialization',
  );
  const endText = scratch.querySelectorAll('p')[2].lastChild,
    startText = scratch.querySelector('p').firstChild;
  window.getSelection().setBaseAndExtent(endText, 4, startText, 1);
  const backward = captureTextSelection(scratch),
    selected = window.getSelection().toString();
  scratch.innerHTML = cleanHTML(scratch.innerHTML);
  assert(
    restoreTextSelection(scratch, backward) &&
      window.getSelection().toString() === selected &&
      window.getSelection().anchorNode.parentElement === scratch.querySelectorAll('p')[2],
    'Backward multi-paragraph selection did not survive normalization',
  );
  scratch.remove();
  const canonical = cleanHTML(
    '<span data-ivo-size="22" data-ivo-color="#123456" style="position:fixed;background:url(https://example.com/x)">Safe</span><span data-ivo-size="Infinity" data-ivo-color="red">Text</span>',
  );
  assert(
    canonical.includes('font-size: 22px') &&
      canonical.includes('#123456') &&
      !canonical.includes('position') &&
      !canonical.includes('url(') &&
      !canonical.includes('Infinity'),
    'Typography sanitizer admitted arbitrary CSS or discarded valid data',
  );
  // Sharing flushes one frozen snapshot without changing the document's undo timeline.
  await nativeCommand('export-pdf');
  await wait(
    () =>
      document.querySelector('#dialog').open &&
      document.querySelector('#dialog h2').textContent === 'Export PDF',
  );
  document.querySelector('#dialog button[type="submit"]').click();
  await wait(() => !!globalThis.__pdfSnapshot);
  await wait(() => !document.querySelector('#dialog').open);
  assert(
    globalThis.__pdfSnapshot.format === 'ivo-pdf-1' &&
      globalThis.__pdfSnapshot.documents[0].id === 'text-b',
    'Native export did not freeze the currently open document',
  );
  // Name/alias fuzzy switching, MRU toggle and creation follow the same navigation queue.
  await nativeCommand('quick-switcher');
  let quick = document.querySelector('#quick-search');
  quick.value = 'att';
  quick.dispatchEvent(new Event('input', { bubbles: true }));
  assert(
    document.querySelectorAll('[data-quick]').length === 1 &&
      document.querySelector('[data-quick]').dataset.quick === 'text-a',
    'Quick switcher did not fuzzy-match title',
  );
  quick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(() => document.title === 'A text test — Ivo');
  await nativeCommand('quick-switcher');
  quick = document.querySelector('#quick-search');
  quick.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert(
    document.querySelector('[data-quick="text-b"]').getAttribute('aria-selected') === 'true',
    'Quick switcher MRU did not select previous document',
  );
  quick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(() => document.title === 'B text test — Ivo');
  await nativeCommand('quick-switcher');
  quick = document.querySelector('#quick-search');
  quick.value = 'Fashion fitting';
  quick.dispatchEvent(new Event('input', { bubbles: true }));
  quick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(
    () => document.title === 'Fashion fitting — Ivo' && !document.querySelector('#dialog').open,
  );
  assert(
    document.querySelectorAll('.canvas-object').length === 1 &&
      document.querySelector('.canvas-flow-input').textContent === '',
    'Quick creation inserted authored placeholder content',
  );
  await nativeCommand('document-text');
  await tick();
  await nativeCommand('tool-select');
  viewport().focus();
  await tick();
  assert(
    menuStates.at(-1).canFormat && JSON.parse(menuStates.at(-1).textTarget)[4] === null,
    'Leaving linked text did not refresh the whole-frame native menu target: ' +
      JSON.stringify(menuStates.at(-1)),
  );
  const toolButton = document.querySelector('[data-canvas-command="tool-select"]');
  toolButton.focus();
  toolButton.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  );
  await tick();
  assert(
    document.querySelector('.scene-editor').classList.contains('tools-hidden'),
    'Application Tab did not stash panels exactly once',
  );
  viewport().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  );
  await tick();
  assert(
    !document.querySelector('.scene-editor').classList.contains('panels-hidden'),
    'Application Tab did not restore panels',
  );
  await nativeCommand('toggle-edit');
  await tick();
  viewport().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
  );
  await tick();
  const reading = document.querySelector('.scene-editor');
  assert(
    reading.classList.contains('scene-reading') &&
      reading.classList.contains('panels-hidden') &&
      Math.abs(
        reading.querySelector('.canvas-center').getBoundingClientRect().width - reading.clientWidth,
      ) < 1,
    'Reading-view Shift Tab retained an empty tool column',
  );
  console.log(
    'IVO_TEXT_RESULT:' +
      JSON.stringify({
        ok: true,
        editorialFindChange: true,
        unifiedUndo: true,
        selectionBookmarks: true,
        liveRangeFormatting: true,
        paragraphScope: true,
        insertionStyle: true,
        modalGuards: true,
        compositionTransaction: true,
        structuralOwnership: true,
        serializedTransitions: true,
        sanitizedTypography: true,
        clipboardWhitespace: true,
        fuzzySwitcher: true,
        mruToggle: true,
        quickCreation: true,
        settledNativeFrameMenu: true,
        applicationTabRouting: true,
      }),
  );
} catch (error) {
  console.log('IVO_TEXT_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
