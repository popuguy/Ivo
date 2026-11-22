import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

export async function verifyPrintedStyleRules({ root, profile, renderPDF, project = root }) {
  const doc = createSceneDocument('Automatic type sizes');
  const first = saveTextStyle(doc, 'character', { name: 'Lead', attributes: { fontSize: 24 } });
  const last = saveTextStyle(doc, 'character', { name: 'Ending', attributes: { fontSize: 18 } });
  const p = saveTextStyle(doc, 'paragraph', {
    name: 'Caption',
    attributes: { fontSize: 12 },
    nestedStyles: [{ style: first.id, delimiter: 'word', count: 1, inclusive: true }],
    grepStyles: [{ style: last.id, pattern: 'Rhythm$' }],
  });
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    x: 40,
    y: 40,
    w: 490,
    h: 180,
    textStyle: 'cmu-serif',
    fontSize: 12,
    html: '<p>Rhythm Rhythm Rhythm</p>',
  });
  const flow = startTextFlow(doc, frame.id, { automaticPages: false });
  flow.style.paragraphStyle = p.id;
  enableNativeComposition(doc, flow, 'single-line');
  const { bytes } = await renderPDF(createPDFSnapshot([doc], [], doc.id), { project });
  const file = path.join(profile, 'conditional-type.pdf');
  await writeFile(file, bytes);
  const read = await promisify(execFile)('swift', [
    '-module-cache-path',
    path.join(profile, 'swift-cache'),
    path.join(root, 'tests/runtime/pdf/inspect-variable-font.swift'),
    file,
  ]);
  const measures = JSON.parse(read.stdout);
  assert.equal(measures.length, 3, 'PDFKit should select three identical words.');
  const [lead, body, ending] = measures.map((s) => s.advance);
  assert.ok(
    Math.abs(lead / body - 2) < 0.08 && Math.abs(ending / body - 1.5) < 0.08,
    'PDFKit widths disagree with the 24/12/18 pt rule cascade: ' + JSON.stringify(measures),
  );
  return measures;
}
