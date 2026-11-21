import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { saveTextStyle } from '../../src/domain/documents/publishing.js';
import {
  canPlacePublicationText,
  writePublicationText,
  generatedTextFlow,
} from '../../src/domain/documents/contents.js';
import { contentsSettings } from '../../src/domain/documents/contents-settings.js';
import {
  startTextFlow,
  threadFrame,
  removeTextFlowFrames,
} from '../../src/domain/documents/text-flows.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import { copyObjectSelection, pasteObjectSelection } from '../../src/domain/documents/clipboard.js';

test('generated contents retain styling and page destinations when duplicating or pasting', () => {
  const doc = createSceneDocument('Materials'),
    pageId = doc.pages[0].id;
  const style = saveTextStyle(doc, 'paragraph', { name: 'Material', attributes: { fontSize: 16 } });
  const settings = contentsSettings({ styles: { [style.id]: 2 }, entryStyle: style.id });
  const markup = '<p><a href="#page=' + pageId + '">Linen</a></p>';
  const contents = writePublicationText(doc, null, markup, settings);
  assert.equal(doc.textFlows[0].automaticPages, true);
  const saved = validateImport({
    schemaVersion: archiveVersion([doc]),
    documents: [doc],
    assets: [],
  }).documents[0];
  assert.equal(archiveVersion([doc]), 28);
  assert.throws(
    () => validateImport({ schemaVersion: 27, documents: [doc], assets: [] }),
    /archive 28/,
  );
  const copy = copyDocument(saved),
    newId = copy.publishing.paragraphStyles.find((s) => s.name === 'Material').id;
  const original = copy.textFlows.find((f) => f.contents);
  assert.deepEqual(original.contents.styles, { [newId]: 2 });
  assert.equal(original.contents.entryStyle, newId);
  assert(copy.textFlows[0].html.includes('#page=' + copy.pages[0].id));
  const packet = copyObjectSelection(doc, [contents.id]);
  const [pasted] = pasteObjectSelection(doc, packet.archive, { pageId });
  assert.deepEqual(generatedTextFlow(doc, pasted).contents.styles, settings.styles);
  assert(doc.textFlows.find((f) => f.id === pasted.textFlowId).html.includes('#page=' + pageId));
});
test('a selected threaded frame owns fixed placement and protected content survives regeneration', () => {
  const doc = createSceneDocument('Placement'),
    page = doc.pages[0].id;
  const a = insertObject(doc, 'text', page, { html: '<p><br></p>' }),
    b = insertObject(doc, 'text', page, { html: '' });
  const flow = startTextFlow(doc, a.id);
  threadFrame(doc, a.id, b.id);
  assert(canPlacePublicationText(doc, b));
  writePublicationText(doc, b, '<p>First edition</p>', contentsSettings());
  assert.equal(flow.automaticPages, false);
  assert.equal(generatedTextFlow(doc, a).id, flow.id);
  assert(!canPlacePublicationText(doc, a));
  a.locked = true;
  assert.throws(
    () => writePublicationText(doc, b, '', contentsSettings(), { update: true }),
    /Unlock/,
  );
  assert.equal(flow.html, '<p>First edition</p>');
  a.locked = false;
  writePublicationText(doc, a, '<p>Second edition</p>', contentsSettings(), { update: true });
  assert.equal(flow.html, '<p>Second edition</p>');
  removeTextFlowFrames(doc, [b.id]);
  doc.blocks = doc.blocks.filter((block) => block.id !== b.id);
  writePublicationText(doc, a, '<p>After deleting the original placement</p>', contentsSettings(), {
    update: true,
  });
  assert.equal(generatedTextFlow(doc, a).id, flow.id);
  assert.equal(doc.pages.length, 1);
  assert.throws(() => contentsSettings({ numbering: 'arbitrary' }), /settings/);
});
