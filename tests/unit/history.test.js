import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentHistory } from '../../src/domain/history/document-history.js';
import { createTransitionQueue } from '../../src/shared/async/transition-queue.js';
const doc = (text, version = 1) => ({
  id: 'a',
  title: 'A',
  blocks: [{ id: 't', html: text }],
  version,
  updatedAt: String(version),
});
const view = (offset) => ({ activeTextId: 't', textSelection: { offset } });
test('text and object changes share an immutable reversible timeline', () => {
  const h = createDocumentHistory(),
    a = doc('one'),
    b = doc('two'),
    c = { ...doc('two'), title: 'Renamed' };
  h.record(a, b, { label: 'Typing', viewBefore: view(0), viewAfter: view(3) });
  h.record(b, c, { label: 'Rename' });
  b.blocks[0].html = 'caller changed';
  let result = h.undo(c);
  assert.equal(result.document.title, 'A');
  result = h.undo(result.document);
  assert.equal(result.document.blocks[0].html, 'one');
  assert.deepEqual(result.view, view(0));
  result.document.blocks[0].html = 'caller changed again';
  result = h.redo(doc('one', 12));
  assert.equal(result.document.blocks[0].html, 'two');
  assert.deepEqual(result.view, view(3));
  result = h.redo(result.document);
  assert.equal(result.document.title, 'Renamed');
  assert.equal(h.canRedo, false);
});
test('only contiguous compatible typing merges; a format or caret boundary ends the group', () => {
  let time = 0;
  const h = createDocumentHistory({ now: () => time });
  h.record(doc(''), doc('a'), { mergeKey: 'type:t', viewBefore: view(0), viewAfter: view(1) });
  time += 100;
  h.record(doc('a'), doc('ab'), { mergeKey: 'type:t', viewBefore: view(1), viewAfter: view(2) });
  assert.equal(h.size, 1);
  assert.equal(h.undo(doc('ab')).document.blocks[0].html, '');
  h.redo(doc(''));
  h.breakGroup();
  h.record(doc('ab'), doc('abc'), { mergeKey: 'type:t', viewBefore: view(2), viewAfter: view(3) });
  assert.equal(h.size, 2);
  h.record(doc('abc'), doc('axbc'), {
    mergeKey: 'type:t',
    viewBefore: view(1),
    viewAfter: view(2),
  });
  assert.equal(h.size, 3);
  h.undo(doc('axbc'));
  h.record(doc('abc'), doc('abcd'), { label: 'Other' });
  assert.equal(h.canRedo, false);
});
test('history rejects unrelated state without consuming entries and respects its bound', () => {
  const h = createDocumentHistory({ limit: 2 });
  h.record(doc('a'), doc('b'));
  assert.throws(() => h.undo(doc('external')), /outside/);
  assert.equal(h.canUndo, true);
  h.record(doc('b'), doc('c'));
  h.record(doc('c'), doc('d'));
  assert.equal(h.size, 2);
  assert.equal(h.undo(doc('d')).document.blocks[0].html, 'c');
  assert.equal(h.undo(doc('c')).document.blocks[0].html, 'b');
  assert.equal(h.canUndo, false);
});
test('view transitions suspend immediately and retain order across waits and failures', async () => {
  const states = [],
    order = [],
    q = createTransitionQueue({ onBusy: (busy) => states.push(busy) });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const first = q.run(async () => {
    order.push('start A');
    await gate;
    order.push('end A');
  });
  const second = q.run(() => {
    order.push('B');
    throw new Error('B failed');
  });
  const failure = assert.rejects(second, /B failed/);
  const third = q.run(() => order.push('C'));
  assert.equal(q.busy, true);
  assert.equal(states[0], true);
  await Promise.resolve();
  assert.deepEqual(order, ['start A']);
  release();
  await first;
  await failure;
  await third;
  assert.deepEqual(order, ['start A', 'end A', 'B', 'C']);
  assert.equal(q.busy, false);
  assert.equal(states.at(-1), false);
});
