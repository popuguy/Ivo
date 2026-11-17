import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openVault } from '../../desktop/vault.mjs';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { startTextFlow } from '../../src/domain/documents/text-flows.js';
import { setLibraryInfo, libraryInfo } from '../../src/domain/documents/library.js';
test('folder/library changes commit atomically with originals/history retained through failure and reopen', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ivo-library-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let fail = false;
  const vault = await openVault(directory, {
      beforeCommit: () => {
        if (fail) throw new Error('simulated interruption');
      },
    }),
    documents = ['a', 'b'].map((id) => {
      const doc = createSceneDocument(id);
      doc.id = id;
      setLibraryInfo(doc, { folder: 'Research/Scans' });
      startTextFlow(
        doc,
        insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Unchanged ' + id + '</p>' }).id,
      );
      return doc;
    });
  const asset = {
    id: 'original',
    name: 'Original.png',
    mimeType: 'image/png',
    data: 'data:image/png;base64,AQIDBA==',
  };
  await vault.saveImport({ schemaVersion: 5, documents, assets: [asset] });
  await vault.putMeta('library:1', { version: 1, folders: ['Research/Empty', 'Studio'] });
  await vault.putMeta('history:a', [documents[0]]);
  const manifestFile = path.join(directory, 'atlas.json'),
    before = await readFile(manifestFile),
    manifest = JSON.parse(before),
    original = await readFile(path.join(directory, manifest.documents.a.file)),
    image = await readFile(path.join(directory, manifest.assets.original.file));
  fail = true;
  await assert.rejects(
    vault.changeLibrary({ type: 'move-folder', path: 'Research', destination: 'Studio' }),
    /interruption/,
  );
  assert.deepEqual(await readFile(manifestFile), before);
  assert.deepEqual(await vault.loadDocuments(), documents);
  fail = false;
  await vault.changeLibrary({ type: 'move-folder', path: 'Research', destination: 'Studio' });
  const reopened = await openVault(directory),
    loaded = await reopened.loadDocuments();
  assert.equal(libraryInfo(loaded[0]).folder, 'Studio/Research/Scans');
  assert.deepEqual(
    loaded.map((doc) => doc.textFlows),
    documents.map((doc) => doc.textFlows),
  );
  assert.deepEqual((await reopened.getMeta('history:a')).value, [documents[0]]);
  assert.deepEqual(await readFile(path.join(directory, manifest.documents.a.file)), original);
  assert.deepEqual(await readFile(path.join(directory, manifest.assets.original.file)), image);
  const after = await readFile(manifestFile);
  await assert.rejects(
    reopened.changeLibrary({ type: 'move-document', id: 'a', destination: '', version: 1 }),
    /changed/,
  );
  assert.deepEqual(await readFile(manifestFile), after);
});
