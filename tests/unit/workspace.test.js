import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  activeTab,
  addTab,
  replaceTab,
  closeTab,
  reopenTab,
  normalizeWorkspace,
  untitledName,
} from '../../src/domain/workspace/state.js';
test('Note creation reuses an empty tab and closes/reopens tabs without deleting documents', () => {
  const workspace = createWorkspace(),
    initial = activeTab(workspace).id;
  addTab(workspace, { kind: 'document', docId: 'a', editing: true, reuseEmpty: true });
  assert.equal(workspace.tabs.length, 1);
  assert.equal(activeTab(workspace).id, initial);
  addTab(workspace, { kind: 'document', docId: 'b', reuseEmpty: true });
  assert.equal(workspace.tabs.length, 2);
  closeTab(workspace);
  assert.equal(activeTab(workspace).docId, 'a');
  assert.equal(reopenTab(workspace).docId, 'b');
  closeTab(workspace);
  closeTab(workspace);
  assert.equal(workspace.tabs.length, 1);
  assert.equal(activeTab(workspace).kind, 'empty');
  assert.equal(reopenTab(workspace).docId, 'a');
  assert.equal(workspace.tabs.length, 1);
});
test('Workspace snapshots retain bounded per-tab view state and discard text/history/unavailable documents', () => {
  const workspace = createWorkspace();
  replaceTab(workspace, 'document', 'a', true);
  Object.assign(activeTab(workspace), {
    html: 'Never persist source',
    textView: { secret: 'selection' },
    canvasState: {
      camera: { x: 12.25, y: -42.5, zoom: 1.25 },
      selection: ['frame', 'frame'],
      activePage: 'page',
      tool: 'text',
      html: 'No',
    },
  });
  addTab(workspace, { kind: 'document', docId: 'missing' });
  const normalized = normalizeWorkspace(workspace, [{ id: 'a' }]);
  assert.equal(normalized.tabs.length, 1);
  assert.deepEqual(normalized.tabs[0].canvasState.camera, { x: 12.25, y: -42.5, zoom: 1.25 });
  assert.deepEqual(normalized.tabs[0].canvasState.selection, ['frame']);
  assert.ok(
    !JSON.stringify(normalized).includes('secret') && !JSON.stringify(normalized).includes('Never'),
  );
  assert.equal(normalizeWorkspace({ version: 99, tabs: [] }).tabs[0].kind, 'empty');
  assert.equal(untitledName([{ title: 'UNTITLED' }, { title: 'Untitled 1' }]), 'Untitled 2');
});

test('Pinned tabs keep their document, reuse an existing destination and persist as view metadata', async () => {
  const { pinTab } = await import('../../src/domain/workspace/state.js'),
    workspace = createWorkspace();
  const a = replaceTab(workspace, 'document', 'a', true);
  a.canvasState = { camera: { x: 1, y: 2, zoom: 1.5 } };
  pinTab(workspace, a.id);
  const b = replaceTab(workspace, 'document', 'b');
  assert.equal(a.docId, 'a');
  assert.equal(workspace.tabs.length, 2);
  workspace.active = a.id;
  assert.equal(replaceTab(workspace, 'document', 'a'), a);
  assert.equal(a.editing, true);
  assert.equal(replaceTab(workspace, 'document', 'b'), b);
  assert.equal(workspace.tabs.length, 2);
  assert.equal(workspace.active, b.id);
  assert.deepEqual(a.canvasState.camera, { x: 1, y: 2, zoom: 1.5 });
  const saved = normalizeWorkspace(workspace, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(saved.tabs[0].pinned, true);
  closeTab(workspace, a.id);
  assert.equal(reopenTab(workspace).pinned, true);
  pinTab(workspace, a.id, false);
  replaceTab(workspace, 'document', 'c');
  assert.equal(a.docId, 'c');
  assert.ok(!a.pinned);
});
test('Tab order changes preserve tab identity, active ownership and closed-tab restoration', async () => {
  const { moveTab, pinTab } = await import('../../src/domain/workspace/state.js'),
    workspace = createWorkspace(),
    a = replaceTab(workspace, 'document', 'a'),
    b = addTab(workspace, { kind: 'document', docId: 'b' }),
    c = addTab(workspace, { kind: 'document', docId: 'c' });
  pinTab(workspace, b.id);
  b.canvasState = { selection: ['object'] };
  const active = workspace.active;
  assert.equal(moveTab(workspace, b.id, 0), true);
  assert.deepEqual(workspace.tabs, [b, a, c]);
  assert.equal(workspace.active, active);
  assert.equal(b.pinned, true);
  assert.deepEqual(b.canvasState.selection, ['object']);
  assert.equal(moveTab(workspace, b.id, -1), false);
  assert.equal(moveTab(workspace, 'missing', 1), false);
  closeTab(workspace, b.id);
  assert.equal(reopenTab(workspace), b);
  assert.equal(workspace.tabs[0], b);
});
