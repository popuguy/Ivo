import test from 'node:test';
import assert from 'node:assert/strict';
import { validTextAttribute } from '../../src/domain/text/typography.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { validateImport } from '../../src/domain/documents/schema.js';
test('typography accepts bounded scalar controls and rejects arbitrary styling', () => {
  for (const [key, value, expected] of [
    ['size', '24.125', '24.125'],
    ['leading', '0', '0'],
    ['tracking', '-15.5', '-15.5'],
    ['font', 'cmu-serif', 'cmu-serif'],
    ['color', '#AABBCC', '#aabbcc'],
    ['align', 'justify', 'justify'],
    ['bold', 'false', 'false'],
  ])
    assert.equal(validTextAttribute(key, value), expected);
  for (const [key, value] of [
    ['size', 'Infinity'],
    ['size', '0'],
    ['tracking', '999999'],
    ['font', 'url(x)'],
    ['color', 'red'],
    ['color', '#123456;background:url(x)'],
    ['align', 'fixed'],
    ['position', 'fixed'],
    ['size', ''],
  ])
    assert.equal(validTextAttribute(key, value), null);
});
test('optional typography survives archives while legacy defaults remain absent', () => {
  const doc = createSceneDocument(),
    legacy = insertObject(doc, 'text', doc.pages[0].id),
    formatted = insertObject(doc, 'text', doc.pages[0].id, {
      leading: 0,
      tracking: 12.5,
      paragraphBefore: 4.25,
      paragraphAfter: 8,
      textColor: '#ABCDEF',
      html: '<p><span data-ivo-size="24.125" style="font-size:24.125px">Source</span></p>',
    });
  const payload = { schemaVersion: 2, documents: [doc], assets: [] },
    result = validateImport(payload).documents[0];
  assert.equal(result.blocks[0].leading, undefined);
  assert.equal(legacy.leading, undefined);
  for (const key of ['leading', 'tracking', 'paragraphBefore', 'paragraphAfter'])
    assert.equal(result.blocks[1][key], formatted[key]);
  assert.equal(result.blocks[1].textColor, '#abcdef');
  assert.equal(result.blocks[1].html, formatted.html);
  for (const [key, value] of [
    ['leading', -1],
    ['tracking', 10001],
    ['paragraphAfter', 2001],
    ['textColor', 'url(x)'],
  ]) {
    const bad = structuredClone(payload);
    bad.documents[0].blocks[1][key] = value;
    assert.throws(() => validateImport(bad), /Invalid Ivo archive/);
  }
});

test('new typography has a forward-declared document and archive version', async () => {
  const { archiveVersion, markTypographyVersion } =
    await import('../../src/domain/documents/capabilities.js');
  const d = createSceneDocument();
  insertObject(d, 'text', d.pages[0].id, { html: '<p>Legacy</p>' });
  assert.equal(archiveVersion([d]), 2);
  assert.equal(markTypographyVersion(d).canvasVersion, 1);
  d.blocks[0].html = '<p><span data-ivo-size="24" style="font-size:24px">Styled</span></p>';
  markTypographyVersion(d);
  assert.equal(d.canvasVersion, 2);
  assert.equal(archiveVersion([d]), 3);
  assert.throws(() => validateImport({ schemaVersion: 2, documents: [d], assets: [] }), /schema 3/);
  assert.equal(
    validateImport({ schemaVersion: 3, documents: [d], assets: [] }).documents[0].canvasVersion,
    2,
  );
  const earlyDevelopment = structuredClone(d);
  earlyDevelopment.canvasVersion = 1;
  const normalized = validateImport({
    schemaVersion: 2,
    documents: [earlyDevelopment],
    assets: [],
  });
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.documents[0].canvasVersion, 2);
  assert.equal(earlyDevelopment.canvasVersion, 1);
});
