import {
  paragraphDestinations,
  paragraphDestination,
} from '../../src/domain/documents/paragraph-destinations.js';
import { startTextFlow } from '../../src/domain/documents/text-flows.js';
import { copyObjectSelection, pasteObjectSelection } from '../../src/domain/documents/clipboard.js';
import { validateReferenceFormats } from '../../src/domain/documents/reference-formats.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { crossReferenceResolver } from '../../src/domain/documents/cross-references.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { markTypographyVersion, archiveVersion } from '../../src/domain/documents/capabilities.js';
import { createSceneDocument, addPage, insertObject } from '../../src/domain/documents/scene.js';
import { copyDocument } from '../../src/domain/documents/copy.js';

test('opening earlier table and chapter-link archives preserves their original content and version', async () => {
  for (const version of [29, 30, 31]) {
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

test('document-owned formats combine live chapter fields, survive copying and reject unknown blocks', () => {
  const source = createSceneDocument('Book'),
    chapter = createSceneDocument('Cloth & dyes');
  chapter.pages[0].section = { style: 'roman-lower', start: 8, prefix: '', marker: 'Échantillons' };
  const page = addPage(chapter, chapter.pages[0].id);
  const format = {
    id: 'xref-test',
    name: 'Swatch reference',
    definition: '<sectionMarker/> · <fileName/> — p. <pageNum/> (<pageName/>)',
  };
  source.referenceFormats = [format];
  const block = insertObject(source, 'text', source.pages[0].id, {
    html:
      '<p><a data-xref-format="xref-test" data-doc-id="' +
      chapter.id +
      '" data-page-id="' +
      page.id +
      '" href="#doc=' +
      chapter.id +
      '">proof</a></p>',
  });
  markTypographyVersion(source);
  markTypographyVersion(chapter);
  const archive = {
    schemaVersion: archiveVersion([source, chapter]),
    documents: [source, chapter],
    assets: [],
  };
  assert.equal(archive.schemaVersion, 33);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 32 }), /archive 33/);
  const reopened = validateImport(archive).documents[0];
  assert.equal(
    crossReferenceResolver([chapter], reopened)(chapter.id, page.id, format.id),
    'Échantillons · Cloth & dyes — p. ix (Page 2)',
  );
  assert.throws(() => validateReferenceFormats([{ ...format, definition: '<unknown/>' }]), /block/);
  assert.throws(() => validateReferenceFormats([format, { ...format, id: 'xref-second' }]), /name/);
  const to = createSceneDocument('Recipient');
  to.referenceFormats = [{ ...format, definition: '<pageNum/>' }];
  markTypographyVersion(to);
  const packet = copyObjectSelection(source, [block.id]);
  const pasted = pasteObjectSelection(to, packet.archive, { pageId: to.pages[0].id });
  assert.equal(to.referenceFormats.length, 2);
  const added = to.referenceFormats[1];
  assert.notEqual(added.id, format.id);
  assert.equal(added.name, 'Swatch reference (2)');
  assert.match(pasted[0].html, new RegExp(added.id));
  const clone = copyDocument(reopened);
  assert.deepEqual(clone.referenceFormats, source.referenceFormats);
});

test('a paragraph remains addressable on promotion and full-document duplication', () => {
  const doc = createSceneDocument('Notes');
  const page = doc.pages[0].id;
  const target = insertObject(doc, 'text', page, {
    html: '<p data-paragraph-destination="par-linen">Linen &amp; <i>silk</i></p>',
  });
  const field = insertObject(doc, 'text', page, {
    html:
      '<p><a data-xref-format="paragraph-text" data-xref-paragraph="' +
      target.id +
      '/par-linen" href="#page=' +
      page +
      '">Linen &amp; silk</a></p>',
  });
  markTypographyVersion(doc);
  const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(doc.canvasVersion, 32);
  assert.equal(archive.schemaVersion, 33);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 32 }), /archive 33/);
  assert.equal(validateImport(archive).documents[0].blocks[0].html, target.html);
  const original = target.id + '/par-linen';
  const lookup = (d) => paragraphDestination(d, paragraphDestinations(d), original);
  assert.equal(lookup(doc).title, 'Linen & silk');
  const flow = startTextFlow(doc, target.id);
  assert.equal(lookup(doc).source, flow.id);
  const copy = copyDocument(doc);
  assert.ok(copy.blocks[1].html.includes(copy.blocks[0].id + '/par-linen'));
  assert.equal(
    paragraphDestination(copy, paragraphDestinations(copy), copy.blocks[0].id + '/par-linen').title,
    'Linen & silk',
  );
  flow.html += flow.html;
  assert.equal(lookup(doc), null);
  flow.html = '';
  assert.equal(lookup(doc), undefined);
  field.html = field.html.replace('/par-linen', '/invalid!');
  assert.throws(() => validateImport(archive), /invalid paragraph reference/);
});
