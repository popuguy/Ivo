import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMergeRecords, mergeRecordRange } from '../../src/domain/text/merge-records.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import {
  orderPublicationEntries,
  publicationSettings,
} from '../../src/domain/documents/publication-order.js';

test('merge records preserve quoted text, empty fields, embedded newlines, spaces and literal quotes', () => {
  const expected = [
    [' Élise, «Я» ', 'a"b\nnext'],
    ['', ''],
  ];
  for (const d of [',', ';', '\t']) {
    const csv = '\uFEFF"A;B"' + d + 'B\r\n" Élise, «Я» "' + d + '"a""b\r\nnext"\r\n' + d + '\r\n';
    assert.deepEqual(parseMergeRecords(csv), { headers: ['A;B', 'B'], records: expected });
  }
  for (const value of [
    'x,X\na',
    'A,A\n1,2',
    'A,B\n1,2,3',
    'A\n"open',
    'A\n"ok"junk',
    'A\nx"y',
    'A,B\n',
  ])
    assert.throws(() => parseMergeRecords(value));
  assert.deepEqual(parseMergeRecords('A\n""').records, [['']]);
  assert.throws(() => mergeRecordRange(0, 2, 3));
  assert.throws(() => mergeRecordRange(3, 1, 3));
});

test('publication order survives archive and duplication and keeps new objects visible in page order', () => {
  const doc = createSceneDocument('Book'),
    b = insertObject(doc, 'text', doc.pages[0].id),
    c = insertObject(doc, 'image', doc.pages[0].id);
  doc.publication = {
    version: 1,
    order: [c.id, b.id],
    excluded: [b.id],
    chapters: ['chapter-2', doc.id],
  };
  markTypographyVersion(doc);
  const payload = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  const [loaded] = validateImport(payload).documents;
  assert.equal(payload.schemaVersion, 23);
  assert.deepEqual(loaded.publication, doc.publication);
  assert.throws(() => validateImport({ ...payload, schemaVersion: 22 }), /archive 23/);
  const copy = copyDocument(loaded);
  assert.deepEqual(copy.publication, {
    version: 1,
    order: [copy.blocks[1].id, copy.blocks[0].id],
    excluded: [copy.blocks[0].id],
    chapters: ['chapter-2', copy.id],
  });
  const entries = [{ id: 'new' }, b, c];
  assert.deepEqual(
    orderPublicationEntries(entries, doc.publication).map((e) => e.id),
    [c.id, 'new'],
  );
  assert.throws(() => publicationSettings({ ...doc.publication, chapters: ['other'] }, doc.id));
  assert.throws(() => publicationSettings({ ...doc.publication, order: ['x', 'x'] }, doc.id));
  assert.throws(() =>
    publicationSettings({ ...doc.publication, headings: { 'style-1': 8 } }, doc.id),
  );
});
