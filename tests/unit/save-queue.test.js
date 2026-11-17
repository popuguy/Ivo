import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from '../../src/storage/save-queue.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const pause = () => new Promise((resolve) => setImmediate(resolve));

test('autosave coalesces to an immutable copy of the newest edit', async () => {
  const writes = [],
    queue = createSaveQueue({ save: async (doc) => writes.push(doc), delay: 60000 });
  const doc = { id: 'a', title: 'First', version: 1 };
  queue.enqueue(doc);
  doc.title = 'Second';
  queue.enqueue(doc);
  doc.title = 'Unsaved caller mutation';
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, [{ id: 'a', title: 'Second', version: 1 }]);
  assert.equal(queue.dirty, false);
});

test('failed older write cannot replace a newer undo edit already queued', async () => {
  const entered = deferred(),
    gate = deferred(),
    writes = [];
  const queue = createSaveQueue({
    delay: 60000,
    save: async (doc) => {
      if (doc.title === 'Older') {
        entered.resolve();
        await gate.promise;
        throw new Error('disk unavailable');
      }
      writes.push(doc);
    },
  });
  queue.enqueue({ id: 'a', title: 'Older', version: 20 });
  const first = queue.flush();
  await entered.promise;
  queue.enqueue({ id: 'a', title: 'Newer undo', version: 3 });
  const second = queue.flush();
  gate.resolve();
  await first;
  assert.equal(await second, true);
  assert.deepEqual(writes, [{ id: 'a', title: 'Newer undo', version: 3 }]);
  assert.equal(queue.state, 'saved');
});

test('failed latest edits remain dirty and can be retried without resubmitting', async () => {
  let unavailable = true;
  const writes = [],
    states = [];
  const queue = createSaveQueue({
    delay: 60000,
    onStatus: (state) => states.push(state),
    save: async (doc) => {
      if (unavailable) throw new Error('disk unavailable');
      writes.push(doc);
    },
  });
  queue.enqueue({ id: 'a', title: 'Keep this' });
  assert.equal(await queue.flush(), false);
  assert.equal(queue.state, 'error');
  assert.equal(queue.dirty, true);
  unavailable = false;
  assert.equal(await queue.flush(), true);
  assert.equal(writes[0].title, 'Keep this');
  assert.equal(states.at(-1), 'saved');
});

test('lifecycle flush waits for in-flight writes and view callbacks cannot poison saves', async () => {
  const entered = deferred(),
    gate = deferred();
  let saved = false;
  const queue = createSaveQueue({
    delay: 60000,
    onStatus: () => {
      throw new Error('view unavailable');
    },
    save: async () => {
      entered.resolve();
      await gate.promise;
      saved = true;
    },
  });
  queue.enqueue({ id: 'a' });
  const saving = queue.flush();
  await entered.promise;
  let finished = false;
  const lifecycle = queue.flush().then((result) => {
    finished = result;
  });
  await pause();
  assert.equal(finished, false);
  assert.equal(saved, false);
  gate.resolve();
  await saving;
  await lifecycle;
  assert.equal(finished, true);
});
