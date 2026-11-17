import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWindowLease,
  workspaceWindowBounds,
  navigationMenuItems,
} from '../../desktop/workspace-windows.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test('Native windows share one lease and transfer only after source flush and target acknowledgement', async () => {
  const a = { id: 'a', ready: true },
    b = { id: 'b', ready: true },
    release = deferred(),
    grant = deferred(),
    events = [];
  let lease;
  lease = createWindowLease({
    release: async (record) => {
      events.push('release:' + record.id);
      return release.promise;
    },
    snapshot: async () => {
      events.push('snapshot');
      assert.equal(lease.canWrite(a), false);
      assert.equal(lease.canWrite(b), false);
      return { documents: ['canonical'] };
    },
    grant: async (record, state) => {
      events.push('grant:' + record.id);
      assert.deepEqual(state.documents, ['canonical']);
      return grant.promise;
    },
    passive: (record) => events.push('passive:' + record.id),
  });
  lease.add(a, { initial: true });
  lease.add(b);
  const pending = lease.request(b);
  await Promise.resolve();
  assert.equal(lease.canWrite(a), true);
  assert.equal(lease.canWrite(b), false);
  release.resolve(true);
  while (!events.includes('grant:b')) await Promise.resolve();
  assert.equal(lease.canWrite(a), false);
  assert.equal(lease.canWrite(b), false);
  grant.resolve();
  assert.equal(await pending, true);
  assert.equal(lease.canWrite(b), true);
  assert.deepEqual(events, ['release:a', 'snapshot', 'grant:b', 'passive:a']);
});
test('Failed source saving preserves its lease and never activates the destination', async () => {
  const a = { ready: true },
    b = { ready: true },
    grants = [];
  const lease = createWindowLease({
    release: async () => false,
    snapshot: async () => ({}),
    grant: async (record) => grants.push(record),
  });
  lease.add(a, { initial: true });
  lease.add(b);
  await assert.rejects(lease.request(b), /finish saving/);
  assert.equal(lease.canWrite(a), true);
  assert.equal(lease.canWrite(b), false);
  assert.deepEqual(grants, [a]);
});
test('Failed target activation restores the previous writer with canonical data', async () => {
  const a = { ready: true },
    b = { ready: true },
    grants = [],
    passive = [];
  const lease = createWindowLease({
    release: async () => true,
    snapshot: async () => ({ revision: 7 }),
    grant: async (record, state) => {
      grants.push([record, state]);
      if (record === b) throw new Error('target unavailable');
    },
    passive: (record) => passive.push(record),
  });
  lease.add(a, { initial: true });
  lease.add(b);
  await assert.rejects(lease.request(b), /target unavailable/);
  assert.equal(lease.canWrite(a), true);
  assert.equal(lease.canWrite(b), false);
  assert.deepEqual(
    grants.map(([record]) => record),
    [b, a],
  );
  assert.deepEqual(passive, [b]);
});
test('Focus handoffs serialize and closing one window leaves other members eligible', async () => {
  const a = { ready: true },
    b = { ready: true },
    c = { ready: false },
    transfers = [];
  const lease = createWindowLease({
    release: async (record) => {
      transfers.push('release:' + record.id);
      return true;
    },
    snapshot: async () => ({}),
    grant: async (record) => transfers.push('grant:' + record.id),
  });
  Object.assign(a, { id: 'a' });
  Object.assign(b, { id: 'b' });
  Object.assign(c, { id: 'c' });
  lease.add(a, { initial: true });
  lease.add(b);
  lease.add(c);
  assert.equal(await lease.request(c), false);
  lease.ready(c);
  await Promise.all([lease.request(b), lease.request(c)]);
  assert.deepEqual(transfers, ['release:a', 'grant:b', 'release:b', 'grant:c']);
  assert.equal(lease.canWrite(c), true);
  lease.remove(c);
  assert.equal(lease.owner(), null);
  await lease.request(a);
  assert.equal(lease.canWrite(a), true);
  assert.equal(lease.canWrite(c), false);
});
test('Window placement remains on screen across small and negative-coordinate displays', () => {
  assert.deepEqual(
    workspaceWindowBounds(
      { x: -99999, y: 99999, width: 10000, height: 9999 },
      { x: -1200, y: 0, width: 1200, height: 800 },
    ),
    { x: -1200, y: 0, width: 1200, height: 800 },
  );
  assert.deepEqual(
    workspaceWindowBounds(
      { x: 99999, y: -99999, width: NaN, height: -4 },
      { x: 100, y: 100, width: 500, height: 300 },
    ),
    { x: 100, y: 100, width: 500, height: 300 },
  );
});
test('A window that finished its close flush cannot write or reacquire a lease', async () => {
  const a = { ready: true },
    b = { ready: true };
  let releases = 0;
  const lease = createWindowLease({
    release: async () => {
      releases++;
      return true;
    },
    snapshot: async () => ({}),
    grant: async () => {},
  });
  lease.add(a, { initial: true });
  lease.add(b);
  a.closingIntent = true;
  assert.equal(lease.canWrite(a), false);
  await lease.request(b);
  assert.equal(releases, 0);
  assert.equal(lease.canWrite(b), true);
  assert.equal(await lease.request(a), false);
});
test('A disappearing passive window cannot roll back an already acknowledged writer grant', async () => {
  const a = { ready: true },
    b = { ready: true };
  const lease = createWindowLease({
    release: async () => true,
    snapshot: async () => ({}),
    grant: async () => {},
    passive: () => {
      throw new Error('Closed while notifying');
    },
  });
  lease.add(a, { initial: true });
  lease.add(b);
  assert.equal(await lease.request(b), true);
  assert.equal(lease.canWrite(a), false);
  assert.equal(lease.canWrite(b), true);
});
test('Native menus accept only bounded opaque actions and discard executable renderer fields', () => {
  const actual = navigationMenuItems([
    { id: 'open-tab', label: 'Open in new tab', click: 'not code', role: 'quit' },
    { type: 'separator' },
    {
      label: 'Copy path',
      submenu: [{ id: 'copy-relative', label: 'Relative path', disabled: true }],
    },
  ]);
  assert.deepEqual(actual, [
    { id: 'open-tab', label: 'Open in new tab', enabled: true },
    { type: 'separator' },
    {
      label: 'Copy path',
      enabled: true,
      submenu: [{ id: 'copy-relative', label: 'Relative path', enabled: false }],
    },
  ]);
  assert.throws(
    () => navigationMenuItems(Array.from({ length: 51 }, (_, i) => ({ id: 'x' + i, label: 'x' }))),
    /large/,
  );
  assert.throws(
    () =>
      navigationMenuItems([
        { id: 'x', label: 'A' },
        { id: 'x', label: 'B' },
      ]),
    /action/,
  );
  assert.throws(
    () =>
      navigationMenuItems([
        {
          label: 'A',
          submenu: [{ label: 'B', submenu: [{ label: 'C', submenu: [{ id: 'x', label: 'x' }] }] }],
        },
      ]),
    /Invalid/,
  );
});
