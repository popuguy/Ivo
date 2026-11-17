import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  replaceTab,
  splitGroup,
  activeTab,
} from '../../src/domain/workspace/state.js';
import {
  layoutSnapshot,
  normalizeLayoutCatalog,
  saveLayout,
  renameLayout,
  removeLayout,
} from '../../src/domain/workspace/layouts.js';
import { normalizeChrome, sidebarWidth } from '../../src/domain/workspace/chrome.js';
import { adjacentPane } from '../../src/domain/workspace/spatial.js';
import { createWorkspacePreferences } from '../../src/storage/workspace-preferences.js';
import { createWorkspaceManager } from '../../src/app/workspace-manager.js';
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
function fixture() {
  const workspace = createWorkspace();
  replaceTab(workspace, 'document', 'alpha', true);
  const first = workspace.groups[0].id;
  splitGroup(workspace);
  replaceTab(workspace, 'document', 'beta');
  const right = workspace.groups[1].id;
  splitGroup(workspace, 'column');
  replaceTab(workspace, 'graph', 'beta');
  return { workspace, first, right, bottom: workspace.groups[2].id };
}
test('named layouts retain independent view geometry and discard authored/input/history payloads', () => {
  const { workspace } = fixture();
  activeTab(workspace).graphState = { center: { x: 4, y: 5 }, scale: 2 };
  workspace.tabs[0].canvasState = {
    camera: { x: 12.5, y: -8, zoom: 1.25 },
    activeTextId: 'frame',
    selection: ['frame'],
  };
  workspace.tabs[0].html = 'secret';
  workspace.tabs[0].textView = { html: 'secret', selection: {} };
  workspace.tabs[0].navigation = {
    back: [{ kind: 'document', docId: 'alpha', source: 'secret' }],
    forward: [],
  };
  const before = structuredClone(workspace),
    snapshot = layoutSnapshot(workspace, {
      sidebarWidth: 318,
      query: 'silk',
      collapsedFolders: ['Research'],
    });
  assert.deepEqual(workspace, before);
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
  assert.equal(snapshot.workspace.tabs[0].canvasState.activeTextId, undefined);
  assert.equal(snapshot.workspace.tabs[0].navigation, undefined);
  const saved = saveLayout(undefined, 'Research', snapshot);
  const loaded = normalizeLayoutCatalog(saved, [{ id: 'alpha' }]);
  assert.equal(
    loaded.layouts[0].workspace.tabs.some((tab) => tab.docId === 'beta' && tab.kind === 'document'),
    false,
  );
  assert.equal(loaded.layouts[0].chrome.sidebarWidth, 318);
  loaded.layouts[0].workspace.tabs[0].canvasState.camera.x = 200;
  assert.equal(saved.layouts[0].workspace.tabs[0].canvasState.camera.x, 12.5);
  assert.equal(renameLayout(saved, saved.layouts[0].id, 'Studio').layouts[0].name, 'Studio');
  assert.equal(removeLayout(saved, saved.layouts[0].id).layouts.length, 0);
  assert.throws(() => saveLayout(saved, 'research', snapshot), /already exists/);
  assert.throws(() => renameLayout(saved, 'missing', 'Other'), /no longer exists/);
  assert.throws(() => normalizeLayoutCatalog({ version: 2, layouts: [] }), /Unsupported/);
});
test('device preferences separate vaults/windows and operate on the latest saved catalog', () => {
  const storage = memory(),
    a = createWorkspacePreferences({ storage, vaultId: 'A', windowId: 'main' }),
    peer = createWorkspacePreferences({ storage, vaultId: 'A', windowId: 'satellite' }),
    b = createWorkspacePreferences({ storage, vaultId: 'B' }),
    snapshot = layoutSnapshot(createWorkspace(), {});
  a.save('One', snapshot);
  peer.save('Two', snapshot);
  assert.equal(a.catalog().layouts.length, 2);
  assert.equal(b.catalog().layouts.length, 0);
  a.writeChrome({ sidebarWidth: 400 });
  peer.writeChrome({ sidebarWidth: 280 });
  assert.equal(a.readChrome().sidebarWidth, 400);
  assert.equal(peer.readChrome().sidebarWidth, 280);
  const saved = [...storage.values.values()];
  storage.setItem = () => {
    throw new Error('quota');
  };
  assert.throws(() => a.save('Three', snapshot), /quota/);
  assert.deepEqual([...storage.values.values()], saved);
});
test('workspace restore waits for a successful flush and preserves a previous layout without changing documents', async () => {
  const storage = memory(),
    preferences = createWorkspacePreferences({ storage }),
    docs = [{ id: 'alpha' }];
  let workspace = createWorkspace(),
    flushAllowed = true,
    applications = 0;
  replaceTab(workspace, 'document', 'alpha', true);
  preferences.save('Saved', layoutSnapshot(workspace, { sidebarWidth: 350 }, docs));
  workspace = createWorkspace();
  const manager = createWorkspaceManager({
    preferences: () => preferences,
    getWorkspace: () => workspace,
    getChrome: () => ({ sidebarWidth: 240 }),
    getDocuments: () => docs,
    capture: () => {},
    flush: async () => flushAllowed,
    apply: async (saved) => {
      applications++;
      workspace = saved.workspace;
    },
  });
  const original = structuredClone(workspace);
  flushAllowed = false;
  assert.equal(await manager.load(preferences.catalog().layouts[0].id), false);
  assert.deepEqual(workspace, original);
  assert.equal(applications, 0);
  flushAllowed = true;
  assert.equal(await manager.load(preferences.catalog().layouts[0].id), true);
  assert.equal(activeTab(workspace).docId, 'alpha');
  assert.equal(manager.canRestorePrevious, true);
  await manager.restorePrevious();
  assert.deepEqual(workspace, original);
  assert.deepEqual(docs, [{ id: 'alpha' }]);
});
test('sidebar bounds support both a desktop track and a usable small-screen overlay', () => {
  assert.equal(sidebarWidth(520, 800), 436);
  assert.equal(sidebarWidth(240, 390), 240);
  assert.equal(sidebarWidth(520, 390), 346);
  assert.equal(sidebarWidth(240, 40), 0);
  assert.equal(normalizeChrome(null).sidebarWidth, 240);
  const chrome = normalizeChrome({
    sidebarWidth: Infinity,
    collapsedFolders: ['valid', '../bad'],
    sidebarMode: 'unknown',
  });
  assert.equal(chrome.sidebarWidth, 240);
  assert.deepEqual(chrome.collapsedFolders, ['valid']);
  assert.equal(chrome.sidebarMode, 'files');
});
test('directional focus follows adjacent split geometry without cycling at outer edges', () => {
  const { workspace, first, right, bottom } = fixture();
  assert.equal(adjacentPane(workspace, first, 'right'), right);
  assert.equal(adjacentPane(workspace, right, 'down'), bottom);
  assert.equal(adjacentPane(workspace, bottom, 'up'), right);
  assert.equal(adjacentPane(workspace, bottom, 'left'), first);
  assert.equal(adjacentPane(workspace, first, 'left'), null);
  assert.equal(adjacentPane(workspace, right, 'up'), null);
});

test('a dismissed workspace request cannot apply after its source flush completes', async () => {
  const preferences = createWorkspacePreferences({ storage: memory() }),
    workspace = createWorkspace();
  preferences.save('Saved', layoutSnapshot(workspace, {}));
  let release,
    open = true,
    applied = 0;
  const manager = createWorkspaceManager({
    preferences: () => preferences,
    getWorkspace: () => workspace,
    getChrome: () => ({}),
    getDocuments: () => [],
    capture: () => {},
    flush: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    apply: async () => {
      applied++;
    },
  });
  const pending = manager.load(preferences.catalog().layouts[0].id, { isCurrent: () => open });
  open = false;
  release(true);
  assert.equal(await pending, false);
  assert.equal(applied, 0);
});
