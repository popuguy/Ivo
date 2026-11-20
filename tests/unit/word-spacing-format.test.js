import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateImport } from '../../src/domain/documents/schema.js';
import {
  archiveVersion,
  hasWordSpacing,
  markTypographyVersion,
} from '../../src/domain/documents/capabilities.js';
import {
  isSceneDocument,
  insertObject,
  createSceneDocument,
} from '../../src/domain/documents/scene.js';
import { saveTextStyle, createParent } from '../../src/domain/documents/publishing.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
} from '../../src/domain/documents/clipboard.js';
import { openVault } from '../../desktop/vault.mjs';

const frozen = JSON.parse(
  await readFile(new URL('../fixtures/legacy/archive-v9.json', import.meta.url), 'utf8'),
);
const fixture = () => structuredClone(frozen);
function current(configure) {
  const payload = fixture(),
    doc = payload.documents[0];
  configure?.(doc);
  markTypographyVersion(doc);
  payload.schemaVersion = archiveVersion([doc]);
  return payload;
}

test('frozen archive9 remains byte/source stable with no word-policy opt-in on read', () => {
  const before = structuredClone(frozen),
    result = validateImport(frozen);
  assert.deepEqual(frozen, before);
  assert.deepEqual(result, frozen);
  assert.equal(result.schemaVersion, 9);
  assert.equal(result.documents[0].canvasVersion, 8);
  assert.equal(hasWordSpacing(result.documents[0]), false);
  assert.equal(JSON.stringify(result).includes('wordSpacing'), false);
});

test('each source location requires archive10/canvas9, including explicit default/reset settings', () => {
  const sources = [
    (d) => {
      d.textFlows[0].style.wordSpacing = '80:100:133';
    },
    (d) => {
      d.textFlows[0].style.textOverrides = { wordSpacing: 'normal' };
    },
    (d) => {
      d.textFlows[0].html = '<p data-ivo-wordspace="80:100:133">Authored policy</p>';
    },
    (d) => {
      d.textFlows[0].html = '<p DATA-IVO-WORDSPACE = "normal">Authored reset</p>';
    },
    (d) => {
      d.blocks[0].wordSpacing = '80:100:133';
    },
    (d) => {
      d.blocks[0].textOverrides = { wordSpacing: 'normal' };
    },
    (d) => {
      d.publishing.paragraphStyles = [
        {
          id: 'spacing-style',
          name: 'Spacing',
          basedOn: null,
          attributes: { wordSpacing: '80:100:133' },
        },
      ];
    },
  ];
  for (const configure of sources) {
    const legacy = fixture();
    configure(legacy.documents[0]);
    assert(hasWordSpacing(legacy.documents[0]));
    assert.throws(() => validateImport(legacy), /archive 10 \/ canvas 9/);
    legacy.schemaVersion = 10;
    assert.throws(() => validateImport(legacy), /archive 10 \/ canvas 9/);
    markTypographyVersion(legacy.documents[0]);
    assert.equal(legacy.documents[0].canvasVersion, 9);
    const before = structuredClone(legacy),
      opened = validateImport(legacy);
    assert.deepEqual(legacy, before);
    assert.equal(opened.documents[0].canvasVersion, 9);
    assert(isSceneDocument(opened.documents[0]));
  }
});

test('named and parent text settings retain the new capability without downgrading other policies', () => {
  const doc = createSceneDocument('Parent spacing'),
    frame = insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Parent text</p>' });
  const parent = createParent(doc, doc.pages[0].id);
  parent.blocks[0].wordSpacing = '80:100:133';
  markTypographyVersion(doc);
  assert.equal(doc.canvasVersion, 9);
  const payload = validateImport({ schemaVersion: 10, documents: [doc], assets: [] });
  assert.equal(payload.documents[0].publishing.parents[0].blocks[0].wordSpacing, '80:100:133');
  saveTextStyle(doc, 'paragraph', {
    id: 'spaced',
    name: 'Spaced',
    attributes: { wordSpacing: '90:105:150' },
  });
  assert.equal(archiveVersion([doc]), 10);
  assert.equal(doc.blocks.find((block) => block.id === frame.id).html, '<p>Parent text</p>');
  assert.throws(
    () =>
      saveTextStyle(doc, 'character', {
        name: 'Invalid scope',
        attributes: { wordSpacing: '80:100:133' },
      }),
    /Invalid style property/,
  );
});

test('invalid atomic triples reject before a style mutation and reset remains a sticky capability', () => {
  const payload = current((doc) => {
    doc.textFlows[0].style.wordSpacing = '80:100:133';
  });
  const doc = payload.documents[0],
    before = structuredClone(doc);
  assert.throws(
    () =>
      saveTextStyle(doc, 'paragraph', {
        name: 'Crossed',
        attributes: { wordSpacing: '120:100:80' },
      }),
    /Invalid style property/,
  );
  assert.deepEqual(doc, before);
  doc.textFlows[0].style.wordSpacing = 'normal';
  markTypographyVersion(doc);
  assert.equal(archiveVersion([doc]), 10);
  delete doc.textFlows[0].style.wordSpacing;
  markTypographyVersion(doc);
  assert.equal(doc.canvasVersion, 9);
  assert.equal(archiveVersion([doc]), 10);
  for (const value of ['80:100', '120:100:80', 'NaN:100:133']) {
    const broken = structuredClone(payload);
    broken.documents[0].textFlows[0].style.wordSpacing = value;
    assert.throws(() => validateImport(broken), /wordSpacing.*typography/);
  }
});

test('document/object copies and clipboard retain exact word source while assigning independent flow identities', () => {
  const payload = current((doc) => {
      doc.textFlows[0].style.wordSpacing = '80.25:100.5:133.75';
    }),
    doc = validateImport(payload).documents[0],
    before = structuredClone(doc),
    copy = copyDocument(doc);
  assert.notEqual(copy.textFlows[0].id, doc.textFlows[0].id);
  assert.equal(copy.textFlows[0].style.wordSpacing, '80.25:100.5:133.75');
  const clipboard = copyObjectSelection(doc, [doc.blocks[0].id]),
    fragment = readObjectClipboard(JSON.stringify(clipboard)),
    target = createSceneDocument('Paste target');
  pasteObjectSelection(target, fragment, { pageId: target.pages[0].id });
  assert.equal(target.canvasVersion, 9);
  assert.equal(target.textFlows[0].html, doc.textFlows[0].html);
  assert.equal(target.textFlows[0].style.wordSpacing, doc.textFlows[0].style.wordSpacing);
  assert.notEqual(target.textFlows[0].id, doc.textFlows[0].id);
  assert.deepEqual(doc, before);
  assert.equal(
    validateImport({ schemaVersion: archiveVersion([target]), documents: [target], assets: [] })
      .schemaVersion,
    10,
  );
});

test('folder storage reopens word policy and keeps the previous immutable revision untouched', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ivo-word-spacing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let vault = await openVault(directory);
  const old = fixture().documents[0];
  await vault.saveDocument(old);
  const manifestBefore = JSON.parse(await readFile(path.join(directory, 'atlas.json'), 'utf8')),
    entry = manifestBefore.documents[old.id],
    original = await readFile(path.join(directory, entry.file));
  const changed = current((doc) => {
    doc.textFlows[0].style.wordSpacing = '80:100:133';
  }).documents[0];
  await vault.saveDocument(changed);
  vault = await openVault(directory);
  const reopened = (await vault.loadDocuments())[0];
  assert.equal(reopened.canvasVersion, 9);
  assert.equal(reopened.textFlows[0].style.wordSpacing, '80:100:133');
  assert.equal(reopened.textFlows[0].html, old.textFlows[0].html);
  assert.deepEqual(await readFile(path.join(directory, entry.file)), original);
  const invalid = structuredClone(reopened);
  invalid.textFlows[0].style.wordSpacing = '150:100:80';
  const stableManifest = await readFile(path.join(directory, 'atlas.json'));
  await assert.rejects(vault.saveDocument(invalid), /wordSpacing/);
  assert.deepEqual(await readFile(path.join(directory, 'atlas.json')), stableManifest);
  assert.equal((await vault.loadDocuments())[0].textFlows[0].style.wordSpacing, '80:100:133');
});

test('existing archive15 and authored archive16 justification survive a cold load without rewriting older notes', async () => {
  const old = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v15.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(validateImport(old), old);
  const value = '80:100:125|-7.5:0:18|94:100:105.5';
  for (const configure of [
    (d) => {
      d.textFlows[0].style.wordSpacing = value;
    },
    (d) => {
      d.textFlows[0].style.textOverrides = { wordSpacing: value };
    },
    (d) => {
      d.textFlows[0].html = '<p data-ivo-wordspace="' + value + '">Experiment</p>';
    },
    (d) => {
      d.textFlows[0].html =
        '<p data-ivo-wordspace=' + value.replaceAll('|', '&#124;') + '>Encoded</p>';
    },
    (d) => {
      d.publishing.paragraphStyles = [
        {
          id: 'new-justification',
          name: 'Magazine',
          basedOn: null,
          attributes: { wordSpacing: value },
        },
      ];
    },
  ]) {
    const archive = structuredClone(old),
      doc = archive.documents[0];
    configure(doc);
    assert.throws(() => validateImport(archive), /archive 16/);
    markTypographyVersion(doc);
    archive.schemaVersion = archiveVersion([doc]);
    assert.equal(archive.schemaVersion, 16);
    const normalized = validateImport(archive);
    assert.equal(normalized.documents[0].canvasVersion, 15);
    assert.deepEqual(validateImport(normalized), normalized);
    doc.canvasVersion = 14;
    assert.throws(() => validateImport(archive), /canvas 15/);
  }
  assert.deepEqual(validateImport(old), old);
});
