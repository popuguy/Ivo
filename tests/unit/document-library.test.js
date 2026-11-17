import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFolder,
  libraryInfo,
  setLibraryInfo,
  normalizeLibraryMeta,
  folderPaths,
  isTrashed,
} from '../../src/domain/documents/library.js';
import { createSceneDocument } from '../../src/domain/documents/scene.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';

test('Logical folders normalize Unicode names and reject filesystem-style traversal or invalid segments', () => {
  assert.equal(normalizeFolder(''), '');
  assert.equal(normalizeFolder('  '), '');
  assert.equal(normalizeFolder(' Fashion / Cafe\u0301 / Fittings '), 'Fashion/Café/Fittings');
  assert.equal(normalizeFolder('🧵'.repeat(256)), '🧵'.repeat(256));
  for (const invalid of [
    '/outside',
    'a/',
    'a//b',
    '.',
    '..',
    'a/../b',
    'a/./b',
    'a\\b',
    'a/ \t /b',
    'a\u0000b',
    'a\n',
    '\n',
    null,
    [],
    42,
  ])
    assert.throws(() => normalizeFolder(invalid), TypeError);
  assert.throws(() => normalizeFolder('🧵'.repeat(257)), RangeError);
  assert.throws(() => normalizeFolder('a'.repeat(4097)), RangeError);
});
test('Library metadata changes preserve authored sources and unrelated extension data and round-trip in archives', () => {
  const document = createSceneDocument('Fitting notes');
  document.extensions = {
    thirdParty: { keep: ['source', 3] },
    'ivo.library': { future: { retained: true } },
  };
  const original = structuredClone(document);
  assert.deepEqual(libraryInfo(document), { folder: '', bookmarked: false, trashedAt: null });
  assert.deepEqual(setLibraryInfo(document, { folder: 'Fashion/Fittings', bookmarked: true }), {
    folder: 'Fashion/Fittings',
    bookmarked: true,
    trashedAt: null,
  });
  setLibraryInfo(document, { trashedAt: '2026-11-15T05:00:00-05:00' });
  assert.equal(isTrashed(document), true);
  assert.equal(libraryInfo(document).trashedAt, '2026-11-15T10:00:00.000Z');
  assert.deepEqual(document.extensions.thirdParty, original.extensions.thirdParty);
  assert.deepEqual(document.extensions['ivo.library'].future, { retained: true });
  assert.deepEqual(document.pages, original.pages);
  assert.deepEqual(document.blocks, original.blocks);
  assert.equal(document.id, original.id);
  const reopened = validateImport({
    schemaVersion: archiveVersion([document]),
    documents: [document],
    assets: [],
  }).documents[0];
  assert.deepEqual(libraryInfo(reopened), libraryInfo(document));
  setLibraryInfo(reopened, { trashedAt: null });
  assert.equal(isTrashed(reopened), false);
  assert.equal(libraryInfo(reopened).folder, 'Fashion/Fittings');
  assert.equal(libraryInfo(document).bookmarked, true);
});
test('Malformed library state cannot trash a document or change unrelated extensions on rejected commands', () => {
  const document = {
    extensions: {
      'ivo.library': {
        folder: '../foreign',
        bookmarked: 'true',
        trashedAt: '2026-11-31T00:00:00Z',
      },
      other: { untouched: true },
    },
  };
  assert.deepEqual(libraryInfo(document), { folder: '', bookmarked: false, trashedAt: null });
  assert.equal(isTrashed(document), false);
  const before = JSON.stringify(document);
  for (const patch of [
    { folder: 'a//b' },
    { bookmarked: 1 },
    { trashedAt: 'yesterday' },
    { trashedAt: '2026-11-31T00:00:00Z' },
    { trashedAt: '2026-11-15' },
    null,
  ])
    assert.throws(() => setLibraryInfo(document, patch), TypeError);
  assert.equal(JSON.stringify(document), before);
  setLibraryInfo(document, { folder: 'Working' });
  assert.deepEqual(document.extensions.other, { untouched: true });
  assert.equal(libraryInfo(document).folder, 'Working');
});
test('Folder metadata and document folders retain sorted ancestors, omit trashed-only paths and stay bounded', () => {
  const value = normalizeLibraryMeta({
    version: 1,
    folders: [
      'Fashion/Fittings/November',
      'Fashion/Fittings',
      'Café',
      'Cafe\u0301',
      '../bad',
      '',
      'Hidden/Empty',
      'a//b',
    ],
  });
  assert.deepEqual(value, {
    version: 1,
    folders: [
      'Café',
      'Fashion',
      'Fashion/Fittings',
      'Fashion/Fittings/November',
      'Hidden',
      'Hidden/Empty',
    ],
  });
  assert.deepEqual(normalizeLibraryMeta({ version: 2, folders: ['Ignored'] }), {
    version: 1,
    folders: [],
  });
  const live = { id: 'one' },
    trash = { id: 'two' };
  setLibraryInfo(live, { folder: 'Fabric/Silk' });
  setLibraryInfo(trash, { folder: 'Trashed/Only', trashedAt: '2026-11-15T00:00:00.000Z' });
  assert.deepEqual(folderPaths([live, trash], { version: 1, folders: ['Saved/Empty'] }), [
    'Fabric',
    'Fabric/Silk',
    'Saved',
    'Saved/Empty',
  ]);
  const many = normalizeLibraryMeta({
    version: 1,
    folders: Array.from(
      { length: 600 },
      (_, index) => 'Parent' + String(index).padStart(3, '0') + '/Child',
    ),
  });
  assert.equal(many.folders.length, 500);
  assert.equal(new Set(many.folders).size, 500);
  for (const folder of many.folders)
    if (folder.includes('/')) assert.ok(many.folders.includes(folder.split('/')[0]));
  assert.deepEqual(normalizeLibraryMeta(many), many);
});
