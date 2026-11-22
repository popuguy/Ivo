import { unlinkEndnoteFields } from '../../src/domain/documents/endnotes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSceneDocument,
  insertObject,
  addPage,
  duplicateObjects,
} from '../../src/domain/documents/scene.js';
import { startTextFlow } from '../../src/domain/documents/text-flows.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import { copyObjectSelection } from '../../src/domain/documents/clipboard.js';

test('numbered annotations require an explicit format and copying a frame does not steal a note', () => {
  const doc = createSceneDocument('Review');
  const page = addPage(doc, doc.pages[0].id);
  const cite = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>See <a href="#page=' + page.id + '" data-endnote="cite-en-test">1</a></p>',
  });
  const frame = insertObject(doc, 'text', page.id, {
    html:
      '<p><a href="#page=' +
      doc.pages[0].id +
      '" data-endnote="body-en-test">1</a> Original annotation.</p>',
  });
  const flow = startTextFlow(doc, frame.id);
  flow.endnotes = true;
  markTypographyVersion(doc);
  assert.equal(doc.canvasVersion, 34);
  const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(archive.schemaVersion, 35);
  assert.equal(validateImport(archive).documents[0].textFlows[0].endnotes, true);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 33 }), /archive 35/);
  assert.throws(
    () => validateImport({ ...archive, documents: [{ ...doc, canvasVersion: 32 }] }),
    /archive 35/,
  );
  const invalid = structuredClone(archive);
  invalid.documents[0].blocks[0].html = '<p data-endnote="cite-en-test">Text</p>';
  assert.throws(() => validateImport(invalid), /invalid endnote marker/);
  const missing = structuredClone(archive);
  missing.documents[0].textFlows[0].html = '<p>Number was removed.</p>';
  assert.throws(() => validateImport(missing), /paired note text/);
  const duplicate = structuredClone(archive);
  duplicate.documents[0].blocks[0].html += duplicate.documents[0].blocks[0].html;
  assert.throws(() => validateImport(duplicate), /duplicated/);
  const [copy] = duplicateObjects(doc, [frame.id]);
  const copyFlow = doc.textFlows.find((f) => f.id === copy.textFlowId);
  assert(
    !copyFlow.endnotes &&
      !copyFlow.html.includes('data-endnote=') &&
      copyFlow.html.includes('Original annotation.'),
  );
  const clip = copyObjectSelection(doc, [cite.id], []);
  assert(
    !JSON.stringify(clip).includes('data-endnote='),
    'Clipboard fragment has a live field without its paired text',
  );
});

test('the frozen paragraph-reference archive still opens at its authored version', async () => {
  const archived = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v33.json', import.meta.url), 'utf8'),
  );
  const result = validateImport(archived);
  assert.deepEqual(result, archived);
  assert.equal(result.schemaVersion, 33);
  assert.equal(result.documents[0].canvasVersion, 32);
});

test('copying ordinary prose preserves literal markup examples', () => {
  const html = '<p>Use data-endnote="cite-en-example" on a link.</p>';
  assert.equal(unlinkEndnoteFields(html), html);
});
