import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

/** Application-owned recent folders. This registry never contains notes or changes a vault's contents. */
export async function openVaultRegistry(file) {
  let state = { version: 1, vaults: {} };
  try {
    state = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(
        'The vault list could not be read. Your vault folders have been left in place.',
        { cause: error },
      );
  }
  if (
    state?.version !== 1 ||
    !state.vaults ||
    typeof state.vaults !== 'object' ||
    Array.isArray(state.vaults) ||
    Object.keys(state.vaults).length > 1000
  )
    throw new Error('Unsupported vault list.');
  for (const [id, value] of Object.entries(state.vaults))
    if (
      !/^[a-f0-9]{16}$/.test(id) ||
      !value ||
      !path.isAbsolute(value.path) ||
      !Number.isFinite(value.ts) ||
      typeof value.open !== 'boolean'
    )
      throw new Error('Damaged vault list. Your folders have been left in place.');
  let queue = Promise.resolve();
  function mutate(callback) {
    const result = queue.then(async () => {
      const next = structuredClone(state),
        result = await callback(next);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = file + '.' + randomUUID() + '.tmp';
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(next, null, 2) + '\n');
        await handle.sync();
        await handle.close();
        await fs.rename(temporary, file);
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(temporary).catch(() => {});
      }
      state = next;
      return structuredClone(result);
    });
    queue = result.catch(() => {});
    return result;
  }
  const list = () =>
    Object.entries(state.vaults)
      .map(([id, value]) => ({
        id,
        ...value,
        name: path.basename(value.path),
        parent: path.dirname(value.path),
      }))
      .sort((a, b) => b.ts - a.ts || a.name.localeCompare(b.name));
  return Object.freeze({
    list,
    entry: (id) => list().find((value) => value.id === id),
    remember: async (directory) => {
      const real = await fs.realpath(directory);
      if (!(await fs.stat(real)).isDirectory()) throw new Error('Choose a vault folder.');
      return mutate((next) => {
        const known = Object.entries(next.vaults).find(([, value]) => value.path === real),
          id = known?.[0] || randomBytes(8).toString('hex');
        next.vaults[id] = { path: real, ts: Date.now(), open: true };
        return { id, ...next.vaults[id], name: path.basename(real), parent: path.dirname(real) };
      });
    },
    setOpen: (id, open) =>
      mutate((next) => {
        if (!next.vaults[id]) throw new Error('This vault is no longer in the list.');
        next.vaults[id].open = open;
        if (open) next.vaults[id].ts = Date.now();
        return next.vaults[id];
      }),
    forget: (id) =>
      mutate((next) => {
        if (!next.vaults[id]) return;
        if (next.vaults[id].open)
          throw new Error('Close this vault before removing it from the list.');
        delete next.vaults[id];
      }),
    flush: () => queue,
  });
}
