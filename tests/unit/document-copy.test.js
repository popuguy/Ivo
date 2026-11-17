import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, addPage, insertObject } from '../../src/domain/documents/scene.js';
import {
  copyDocument,
  createUserTemplate,
  instantiateTemplate,
  isTemplate,
} from '../../src/domain/documents/copy.js';
import { buildIndex } from '../../src/domain/knowledge/index.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';

test('Document copies remap all owned IDs and self-links, preserving hierarchy, media and rich text', () => {
  const doc = createSceneDocument('Layout');
  doc.aliases = ['Old alias'];
  Object.assign(addPage(doc, doc.pages[0].id), { width: 800.25, height: 500 });
  const mask = insertObject(doc, 'polygon', doc.pages[1].id, { x: 27.25, y: 30.5 }),
    _text = insertObject(doc, 'text', mask.pageId, {
      parentId: mask.id,
      x: 8,
      y: 9,
      textStyle: 'cmu-serif',
      html: `<p><strong>Retained</strong> <a data-doc-id="${doc.id}" href="#doc=${doc.id}">Self</a></p>`,
    });
  const before = JSON.stringify(doc),
    copy = copyDocument(doc);
  assert.equal(JSON.stringify(doc), before);
  assert.notEqual(copy.id, doc.id);
  assert.deepEqual(copy.aliases, []);
  assert.equal(copy.blocks[1].parentId, copy.blocks[0].id);
  assert.equal(copy.blocks[0].pageId, copy.pages[1].id);
  assert.equal(copy.blocks[0].x, 27.25);
  assert.equal(copy.blocks[1].textStyle, 'cmu-serif');
  assert.ok(copy.blocks[1].html.includes(`<a data-doc-id="${copy.id}" href="#doc=${copy.id}">`));
  assert.ok(copy.blocks[1].html.includes('<strong>Retained</strong>'));
  const all = (doc) => [
    doc.id,
    ...doc.pages.map((p) => p.id),
    ...doc.blocks.flatMap((b) => [b.id, ...(b.points || []).map((p) => p.id)]),
  ];
  assert.ok(all(copy).every((id) => !all(doc).includes(id)));
  validateImport({ schemaVersion: 2, documents: [doc, copy], assets: [] });
  assert.equal(buildIndex([copy]).edges[0].target, copy.id);
});
test('Reusable template and instances round-trip through archives without sharing mutable source', () => {
  const source = createSceneDocument('Working document'),
    _item = insertObject(source, 'text', source.pages[0].id, {
      fontSize: 20,
      textStyle: 'cmu-serif',
      html: '<p>Original</p>',
    }),
    before = JSON.stringify(source);
  const template = createUserTemplate(source, 'Fashion layout');
  assert.equal(isTemplate(template), true);
  const archive = validateImport({
    schemaVersion: archiveVersion([template]),
    documents: [template],
    assets: [],
  });
  assert.equal(isTemplate(archive.documents[0]), true);
  const one = instantiateTemplate(archive.documents[0], 'First fitting'),
    two = instantiateTemplate(template, 'Second fitting');
  assert.equal(isTemplate(one), false);
  assert.equal(one.title, 'First fitting');
  assert.notEqual(one.id, two.id);
  one.blocks[0].html = 'Changed';
  assert.equal(two.blocks[0].html, '<p>Original</p>');
  assert.equal(template.blocks[0].html, '<p>Original</p>');
  assert.equal(JSON.stringify(source), before);
  assert.throws(() => instantiateTemplate(source, 'Invalid'), /available template/);
});

test('Templates reuse original media references and keep crop edits independent', () => {
  const source = createSceneDocument('Image layout'),
    image = insertObject(source, 'image', source.pages[0].id, {
      src: 'asset:original-image',
      crop: { x: 30, y: 75 },
      caption: 'Original caption',
    });
  const asset = {
    id: 'original-image',
    name: 'Original.png',
    mimeType: 'image/png',
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGN49vorVmSUsgUrYhjVQBMNuCRwGTSqgSYaACk0CB+bcN8GAAAAAElFTkSuQmCC',
  };
  const template = createUserTemplate(source, 'Image template'),
    copy = instantiateTemplate(template, 'Fitting');
  const archive = validateImport({
    schemaVersion: 2,
    documents: [source, template, copy],
    assets: [asset],
  });
  assert.equal(archive.assets.length, 1);
  assert.equal(archive.assets[0].data, asset.data);
  assert.equal(copy.blocks[0].src, image.src);
  assert.equal(copy.blocks[0].caption, 'Original caption');
  copy.blocks[0].crop.x = 10;
  assert.equal(template.blocks[0].crop.x, 30);
  assert.equal(source.blocks[0].crop.x, 30);
});
