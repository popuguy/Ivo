import { startApplication } from '../../../src/app/application.js';
import { createIndexedDBStore } from '../../../src/storage/indexeddb.js';
import { createWorkspacePreferences } from '../../../src/storage/workspace-preferences.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { createWorkspace, replaceTab, addTab } from '../../../src/domain/workspace/state.js';
import { layoutSnapshot } from '../../../src/domain/workspace/layouts.js';
const report = (value) => console.log('IVO_PAUSED_WORKSPACE_RESULT:' + JSON.stringify(value)),
  assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
window.addEventListener('error', (e) => report({ error: e.error?.stack || e.message }));
window.addEventListener('unhandledrejection', (e) =>
  report({ error: String(e.reason?.stack || e.reason) }),
);
try {
  const backend = createIndexedDBStore(),
    prefs = createWorkspacePreferences({ vaultId: 'paused-vault', windowId: 'main' }),
    catalogKey = 'ivo:workspace-layouts:1:paused-vault',
    reloaded = new URL(location.href).searchParams.has('reloaded');
  if (!reloaded) {
    const docs = ['One', 'Two'].map((title) => {
        const doc = createSceneDocument(title);
        doc.id = 'paused-' + title.toLowerCase();
        insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Preserved ' + title + '</p>' });
        return doc;
      }),
      workspace = createWorkspace();
    replaceTab(workspace, 'document', docs[0].id, true);
    addTab(workspace, { kind: 'document', docId: docs[1].id });
    workspace.groups[0].stacked = true;
    await backend.saveImport({ schemaVersion: 5, documents: docs, assets: [] });
    await backend.putMeta('workspace:1', workspace);
    prefs.save('Retained layout', layoutSnapshot(workspace, {}));
    sessionStorage.setItem('paused-catalog', localStorage.getItem(catalogKey));
    sessionStorage.setItem('paused-source', JSON.stringify(await backend.loadDocuments()));
  }
  let nativeCommand,
    prepareClose,
    menu,
    writes = 0;
  globalThis.ivoNative = {
    platform: 'macos',
    store: {
      ...backend,
      saveDocument: async (doc) => {
        writes++;
        return backend.saveDocument(doc);
      },
    },
    vaults: { info: async () => ({ id: 'paused-vault', name: 'Paused features', manager: false }) },
    windows: {
      info: async () => ({ windowId: 'main', active: true, main: true }),
      ready: async () => true,
    },
    onCommand: (callback) => {
      nativeCommand = callback;
    },
    onPrepareClose: (callback) => {
      prepareClose = callback;
    },
    showNavigationMenu: async (items) => {
      menu = items;
      return null;
    },
    updateHistory() {},
  };
  await startApplication({
    root: document.querySelector('#app'),
    dialog: document.querySelector('#dialog'),
  });
  await tick();
  const panes = () => [...document.querySelectorAll('.workspace-pane')],
    buttons = () => [...document.querySelectorAll('[data-tab-id]')],
    check = () => {
      assert(!document.querySelector('.tabs-stacked'), 'A saved stack reopened in stacked mode');
      for (const pane of panes()) {
        assert(
          pane.querySelectorAll('.workspace-view').length === 1,
          'Paused stack mounted inactive views',
        );
        const selected = pane.querySelector('[data-tab-id][aria-selected=true]');
        assert(
          pane.querySelector('.workspace-pane-content').id ===
            selected.getAttribute('aria-controls'),
          'Ordinary-tab accessibility ownership is broken',
        );
      }
      assert(
        localStorage.getItem(catalogKey) === sessionStorage.getItem('paused-catalog'),
        'Saved layouts were rewritten or deleted',
      );
    };
  check();
  if (!reloaded) {
    assert(buttons().length === 2, 'Saved tabs were lost');
    buttons()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await tick();
    assert(
      menu?.length && !menu.some((item) => item.id === 'toggle-stack'),
      'Stack tabs remains in the tab menu',
    );
    document.querySelector('[data-action=view-options]').click();
    await tick();
    assert(
      menu?.some((item) => item.id === 'split-right'),
      'Normal view menu is missing',
    );
    assert(
      !menu.some((item) => ['workspaces', 'restore-workspace', 'toggle-stack'].includes(item.id)),
      'Paused actions remain in view options',
    );
    for (const command of ['workspaces', 'restore-workspace', 'toggle-stack'])
      await nativeCommand(command);
    assert(
      !document.querySelector('#dialog').open,
      'Stale native command opened a removed feature',
    );
    buttons()[0].click();
    await tick();
    check();
    await nativeCommand('split-right');
    await tick();
    assert(panes().length === 2, 'Ordinary split navigation was removed');
  }
  check();
  assert(await prepareClose(), 'Ordinary workspace save failed');
  const saved = (await backend.getMeta('workspace:1')).value;
  assert(
    saved.groups.some((group) => group.stacked),
    'Paused stacked metadata was erased',
  );
  assert(
    JSON.stringify(await backend.loadDocuments()) === sessionStorage.getItem('paused-source') &&
      writes === 0,
    'UI retirement changed authored content',
  );
  assert(
    prefs.catalog().layouts[0].name === 'Retained layout',
    'Retained layout cannot be restored by a future build',
  );
  if (!reloaded) location.search = '?reloaded=1';
  else
    report({
      ok: true,
      pausedActionsAbsent: true,
      legacyStackRendersOrdinaryTabs: true,
      tabsAndSplitsWork: true,
      savedLayoutBytesPreserved: true,
      reloadPreservesMetadataAndContent: true,
    });
} catch (error) {
  report({ error: error.stack || String(error) });
}
