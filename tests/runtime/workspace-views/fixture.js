import { createIndexedDBStore } from '../../../src/storage/indexeddb.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import {
  createWorkspace,
  replaceTab,
  addTab,
  normalizeWorkspace,
} from '../../../src/domain/workspace/state.js';
import { startApplication } from '../../../src/app/application.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function wait(predicate, label) {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(label + ': ' + document.querySelector('#toast').textContent);
}
const backend = createIndexedDBStore(),
  choices = [];
let nativeCommand,
  writes = 0,
  failWorkspace = false,
  receive,
  prepareClose;
const a = createSceneDocument('Alpha'),
  b = createSceneDocument('Beta');
a.id = 'views-alpha';
b.id = 'views-beta';
for (const doc of [a, b])
  startTextFlow(
    doc,
    insertObject(doc, 'text', doc.pages[0].id, {
      x: 48.125,
      y: 48,
      w: 480,
      h: 500,
      html:
        '<p>' +
        doc.title +
        ' <strong>retained source</strong>.</p><p><br></p>' +
        (doc === b ? '<p><a href="#doc=views-alpha" data-doc-id="views-alpha">Alpha</a></p>' : ''),
    }).id,
  );
await backend.saveImport({ schemaVersion: 5, documents: [a, b], assets: [] });
const original = JSON.stringify(await backend.loadDocuments()),
  workspace = createWorkspace(),
  first = replaceTab(workspace, 'document', a.id, true),
  second = addTab(workspace, { kind: 'document', docId: b.id });
await backend.putMeta('workspace:1', workspace);
globalThis.ivoNative = {
  platform: 'macos',
  store: {
    ...backend,
    saveDocument: async (doc) => {
      writes++;
      return backend.saveDocument(doc);
    },
    putMeta: async (key, value) => {
      if (failWorkspace && key === 'workspace:1') throw new Error('Test layout failure');
      return backend.putMeta(key, value);
    },
  },
  vaults: { info: async () => ({ id: 'views-vault', name: 'Views', manager: false }) },
  windows: {
    info: async () => ({ windowId: 'views-main', active: true, main: true }),
    ready: async () => true,
  },
  onCommand: (callback) => {
    nativeCommand = callback;
  },
  onTabTransfer: (callback) => {
    receive = callback;
  },
  onPrepareClose: (callback) => {
    prepareClose = callback;
  },
  showNavigationMenu: async () => choices.shift() || null,
  updateHistory() {},
};
const tab = (id) => document.querySelector('[data-tab-id="' + id + '"]'),
  view = (id) => document.querySelector('[data-workspace-tab="' + id + '"]');
async function context(element, action) {
  assert(element, 'Missing context owner: ' + action);
  choices.push(action);
  element.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 20 }),
  );
  await tick();
}
function pointer(target, type, x, y) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 77,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}
async function panelMenu(element, action) {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + 10,
      clientY: rect.y + 10,
    }),
  );
  await tick();
  const button = document.querySelector('[data-workspace-action="' + action + '"]');
  assert(button, 'Missing panel action ' + action);
  button.click();
  await tick();
}
try {
  await startApplication({
    workspaceFeatures: { stackedTabs: true, savedLayouts: true },
    root: document.querySelector('#app'),
    dialog: document.querySelector('#dialog'),
  });
  await wait(() => view(second.id), 'Initial view');
  await context(tab(second.id), 'toggle-stack');
  await wait(() => document.querySelectorAll('.workspace-view').length === 2, 'Stacked views');
  const alphaNode = view(first.id),
    betaNode = view(second.id),
    betaWorld = betaNode.querySelector('.canvas-world');
  alphaNode
    .querySelector('.canvas-viewport')
    .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  await tick();
  assert(tab(first.id).ariaSelected === 'true', 'Stacked card pointer failed to select owning tab');
  assert(
    view(second.id) === betaNode && view(first.id) === alphaNode,
    'Stacked activation replaced views',
  );
  for (const keys of [
    { metaKey: true, key: '∑' },
    { ctrlKey: true, key: 'w' },
  ]) {
    const count = document.querySelectorAll('[data-tab-id]').length;
    alphaNode.querySelector('.canvas-viewport').dispatchEvent(
      new KeyboardEvent('keydown', {
        ...keys,
        code: 'KeyW',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(
      () => alphaNode.querySelector('[data-canvas-panel="text-wrap"]').ariaSelected === 'true',
      'Text Wrap shortcut',
    );
    assert(
      document.querySelectorAll('[data-tab-id]').length === count,
      'Text Wrap shortcut closed a document tab',
    );
    await panelMenu(alphaNode.querySelector('[data-canvas-panel="text-wrap"]'), 'close-panel');
  }
  await context(tab(first.id), 'linked-backlinks');
  await wait(() => document.querySelector('.linked-backlinks'), 'Linked backlinks');
  assert(
    document.querySelector('.linked-backlinks').textContent.includes('Beta'),
    'Backlinks absent',
  );
  const linkedId = document.querySelector(
    '.workspace-pane.active [data-tab-id][aria-selected=true]',
  ).dataset.tabId;
  // Navigate the source tab to a different document and back; linked view follows its identity.
  tab(first.id).click();
  await tick();
  document.querySelector('#document-list [data-open="' + b.id + '"]').click();
  await tick();
  await wait(
    () => document.querySelector('.linked-backlinks h2')?.textContent === 'Beta',
    'Linked view did not follow source navigation',
  );
  assert(
    view(second.id) === betaNode && betaNode.querySelector('.canvas-world') === betaWorld,
    'Source navigation disturbed a neighboring stacked editor',
  );
  assert(
    document.querySelector('.linked-backlinks').textContent.includes('No backlinks found.'),
    'Linked backlinks retained stale links',
  );
  document.querySelector('.workspace-view.active [data-action="go-back"]').click();
  await tick();
  await wait(
    () => document.querySelector('.linked-backlinks h2')?.textContent === 'Alpha',
    'Linked view did not follow history',
  );
  // Context groups keep editor and source nodes alive across independent floating and regrouping.
  const owner = view(first.id),
    source = owner.querySelector('.canvas-flow-input'),
    world = owner.querySelector('.canvas-world'),
    pages = owner.querySelector('[data-canvas-panel="pages"]');
  await panelMenu(pages, 'detach');
  assert(owner.querySelectorAll('[data-context-group]').length === 2, 'Panel tab did not detach');
  const float = pages.closest('[data-context-group]');
  assert(float.dataset.floating === 'true', 'Detached panel did not float');
  assert(
    owner.querySelector('.canvas-world') === world &&
      owner.querySelector('.canvas-flow-input') === source,
    'Panel grouping replaced document DOM',
  );
  const main = owner
    .querySelector('[data-canvas-panel="properties"]')
    .closest('[data-context-group]');
  await panelMenu(pages, 'join/' + main.dataset.contextGroup);
  assert(owner.querySelectorAll('[data-context-group]').length === 1, 'Panel tab did not regroup');
  await panelMenu(owner.querySelector('.canvas-panel-microbar'), 'layout');
  assert(
    owner.querySelectorAll('.canvas-panel-dock > [data-context-group]').length === 2,
    'Layout preset did not create dock stack',
  );
  assert(
    betaNode.querySelectorAll('.canvas-panel-dock > [data-context-group]').length === 2,
    'Panel layout failed to propagate to retained neighboring view',
  );
  await panelMenu(owner.querySelector('.canvas-panel-microbar'), 'save-preset');
  const form = document.querySelector('.workspace-panel-preset-form');
  form.elements.namedItem('preset-name').value = 'Design panels';
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await tick();
  const catalog = JSON.parse(localStorage.getItem('ivo:panel-presets:1:views-vault'));
  assert(catalog.presets[0].name === 'Design panels', 'Named panel preset was not saved');
  await panelMenu(owner.querySelector('.canvas-panel-microbar'), 'compact');
  assert(owner.querySelectorAll('[data-context-group]').length === 1, 'Compact preset failed');
  await panelMenu(owner.querySelector('.canvas-panel-microbar'), 'preset/' + catalog.presets[0].id);
  assert(
    owner.querySelectorAll('[data-context-group]').length === 2,
    'Named panel preset did not restore',
  );
  await nativeCommand('show-panel-properties');
  await tick();
  if (new URL(location.href).searchParams.has('capture')) {
    console.log('IVO_WORKSPACE_VIEWS_PANELS');
    await wait(() => globalThis.ivoWorkspacePanelsCaptured, 'Panel capture');
  }
  const dragTab = owner.querySelector('[data-canvas-panel="links"]'),
    rect = dragTab.getBoundingClientRect();
  pointer(dragTab, 'pointerdown', rect.x + 10, rect.y + 10);
  pointer(window, 'pointermove', 600, 180);
  pointer(window, 'pointerup', 600, 180);
  await tick();
  assert(
    dragTab.closest('[data-context-group]').dataset.floating === 'true',
    'Pointer panel tear-off failed',
  );
  const stable = JSON.stringify(owner.querySelectorAll('[data-context-group]').length);
  const bar = dragTab.closest('[data-context-group]').querySelector('.canvas-panel-microbar'),
    barRect = bar.getBoundingClientRect();
  pointer(bar, 'pointerdown', barRect.x + 20, barRect.y + 5);
  pointer(window, 'pointermove', barRect.x - 40, barRect.y + 50);
  bar.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await tick();
  assert(
    JSON.stringify(owner.querySelectorAll('[data-context-group]').length) === stable,
    'Panel cancellation changed partition',
  );
  // The same receiver used by native IPC rejects bad layouts without removing existing views.
  const strip = owner
      .closest('[data-workspace-group]')
      .querySelector('.document-tabs')
      .getBoundingClientRect(),
    drop = { x: strip.right - 50, y: strip.top + 15 };
  assert(await receive({ phase: 'probe', drop }), 'Existing-window tab strip declined');
  assert(
    !(await receive({ phase: 'probe', drop: { x: 5, y: 300 } })),
    'Non-tab area accepted a transfer',
  );
  const incoming = {
    id: first.id,
    kind: 'document',
    docId: a.id,
    editing: false,
    pinned: true,
    canvasState: { camera: { x: 22.25, y: 10, zoom: 0.55 }, tool: 'select' },
  };
  failWorkspace = true;
  let refused = false;
  try {
    refused = (await receive({ phase: 'receive', drop, tab: incoming })) === false;
  } catch {
    refused = true;
  }
  assert(
    refused && view(first.id)?.querySelector('.canvas-world') === world,
    'Failed incoming view disturbed source session',
  );
  failWorkspace = false;
  assert(await receive({ phase: 'receive', drop, tab: incoming }), 'Incoming view failed');
  await tick();
  assert(await prepareClose(), 'View state flush failed');
  const saved = normalizeWorkspace((await backend.getMeta('workspace:1')).value, [a, b]);
  assert(
    saved.tabs.length === 4 && new Set(saved.tabs.map((tab) => tab.id)).size === 4,
    'Incoming view identity collided',
  );
  const received = saved.tabs.find((tab) => tab.pinned);
  assert(
    received.id !== first.id && received.canvasState.camera.zoom === 0.55,
    'Incoming camera or pin changed',
  );
  assert(
    saved.tabs.find((tab) => tab.id === linkedId).linkedTo === first.id,
    'Transfer lost existing linked view',
  );
  assert(
    saved.groups.some((group) => group.stacked),
    'Stacked mode did not persist',
  );
  assert(
    JSON.stringify(await backend.loadDocuments()) === original && writes === 0,
    'Workspace operations changed authored source',
  );
  tab(first.id).click();
  await tick();
  await nativeCommand('document-text');
  await wait(
    () => view(first.id).querySelector('.canvas-flow-input')?.isContentEditable,
    'Stacked text editing',
  );
  const editable = view(first.id).querySelector('.canvas-flow-input');
  editable.focus();
  editable.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  betaNode.querySelector('.canvas-viewport').dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 80,
      button: 0,
    }),
  );
  assert(
    tab(first.id).ariaSelected === 'true',
    'Composition lost ownership to another stacked view',
  );
  editable.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
  await wait(
    () => tab(second.id).ariaSelected === 'true',
    'Deferred stacked activation after composition',
  );
  tab(first.id).click();
  await wait(() => tab(first.id).ariaSelected === 'true', 'Return to stacked editor');
  await nativeCommand('document-text');
  await tick();
  const betaSource = JSON.stringify(
    (await backend.loadDocuments()).find((doc) => doc.id === b.id).textFlows,
  );
  editable.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, 'Stacked editing retains a single source.');
  await tick();
  assert(
    editable.textContent.includes('Stacked editing retains'),
    'Stacked text input was ignored',
  );
  await nativeCommand('undo');
  await tick();
  assert(
    !editable.textContent.includes('Stacked editing retains') &&
      editable.textContent.includes('retained source'),
    'Stacked text undo failed',
  );
  assert(await prepareClose(), 'Stacked edit/undo flush failed');
  assert(
    JSON.stringify((await backend.loadDocuments()).find((doc) => doc.id === b.id).textFlows) ===
      betaSource && betaNode.querySelector('.canvas-world') === betaWorld,
    'Stacked text input modified neighboring document/view',
  );
  // A retained editor moved to another group must resolve its current owner for links.
  const movedTab = tab(second.id),
    start = movedTab.getBoundingClientRect(),
    destination = [...document.querySelectorAll('.document-tabs')].find(
      (bar) => !bar.closest('[data-workspace-group]').contains(movedTab),
    ),
    target = destination.getBoundingClientRect();
  pointer(movedTab, 'pointerdown', start.x + 20, start.y + 15);
  pointer(window, 'pointermove', target.x + 60, target.y + 15);
  pointer(window, 'pointerup', target.x + 60, target.y + 15);
  await wait(
    () =>
      view(second.id)?.closest('[data-workspace-group]') ===
      destination.closest('[data-workspace-group]'),
    'Retained view cross-group transfer',
  );
  assert(
    view(second.id) === betaNode && betaNode.querySelector('.canvas-world') === betaWorld,
    'Group transfer rebuilt retained view',
  );
  const link = betaNode.querySelector('[data-doc-id="views-alpha"]');
  assert(link, 'Missing moved-view document link');
  link.click();
  await wait(
    () => view(second.id)?.querySelector('[data-document-title]')?.value === 'Alpha',
    'Moved view used its previous group for link navigation',
  );
  assert(
    document.querySelector('.workspace-pane.active') ===
      destination.closest('[data-workspace-group]') &&
      view(first.id).querySelector('.canvas-flow-input') === editable,
    'Moved link activated or replaced the previous group',
  );
  if (new URL(location.href).searchParams.has('capture')) {
    console.log('IVO_WORKSPACE_VIEWS_CAPTURE');
    await wait(() => globalThis.ivoWorkspaceViewsCaptured, 'Capture');
  }
  console.log(
    'IVO_WORKSPACE_VIEWS_RESULT:' +
      JSON.stringify({
        ok: true,
        stackedRetainedViews: true,
        stackInputOwnership: true,
        stackedTextCompositionAndUndo: true,
        movedViewLinkOwnership: true,
        linkedBacklinksAndHistory: true,
        independentPanels: true,
        tabRegrouping: true,
        dockStackPresets: true,
        panelPointerTearoffAndCancellation: true,
        existingWindowReceiver: true,
        failedTransferRetainsSource: true,
        uniqueIncomingIdentityAndCamera: true,
        workspacePersistence: true,
        sourceUnchanged: true,
      }),
  );
} catch (error) {
  console.log(
    'IVO_WORKSPACE_VIEWS_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
