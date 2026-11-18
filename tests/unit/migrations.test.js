import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateImport } from '../../src/domain/documents/schema.js';
import { openVault } from '../../desktop/vault.mjs';
import { hashBytes } from '../../src/storage/file-vault.js';
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/legacy/archive-v4.json', import.meta.url), 'utf8'),
);
const legacyCollection = 'stories',
  legacyReference = 'storyId';

test('frozen legacy archive migrates losslessly without mutating source or regenerating identities', () => {
  const before = structuredClone(fixture),
    converted = validateImport(fixture),
    old = fixture.documents[0],
    doc = converted.documents[0];
  assert.deepEqual(fixture, before);
  assert.equal(converted.schemaVersion, 5);
  assert.equal(doc.canvasVersion, 4);
  assert.deepEqual(doc.textFlows, old[legacyCollection]);
  assert.deepEqual(
    doc.blocks,
    old.blocks.map((block) => {
      const copy = { ...block };
      if (legacyReference in copy) {
        copy.textFlowId = copy[legacyReference];
        delete copy[legacyReference];
      }
      return copy;
    }),
  );
  assert.deepEqual(doc.pages, old.pages);
  assert.deepEqual(doc.extensions, old.extensions);
  assert.deepEqual(converted.assets, fixture.assets);
  assert.equal(doc.id, old.id);
  assert.equal(doc.version, old.version);
  assert.equal(legacyCollection in doc, false);
  assert.deepEqual(validateImport(converted), converted);
});

test('ambiguous representations, missing sources and unsupported versions fail before writes', () => {
  const ambiguous = structuredClone(fixture);
  ambiguous.documents[0].textFlows = [];
  assert.throws(() => validateImport(ambiguous), /mixed/);
  const reference = structuredClone(fixture);
  reference.documents[0].blocks[0].textFlowId = 'other';
  assert.throws(() => validateImport(reference), /mixed/);
  const missing = validateImport(fixture);
  delete missing.documents[0].textFlows;
  assert.throws(() => validateImport(missing), /canonical document text/);
  assert.throws(() => validateImport({ ...fixture, schemaVersion: 7 }), /unsupported schema/);
  const oldEnvelope = validateImport(fixture);
  oldEnvelope.schemaVersion = 4;
  assert.throws(() => validateImport(oldEnvelope), /schema 5/);
});

test('old native documents, media and history open without changing any original disk bytes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ivo-legacy-format-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'documents'));
  await mkdir(path.join(directory, 'assets'));
  const doc = fixture.documents[0],
    asset = fixture.assets[0];
  const documentBytes = Buffer.from(JSON.stringify(doc) + '\n'),
    sha256 = await hashBytes(documentBytes),
    file = `documents/${doc.id}-${sha256}.json`;
  const assetBytes = Buffer.from(asset.data.split(',')[1], 'base64'),
    assetHash = await hashBytes(assetBytes),
    assetFile = `assets/${assetHash}.bin`;
  const manifest = {
    format: 'ivo-folder',
    schemaVersion: 1,
    documents: { [doc.id]: { file, sha256 } },
    assets: {
      [asset.id]: {
        file: assetFile,
        sha256: assetHash,
        name: asset.name,
        mimeType: asset.mimeType,
      },
    },
    meta: { initialized: true, ['history:' + doc.id]: [doc] },
  };
  const original = Buffer.from(JSON.stringify(manifest) + '\n');
  await writeFile(path.join(directory, file), documentBytes);
  await writeFile(path.join(directory, assetFile), assetBytes);
  await writeFile(path.join(directory, 'atlas.json'), original);
  const vault = await openVault(directory),
    loaded = (await vault.loadDocuments())[0];
  assert.deepEqual(loaded, validateImport(fixture).documents[0]);
  assert.deepEqual((await vault.getMeta('history:' + doc.id)).value, [loaded]);
  assert.deepEqual(await readFile(path.join(directory, 'atlas.json')), original);
  assert.deepEqual(await readFile(path.join(directory, file)), documentBytes);
  assert.deepEqual(await readFile(path.join(directory, assetFile)), assetBytes);
  loaded.title = 'Edited after migration';
  await vault.saveDocument(loaded);
  const reopened = await openVault(directory);
  assert.deepEqual((await reopened.loadDocuments())[0], loaded);
  assert.deepEqual(await readFile(path.join(directory, file)), documentBytes);
  assert.deepEqual(await readFile(path.join(directory, assetFile)), assetBytes);
  assert.equal(
    (await reopened.getMeta('history:' + doc.id)).value[0].textFlows[0].html,
    loaded.textFlows[0].html,
  );
});
