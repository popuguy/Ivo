import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await tick();
    }
    throw new Error(
      'Daily-use application timeout: ' + document.querySelector('#app').textContent.slice(0, 500),
    );
  };
try {
  const a = createSceneDocument('Existing A'),
    b = createSceneDocument('Existing B');
  a.id = 'daily-a';
  b.id = 'daily-b';
  insertObject(a, 'text', a.pages[0].id, { html: '<p>Existing source A.</p>' });
  insertObject(b, 'text', b.pages[0].id, { html: '<p>Existing source B.</p>' });
  const docs = new Map([
      [a.id, a],
      [b.id, b],
    ]),
    meta = new Map([['initialized', true]]);
  let command, close;
  globalThis.ivoNative = {
    platform: 'macos',
    zoomFactor: () => 1,
    vaults: {
      info: async () => ({
        id: 'fixture',
        name: 'Daily test vault',
        directory: '/private/fixture',
      }),
      menu: async () => true,
    },
    onCommand: (callback) => (command = callback),
    onPrepareClose: (callback) => (close = callback),
    updateHistory: () => {},
    store: {
      loadDocuments: async () => structuredClone([...docs.values()]),
      loadAssets: async () => [],
      loadAsset: async () => null,
      saveAsset: async () => {},
      saveDocument: async (doc) => {
        validateImport({ schemaVersion: 5, documents: [doc], assets: [] });
        docs.set(doc.id, structuredClone(doc));
      },
      getMeta: async (key) =>
        meta.has(key) ? { id: key, value: structuredClone(meta.get(key)) } : null,
      putMeta: async (key, value) => meta.set(key, structuredClone(value)),
      saveImport: async () => {},
    },
  };
  await import('../../../src/app/main.js');
  await wait(() => document.querySelector('.canvas-world'));
  assert(!document.querySelector('.canvas-shortcuts'), 'Shortcut prose block remains');
  assert(
    document.querySelector('.vault-switcher').textContent.includes('Daily test vault'),
    'Vault name missing',
  );
  await command('new-document');
  await tick();
  let title = document.querySelector('[data-document-title]');
  assert(
    !document.querySelector('#dialog').open &&
      title.value === 'Untitled' &&
      document.activeElement === title &&
      title.selectionStart === 0 &&
      title.selectionEnd === 8,
    'Cmd N did not immediately create and select its title',
  );
  assert(
    document.querySelectorAll('[data-tab-id]').length === 2 && docs.size === 3,
    'New note did not get a new tab',
  );
  title.value = 'Daily fitting';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  title.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await wait(() => document.activeElement?.classList.contains('canvas-flow-input'));
  const source = document.activeElement;
  document.execCommand('insertText', false, 'Notes typed directly after naming.');
  await close();
  assert(
    [...docs.values()]
      .find((doc) => doc.title === 'Daily fitting')
      .textFlows[0].html.includes('Notes typed directly'),
    'Naming did not lead into saved body input',
  );
  const textNode = source.firstChild;
  window.getSelection().setBaseAndExtent(textNode, 0, textNode, 5);
  document.dispatchEvent(new Event('selectionchange'));
  document.querySelector('.canvas-viewport').dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -50,
      clientX: 500,
      clientY: 300,
    }),
  );
  await tick();
  const savedZoom = document.querySelector('.zoom-value').textContent;
  const selectedTab = document.querySelector('[data-tab-id][aria-selected=true]').dataset.tabId;
  await command('new-tab');
  assert(
    docs.size === 3 && document.querySelector('.empty-document-tab'),
    'Cmd T created a document',
  );
  const tabs = document.querySelectorAll('[data-tab-id]').length;
  await command('new-document');
  await tick();
  assert(
    document.querySelectorAll('[data-tab-id]').length === tabs,
    'Cmd N did not reuse empty tab',
  );
  assert(
    document.querySelector('[data-document-title]').value === 'Untitled',
    'Untitled name did not remain available after rename',
  );
  await command('new-document');
  await tick();
  assert(
    document.querySelector('[data-document-title]').value === 'Untitled 1',
    'Untitled collision suffix failed',
  );
  const size = docs.size;
  await command('close-tab');
  assert(
    docs.size === size && document.querySelector('[data-document-title]').value === 'Untitled',
    'Closing a tab deleted or renamed a note',
  );
  await command('reopen-tab');
  assert(
    document.querySelector('[data-document-title]').value === 'Untitled 1',
    'Reopen closed tab failed',
  );
  document.querySelector(`[data-tab-id="${selectedTab}"]`).click();
  await wait(() => document.querySelector('[data-document-title]')?.value === 'Daily fitting');
  await wait(() => document.querySelector('.canvas-flow-input[contenteditable=true]'));
  assert(
    document.querySelector('.canvas-flow-input').textContent ===
      'Notes typed directly after naming.',
    'Tab return lost source or editing ownership',
  );
  assert(
    window.getSelection().toString() === 'Notes' &&
      document.querySelector('.zoom-value').textContent === savedZoom,
    'Tab return lost caret selection or camera',
  );
  const before = document.querySelectorAll('[data-tab-id]').length;
  document
    .querySelector('[data-open="daily-b"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, cancelable: true }));
  await wait(() => document.querySelector('[data-document-title]')?.value === 'Existing B');
  assert(
    document.querySelectorAll('[data-tab-id]').length === before + 1,
    'Command-click did not open another document tab',
  );
  document.querySelector('[data-open="daily-a"]').click();
  await wait(() => document.querySelector('[data-document-title]')?.value === 'Existing A');
  assert(
    document.querySelectorAll('[data-tab-id]').length === before + 1,
    'Plain click accumulated another tab',
  );

  const pinnedId = document.querySelector('[data-tab-id][aria-selected=true]').dataset.tabId,
    pinnedButton = document.querySelector(`[data-tab-id="${pinnedId}"]`),
    pinnedCount = document.querySelectorAll('[data-tab-id]').length;
  pinnedButton.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 22 }),
  );
  assert(document.querySelector('.tab-context-menu'), 'Tab context menu missing');
  document.querySelector('[data-tab-option="pin"]').click();
  assert(
    document.querySelector(`[data-tab-id="${pinnedId}"]`).title.includes('pinned'),
    'Pin indicator missing',
  );
  document.querySelector('[data-open="daily-b"]').click();
  await wait(() => document.querySelector('[data-document-title]')?.value === 'Existing B');
  assert(
    document.querySelectorAll('[data-tab-id]').length === pinnedCount + 1 &&
      document.querySelector(`[data-tab-id="${pinnedId}"] span`).textContent === 'Existing A',
    'Pinned document was overwritten',
  );
  document.querySelector(`[data-tab-id="${selectedTab}"]`).click();
  await wait(() => document.querySelector('[data-document-title]')?.value === 'Daily fitting');
  await wait(() => document.querySelector('.canvas-flow-input[contenteditable=true]'));
  const retainedSource = document.querySelector('.canvas-flow-input'),
    retainedText = retainedSource.firstChild;
  retainedSource.focus();
  window.getSelection().setBaseAndExtent(retainedText, 0, retainedText, 5);
  document.dispatchEvent(new Event('selectionchange'));
  const geometryBeforeMenu = JSON.stringify(
    [...docs.values()].find((doc) => doc.title === 'Daily fitting').blocks,
  );
  document
    .querySelector(`[data-tab-id="${selectedTab}"]`)
    .dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 22 }),
    );
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  );
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await close();
  assert(
    JSON.stringify([...docs.values()].find((doc) => doc.title === 'Daily fitting').blocks) ===
      geometryBeforeMenu,
    'Tab menu arrow navigation nudged the selected page object',
  );
  retainedSource.focus();
  window.getSelection().setBaseAndExtent(retainedText, 0, retainedText, 5);
  document.dispatchEvent(new Event('selectionchange'));
  const order = () =>
      [...document.querySelectorAll('[data-tab-id]')].map((button) => button.dataset.tabId),
    pointer = (type, target, x, y) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 91,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
  let buttons = [...document.querySelectorAll('[data-tab-id]')],
    dragButton = buttons.find((button) => button.dataset.tabId === selectedTab),
    dragBox = dragButton.getBoundingClientRect(),
    firstBox = buttons[0].getBoundingClientRect();
  pointer('pointerdown', dragButton, dragBox.x + 20, dragBox.y + 10);
  pointer('pointermove', document.querySelector('#app'), firstBox.x + 2, firstBox.y + 10);
  pointer('pointerup', document.querySelector('#app'), firstBox.x + 2, firstBox.y + 10);
  await tick();
  assert(
    order()[0] === selectedTab && !document.querySelector('.tab-drag-ghost'),
    'Pointer tab reorder did not complete',
  );
  assert(
    retainedSource === document.querySelector('.canvas-flow-input') &&
      window.getSelection().toString() === 'Notes' &&
      document.querySelector('.zoom-value').textContent === savedZoom,
    'Tab reorder replaced source, selection or camera',
  );
  const beforeCancel = order().join('|');
  buttons = [...document.querySelectorAll('[data-tab-id]')];
  dragButton = buttons[0];
  dragBox = dragButton.getBoundingClientRect();
  const lastBox = buttons.at(-1).getBoundingClientRect();
  pointer('pointerdown', dragButton, dragBox.x + 20, dragBox.y + 10);
  pointer('pointermove', document.querySelector('#app'), lastBox.right - 2, lastBox.y + 10);
  dragButton.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert(
    order().join('|') === beforeCancel && !document.querySelector('.tab-drag-ghost'),
    'Escape did not roll back tab order',
  );
  const keyboardTab = document.querySelector(`[data-tab-id="${selectedTab}"]`);
  keyboardTab.focus();
  keyboardTab.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(
    order()[1] === selectedTab && document.activeElement.dataset.tabId === selectedTab,
    'Keyboard tab reordering failed',
  );
  await close();
  const saved = meta.get('workspace:1');
  assert(
    saved.tabs.length === before + 2 &&
      saved.tabs.some(
        (tab) => tab.docId === [...docs.values()].find((doc) => doc.title === 'Daily fitting').id,
      ),
    'Workspace did not persist document tabs',
  );
  assert(
    saved.tabs.some((tab) => tab.id === pinnedId && tab.pinned) && saved.tabs[1].id === selectedTab,
    'Pinned/order view metadata did not persist',
  );
  assert(
    !JSON.stringify(saved).includes('Notes typed directly'),
    'Workspace duplicated authored text',
  );
  assert(
    docs.get(a.id).blocks[0].html === '<p>Existing source A.</p>' &&
      docs.get(b.id).blocks[0].html === '<p>Existing source B.</p>',
    'Navigation changed existing source',
  );
  console.log(
    'IVO_DAILY_RESULT:' +
      JSON.stringify({
        ok: true,
        immediateCreation: true,
        selectedTitle: true,
        titleToBody: true,
        emptyTabReuse: true,
        uniqueUntitledNames: true,
        closeAndReopen: true,
        modifierOpening: true,
        sourceAndEditStateRetained: true,
        selectionAndCameraRetained: true,
        workspacePersisted: true,
        shortcutBlockRemoved: true,
        tabPinning: true,
        pinnedNavigationProtected: true,
        pointerAndKeyboardTabReordering: true,
        tabDragCancellation: true,
      }),
  );
} catch (error) {
  console.log('IVO_DAILY_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
