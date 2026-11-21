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

test('InDesign numbering at the deletion of an initial or subsequent section boundary', () => {
  const doc = createSceneDocument('Folio comparison');
  const front = doc.pages[0],
    other = addPage(doc, front.id),
    body = addPage(doc, other.id);
  addPage(doc, body.id);
  front.section = { start: 3, style: 'roman-lower', prefix: '' };
  body.section = { start: 9, style: 'decimal-3', prefix: 'S–' };
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'iv', 'S–009', 'S–010']);
  body.section.includePrefix = false;
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'iv', '009', '010']);
  body.section.includePrefix = true;
  const initial = structuredClone(doc);
  removePage(doc, front.id);
  assert.deepEqual(pageFolios(doc.pages), ['iii', 'S–009', 'S–010']);
  removePage(doc, other.id);
  assert.deepEqual(pageFolios(doc.pages), ['S–009', 'S–010']);
  removePage(initial, body.id);
  assert.deepEqual(pageFolios(initial.pages), ['iii', 'iv', 'v']);
});

test('alphabetic rollover, hidden prefix and padded section numbers survive a vault round trip', () => {
  const doc = createSceneDocument('Number formats'),
    p = doc.pages[0];
  addPage(doc, p.id);
  for (const [style, start, expected] of [
    ['letters-upper', 26, ['Z', 'AA']],
    ['letters-lower', 702, ['zz', 'aaa']],
    ['decimal-2', 99, ['99', '100']],
    ['decimal-3', 9, ['009', '010']],
    ['decimal-4', 99, ['0099', '0100']],
  ]) {
    p.section = { start, style, prefix: 'Edition', includePrefix: false };
    markTypographyVersion(doc);
    const packet = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
    assert.equal(packet.schemaVersion, 26);
    assert.equal(doc.canvasVersion, 25);
    const reopened = validateImport(packet).documents[0];
    assert.deepEqual(pageFolios(reopened.pages), expected);
    reopened.pages[0].section.includePrefix = true;
    assert.equal(pageFolios(reopened.pages)[0], 'Edition' + expected[0]);
    assert.throws(() => validateImport({ ...packet, schemaVersion: 25 }), /archive 26/);
  }
});
