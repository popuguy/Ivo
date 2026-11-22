import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

export async function verifyEndnotePDF({ root, output, renderPDF }) {
  const doc = createSceneDocument('Numbered endnotes');
  const pages = [doc.pages[0], addPage(doc, doc.pages[0].id)];
  const tail = addPage(doc, pages.at(-1).id);
  // Deliberately obsolete page hints. A printed link resolves the actual paired marker after reflow.
  const link = (role, id, n) =>
    '<a href="#page=' + pages[0].id + '" data-endnote="' + role + '-en-' + id + '">' + n + '</a>';
  for (const [i, page] of pages.entries()) {
    const node = insertObject(doc, 'text', page.id, {
      x: 54,
      y: 55,
      w: 206,
      h: 98,
      fontSize: 14,
      html: '<p>Material ' + link('cite', i, i + 1) + ' reviewed.</p>',
    });
    if (i === 1)
      enableNativeComposition(
        doc,
        startTextFlow(doc, node.id, { automaticPages: false }),
        'single-line',
      );
  }
  const note = insertObject(doc, 'text', tail.id, {
    x: 54,
    y: 155,
    w: 290,
    h: 188,
    fontSize: 14,
    html:
      '<p>Endnotes</p><p>' +
      link('body', 0, 1) +
      ' First source.</p><p>' +
      link('body', 1, 2) +
      ' Second source.</p>',
  });
  const notes = startTextFlow(doc, note.id, { automaticPages: false });
  notes.endnotes = true;
  doc.canvasVersion = 34;
  const pdf = await renderPDF(createPDFSnapshot([doc], [], doc.id), { project: root });
  const file = path.join(output, 'endnotes.pdf');
  await writeFile(file, pdf.bytes);
  assert.equal(pdf.manifest.warnings.length, 0, JSON.stringify(pdf.manifest.warnings));
  const pairs = pdf.manifest.links.map(({ pageIndex, target }) => [pageIndex, target.pageIndex]);
  assert.equal(
    new Set(pdf.manifest.links.map((link) => JSON.stringify([link.pageIndex, link.rect]))).size,
    pdf.manifest.links.length,
  );
  assert.deepEqual([...new Set(pairs.map((pair) => pair.join(',')))], ['0,2', '1,2', '2,0', '2,1']);
  if (process.platform === 'darwin') {
    const { stdout } = await promisify(execFile)(
      'swift',
      [path.join(root, 'tests/runtime/pdf/inspect-book.swift'), file],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const reader = JSON.parse(stdout);
    assert.deepEqual(
      reader.pageLinks,
      pairs,
      'PDFKit resolved different links from the print renderer',
    );
    assert(
      reader.linkPoints.every((link) => link[2] > 40),
      'PDFKit links should land at the endnote or reference',
    );
    assert.match(reader.text[0], /Material 1 reviewed/);
    assert(reader.text[2].includes('First source.') && reader.text[2].includes('Second source.'));
  }
}
