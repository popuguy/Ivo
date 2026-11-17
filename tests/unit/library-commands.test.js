import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { startTextFlow } from '../../src/domain/documents/text-flows.js';
import { libraryInfo, setLibraryInfo } from '../../src/domain/documents/library.js';
import { planLibraryChange } from '../../src/domain/documents/library-commands.js';
import { createLibraryOperations } from '../../src/app/library-operations.js';
const make = (id, folder) => {
  const doc = createSceneDocument(id);
  doc.id = id;
  doc.extensions = { unrelated: { keep: ['original'] } };
  setLibraryInfo(doc, { folder, bookmarked: true });
  startTextFlow(
    doc,
    insertObject(doc, 'text', doc.pages[0].id, {
      x: 12.125,
      html: '<p>Original <strong>café</strong></p><p><br></p>',
    }).id,
  );
  return doc;
};
test('folder rename/remap is immutable, segment-aware and retains all authored sources/IDs/extensions', () => {
  const docs = [make('a', 'Research'), make('b', 'Research/Scans'), make('c', 'Research2')],
    before = structuredClone(docs),
    meta = { version: 1, folders: ['Research/Empty', 'Studio'] };
  const plan = planLibraryChange(
    docs,
    meta,
    { type: 'rename-folder', path: 'Research', name: 'References' },
    { now: () => '2026-11-15T18:00:00.000Z' },
  );
  assert.deepEqual(docs, before);
  assert.equal(plan.documents.length, 2);
  assert.deepEqual(plan.library.folders, [
    'References',
    'References/Empty',
    'References/Scans',
    'Research2',
    'Studio',
  ]);
  for (const updated of plan.documents) {
    const old = docs.find((doc) => doc.id === updated.id);
    assert.deepEqual(updated.blocks, old.blocks);
    assert.deepEqual(updated.textFlows, old.textFlows);
    assert.deepEqual(updated.pages, old.pages);
    assert.deepEqual(updated.extensions.unrelated, old.extensions.unrelated);
    assert.equal(updated.version, old.version + 1);
    assert.equal(libraryInfo(updated).bookmarked, true);
  }
  const moved = planLibraryChange(docs, meta, {
    type: 'move-folder',
    path: 'Research',
    destination: 'Studio',
  });
  assert.equal(libraryInfo(moved.documents[1]).folder, 'Studio/Research/Scans');
  assert.equal(
    planLibraryChange(docs, meta, { type: 'move-folder', path: 'Research', destination: '' })
      .changed,
    false,
  );
});
test('invalid/cyclic/colliding/stale library moves reject without changing their input', () => {
  const docs = [make('a', 'Research/Scans')],
    meta = { version: 1, folders: ['Studio/Research'] },
    before = structuredClone(docs);
  for (const command of [
    { type: 'move-folder', path: 'Research', destination: 'Research/Scans' },
    { type: 'move-folder', path: 'Research', destination: 'Studio' },
    { type: 'move-document', id: 'a', destination: 'Missing' },
    { type: 'move-document', id: 'a', destination: '', version: 900 },
    { type: 'rename-folder', path: 'Research', name: '../Bad' },
    { type: 'rename-folder', path: 'Research', name: 'Two/Parts' },
  ])
    assert.throws(() => planLibraryChange(docs, meta, command));
  assert.deepEqual(docs, before);
  const many = { version: 1, folders: Array.from({ length: 500 }, (_, i) => 'Folder' + i) };
  assert.throws(() => planLibraryChange([], many, { type: 'create-folder', path: 'Extra' }), /500/);
});
test('library application publishes only committed data and retains source state on flush/write failure', async () => {
  const docs = [make('a', 'Research')];
  let library = { version: 1, folders: ['Research', 'Studio'] },
    allowed = false,
    fail = false,
    commits = 0,
    records = 0;
  const operations = createLibraryOperations({
    flush: async () => allowed,
    commit: async (command) => {
      commits++;
      if (fail) throw new Error('disk');
      return planLibraryChange(docs, library, command);
    },
    getDocuments: () => docs,
    receive: (values) => docs.splice(0, docs.length, ...values),
    getLibrary: () => library,
    setLibrary: (next) => {
      library = next;
    },
    record: () => {
      records++;
    },
    onChanged: () => {},
  });
  const before = structuredClone(docs);
  assert.equal(
    await operations.run({ type: 'move-document', id: 'a', destination: 'Studio' }),
    false,
  );
  assert.equal(commits, 0);
  allowed = true;
  fail = true;
  await assert.rejects(
    operations.run({ type: 'move-document', id: 'a', destination: 'Studio' }),
    /disk/,
  );
  assert.deepEqual(docs, before);
  assert.equal(records, 0);
  fail = false;
  await operations.run({ type: 'move-document', id: 'a', destination: 'Studio' });
  assert.equal(libraryInfo(docs[0]).folder, 'Studio');
  assert.equal(records, 1);
  assert.deepEqual(docs[0].textFlows, before[0].textFlows);
});
