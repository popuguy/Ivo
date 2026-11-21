import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSceneDocument,
  insertObject,
  removeObject,
  removePage,
  isSceneDocument,
} from '../../src/domain/documents/scene.js';
import {
  startTextFlow,
  enableNativeComposition,
  appendTextFlowPage,
  trimTextFlowPages,
} from '../../src/domain/documents/text-flows.js';
import {
  authoredLayoutDocument,
  promoteTextLayout,
} from '../../src/domain/documents/derived-text-layout.js';
import {
  archiveVersion,
  markTypographyVersion,
  CURRENT_ARCHIVE_VERSION,
  CURRENT_CANVAS_VERSION,
} from '../../src/domain/documents/capabilities.js';
import { enablePublishing, enableFrameComposition } from '../../src/domain/documents/publishing.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
} from '../../src/domain/documents/clipboard.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../src/domain/history/document-history.js';

function fixture({ native = true, pages = 0 } = {}) {
  const doc = createSceneDocument('Native layout ownership'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40.5,
      y: 48.25,
      w: 300.75,
      h: 180.5,
      html: '<p>Original source</p>',
    }),
    flow = startTextFlow(doc, frame.id);
  if (native) enableNativeComposition(doc, flow);
  for (let index = 0; index < pages; index++) appendTextFlowPage(doc, flow);
  return { doc, frame, flow };
}
const archive = (doc, schemaVersion = archiveVersion([doc])) =>
  validateImport({ schemaVersion, documents: [doc], assets: [] });

test('native composition is explicit archive8/canvas7 source data; old formats reject it and retain their existing capability', async () => {
  assert.ok(CURRENT_ARCHIVE_VERSION >= 8);
  assert.ok(CURRENT_CANVAS_VERSION >= 7);
  for (const composer of ['paragraph', 'single-line']) {
    const { doc, flow } = fixture();
    enableNativeComposition(doc, flow, composer);
    enablePublishing(doc);
    enableFrameComposition(doc);
    markTypographyVersion(doc);
    assert.equal(doc.canvasVersion, 7);
    assert.equal(archiveVersion([doc]), 8);
    assert.ok(isSceneDocument(doc));
    const before = structuredClone(doc),
      decoded = archive(doc);
    assert.deepEqual(doc, before, 'Reading must not rewrite the supplied source');
    assert.deepEqual(decoded.documents[0].textFlows[0].composition, { version: 1, composer });
    assert.deepEqual(archive(decoded.documents[0]), decoded);
    const copied = copyDocument(doc);
    assert.notEqual(copied.textFlows[0].id, flow.id);
    assert.deepEqual(copied.textFlows[0].composition, flow.composition);
    archive(copied);
    const fragment = copyObjectSelection(doc, [doc.blocks[0].id]),
      destination = createSceneDocument('Paste native source');
    pasteObjectSelection(destination, readObjectClipboard(JSON.stringify(fragment)), {
      pageId: destination.pages[0].id,
    });
    assert.equal(destination.canvasVersion, 7);
    assert.deepEqual(destination.textFlows[0].composition, flow.composition);
    archive(destination);
    assert.throws(() => archive(doc, 7), /schema 8/);
    const disguised = structuredClone(doc);
    disguised.canvasVersion = 6;
    assert.throws(() => archive(disguised, 7), /archive 8/);
    assert.throws(() => archive(disguised, 8), /archive 8/);
    for (const composition of [
      { version: 2, composer },
      { version: 1, composer: 'unknown' },
      { version: 1 },
      { version: 1, composer, options: {} },
    ]) {
      const invalid = structuredClone(doc);
      invalid.textFlows[0].composition = composition;
      assert.throws(() => archive(invalid), /composition|composer/);
    }
    assert.throws(() => enableNativeComposition(doc, structuredClone(flow)), /text flow/);
    assert.throws(() => enableNativeComposition(doc, flow, 'unknown'), /composer/);
  }
  const old = JSON.parse(
      await readFile(new URL('../fixtures/legacy/archive-v6.json', import.meta.url), 'utf8'),
    ),
    saved = structuredClone(old);
  const decoded = validateImport(old);
  assert.equal(decoded.schemaVersion, 6);
  assert.equal(decoded.documents[0].canvasVersion, 5);
  assert.deepEqual(old, saved);
  markTypographyVersion(decoded.documents[0]);
  assert.equal(decoded.documents[0].canvasVersion, 5);
  enableFrameComposition(decoded.documents[0]);
  assert.equal(decoded.documents[0].canvasVersion, 6);
  assert.equal(archiveVersion(decoded.documents), 7);
  assert.equal(validateImport({ ...decoded, schemaVersion: 7 }).documents[0].canvasVersion, 6);
  const previous = JSON.parse(
      await readFile(new URL('../fixtures/legacy/archive-v7.json', import.meta.url), 'utf8'),
    ),
    original = structuredClone(previous),
    opened = validateImport(previous);
  assert.equal(opened.schemaVersion, 7);
  assert.equal(opened.documents[0].canvasVersion, 6);
  assert.equal(opened.documents[0].textFlows[0].composition, undefined);
  assert.equal(opened.documents[0].textFlows[0].html, original.documents[0].textFlows[0].html);
  assert.equal(opened.documents[0].blocks[0].frameOptions.minimumFirstBaseline, 17.125);
  assert.deepEqual(previous, original);
  assert.deepEqual(validateImport(opened), opened);
});

test('native continuation identities survive deterministic grow/trim/regrow while legacy IDs remain independent', () => {
  const { doc, flow } = fixture(),
    first = appendTextFlowPage(doc, flow),
    identities = [doc.pages[1].id, first.id];
  appendTextFlowPage(doc, flow);
  assert.equal(trimTextFlowPages(doc, flow, 1), true);
  assert.equal(flow.automaticPages, true, 'Derived shrink is not an explicit frame deletion');
  const again = appendTextFlowPage(doc, flow);
  assert.deepEqual([doc.pages[1].id, again.id], identities);
  archive(doc);
  const long = fixture();
  long.flow.id = 'f'.repeat(120);
  long.frame.textFlowId = long.flow.id;
  const generated = appendTextFlowPage(long.doc, long.flow);
  assert.ok(generated.id.length <= 120);
  assert.ok(long.doc.pages[1].id.length <= 120);
  archive(long.doc);
  const collision = fixture(),
    reserved = `page-auto-${collision.flow.id}-1`;
  insertObject(collision.doc, 'polygon', collision.doc.pages[0].id, { id: reserved });
  const safe = appendTextFlowPage(collision.doc, collision.flow);
  assert.notEqual(collision.doc.pages[1].id, reserved);
  assert.ok(safe.id.endsWith('-2'));
  archive(collision.doc);
  const legacy = fixture({ native: false }),
    original = appendTextFlowPage(legacy.doc, legacy.flow).id;
  trimTextFlowPages(legacy.doc, legacy.flow, 1);
  assert.notEqual(appendTextFlowPage(legacy.doc, legacy.flow).id, original);
  assert.equal(archiveVersion([legacy.doc]), 5);
});

test('async native layout changes do not break source undo/redo and full history snapshots retain derived pages', () => {
  const { doc: a } = fixture(),
    h = createDocumentHistory(),
    b = structuredClone(a);
  b.textFlows[0].html = '<p>A longer source that needs three pages.</p>';
  h.record(a, b, { label: 'Typing' });
  appendTextFlowPage(b, b.textFlows[0]);
  appendTextFlowPage(b, b.textFlows[0]);
  const grown = structuredClone(b),
    originalIds = b.textFlows[0].frameIds.slice();
  assert.equal(h.record(grown, b), false);
  const undone = h.undo(b).document;
  assert.equal(undone.textFlows[0].html, a.textFlows[0].html);
  const redone = h.redo(undone).document;
  appendTextFlowPage(redone, redone.textFlows[0]);
  appendTextFlowPage(redone, redone.textFlows[0]);
  assert.deepEqual(redone.textFlows[0].frameIds, originalIds);
  const shorter = structuredClone(redone);
  shorter.textFlows[0].html = '<p>Short.</p>';
  h.record(redone, shorter);
  trimTextFlowPages(shorter, shorter.textFlows[0], 1);
  assert.equal(shorter.pages.length, 1);
  const full = h.undo(shorter).document;
  assert.equal(
    full.pages.length,
    3,
    'Snapshots must not be replaced with the comparison projection',
  );
  assert.deepEqual(full.textFlows[0].frameIds, originalIds);
  assert.equal(full.textFlows[0].html, grown.textFlows[0].html);
  assert.equal(h.redo(full).document.textFlows[0].html, '<p>Short.</p>');
});

test('an authored section on a generated page survives trimming and the history projection', () => {
  const { doc, flow } = fixture({ pages: 2 });
  const before = structuredClone(doc);
  const page = doc.pages[1];
  page.section = { start: 1, style: 'roman-lower', prefix: '' };
  assert.ok(authoredLayoutDocument(doc).pages.some((p) => p.id === page.id));
  assert.equal(promoteTextLayout(before, doc), 1);
  assert.equal(trimTextFlowPages(doc, flow, 1), true);
  assert.deepEqual(
    doc.pages.map((p) => p.id),
    [before.pages[0].id, page.id],
  );
  assert.deepEqual(doc.pages[1].section, page.section);
});

test('only exclusive native ownership is omitted; legacy/mixed pages and unrelated changes stay visible to history', () => {
  const { doc, flow } = fixture(),
    before = structuredClone(doc);
  appendTextFlowPage(doc, flow);
  assert.equal(documentContent(doc), documentContent(before));
  assert.equal(doc.pages.length, 2);
  const untouched = structuredClone(doc);
  const projection = authoredLayoutDocument(doc);
  assert.equal(projection.pages.length, 1);
  assert.deepEqual(doc, untouched);
  const h = createDocumentHistory(),
    changed = structuredClone(doc);
  changed.textFlows[0].html = '<p>An actual edit</p>';
  h.record(doc, changed);
  const extra = insertObject(changed, 'polygon', changed.pages[1].id);
  assert.ok(authoredLayoutDocument(changed).blocks.some((block) => block.id === extra.id));
  assert.throws(() => h.undo(changed), /outside its history/);
  assert.equal(h.canUndo, true);
  const duplicateSource = structuredClone(doc);
  duplicateSource.blocks[1].html = '<p>A frame cannot become a hidden second source.</p>';
  assert.notEqual(documentContent(duplicateSource), documentContent(doc));
  const duplicateIdentity = structuredClone(doc);
  duplicateIdentity.pages.push({ ...duplicateIdentity.pages[1] });
  assert.notEqual(documentContent(duplicateIdentity), documentContent(doc));
  const duplicateMembership = structuredClone(doc);
  duplicateMembership.textFlows[0].frameIds.push(duplicateMembership.blocks[1].id);
  assert.notEqual(documentContent(duplicateMembership), documentContent(doc));
  const unrelated = structuredClone(doc);
  unrelated.title = 'Unexpected external mutation';
  assert.notEqual(documentContent(unrelated), documentContent(doc));
  const legacy = fixture({ native: false }),
    legacyBefore = structuredClone(legacy.doc);
  appendTextFlowPage(legacy.doc, legacy.flow);
  assert.notEqual(documentContent(legacy.doc), documentContent(legacyBefore));
});

test('derived grow/shrink delivered inside an open source or style batch never promotes pages or changes continuation policy', () => {
  for (const field of ['html', 'style']) {
    const { doc: before } = fixture({ pages: 1 }),
      history = createDocumentHistory(),
      grown = structuredClone(before);
    if (field === 'html')
      grown.textFlows[0].html = '<p>New longer source during the open typing batch.</p>';
    else grown.textFlows[0].style.fontSize = 36;
    appendTextFlowPage(grown, grown.textFlows[0]);
    assert.equal(promoteTextLayout(before, grown), 0);
    assert.equal(grown.textFlows[0].autoPages.length, 2);
    assert.equal(grown.textFlows[0].automaticPages, true);
    assert.equal(history.record(before, grown), true);
    const shrunk = structuredClone(grown);
    if (field === 'html') shrunk.textFlows[0].html = '<p>Short again.</p>';
    else shrunk.textFlows[0].style.fontSize = 12;
    trimTextFlowPages(shrunk, shrunk.textFlows[0], 1);
    assert.equal(promoteTextLayout(grown, shrunk), 0);
    assert.equal(shrunk.textFlows[0].autoPages.length, 0);
    assert.equal(shrunk.textFlows[0].automaticPages, true);
    assert.equal(history.record(grown, shrunk), true);
    const undoShrink = history.undo(shrunk).document;
    assert.equal(undoShrink.pages.length, 3);
    assert.equal(undoShrink.textFlows[0].autoPages.length, 2);
    assert.equal(undoShrink.textFlows[0].automaticPages, true);
    assert.equal(history.undo(undoShrink).document.pages.length, 2);
  }
});

test('intentional geometry, extra objects, page order and frame threading promote ownership; typography does not', () => {
  const { doc: before } = fixture({ pages: 2 }),
    original = structuredClone(before),
    styled = structuredClone(before);
  styled.textFlows[0].html = '<p><em>Source style change.</em></p>';
  styled.textFlows[0].style.italic = true;
  styled.blocks[1].fontSize = 28;
  styled.blocks[1].textOverrides = ['fontSize'];
  assert.equal(promoteTextLayout(before, styled), 0);
  assert.equal(styled.textFlows[0].autoPages.length, 2);
  const cases = [
    (doc) => {
      doc.blocks[1].x += 0.25;
    },
    (doc) => {
      doc.blocks[1].textScale = { x: 1.125, y: 1 };
    },
    (doc) => {
      doc.blocks[1].frameOptions = { firstBaseline: 'fixed', minimumFirstBaseline: 18 };
    },
    (doc) => {
      doc.pages[1].width += 10;
    },
    (doc) => {
      doc.pages[1].name = 'Authored page';
    },
    (doc) => {
      insertObject(doc, 'polygon', doc.pages[1].id);
    },
  ];
  for (const change of cases) {
    const after = structuredClone(before);
    change(after);
    assert.equal(promoteTextLayout(before, after), 1);
    assert.deepEqual(after.textFlows[0].autoPages, [before.textFlows[0].autoPages[1]]);
    assert.ok(authoredLayoutDocument(after).pages.some((page) => page.id === before.pages[1].id));
    archive(after);
  }
  const reordered = structuredClone(before);
  [reordered.pages[1], reordered.pages[2]] = [reordered.pages[2], reordered.pages[1]];
  assert.equal(promoteTextLayout(before, reordered), 2);
  assert.deepEqual(reordered.textFlows[0].autoPages, []);
  const threaded = structuredClone(before);
  [threaded.textFlows[0].frameIds[1], threaded.textFlows[0].frameIds[2]] = [
    threaded.textFlows[0].frameIds[2],
    threaded.textFlows[0].frameIds[1],
  ];
  assert.equal(promoteTextLayout(before, threaded), 2);
  assert.deepEqual(threaded.textFlows[0].autoPages, []);
  assert.deepEqual(before, original, 'Promotion must not mutate the prior snapshot');
});

test('promoted continuation survives later derived shrink and source undo', () => {
  const { doc: before } = fixture({ pages: 2 }),
    after = structuredClone(before),
    h = createDocumentHistory();
  after.blocks[1].w = 190.125;
  promoteTextLayout(before, after);
  h.record(before, after, { label: 'Resize text frame' });
  const source = structuredClone(after);
  source.textFlows[0].html = '<p>Short.</p>';
  promoteTextLayout(after, source);
  h.record(after, source, { label: 'Typing' });
  trimTextFlowPages(source, source.textFlows[0], 1);
  assert.equal(source.pages.length, 2);
  assert.ok(source.blocks.some((frame) => frame.w === 190.125));
  const restored = h.undo(source).document;
  assert.equal(restored.blocks[1].w, 190.125);
  assert.equal(restored.textFlows[0].autoPages.length, 1);
  assert.equal(restored.textFlows[0].html, before.textFlows[0].html);
  archive(restored);
});

test('explicit native page/frame deletion retains source, disables automatic recreation, and is undoable', () => {
  for (const deletion of ['page', 'frame']) {
    const { doc: before } = fixture({ pages: 1 }),
      after = structuredClone(before),
      h = createDocumentHistory();
    if (deletion === 'page') removePage(after, after.pages[1].id);
    else removeObject(after, after.textFlows[0].frameIds[1]);
    promoteTextLayout(before, after);
    assert.equal(after.textFlows[0].automaticPages, false);
    assert.equal(after.textFlows[0].html, before.textFlows[0].html);
    assert.equal(h.record(before, after), true);
    const undone = h.undo(after).document;
    assert.equal(undone.textFlows[0].automaticPages, true);
    assert.deepEqual(undone.textFlows[0].frameIds, before.textFlows[0].frameIds);
    assert.equal(undone.pages.length, 2);
    archive(after);
    archive(undone);
  }
  const { doc: before } = fixture({ pages: 1 }),
    after = structuredClone(before),
    history = createDocumentHistory();
  for (const id of before.textFlows[0].frameIds) removeObject(after, id);
  promoteTextLayout(before, after);
  assert.deepEqual(
    after.textFlows,
    [],
    'Deleting every member uses the existing whole-flow deletion command',
  );
  assert.equal(history.record(before, after), true);
  const restored = history.undo(after).document;
  assert.equal(restored.textFlows[0].html, before.textFlows[0].html);
  assert.deepEqual(restored.textFlows[0].frameIds, before.textFlows[0].frameIds);
  archive(after);
  archive(restored);
});
