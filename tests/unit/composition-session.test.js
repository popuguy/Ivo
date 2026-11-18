import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionSession } from '../../src/features/editor/text/composition-session.js';
test('native layout never applies an obsolete edit; queued superseded edits do no work', async () => {
  let doc = { pages: [], blocks: [], textFlows: [{ html: 'first' }] },
    release;
  const calls = [],
    applied = [],
    errors = [],
    session = createCompositionSession({
      getDocument: () => doc,
      compose: async (snapshot) => {
        calls.push(snapshot.textFlows[0].html);
        if (calls.length === 1)
          await new Promise((resolve) => {
            release = resolve;
          });
        return snapshot.textFlows[0].html;
      },
      onResult: (plan) => applied.push(plan),
      onError: (error) => errors.push(error),
    });
  session.request(doc);
  await Promise.resolve();
  doc.textFlows[0].html = 'second';
  session.request(doc);
  doc.textFlows[0].html = 'third';
  session.request(doc);
  release();
  await session.flush();
  assert.deepEqual(calls, ['first', 'third']);
  assert.deepEqual(applied, ['third']);
  assert.deepEqual(errors, []);
  assert.equal(session.pending, false);
  session.request(doc);
  await session.flush();
  assert.equal(calls.length, 2);
  session.destroy();
});
test('save bookkeeping does not invalidate composition and a destroyed editor receives no result', async () => {
  const doc = { version: 1, pages: [], blocks: [], textFlows: [] };
  let release,
    applied = 0;
  const session = createCompositionSession({
    getDocument: () => doc,
    compose: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    onResult: () => applied++,
    onError: assert.fail,
  });
  session.request(doc);
  await Promise.resolve();
  doc.version++;
  release({});
  await session.flush();
  assert.equal(applied, 1);
  doc.pages.push({ id: 'page' });
  session.request(doc);
  await Promise.resolve();
  session.destroy();
  release({});
  await session.flush();
  assert.equal(applied, 1);
});
test('losing the writer lease fences a pending result, and passive delivery uses its own scope', async () => {
  const doc = { pages: [], blocks: [], textFlows: [] },
    applied = [];
  let writer = true,
    release;
  const session = createCompositionSession({
    getDocument: () => doc,
    scope: () => writer,
    compose: (_snapshot, options) =>
      new Promise((resolve) => {
        release = () => resolve(options.allowPages);
      }),
    onResult: (result) => applied.push(result),
    onError: assert.fail,
  });
  session.request(doc, { allowPages: true });
  await Promise.resolve();
  writer = false;
  release();
  await session.flush();
  assert.deepEqual(applied, []);
  session.request(doc, { allowPages: false });
  await Promise.resolve();
  release();
  await session.flush();
  assert.deepEqual(applied, [false]);
  session.destroy();
});
test('a transient failure has an explicit bounded retry without a paint-triggered retry loop', async () => {
  const doc = { pages: [], blocks: [], textFlows: [] },
    errors = [],
    applied = [];
  let calls = 0;
  const session = createCompositionSession({
    getDocument: () => doc,
    compose: async () => {
      if (++calls === 1) throw Error('worker stopped');
      return 'recovered';
    },
    onResult: (result) => applied.push(result),
    onError: (error) => errors.push(error.message),
  });
  session.request(doc);
  await session.flush();
  session.request(doc);
  await session.flush();
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['worker stopped']);
  session.retry(doc);
  await session.flush();
  assert.deepEqual(applied, ['recovered']);
  assert.equal(calls, 2);
  session.destroy();
});
