import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentSession } from '../../src/app/document-session.js';
import { createPassiveRefresh } from '../../src/app/passive-refresh.js';
import { createDocument } from '../../src/domain/documents/model.js';

test('document session preserves the pre-upgrade revision, retries failed writes and isolates histories', async () => {
  const writes = [],
    snapshots = [],
    changed = [];
  let fail = true;
  const session = createDocumentSession({
    save: async (doc) => {
      if (fail) throw new Error('offline');
      writes.push(doc);
    },
    snapshot: async (doc) => snapshots.push(doc),
    onChanged: (id) => changed.push(id),
    now: () => '2026-11-15T12:00:00.000Z',
  });
  const old = createDocument('Before'),
    doc = { ...old, title: 'After' };
  session.preserveLegacy(old);
  old.title = 'Mutated caller';
  session.changed(doc);
  assert.equal(await session.saves.flush(), false);
  assert.equal(session.saves.dirty, true);
  assert.equal(session.legacyOriginal(doc.id).title, 'Before');
  fail = false;
  assert.equal(await session.saves.flush(), true);
  assert.equal(writes[0].title, 'After');
  assert.equal(snapshots[0].title, 'Before');
  assert.equal(session.legacyOriginal(doc.id), undefined);
  assert.equal(doc.version, 2);
  assert.deepEqual(changed, [doc.id]);
  assert.notEqual(session.history(doc.id), session.history('other'));
  session.discardHistory(doc.id);
  assert.equal(session.existingHistory(doc.id), undefined);
});

test('passive refresh coalesces media reads and rejects results begun before ownership changes', async () => {
  let blocked = false,
    next,
    resolveRead;
  const options = [],
    applied = [],
    errors = [];
  const refresh = createPassiveRefresh({
    blocked: () => blocked,
    schedule: (fn) => {
      next = fn;
      return 1;
    },
    cancel: () => {
      next = null;
    },
    read: (optionsValue) => {
      options.push(optionsValue);
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    apply: (value) => applied.push(value),
    onError: (error) => errors.push(error),
  });
  refresh.request({ method: 'saveAsset' });
  refresh.request({ method: 'saveDocument' });
  const stale = next();
  assert.equal(options[0].includeAssets, true);
  blocked = true;
  refresh.invalidate();
  blocked = false;
  resolveRead({ documents: ['obsolete'], assets: [] });
  await stale;
  assert.deepEqual(applied, []);
  refresh.request({ method: 'saveDocument' });
  const current = next();
  assert.equal(options[1].includeAssets, true);
  resolveRead({ documents: ['current'], assets: [] });
  await current;
  assert.equal(applied[0].documents[0], 'current');
  assert.deepEqual(errors, []);
  refresh.request({ method: 'saveDocument' });
  const noMedia = next();
  assert.equal(options[2].includeAssets, false);
  resolveRead({ documents: [], assets: null });
  await noMedia;
});
