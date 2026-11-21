import test from 'node:test';
import assert from 'node:assert/strict';
import { indexSettings } from '../../src/domain/documents/subject-index.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { writePublicationText } from '../../src/domain/documents/contents.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
const reference = (from, to, kind = 'see') => ({ from: [from], to: [to], kind });
test('index references and collation validate the complete topic tree', () => {
  const spec = {
    topics: [['Fibres', 'Wool'], ['Linen']],
    references: [reference('Flax', 'Linen'), reference('Linen', 'Fibres', 'also')],
    sortKeys: [{ path: ['Flax'], key: 'Á flax' }],
  };
  assert.deepEqual(indexSettings(spec), {
    title: 'Index',
    topics: spec.topics,
    ranges: true,
    references: spec.references,
    sortKeys: spec.sortKeys,
  });
  for (const references of [
    [reference('x', 'Missing')],
    [reference('Linen', 'Linen')],
    [reference('Linen', 'Fibres'), reference('Fibres', 'Linen')],
    [reference('Flax', 'Linen'), reference('Flax', 'Fibres', 'also')],
  ])
    assert.throws(() => indexSettings({ ...spec, references }));
  assert.throws(() => indexSettings({ ...spec, sortKeys: [{ path: ['Unknown'], key: 'x' }] }));
});
test('new index settings raise the format version only when used', () => {
  const doc = createSceneDocument('Indexing'),
    frame = insertObject(doc, 'text', doc.pages[0].id);
  writePublicationText(doc, frame, '<p>Linen</p>', { topics: [['Linen']] }, { kind: 'index' });
  assert.equal(archiveVersion([doc]), 28);
  writePublicationText(
    doc,
    frame,
    '<p>Flax: see Linen</p>',
    { topics: [['Linen']], references: [reference('Flax', 'Linen')] },
    { kind: 'index', update: true },
  );
  const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(archive.schemaVersion, 29);
  assert.deepEqual(validateImport(archive).documents[0].textFlows[0].index.references, [
    reference('Flax', 'Linen'),
  ]);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 28 }));
});
