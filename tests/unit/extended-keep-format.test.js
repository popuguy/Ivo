import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateImport } from '../../src/domain/documents/schema.js';
import {
  archiveVersion,
  markTypographyVersion,
  hasExtendedKeeps,
} from '../../src/domain/documents/capabilities.js';
import { createParent, saveTextStyle } from '../../src/domain/documents/publishing.js';
import { createSceneDocument, insertObject, addPage } from '../../src/domain/documents/scene.js';
import { openVault } from '../../desktop/vault.mjs';

const frozen = JSON.parse(
  await readFile(new URL('../fixtures/legacy/archive-v10.json', import.meta.url), 'utf8'),
);
test('existing one-line joins retain archive 10 and their exact source on open', () => {
  assert.deepEqual(validateImport(frozen), frozen);
  assert.equal(hasExtendedKeeps(frozen.documents[0]), false);
  assert.equal(archiveVersion(frozen.documents), 10);
});

test('extended keeps promote all authoring locations and preserve explicit resets', () => {
  for (const write of [
    (d) => (d.textFlows[0].style.keepNextLines = 3),
    (d) => (d.textFlows[0].style.textOverrides = { keepWithPrevious: false }),
    (d) => (d.textFlows[0].html = '<p DATA-IVO-PREVIOUS = "true">Caption</p>'),
    (d) => (d.blocks[0].keepWithPrevious = false),
    (d) => (d.blocks[0].textOverrides = { keepNextLines: 1 }),
    (d) =>
      saveTextStyle(d, 'paragraph', {
        name: 'Heading',
        attributes: { keepWithNext: true, keepNextLines: 3 },
      }),
    (d) => {
      const page = addPage(d, d.pages[0].id);
      const frame = insertObject(d, 'text', page.id, { html: '<p>Parent caption</p>' });
      const parent = createParent(d, page.id);
      parent.blocks.find((b) => b.html === frame.html).keepWithPrevious = true;
    },
  ]) {
    const input = structuredClone(frozen),
      doc = input.documents[0];
    write(doc);
    assert.equal(hasExtendedKeeps(doc), true);
    assert.throws(() => validateImport(input), /archive 11 \/ canvas 10/);
    markTypographyVersion(doc);
    input.schemaVersion = archiveVersion([doc]);
    assert.equal(input.schemaVersion, 11);
    assert.equal(validateImport(input).documents[0].canvasVersion, 10);
  }
});

test('counts and previous flags validate before saving and sticky version survives resets', () => {
  const input = structuredClone(frozen),
    doc = input.documents[0];
  doc.textFlows[0].style.keepNextLines = 4;
  markTypographyVersion(doc);
  input.schemaVersion = 11;
  for (const value of [0, 6, 1.5, '2', null]) {
    const bad = structuredClone(input);
    bad.documents[0].textFlows[0].style.keepNextLines = value;
    assert.throws(() => validateImport(bad), /keepNextLines/);
  }
  for (const value of ['false', 0]) {
    const bad = structuredClone(input);
    bad.documents[0].textFlows[0].style.keepWithPrevious = value;
    assert.throws(() => validateImport(bad), /keepWithPrevious/);
  }
  delete doc.textFlows[0].style.keepNextLines;
  markTypographyVersion(doc);
  assert.equal(archiveVersion([doc]), 11);
  assert.throws(() => validateImport({ ...input, schemaVersion: 10 }), /archive 11 \/ canvas 10/);
  const simple = createSceneDocument('Character scope');
  assert.throws(
    () =>
      saveTextStyle(simple, 'character', { name: 'Bad scope', attributes: { keepNextLines: 3 } }),
    /Invalid style property/,
  );
});

test('folder vault reopens counted and backward joins without rewriting the previous revision', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ivo-keeps-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const vault = await openVault(folder),
    doc = structuredClone(frozen.documents[0]);
  await vault.saveDocument(doc);
  const manifest = JSON.parse(await readFile(path.join(folder, 'atlas.json'), 'utf8'));
  const originalPath = path.join(folder, manifest.documents[doc.id].file),
    oldBytes = await readFile(originalPath);
  doc.textFlows[0].html =
    '<p data-ivo-next="true" data-ivo-nextlines="3">Heading</p><p>Body</p><p data-ivo-previous="true">Caption</p>';
  markTypographyVersion(doc);
  await vault.saveDocument(doc);
  const [reopened] = await (await openVault(folder)).loadDocuments();
  assert.equal(reopened.canvasVersion, 10);
  assert.equal(reopened.textFlows[0].html, doc.textFlows[0].html);
  assert.deepEqual(await readFile(originalPath), oldBytes);
});

test('paragraph starts upgrade only authored documents and validate the location vocabulary', async () => {
  const old = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v11.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(validateImport(old), old);
  assert.equal(archiveVersion(old.documents), 11);
  for (const rule of ['anywhere', 'column', 'frame', 'page', 'odd', 'even']) {
    const payload = structuredClone(old),
      doc = payload.documents[0];
    doc.textFlows[0].style.paragraphStart = rule;
    assert.throws(() => validateImport(payload), /archive 12/);
    markTypographyVersion(doc);
    payload.schemaVersion = archiveVersion([doc]);
    assert.equal(payload.schemaVersion, 12);
    assert.equal(validateImport(payload).documents[0].textFlows[0].style.paragraphStart, rule);
    doc.textFlows[0].style.paragraphStart = 'unknown';
    assert.throws(() => validateImport(payload), /paragraphStart/);
  }
});
