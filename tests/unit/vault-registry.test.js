import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openVaultRegistry } from '../../desktop/vault-registry.mjs';
import { openVault } from '../../desktop/vault.mjs';
import { createSceneDocument } from '../../src/domain/documents/scene.js';
import { createWorkspace, replaceTab } from '../../src/domain/workspace/state.js';
test('Vault registry deduplicates real folders, retains open state and forgets references without deleting files', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ivo-registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const a = path.join(root, 'A'),
    b = path.join(root, 'B'),
    registry = await openVaultRegistry(path.join(root, 'Profile', 'vaults.json'));
  await fs.mkdir(a);
  await fs.mkdir(b);
  await fs.writeFile(path.join(a, 'source.txt'), 'preserved');
  const first = await registry.remember(a),
    second = await registry.remember(b);
  await fs.symlink(a, path.join(root, 'alias'));
  assert.equal((await registry.remember(path.join(root, 'alias'))).id, first.id);
  assert.equal(registry.list().length, 2);
  await assert.rejects(registry.forget(first.id), /Close this vault/);
  await registry.setOpen(first.id, false);
  await registry.forget(first.id);
  assert.equal(await fs.readFile(path.join(a, 'source.txt'), 'utf8'), 'preserved');
  assert.equal(
    (await openVaultRegistry(path.join(root, 'Profile', 'vaults.json'))).list()[0].id,
    second.id,
  );
});
test('Separate vaults retain identical document IDs, workspace and original data independently', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ivo-vault-owners-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const a = await openVault(path.join(root, 'A')),
    b = await openVault(path.join(root, 'B')),
    doc = createSceneDocument('A');
  doc.id = 'same-id';
  await a.saveDocument(doc);
  await b.saveDocument({ ...doc, title: 'B' });
  const workspace = createWorkspace();
  replaceTab(workspace, 'document', doc.id, true);
  await a.putMeta('workspace:1', workspace);
  await a.saveDocument({ ...doc, title: 'A later' });
  assert.equal((await b.loadDocuments())[0].title, 'B');
  assert.equal(await b.getMeta('workspace:1'), undefined);
  const reopened = await openVault(a.directory);
  assert.equal((await reopened.getMeta('workspace:1')).value.tabs[0].docId, doc.id);
  assert.equal((await reopened.loadDocuments())[0].title, 'A later');
});
