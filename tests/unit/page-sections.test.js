import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSection, pageFolios } from '../../src/domain/documents/page-sections.js';
import { createSceneDocument, addPage, removePage } from '../../src/domain/documents/scene.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';

test('section starts track page identity through insertion, deletion and archive reopen', () => {
  const doc = createSceneDocument('Book'),
    front = doc.pages[0],
    next = addPage(doc, front.id),
    body = addPage(doc, next.id);
  front.section = { style: 'roman-lower', prefix: '', start: 3 };
  body.section = { style: 'decimal', prefix: 'É–', start: 1 };
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'iv', 'É–1']);
  addPage(doc, next.id);
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'iv', 'v', 'É–1']);
  removePage(doc, front.id);
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'iv', 'É–1']);
  body.section.start = null;
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'iv', 'É–5']);
  markTypographyVersion(doc);
  const payload = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(payload.schemaVersion, 25);
  assert.deepEqual(pageFolios(validateImport(payload).documents[0].pages), pageFolios(doc.pages));
  assert.throws(() => validateImport({ ...payload, schemaVersion: 24 }), /archive 25/);
  for (const bad of [{ start: 0 }, { prefix: '+' }, { style: 'fake' }])
    assert.throws(() => pageSection({ ...front.section, ...bad }));
});
