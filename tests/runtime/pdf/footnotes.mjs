import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSceneDocument, addPage, insertObject } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

export async function verifyFootnotePDF({ root, output, renderPDF }) {
  for (const mode of ['browser', 'paragraph']) {
    const doc = createSceneDocument('Column footnotes');
    const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    const body =
      'Aster samples from the first fitting include the cotton twill and the linen canvas.';
    words[3] +=
      '<span data-footnote="' +
      encodeURIComponent(body) +
      '" data-ivo-size="7" data-ivo-baseline="4">1</span>';
    const frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 36,
      y: 36,
      w: 144,
      h: 96,
      fontSize: 12,
      leading: 16,
      textStyle: 'cmu-serif',
      html: words.map((word) => '<p data-ivo-spaceafter="0">' + word + '</p>').join(''),
    });
    const flow = startTextFlow(doc, frame.id, { automaticPages: false });
    for (let i = 0; i < 3; i++) {
      const next = insertObject(doc, 'text', addPage(doc, doc.pages.at(-1).id).id, {
        x: 36,
        y: 36,
        w: 144,
        h: 96,
        html: '',
      });
      threadFrame(doc, flow.frameIds.at(-1), next.id);
    }
    if (mode === 'paragraph') enableNativeComposition(doc, flow, mode);
    doc.canvasVersion = 35;
    const pdf = await renderPDF(createPDFSnapshot([doc], [], doc.id), { project: root });
    assert.equal(pdf.manifest.warnings.length, 0, JSON.stringify(pdf.manifest.warnings));
    const file = path.join(output, 'column-footnotes-' + mode + '.pdf');
    await writeFile(file, pdf.bytes);
    if (process.platform !== 'darwin') continue;
    const { stdout } = await promisify(execFile)('swift', [
      path.join(root, 'tests/runtime/pdf/inspect-book.swift'),
      file,
    ]);
    const pages = JSON.parse(stdout).text;
    const reference = pages.findIndex((p) => p.includes('Four'));
    assert(
      reference >= 0 && pages[reference].includes('Aster'),
      'PDF footnote is detached from its citation: ' + JSON.stringify(pages),
    );
    for (const word of ['Aster', 'fitting', 'twill', 'linen', 'canvas', 'Ten'])
      assert.equal(
        pages.join(' ').split(word).length,
        2,
        'PDF has lost or duplicated ' + word + ': ' + JSON.stringify(pages),
      );
  }
}
