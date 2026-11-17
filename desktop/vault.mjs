import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileVault, hashBytes } from '../src/storage/file-vault.js';

export async function openVault(directory, options) {
  await fs.mkdir(directory, { recursive: true });
  const root = await fs.realpath(directory);
  async function location(relative, createParent = false) {
    if (
      // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
      /[\u0000-\u001f\u007f]/.test(relative) ||
      !/^(atlas\.json|documents\/[A-Za-z0-9_-]+-[a-f0-9]{64}\.json|assets\/[a-f0-9]{64}\.bin)$/.test(
        relative,
      )
    )
      throw new Error('Invalid atlas object path.');
    const target = path.join(root, relative),
      parent = path.dirname(target);
    if (createParent) await fs.mkdir(parent, { recursive: true });
    try {
      if ((await fs.lstat(parent)).isSymbolicLink())
        throw new Error('Atlas folders must not be symbolic links.');
      if ((await fs.lstat(target)).isSymbolicLink())
        throw new Error('Atlas objects must not be symbolic links.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return target;
  }
  async function read(relative) {
    try {
      return new Uint8Array(await fs.readFile(await location(relative)));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  return createFileVault(
    {
      directory: root,
      initialize: async () => {
        if (!(await read('atlas.json')) && (await fs.readdir(root)).length)
          throw new Error('This folder is not an Ivo atlas. Choose an empty folder.');
        for (const folder of ['documents', 'assets']) {
          try {
            if ((await fs.lstat(path.join(root, folder))).isSymbolicLink())
              throw new Error('Atlas folders must not be symbolic links.');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
      },
      read,
      writeAtomic: async (relative, bytes, guard = {}) => {
        const target = await location(relative, true),
          temporary = target + '.' + randomUUID() + '.tmp';
        if (relative === 'atlas.json') {
          const previous = await read(relative),
            previousHash = previous ? await hashBytes(previous) : null;
          if (previousHash !== guard.expectedHash)
            throw new Error(
              'The atlas changed outside this window. Your edits are still here; export a backup before reopening it.',
            );
        }
        const handle = await fs.open(temporary, 'wx', 0o600);
        let renamed = false;
        try {
          await handle.writeFile(bytes);
          await handle.sync();
          await handle.close();
          await fs.rename(temporary, target);
          renamed = true;
        } finally {
          await handle.close().catch(() => {});
          if (!renamed) await fs.unlink(temporary).catch(() => {});
        }
        // After rename, committed bytes must not be reported as an uncommitted save.
        await fs
          .open(path.dirname(target), 'r')
          .then(async (parent) => {
            try {
              await parent.sync();
            } finally {
              await parent.close();
            }
          })
          .catch(() => {});
      },
    },
    options,
  );
}
