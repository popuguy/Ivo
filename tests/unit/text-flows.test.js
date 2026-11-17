import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneDocument,
  insertObject,
  addPage,
  removeObject,
  duplicateObject,
} from '../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  appendTextFlowPage,
  textFlowForFrame,
} from '../../src/domain/documents/text-flows.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { buildIndex, filterDocuments } from '../../src/domain/knowledge/index.js';
import { exportMarkdown } from '../../src/features/export/markdown.js';
import { createUserTemplate, instantiateTemplate } from '../../src/domain/documents/copy.js';
const archive = (doc) => validateImport({ schemaVersion: 5, documents: [doc], assets: [] });
test('A linked textFlow is one source with independent frame geometry and closed format gates', () => {
  const doc = createSceneDocument('Long note'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      html: '<p>Original <strong>textFlow</strong></p>',
    }),
    other = insertObject(doc, 'text', addPage(doc, doc.pages[0].id).id, {
      x: 20,
      y: 30,
      w: 300,
      h: 500,
    });
  const textFlow = startTextFlow(doc, frame.id);
  threadFrame(doc, frame.id, other.id);
  assert.equal(frame.html, '');
  assert.equal(textFlow.html, '<p>Original <strong>textFlow</strong></p>');
  assert.deepEqual(textFlow.frameIds, [frame.id, other.id]);
  assert.equal(other.w, 300);
  assert.equal(archiveVersion([doc]), 5);
  assert.equal(archive(doc).documents[0].textFlows[0].html, textFlow.html);
  assert.throws(
    () => validateImport({ schemaVersion: 3, documents: [doc], assets: [] }),
    /text flow archive/,
  );
  const invalid = structuredClone(doc);
  invalid.textFlows[0].frameIds.push(frame.id);
  assert.throws(() => archive(invalid), /shared frames/);
  frame.html = 'Duplicate source';
  assert.throws(() => archive(doc), /duplicate source/);
});
test('TextFlow deletion, independent duplication and template copies retain source and remap owned references', () => {
  const doc = createSceneDocument(),
    frame = insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Retain all text</p>' }),
    textFlow = startTextFlow(doc, frame.id),
    next = appendTextFlowPage(doc, textFlow);
  const copy = duplicateObject(doc, frame.id),
    copyTextFlow = textFlowForFrame(doc, copy);
  assert.notEqual(copyTextFlow.id, textFlow.id);
  assert.equal(copyTextFlow.html, textFlow.html);
  assert.equal(copyTextFlow.automaticPages, false);
  archive(doc);
  const template = createUserTemplate(doc, 'Flow template'),
    instance = instantiateTemplate(template, 'New textFlow');
  assert.notEqual(instance.textFlows[0].id, textFlow.id);
  assert.equal(instance.blocks[0].textFlowId, instance.textFlows[0].id);
  assert.equal(
    instance.textFlows[0].autoPages[0].pageId,
    instance.blocks.find((b) => b.id === instance.textFlows[0].frameIds[1]).pageId,
  );
  archive(instance);
  removeObject(doc, frame.id);
  assert.equal(textFlow.html, '<p>Retain all text</p>');
  assert.deepEqual(textFlow.frameIds, [next.id]);
  archive(doc);
});
test('Canonical textFlows participate once in links, search and Markdown', () => {
  const doc = createSceneDocument('Note'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      html: `<p>Distinctive phrase <a data-doc-id="${doc.id}">Self</a></p>`,
    }),
    textFlow = startTextFlow(doc, frame.id);
  appendTextFlowPage(doc, textFlow);
  assert.equal(buildIndex([doc]).edges[0].count, 1);
  assert.equal(filterDocuments([doc], 'Distinctive')[0].id, doc.id);
  assert.equal(exportMarkdown(doc).match(/Distinctive phrase/g).length, 1);
});
test('Automatic continuation preserves the page position of a frame inside a mask', () => {
  const doc = createSceneDocument(),
    mask = insertObject(doc, 'polygon', doc.pages[0].id, { x: 100, y: 120, w: 300, h: 400 });
  mask.clip = true;
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
      parentId: mask.id,
      x: 20,
      y: 30,
      w: 200,
      h: 300,
      html: '<p>Masked textFlow</p>',
    }),
    textFlow = startTextFlow(doc, frame.id),
    next = appendTextFlowPage(doc, textFlow);
  assert.equal(next.x, 120);
  assert.equal(next.y, 150);
  assert.equal(next.parentId, undefined);
  assert.equal(next.w, frame.w);
  assert.equal(next.h, frame.h);
  archive(doc);
});
