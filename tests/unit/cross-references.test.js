import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { crossReferenceResolver } from '../../src/domain/documents/cross-references.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { markTypographyVersion, archiveVersion } from '../../src/domain/documents/capabilities.js';
import { createSceneDocument, addPage, insertObject } from '../../src/domain/documents/scene.js';
import { copyDocument } from '../../src/domain/documents/copy.js';

test('opening earlier table and chapter-link archives preserves their original content and version', async () => {
  for (const version of [29, 30]) {
    const raw = JSON.parse(
      await readFile(
        new URL('../fixtures/legacy/archive-v' + version + '.json', import.meta.url),
        'utf8',
      ),
    );
    const doc = validateImport(raw).documents[0];
    assert.equal(archiveVersion([doc]), version);
    assert.equal(doc.canvasVersion, version - 1);
    assert.deepEqual(doc.blocks[0].table, raw.documents[0].blocks[0].table);
    assert.equal(doc.blocks[0].html, raw.documents[0].blocks[0].html);
  }
});

test('formatted references bind by document and page ID across renumbering and copying', () => {
  const doc = createSceneDocument('Assembly'),
    other = createSceneDocument('Fabric');
  const page = addPage(doc, doc.pages[0].id);
  page.section = { start: 27, style: 'letters-upper', prefix: 'S-' };
  other.pages[0].id = page.id;
  const resolve = crossReferenceResolver([other, doc]);
  assert.equal(resolve(doc.id, page.id, 'document-page'), 'Assembly, S-AA');
  assert.equal(resolve(other.id, page.id, 'folio'), '1');
  assert.equal(resolve(doc.id, 'missing', 'folio'), null);
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<a data-xref-format="folio" href="#page=' + page.id + '">S-AA</a>',
  });
  markTypographyVersion(doc);
  const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(archive.schemaVersion, 31);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 30 }), /archive 31/);
  const copy = copyDocument(validateImport(archive).documents[0]);
  assert.ok(copy.blocks[0].html.includes('#page=' + copy.pages[1].id));
  frame.html = frame.html.replace('folio', 'unrecognized');
  assert.throws(() => validateImport(archive), /invalid cross-reference/);
});
