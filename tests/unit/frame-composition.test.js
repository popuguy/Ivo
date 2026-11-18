import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  firstBaselineOffset,
  frameCompositionOffset,
} from '../../src/domain/text/frame-composition.js';
import {
  createSceneDocument,
  insertObject,
  isSceneDocument,
} from '../../src/domain/documents/scene.js';
import {
  enablePublishing,
  enableFrameComposition,
  createParent,
  commitParentDefinition,
} from '../../src/domain/documents/publishing.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
} from '../../src/domain/documents/clipboard.js';
import { createPDFSnapshot } from '../../src/features/export/pdf-plan.js';

test('first-baseline policies use supplied font/line metrics and honor the declared minimum', () => {
  const metrics = { ascent: 11.5, 'cap-height': 10, 'x-height': 7.25, leading: 18 };
  for (const [policy, expected] of Object.entries(metrics))
    assert.equal(firstBaselineOffset(policy, 0, metrics), expected);
  assert.equal(firstBaselineOffset('fixed', 19.375, metrics), 19.375);
  assert.equal(firstBaselineOffset('ascent', 20, metrics), 20);
  assert.throws(() => firstBaselineOffset('imaginary', 0, metrics));
  assert.throws(() => firstBaselineOffset('ascent', -1, metrics));
  assert.throws(() => firstBaselineOffset('ascent', 0, {}));
});

test('vertical alignment changes only derived geometry and clamps overset rather than altering leading', () => {
  const input = {
    policy: 'fixed',
    minimum: 18,
    metrics: {},
    naturalBaseline: 14,
    contentHeight: 44,
    availableHeight: 200,
  };
  const top = frameCompositionOffset(input),
    center = frameCompositionOffset({ ...input, verticalAlign: 'center' }),
    bottom = frameCompositionOffset({ ...input, verticalAlign: 'bottom' });
  assert.equal(top.baselineShift, 4);
  assert.equal(center.alignmentShift, 76);
  assert.equal(bottom.alignmentShift, 152);
  assert.equal(top.height + top.top, 200);
  assert.equal(center.height + center.top, 200);
  assert.equal(bottom.height + bottom.top, 200);
  assert.equal(
    frameCompositionOffset({ ...input, contentHeight: 300, verticalAlign: 'center' })
      .alignmentShift,
    0,
  );
  assert.equal(frameCompositionOffset({ ...input, policy: 'fixed', minimum: 5 }).baselineShift, -9);
});

test('frozen archive6/canvas5 keeps original source without implicit first-baseline defaults or upgrading', async () => {
  const raw = JSON.parse(
      await readFile(new URL('../fixtures/legacy/archive-v6.json', import.meta.url), 'utf8'),
    ),
    before = structuredClone(raw),
    decoded = validateImport(raw);
  assert.deepEqual(raw, before);
  assert.equal(decoded.schemaVersion, 6);
  assert.equal(decoded.documents[0].canvasVersion, 5);
  assert.equal(decoded.documents[0].blocks[0].frameOptions.firstBaseline, undefined);
  assert.equal(decoded.documents[0].blocks[0].html, before.documents[0].blocks[0].html);
  assert.deepEqual(decoded.documents[0].extensions, before.documents[0].extensions);
  assert.deepEqual(validateImport(decoded), decoded);
});

test('authored first-baseline features require archive7/canvas6 and survive sharing, parents and clipboard', () => {
  const doc = createSceneDocument('First baseline'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      html: '<p>Source <em>stays intact.</em></p>',
    });
  enablePublishing(doc);
  assert.equal(archiveVersion([doc]), 6);
  frame.frameOptions = { firstBaseline: 'fixed', minimumFirstBaseline: 18.125, insetTop: 10 };
  assert.throws(
    () => validateImport({ schemaVersion: 6, documents: [doc], assets: [] }),
    /archive 7/,
  );
  enableFrameComposition(doc);
  enablePublishing(doc);
  assert.equal(doc.canvasVersion, 6);
  assert.equal(archiveVersion([doc]), 7);
  assert.ok(isSceneDocument(doc));
  assert.throws(
    () => validateImport({ schemaVersion: 6, documents: [doc], assets: [] }),
    /schema 7/,
  );
  const decoded = validateImport({ schemaVersion: 7, documents: [doc], assets: [] });
  assert.equal(decoded.documents[0].blocks[0].frameOptions.minimumFirstBaseline, 18.125);
  assert.deepEqual(validateImport(decoded), decoded);
  createParent(doc, doc.pages[0].id, 'First-baseline parent');
  assert.equal(
    validateImport({ schemaVersion: 7, documents: [doc], assets: [] }).documents[0].publishing
      .parents[0].blocks[0].frameOptions.firstBaseline,
    'fixed',
  );
  const clipboard = copyObjectSelection(doc, [frame.id]);
  assert.equal(clipboard.archive.schemaVersion, 7);
  const destination = createSceneDocument('Paste');
  pasteObjectSelection(destination, readObjectClipboard(JSON.stringify(clipboard)), {
    pageId: destination.pages[0].id,
  });
  assert.equal(destination.canvasVersion, 6);
  assert.equal(destination.blocks[0].frameOptions.firstBaseline, 'fixed');
  assert.equal(
    createPDFSnapshot([doc], [], doc.id).documents[0].blocks[0].frameOptions.minimumFirstBaseline,
    18.125,
  );
  delete frame.frameOptions.firstBaseline;
  delete frame.frameOptions.minimumFirstBaseline;
  markTypographyVersion(doc);
  assert.equal(doc.canvasVersion, 6);
});

test('editing a parent with new composition semantics propagates its capability to the owning document', () => {
  const doc = createSceneDocument('Parent edits');
  insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Original</p>' });
  const parent = createParent(doc, doc.pages[0].id, 'Body');
  const proxy = structuredClone(doc);
  proxy.pages = [{ id: parent.id, name: parent.name, width: parent.width, height: parent.height }];
  proxy.blocks = parent.blocks.map((b) => ({ ...structuredClone(b), pageId: parent.id }));
  enableFrameComposition(proxy);
  proxy.blocks[0].frameOptions = { firstBaseline: 'leading', minimumFirstBaseline: 18 };
  assert.equal(doc.canvasVersion, 5);
  commitParentDefinition(doc, parent.id, proxy);
  assert.equal(doc.canvasVersion, 6);
  assert.equal(archiveVersion([doc]), 7);
  const decoded = validateImport({ schemaVersion: 7, documents: [doc], assets: [] });
  assert.equal(
    decoded.documents[0].publishing.parents[0].blocks[0].frameOptions.firstBaseline,
    'leading',
  );
});
