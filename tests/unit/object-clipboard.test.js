import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject, addPage } from '../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  frameTextSettings,
} from '../../src/domain/documents/text-flows.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
} from '../../src/domain/documents/clipboard.js';
import { enablePublishing, saveTextStyle } from '../../src/domain/documents/publishing.js';
import { validateImport } from '../../src/domain/documents/schema.js';

test('pasting between new documents shares equivalent basic type and preserves distinct defaults', () => {
  const source = createSceneDocument('First', undefined, 'cmu-serif');
  const frame = insertObject(source, 'text', source.pages[0].id, { html: '<p>Body</p>' });
  const archive = readObjectClipboard(JSON.stringify(copyObjectSelection(source, [frame.id])));
  for (const [font, count] of [
    ['cmu-serif', 1],
    ['geist', 2],
  ]) {
    const target = createSceneDocument('Second', undefined, font);
    pasteObjectSelection(target, archive, { pageId: target.pages[0].id });
    assert.equal(target.publishing.paragraphStyles.length, count);
    const style = target.publishing.paragraphStyles.find(
      (s) => s.id === target.blocks[0].paragraphStyle,
    );
    assert.equal(style.attributes.textStyle, 'cmu-serif');
  }
});

test('threaded character defaults belong to the flow, never stale frame typography', () => {
  const doc = createSceneDocument(),
    frame = insertObject(doc, 'text', doc.pages[0].id, { italic: true, bold: true });
  const flow = startTextFlow(doc, frame.id, { automaticPages: false });
  delete flow.style.italic;
  delete flow.style.bold;
  assert.equal(frameTextSettings(doc, frame), flow.style);
  assert.equal(frameTextSettings(doc, frame).italic, undefined);
  assert.equal(frame.italic, true);
});

test('object clipboard carries masks, rich text, independent flow IDs, styles, and required resources', () => {
  const source = createSceneDocument('Source');
  enablePublishing(source);
  const style = saveTextStyle(source, 'paragraph', {
    name: 'Caption',
    attributes: { italic: true, fontSize: 17 },
  });
  const mask = insertObject(source, 'polygon', source.pages[0].id, {
    x: 100.125,
    y: 90.25,
    w: 200,
    h: 180,
  });
  const frame = insertObject(source, 'text', source.pages[0].id, {
    parentId: mask.id,
    x: 4,
    y: 6,
    html: `<p data-ivo-pstyle="${style.id}"><a data-doc-id="${source.id}" href="#doc=${source.id}">Source link</a></p>`,
  });
  const flow = startTextFlow(source, frame.id, { automaticPages: false });
  const second = insertObject(source, 'text', source.pages[0].id, { html: '' });
  threadFrame(source, frame.id, second.id);
  const image = insertObject(source, 'image', source.pages[0].id, {
    parentId: mask.id,
    src: 'asset:picture',
  });
  const assets = [
    { id: 'picture', mimeType: 'image/png', name: 'Original', data: 'data:image/png;base64,AAAA' },
    { id: 'unused', mimeType: 'image/png', data: 'data:image/png;base64,AQAA' },
  ];
  const original = structuredClone(source),
    clipboard = copyObjectSelection(source, [mask.id, frame.id, second.id], assets);
  const archive = readObjectClipboard(JSON.stringify(clipboard));
  assert.deepEqual(source, original);
  assert.deepEqual(
    archive.assets.map((a) => a.id),
    ['picture'],
  );
  assert.equal(archive.documents[0].blocks.length, 4);
  const destination = createSceneDocument('Destination');
  const roots = pasteObjectSelection(destination, archive, { pageId: destination.pages[0].id });
  assert.equal(roots.length, 2);
  const pastedMask = roots.find((b) => b.type === 'polygon');
  assert.equal(pastedMask.x, mask.x + 16);
  assert.notEqual(pastedMask.id, mask.id);
  assert.notEqual(pastedMask.points[0].id, mask.points[0].id);
  const pastedImage = destination.blocks.find((b) => b.type === 'image');
  assert.equal(pastedImage.src, image.src);
  assert.equal(pastedImage.parentId, pastedMask.id);
  assert.equal(destination.textFlows.length, 1);
  assert.equal(destination.textFlows[0].frameIds.length, 2);
  assert.notEqual(destination.textFlows[0].id, flow.id);
  assert.ok(destination.textFlows[0].html.includes(source.id));
  assert.ok(destination.textFlows[0].html.includes(destination.publishing.paragraphStyles[0].id));
  assert.notEqual(destination.publishing.paragraphStyles[0].id, style.id);
  validateImport({ schemaVersion: 6, documents: [destination], assets: archive.assets });
  const count = destination.blocks.length;
  pasteObjectSelection(destination, archive, { pageId: destination.pages[0].id });
  assert.equal(destination.blocks.length, count * 2);
  validateImport({ schemaVersion: 6, documents: [destination], assets: archive.assets });
});

test('copying a clipped child detaches it at its world position; paste failures leave source unchanged', () => {
  const doc = createSceneDocument(),
    p = doc.pages[0],
    mask = insertObject(doc, 'polygon', p.id, { x: 80, y: 70 });
  const child = insertObject(doc, 'text', p.id, {
    parentId: mask.id,
    x: 7.125,
    y: 8.25,
    html: '<p>Independent</p>',
  });
  const archive = readObjectClipboard(JSON.stringify(copyObjectSelection(doc, [child.id])));
  assert.equal(archive.documents[0].blocks[0].parentId, undefined);
  assert.equal(archive.documents[0].blocks[0].x, 87.125);
  const before = structuredClone(doc);
  assert.throws(() => pasteObjectSelection(doc, archive, { pageId: 'missing' }));
  assert.deepEqual(doc, before);
  assert.throws(() => readObjectClipboard('{"version":9}'));
  const bad = structuredClone(archive);
  bad.documents[0].blocks[0].html = '<script>bad()</script>';
  assert.throws(() => readObjectClipboard(JSON.stringify({ version: 1, archive: bad })));
});

test('multi-page selections preserve relative page offsets when pasted onto one page', () => {
  const doc = createSceneDocument(),
    first = insertObject(doc, 'text', doc.pages[0].id, { y: 20, html: 'One' });
  const page = addPage(doc, doc.pages[0].id),
    second = insertObject(doc, 'text', page.id, { y: 30, html: 'Two' });
  const archive = readObjectClipboard(
    JSON.stringify(copyObjectSelection(doc, [first.id, second.id])),
  );
  const destination = createSceneDocument();
  const pasted = pasteObjectSelection(destination, archive, { pageId: destination.pages[0].id });
  assert.equal(pasted[1].y - pasted[0].y, 792 + 64 + 10);
});

test('same-document paste reuses unchanged style definitions and keeps original links', () => {
  const doc = createSceneDocument('Styles');
  const base = saveTextStyle(doc, 'paragraph', { name: 'Body', attributes: { fontSize: 15 } });
  const detail = saveTextStyle(doc, 'paragraph', {
    name: 'Detail',
    basedOn: base.id,
    attributes: { italic: true },
  });
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    paragraphStyle: detail.id,
    html: `<p data-ivo-pstyle="${detail.id}">Copy</p>`,
  });
  const archive = readObjectClipboard(JSON.stringify(copyObjectSelection(doc, [frame.id])));
  for (let i = 0; i < 3; i++) pasteObjectSelection(doc, archive, { pageId: doc.pages[0].id });
  assert.equal(doc.publishing.paragraphStyles.length, 2);
  assert.ok(doc.blocks.every((b) => b.paragraphStyle === detail.id));
  assert.ok(doc.blocks.every((b) => b.html.includes(detail.id)));
  validateImport({ schemaVersion: 6, documents: [doc], assets: [] });
});

test('clipboard retains exact used font bytes and family companions for another vault', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { inspectFont } = await import('../../src/domain/text/fonts.js');
  const assets = [];
  for (const name of ['cmunrm.ttf', 'cmunti.ttf']) {
    const bytes = await readFile(new URL('../../public/fonts/cmu-serif/' + name, import.meta.url));
    assets.push({
      id: 'font-' + createHash('sha256').update(bytes).digest('hex'),
      name,
      mimeType: 'font/ttf',
      font: inspectFont(bytes),
      data: 'data:font/ttf;base64,' + bytes.toString('base64'),
    });
  }
  const doc = createSceneDocument('Portable font');
  enablePublishing(doc);
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    textStyle: assets[0].id,
    html: '<p>Regular <em>italic companion</em></p>',
  });
  const archive = readObjectClipboard(JSON.stringify(copyObjectSelection(doc, [frame.id], assets)));
  assert.deepEqual(
    archive.assets.map((a) => a.data),
    assets.map((a) => a.data),
  );
  const destination = createSceneDocument('Other vault');
  pasteObjectSelection(destination, archive, { pageId: destination.pages[0].id });
  const decoded = validateImport({
    schemaVersion: 6,
    documents: [destination],
    assets: archive.assets,
  });
  assert.equal(decoded.documents[0].blocks[0].textStyle, assets[0].id);
});
