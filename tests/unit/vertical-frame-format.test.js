import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { startTextFlow, enableNativeComposition } from '../../src/domain/documents/text-flows.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';

test('vertical frame justification persists only on the versioned native flow that owns it', () => {
  const doc = createSceneDocument('Justified text');
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    textStyle: 'cmu-serif',
    html: '<p>A</p><p>B</p>',
  });
  const flow = startTextFlow(doc, frame.id, { automaticPages: false });
  enableNativeComposition(doc, flow, 'paragraph');
  assert(archiveVersion([doc]) < 16);
  frame.frameOptions = { verticalAlign: 'justify', paragraphSpacingLimit: 12.5 };
  const archive = (version = 16, document = doc) => ({
    schemaVersion: version,
    documents: [document],
    assets: [],
  });
  assert.throws(() => validateImport(archive()), /canvas 15/);
  markTypographyVersion(doc);
  assert.equal(doc.canvasVersion, 15);
  assert.equal(archiveVersion([doc]), 16);
  assert.throws(() => validateImport(archive(15)), /archive 16/);
  const opened = validateImport(archive()).documents[0];
  assert.equal(opened.blocks[0].frameOptions.paragraphSpacingLimit, 12.5);
  assert.equal(opened.blocks[0].frameOptions.verticalAlign, 'justify');
  assert.equal(opened.textFlows[0].html, flow.html);
  delete opened.textFlows[0].composition;
  assert.throws(() => validateImport(archive(16, opened)), /requires a native text flow/);
  frame.frameOptions.paragraphSpacingLimit = -1;
  assert.throws(() => validateImport(archive()));
});
