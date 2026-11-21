import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPage, createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import {
  applyParent,
  createParent,
  overrideParent,
  parentObjects,
} from '../../src/domain/documents/publishing.js';
import { markTypographyVersion, archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { resolveRunningText } from '../../src/domain/documents/running-text.js';

test('running fields on one parent resolve in each section and after reordering or override', () => {
  const doc = createSceneDocument('Index & archive');
  const one = doc.pages[0],
    two = addPage(doc, one.id),
    three = addPage(doc, two.id);
  one.section = { style: 'roman-lower', prefix: '', start: 1, marker: 'Fabric <studies>' };
  three.section = { style: 'decimal-2', prefix: 'A-', start: 7, marker: 'Trims' };
  const source = '<p>«Section Marker» · <b>«Current Page Number»</b> / «Last Page Number»</p>';
  const frame = insertObject(doc, 'text', one.id, {
    html: source,
    extensions: { ivoRunningText: true },
  });
  const parent = createParent(doc, one.id);
  doc.blocks = doc.blocks.filter((b) => b.id !== frame.id);
  for (const page of doc.pages) applyParent(doc, page.id, parent.id);
  markTypographyVersion(doc);
  const archive = validateImport({
    schemaVersion: archiveVersion([doc]),
    documents: [doc],
    assets: [],
  });
  assert.equal(archive.schemaVersion, 27);
  const displayed = (p) => parentObjects(doc, p)[0].html;
  assert.equal(displayed(two), '<p>Fabric &lt;studies&gt; · <b>ii</b> / A-07</p>');
  assert.equal(displayed(three), '<p>Trims · <b>A-07</b> / A-07</p>');
  doc.pages = [one, three, two];
  assert.equal(displayed(two), '<p>Trims · <b>A-08</b> / A-08</p>');
  assert.equal(parent.blocks[0].html, source);
  overrideParent(doc, two.id);
  assert.match(doc.blocks.find((b) => b.pageId === two.id).html, /Trims · <b>A-08/);
  assert.equal(parentObjects(doc, two).length, 0);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 26 }), /archive 27/);
});
test('mixed inline typography, repeated fields and HTML in section names preserve surrounding content', () => {
  const source =
    '<p title="«Document Name»"><b>«Doc</b>ument Name» / «Doc<i>ument Name»</i></p><p>«Section</p><p> Marker»</p>';
  assert.equal(
    resolveRunningText(source, { 'document-name': 'C & <i>' }),
    '<p title="«Document Name»"><b>C &amp; &lt;i&gt;</b> / C &amp; &lt;i&gt;<i></i></p><p>«Section</p><p> Marker»</p>',
  );
});

test('a non-text parent item cannot claim to contain text variables', () => {
  const doc = createSceneDocument('Validation');
  insertObject(doc, 'polygon', doc.pages[0].id, { extensions: { ivoRunningText: true } });
  markTypographyVersion(doc);
  assert.throws(
    () => validateImport({ schemaVersion: 27, documents: [doc], assets: [] }),
    /Running text requires a text frame/,
  );
});
