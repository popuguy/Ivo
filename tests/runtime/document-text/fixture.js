import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { CURRENT_ARCHIVE_VERSION } from '../../../src/domain/documents/capabilities.js';
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await frame();
  }
  throw new Error('TextFlow application timeout');
};
try {
  const source = createSceneDocument('Long note'),
    text = insertObject(source, 'text', source.pages[0].id, {
      x: 30,
      y: 30,
      w: 300,
      h: 220,
      textStyle: 'serif',
      html: '<p><span data-ivo-font="cmu-serif" data-ivo-size="12">Initial <strong>textFlow</strong>.</span></p><p><br></p>',
    });
  source.id = 'flow-source';
  const reference = createSceneDocument('Reference'),
    docs = new Map([
      [source.id, structuredClone(source)],
      [reference.id, reference],
    ]),
    meta = new Map([['initialized', true]]);
  let nativeCommand;
  globalThis.ivoNative = {
    platform: 'macos',
    zoomFactor: () => 1,
    onCommand: (callback) => (nativeCommand = callback),
    onPrepareClose: () => {},
    updateHistory: () => {},
    store: {
      loadDocuments: async () => structuredClone([...docs.values()]),
      loadAssets: async () => [],
      loadAsset: async () => null,
      saveAsset: async () => {},
      saveDocument: async (doc) => {
        validateImport({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents: [doc], assets: [] });
        docs.set(doc.id, structuredClone(doc));
      },
      getMeta: async (id) => (meta.has(id) ? { id, value: structuredClone(meta.get(id)) } : null),
      putMeta: async (id, value) => meta.set(id, structuredClone(value)),
      saveImport: async () => {},
    },
  };
  await import('../../../src/app/main.js');
  await wait(() => document.querySelector('.canvas-world'));
  await nativeCommand('toggle-edit');
  const target = document.querySelector(`[data-object="${text.id}"]`),
    r = target.getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: r.x + 10,
      clientY: r.y + 10,
    }),
  );
  document.querySelector('.canvas-viewport').dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: r.x + 10,
      clientY: r.y + 10,
    }),
  );
  document.querySelector('[data-canvas-command="start-flow"]').click();
  await wait(() => document.querySelector('.canvas-flow-input[contenteditable="true"]'));
  // Match the reported re-entry: read, edit again, then type on an unformatted newline.
  await nativeCommand('toggle-edit');
  await nativeCommand('toggle-edit');
  await nativeCommand('document-text');
  const root = document.querySelector('.canvas-flow-input'),
    initialNode = root;
  assert(root.textContent === 'Initial textFlow.', 'TextFlow source was not retained');
  const blank = root.querySelectorAll('p')[1],
    blankRange = document.createRange();
  root.focus();
  blankRange.setStart(blank, 0);
  blankRange.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(blankRange);
  document.dispatchEvent(new Event('selectionchange'));
  assert(
    getComputedStyle(blank).fontFamily.includes('Georgia'),
    'Fixture no longer reproduces the distinct flow default',
  );
  root.dispatchEvent(
    new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'Continuation' }),
  );
  document.execCommand('insertText', false, 'Continuation');
  assert(
    getComputedStyle(blank).fontFamily.includes('CMU Serif') &&
      getComputedStyle(blank).fontSize === '12px',
    'Typing on a bare newline fell back to the flow default font or size',
  );
  assert(
    blank.textContent === 'Continuation' && blank.dataset.ivoFont === 'cmu-serif',
    'Newline insertion did not retain canonical character formatting',
  );
  await nativeCommand('undo');
  assert(
    root.textContent === 'Initial textFlow.' &&
      !root.querySelectorAll('p')[1].hasAttribute('data-ivo-font'),
    'Undo did not restore the original blank paragraph and character formatting together',
  );
  await nativeCommand('redo');
  assert(
    root.querySelectorAll('p')[1].textContent === 'Continuation' &&
      getComputedStyle(root.querySelectorAll('p')[1]).fontFamily.includes('CMU Serif'),
    'Redo lost inherited newline formatting',
  );
  await nativeCommand('undo');

  const long = Array.from(
    { length: 35 },
    (_, i) =>
      `<p>Paragraph ${i} has <strong>rich type</strong> and enough continuous text to flow across pages while preserving the original source.</p>`,
  ).join('');
  await nativeCommand('select-all');
  root.dispatchEvent(
    new InputEvent('beforeinput', { bubbles: true, inputType: 'insertFromPaste' }),
  );
  document.execCommand('insertHTML', false, long);
  await wait(() => document.querySelectorAll('.canvas-page').length > 4);
  assert(
    document.querySelector('.canvas-flow-input') === initialNode,
    'Pagination replaced the live editing DOM',
  );
  const pages = document.querySelectorAll('.canvas-page').length;
  assert(
    !document.querySelector('.canvas-document-text'),
    'Linked text still opened a bottom editor',
  );
  const later = root.querySelectorAll('p')[10].firstChild;
  root.focus();
  getSelection().setBaseAndExtent(later, 2, later, 6);
  document.dispatchEvent(new Event('selectionchange'));
  await frame();
  const liveBounds = root.getBoundingClientRect(),
    frameBounds = document
      .querySelector(`[data-flow-frame="${root.dataset.sceneText}"]`)
      .getBoundingClientRect();
  assert(
    Number(root.dataset.projectedStart) > 0 &&
      Math.abs(liveBounds.x - frameBounds.x) < 1 &&
      Math.abs(liveBounds.y - frameBounds.y) < 1,
    'Continuation editing is not positioned directly in the selected page frame',
  );
  await nativeCommand('select-all');
  document.dispatchEvent(new Event('selectionchange'));
  const clipboard = new DataTransfer();
  root.dispatchEvent(
    new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }),
  );
  assert(
    clipboard.getData('text/plain').includes('Paragraph 0') &&
      clipboard.getData('text/plain').includes('Paragraph 34') &&
      !clipboard.getData('text/html').includes('data-flow-input'),
    'Copy across page frames skipped hidden text or leaked projection markers',
  );

  await nativeCommand('undo');
  assert(root.textContent === 'Initial textFlow.', 'TextFlow typing did not share document undo');
  assert(
    document.querySelectorAll('.canvas-page').length === 1,
    'TextFlow undo left generated pages',
  );
  await nativeCommand('redo');
  assert(
    root.textContent.includes('Paragraph 34') &&
      document.querySelectorAll('.canvas-page').length === pages,
    'TextFlow redo did not restore source and pagination together',
  );
  // A cross-frame selection remains anchored in its first physical column.
  // Removing later automatic frames must preserve canonical input ownership.
  await nativeCommand('select-all');
  document.dispatchEvent(new Event('selectionchange'));
  const short = 'Native flow edit.';
  for (const character of short) {
    root.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: character }),
    );
    document.execCommand('insertText', false, character);
  }
  assert(
    root === initialNode && root.textContent === short,
    'Incremental replacement lost the live source',
  );
  assert(
    document.querySelectorAll('.canvas-page').length === 1 &&
      document.querySelector(`[data-flow-frame="${root.dataset.sceneText}"]`),
    'Shrinking textFlow retained the deleted frame owner',
  );
  assert(
    document.querySelector('[data-flow-frame]').textContent === short,
    'Preview lost text after automatic frame removal',
  );
  await nativeCommand('undo');
  assert(
    root.textContent.includes('Paragraph 34') &&
      document.querySelectorAll('.canvas-page').length === pages,
    'One textFlow undo did not restore incremental replacement and pages',
  );
  await nativeCommand('redo');
  assert(
    root.textContent === short && document.querySelector('[data-flow-frame]').textContent === short,
    'Incremental textFlow redo lost canonical text',
  );
  await nativeCommand('undo');
  await nativeCommand('select-all');
  document.dispatchEvent(new Event('selectionchange'));
  root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  root.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: '編集中',
    }),
  );
  document.execCommand('insertText', false, '編集中');
  root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '編集中' }));
  assert(
    root.textContent === '編集中' &&
      document.querySelectorAll('.canvas-page').length === 1 &&
      document.querySelector('[data-flow-frame]').textContent === '編集中',
    'Composition lost stable textFlow ownership during shrink: ' +
      JSON.stringify({
        pages: document.querySelectorAll('.canvas-page').length,
        source: root.textContent.slice(0, 120),
        ink: document.querySelector('[data-flow-frame]').textContent.slice(0, 120),
        projected: root.dataset.projectedStart,
      }),
  );
  await nativeCommand('undo');
  assert(
    root.textContent.includes('Paragraph 34') &&
      document.querySelectorAll('.canvas-page').length === pages,
    'Composed textFlow replacement did not undo atomically',
  );
  // Character formatting remains scoped within the single canonical source.
  const strong = root.querySelector('strong'),
    selection = window.getSelection();
  root.focus();
  selection.setBaseAndExtent(strong.firstChild, 0, strong.firstChild, 4);
  document.dispatchEvent(new Event('selectionchange'));
  const field = document.querySelector('[data-object-prop="fontSize"]');
  field.value = '24';
  field.dispatchEvent(new Event('change', { bubbles: true }));
  assert(
    root.querySelector('[data-ivo-size="24"]')?.textContent === 'rich',
    'TextFlow selected-run formatting failed',
  );
  await nativeCommand('undo');
  assert(!root.querySelector('[data-ivo-size="24"]'), 'TextFlow formatting undo failed');
  const linked = root.querySelector('strong').firstChild;
  root.focus();
  selection.setBaseAndExtent(linked, 0, linked, 4);
  document.dispatchEvent(new Event('selectionchange'));
  const linking = nativeCommand('link');
  await wait(() => document.querySelector('#dialog').open);
  document.querySelector(`[data-link-to="${reference.id}"]`).click();
  await linking;
  assert(root.querySelector('a')?.textContent === 'rich', 'TextFlow selected-word link failed');
  await nativeCommand('undo');
  assert(!root.querySelector('a'), 'TextFlow link undo failed');
  await new Promise((resolve) => setTimeout(resolve, 350));
  const saved = docs.get(source.id);
  assert(
    saved.canvasVersion === 4 &&
      saved.textFlows[0].html.includes('Paragraph 34') &&
      saved.blocks.every((b) => !b.textFlowId || b.html === ''),
    'Canonical source did not save cleanly',
  );
  validateImport({ schemaVersion: 5, documents: [saved], assets: [] });
  await nativeCommand('new-layout');
  await wait(() => document.querySelector('[name="flow"]'));
  document.querySelector('[name="title"]').value = 'New long note';
  document.querySelector('[name="flow"]').checked = true;
  document.querySelector('#dialog button[type="submit"]').click();
  await wait(
    () =>
      document.title === 'New long note — Ivo' &&
      document.querySelector('.canvas-flow-input[contenteditable="true"]'),
  );
  assert(
    document.querySelector('.canvas-flow-input').textContent === '',
    'New flowing note inserted placeholder text',
  );
  const typography = getComputedStyle(document.querySelector('.canvas-flow-input'));
  assert(
    typography.fontSize === '12px' && typography.lineHeight === '14.4px',
    'New layout dialog lost the default type size or leading',
  );
  console.log(
    'IVO_TEXT_FLOW_APP_RESULT:' +
      JSON.stringify({
        ok: true,
        pages,
        continuousSource: true,
        liveNodeRetained: true,
        sourceAndPagesUndoRedo: true,
        incrementalShrink: true,
        compositionShrink: true,
        selectedRunFormatting: true,
        newlineFontInheritanceAfterModeSwitch: true,
        inheritedInsertionUndoRedo: true,
        canonicalSave: true,
        selectedWordLinkUndo: true,
        newFlowingDocument: true,
      }),
  );
} catch (error) {
  console.log(
    'IVO_TEXT_FLOW_APP_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
