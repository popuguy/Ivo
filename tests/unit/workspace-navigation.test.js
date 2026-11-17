import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  replaceTab,
  addTab,
  activeTab,
  activeGroup,
  activateTab,
  groupTabs,
  splitGroup,
  mergeGroup,
  moveTabToGroup,
  closeTab,
  reopenTab,
  normalizeWorkspace,
  navigateHistory,
  canNavigate,
  setSplitRatio,
  pinTab,
} from '../../src/domain/workspace/state.js';
test('Split groups refer to one canonical tab list and keep independent view state', () => {
  const w = createWorkspace(),
    a = replaceTab(w, 'document', 'a', true);
  a.canvasState = { camera: { x: 1, y: 2, zoom: 1.5 }, selection: ['frame'] };
  a.textView = { activeTextId: 'frame', textSelection: { privateLiveSelection: 'not serialized' } };
  const first = activeGroup(w),
    second = splitGroup(w);
  const b = activeTab(w);
  assert.notEqual(b.id, a.id);
  assert.equal(b.docId, a.docId);
  assert.deepEqual(b.canvasState, a.canvasState);
  b.canvasState.camera.x = 88;
  assert.equal(a.canvasState.camera.x, 1);
  assert.equal(w.layout.axis, 'row');
  assert.equal(groupTabs(w, first.id)[0], a);
  assert.equal(groupTabs(w, second.id)[0], b);
  const saved = normalizeWorkspace(w, [{ id: 'a' }]);
  assert.equal(saved.groups.length, 2);
  assert.equal(saved.layout.id, w.layout.id);
  assert.ok(!JSON.stringify(saved).includes('privateLiveSelection'));
  assert.equal(saved.tabs[1].canvasState.camera.x, 88);
  assert.equal(setSplitRatio(w, w.layout.id, 0.8), true);
  assert.equal(w.layout.ratio, 0.8);
});
test('Navigation history belongs to each tab, restores views, and discards the forward branch on a new route', () => {
  const w = createWorkspace(),
    tab = replaceTab(w, 'document', 'a');
  tab.navigation = undefined;
  tab.canvasState = { camera: { x: 12.25, y: 9, zoom: 0.75 } };
  replaceTab(w, 'document', 'b');
  activeTab(w).canvasState = { camera: { x: 80, y: -30, zoom: 2 } };
  replaceTab(w, 'graph', 'b');
  assert.equal(canNavigate(w, 'back'), true);
  assert.equal(navigateHistory(w, 'back'), true);
  assert.equal(tab.docId, 'b');
  assert.equal(tab.canvasState.camera.zoom, 2);
  navigateHistory(w, 'back');
  assert.equal(tab.docId, 'a');
  assert.equal(tab.canvasState.camera.x, 12.25);
  navigateHistory(w, 'forward');
  assert.equal(tab.docId, 'b');
  replaceTab(w, 'document', 'c');
  assert.equal(canNavigate(w, 'forward'), false);
  splitGroup(w);
  assert.equal(canNavigate(w, 'back'), false);
  activateTab(w, tab.id);
  assert.equal(canNavigate(w, 'back'), true);
  pinTab(w, tab.id);
  assert.equal(navigateHistory(w, 'back'), true);
  assert.equal(tab.pinned, true);
});
test('Closing the last tab removes its split and merging/moving retain every tab and pin', () => {
  const w = createWorkspace(),
    a = replaceTab(w, 'document', 'a'),
    original = activeGroup(w),
    other = splitGroup(w, 'column', { kind: 'document', docId: 'b' }),
    b = activeTab(w);
  pinTab(w, b.id);
  addTab(w, { kind: 'document', docId: 'c' });
  const c = activeTab(w);
  moveTabToGroup(w, c.id, original.id);
  assert.equal(w.groups.length, 2);
  assert.ok(groupTabs(w, original.id).includes(c));
  closeTab(w, b.id);
  assert.equal(w.groups.length, 1);
  assert.equal(w.layout.type, 'group');
  assert.equal(w.tabs.length, 2);
  assert.equal(reopenTab(w), b);
  assert.equal(b.pinned, true);
  splitGroup(w);
  const count = w.tabs.length;
  assert.equal(mergeGroup(w), true);
  assert.equal(w.tabs.length, count);
  assert.equal(w.groups.length, 1);
  assert.ok(w.tabs.includes(a));
  assert.equal(other.tabIds.length, 0);
});
test('Legacy workspaces and malformed layout references recover without losing valid tabs', () => {
  const legacy = {
    version: 1,
    tabs: [
      { id: 't-a', kind: 'document', docId: 'a' },
      { id: 't-b', kind: 'document', docId: 'b' },
    ],
    active: 't-b',
  };
  const w = normalizeWorkspace(legacy, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(w.groups.length, 1);
  assert.deepEqual(w.groups[0].tabIds, ['t-a', 't-b']);
  assert.equal(w.groups[0].active, 't-b');
  w.groups = [
    { id: 'g', tabIds: ['t-a', 't-a', 'missing'], active: 'missing' },
    { id: 'g', tabIds: ['t-b'], active: 't-b' },
  ];
  w.layout = {
    type: 'split',
    axis: 'bad',
    ratio: 99,
    first: { type: 'group', id: 'g' },
    second: { type: 'group', id: 'g' },
  };
  const repaired = normalizeWorkspace(w, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(new Set(repaired.groups.flatMap((g) => g.tabIds)).size, 2);
  assert.equal(repaired.groups.flatMap((g) => g.tabIds).length, 2);
  assert.equal(repaired.groups.length, 2);
  assert.equal(new Set(repaired.groups.map((g) => g.id)).size, 2);
  assert.equal(repaired.layout.type, 'split');
  assert.ok(repaired.layout.ratio <= 0.9);
});
test('Workspace history is bounded, removes missing documents and never persists source/undo', () => {
  const w = createWorkspace(),
    docs = Array.from({ length: 100 }, (_, i) => ({ id: 'd' + i }));
  for (const doc of docs) {
    replaceTab(w, 'document', doc.id);
    activeTab(w).html = 'private';
    activeTab(w).textView = { source: 'private' };
    activeTab(w).canvasState = {
      camera: { x: 1, y: 2, zoom: 1.5 },
      html: 'private',
      selection: ['object'],
    };
  }
  const saved = normalizeWorkspace(w, docs.slice(-10));
  assert.ok(saved.tabs[0].navigation.back.length <= 10);
  assert.ok(!JSON.stringify(saved).includes('private'));
  assert.ok(JSON.stringify(saved).length < 250000);
  const group = activeGroup(w);
  for (let i = 0; i < 7; i++) splitGroup(w);
  assert.throws(() => splitGroup(w), /eight/);
  assert.equal(w.groups.length, 8);
  assert.ok(w.groups.includes(group));
});

test('Graph camera state is view-only, normalized and restored independently in history', () => {
  const w = createWorkspace();
  replaceTab(w, 'graph', 'a');
  activeTab(w).graphState = { center: { x: 123.25, y: -45.5 }, scale: 1.6, html: 'private' };
  replaceTab(w, 'document', 'b');
  const saved = normalizeWorkspace(w, [{ id: 'a' }, { id: 'b' }]);
  assert.ok(!JSON.stringify(saved).includes('private'));
  assert.equal(navigateHistory(saved, 'back'), true);
  assert.deepEqual(activeTab(saved).graphState, { center: { x: 123.25, y: -45.5 }, scale: 1.6 });
  activeTab(saved).graphState.scale = 99;
  assert.ok(!normalizeWorkspace(saved, [{ id: 'a' }, { id: 'b' }]).tabs[0].graphState);
});

test('A maximum workspace remains below the native metadata envelope without dropping tabs', () => {
  const ids = Array.from(
      { length: 100 },
      (_, i) => 'd' + String(i).padStart(3, '0') + 'a'.repeat(110),
    ),
    documents = ids.map((id) => ({ id })),
    state = {
      camera: { x: 999999999, y: -999999999, zoom: 7.999999 },
      activePage: 'p' + 'a'.repeat(119),
      inside: 'm' + 'a'.repeat(119),
      activeTextId: 'f' + 'a'.repeat(119),
      selection: Array.from(
        { length: 1000 },
        (_, i) => 'o' + String(i).padStart(3, '0') + 'a'.repeat(110),
      ),
      tool: 'text',
    },
    tabs = ids.map((docId, i) => ({
      id: 't' + i,
      kind: 'document',
      docId,
      editing: true,
      canvasState: state,
      navigation: {
        back: ids.map((id) => ({ kind: 'document', docId: id, editing: true, canvasState: state })),
        forward: [],
      },
    }));
  const value = normalizeWorkspace({ version: 1, tabs, active: 't99' }, documents);
  assert.equal(value.tabs.length, 100);
  assert.ok(JSON.stringify(value).length <= 240000);
  assert.equal(value.active, 't99');
});
