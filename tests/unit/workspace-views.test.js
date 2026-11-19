import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  replaceTab,
  addTab,
  normalizeWorkspace,
  syncLinkedViews,
  closeTab,
  activateTab,
  navigateHistory,
} from '../../src/domain/workspace/state.js';
import { receiveTab } from '../../src/domain/workspace/transfer.js';
import {
  defaultPanels,
  normalizePanels,
  movePanel,
  panelPreset,
} from '../../src/domain/workspace/panels.js';
import { layoutSnapshot } from '../../src/domain/workspace/layouts.js';

test('linked graph/backlinks follow stable source tabs through navigation and freeze on source close', () => {
  const workspace = createWorkspace(),
    source = replaceTab(workspace, 'document', 'a'),
    graph = addTab(workspace, { kind: 'graph', docId: 'a' });
  graph.linkedTo = source.id;
  const backlinks = addTab(workspace, { kind: 'backlinks', docId: 'a' });
  backlinks.linkedTo = source.id;
  activateTab(workspace, source.id);
  replaceTab(workspace, 'document', 'b');
  syncLinkedViews(workspace);
  assert.equal(graph.docId, 'b');
  assert.equal(backlinks.docId, 'b');
  navigateHistory(workspace, 'back');
  syncLinkedViews(workspace);
  assert.equal(graph.docId, 'a');
  replaceTab(workspace, 'empty');
  syncLinkedViews(workspace);
  assert.equal(graph.docId, null);
  navigateHistory(workspace, 'back');
  syncLinkedViews(workspace);
  closeTab(workspace, source.id);
  syncLinkedViews(workspace);
  assert.equal(graph.docId, 'a');
  assert.equal(graph.linkedTo, undefined);
  assert.equal(graph.graphScope, 'local');
});
test('stacked group and bounded auxiliary links round-trip without accepting cycles or payloads', () => {
  const workspace = createWorkspace(),
    source = replaceTab(workspace, 'document', 'a'),
    graph = addTab(workspace, { kind: 'graph', docId: 'a' });
  graph.linkedTo = source.id;
  graph.source = { forbidden: true };
  workspace.groups[0].stacked = true;
  const restored = normalizeWorkspace(workspace, [{ id: 'a' }]);
  assert.equal(restored.groups[0].stacked, true);
  assert.equal(restored.tabs[1].linkedTo, source.id);
  assert.equal(restored.tabs[1].source, undefined);
  workspace.tabs[0].linkedTo = graph.id;
  workspace.tabs[0].kind = 'graph';
  assert.ok(normalizeWorkspace(workspace).tabs.every((tab) => !tab.linkedTo));
});
test('incoming window views receive unique local IDs and retain geometry/pin without input or source', () => {
  const workspace = createWorkspace(),
    tab = replaceTab(workspace, 'document', 'a');
  tab.textView = { activeTextId: 'own-frame', caret: 12 };
  const input = {
    ...tab,
    pinned: true,
    canvasState: { camera: { x: 15.125, y: -8, zoom: 0.5321 } },
    textView: { private: 'caret' },
    html: 'source',
  };
  const before = structuredClone(workspace),
    next = receiveTab(workspace, input, [{ id: 'a' }], workspace.groups[0].id, 0),
    incoming = next.tabs[0];
  assert.deepEqual(workspace, before);
  assert.deepEqual(next.tabs.find((item) => item.id === tab.id).textView, tab.textView);
  assert.notEqual(incoming.id, tab.id);
  assert.equal(incoming.pinned, true);
  assert.deepEqual(incoming.canvasState, input.canvasState);
  assert.equal(incoming.textView, undefined);
  assert.equal(incoming.html, undefined);
  assert.throws(() =>
    receiveTab(workspace, { ...input, docId: 'missing' }, [{ id: 'a' }], workspace.groups[0].id),
  );
  assert.throws(() => receiveTab(workspace, input, [{ id: 'a' }], 'missing'));
});
test('context panel moves partition tabs and remove empty groups, including repeated detachment', () => {
  const base = defaultPanels(),
    separate = movePanel(base, 'pages', null, 0);
  assert.deepEqual(base, defaultPanels());
  assert.equal(separate.groups.length, 2);
  const pages = separate.groups.find((group) => group.tabs.includes('pages'));
  assert.equal(pages.floating, true);
  const again = movePanel(separate, 'pages', null, 0, { floating: false });
  assert.equal(again.groups.length, 2);
  assert.equal(again.groups.find((group) => group.tabs.includes('pages')).floating, false);
  const joined = movePanel(again, 'pages', again.groups[0].id, 1);
  assert.equal(joined.groups.length, 1);
  assert.deepEqual(joined.groups[0].tabs, ['properties', 'pages', 'layers', 'links', 'text-wrap']);
  assert.deepEqual(joined.closed, ['text-wrap']);
});
test('legacy panels migrate and malformed groups cannot duplicate, omit or inject panels', () => {
  const migrated = normalizePanels({ floating: true, dock: 310, textFlow: 200, rect: { x: 20 } });
  assert.equal(migrated.dock, 310);
  assert.equal(migrated.groups[0].floating, true);
  const repaired = normalizePanels({
    groups: [
      { id: 'x', tabs: ['links', 'links', 'source'], active: 'source', source: 'bad' },
      { id: 'x', tabs: ['links', 'pages'] },
    ],
  });
  assert.deepEqual(repaired.groups.flatMap((group) => group.tabs).sort(), [
    'layers',
    'links',
    'pages',
    'properties',
    'text-wrap',
  ]);
  assert.deepEqual(migrated.closed, ['text-wrap']);
  const open = normalizePanels({ ...repaired, closed: [] });
  assert.deepEqual(normalizePanels(open).closed, []);
  assert.equal(new Set(repaired.groups.map((group) => group.id)).size, repaired.groups.length);
  assert.ok(repaired.groups.every((group) => group.tabs.includes(group.active) && !group.source));
});
test('named workspaces retain panel presets as view state without changing authored documents', () => {
  const docs = [{ id: 'a', html: 'keep' }],
    workspace = createWorkspace();
  replaceTab(workspace, 'document', 'a');
  const layout = layoutSnapshot(workspace, { panelLayout: panelPreset('layout') }, docs);
  assert.equal(layout.chrome.panelLayout.groups.length, 2);
  assert.deepEqual(docs, [{ id: 'a', html: 'keep' }]);
});

test('named panel presets update by name and remain isolated between vaults', async () => {
  const { createWorkspacePreferences } = await import('../../src/storage/workspace-preferences.js');
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    },
    a = createWorkspacePreferences({ storage, vaultId: 'a' }),
    b = createWorkspacePreferences({ storage, vaultId: 'b' });
  const first = a.savePanelPreset('Design', panelPreset('layout')).presets[0];
  assert.equal(first.layout.groups.length, 2);
  assert.equal(b.panelPresets().presets.length, 0);
  const updated = a.savePanelPreset('design', panelPreset('links')).presets;
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, first.id);
  assert.equal(updated[0].layout.groups[0].active, 'links');
  a.removePanelPreset(first.id);
  assert.equal(a.panelPresets().presets.length, 0);
  assert.throws(() => a.savePanelPreset('', defaultPanels()));
});
