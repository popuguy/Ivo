import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSceneDocument, addPage, insertObject } from '../../../src/domain/documents/scene.js';
import {
  anchorObject,
  anchorObjectMarker,
} from '../../../src/domain/documents/anchored-objects.js';
import { threadFrame, enableNativeComposition } from '../../../src/domain/documents/text-flows.js';
import { createTable } from '../../../src/domain/documents/tables.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

export async function verifyInlineTablePDF({ root, output, renderPDF }) {
  if (process.platform !== 'darwin') return;
  for (const mode of ['browser', 'paragraph', 'single-line']) {
    const doc = createSceneDocument('Flowing table'),
      second = addPage(doc, doc.pages[0].id);
    const base = { x: 36, y: 36, w: 200, fontSize: 12, leading: 15, textStyle: 'cmu-serif', h: 44 };
    const first = insertObject(doc, 'text', doc.pages[0].id, { ...base, html: '' });
    const last = insertObject(doc, 'text', second.id, { ...base, html: '' });
    const flow = threadFrame(doc, first.id, last.id);
    if (mode !== 'browser') enableNativeComposition(doc, flow, mode);
    const data = createTable(2, 1);
    data.cells = [['Brushed wool'], ['Polished silk']];
    data.cellRuns = { '0,0': [{ start: 8, end: 12, italic: true }] };
    const frame = insertObject(doc, 'table', doc.pages[0].id, {
      x: 0,
      y: 0,
      w: 200,
      h: 58,
      fontSize: 12,
      textStyle: 'cmu-serif',
      table: data,
    });
    anchorObject(doc, frame, flow.id, 'above-line');
    flow.html = '<p>Intro' + anchorObjectMarker(frame.id) + 'After</p>';
    const run = async () => {
      let placement;
      const pdf = await renderPDF(createPDFSnapshot([doc], [], doc.id), {
        project: root,
        onRendered: async (win) => {
          placement = await win.webContents
            .executeJavaScript(`Array.from(document.querySelectorAll('.pdf-page'),page=>{
          const table=page.querySelector('[data-anchored-artwork] table');
          return {table:!!table,word:table?.querySelector('em')?.textContent||'',lines:[...page.querySelectorAll('svg [data-anchor-site]')].length};
        })`);
        },
      });
      return { pdf, placement };
    };
    const tooSmall = await run();
    assert(
      tooSmall.pdf.manifest.warnings.some((s) => /overset/i.test(s)),
      mode +
        ' oversize table failed to report overset: ' +
        JSON.stringify(tooSmall.pdf.manifest.warnings),
    );
    assert(
      !tooSmall.placement.some((p) => p.table),
      mode +
        ' emitted an oversized table spilling out of a frame: ' +
        JSON.stringify(tooSmall.placement),
    );
    assert.deepEqual(frame.table.cells, [['Brushed wool'], ['Polished silk']]);
    last.h = 190;
    const { pdf, placement } = await run();
    assert.deepEqual(pdf.manifest.warnings, [], mode + ' overset did not recover');
    assert.deepEqual(
      placement.map((p) => p.word),
      ['', 'wool'],
      mode + ' placed the table on the wrong page: ' + JSON.stringify(placement),
    );
    if (mode !== 'browser')
      assert.deepEqual(
        placement.map((p) => p.lines),
        [0, 1],
      );
    const file = path.join(output, 'inline-table-' + mode + '.pdf');
    await writeFile(file, pdf.bytes);
    const { stdout } = await promisify(execFile)('swift', [
      path.join(root, 'tests/runtime/pdf/inspect-book.swift'),
      file,
    ]);
    const pages = JSON.parse(stdout).text;
    assert(
      pages[1].includes('Brushed wool') && pages[1].includes('Polished silk'),
      mode + ' PDF lost selectable cell words: ' + JSON.stringify(pages),
    );
    assert.equal(
      pages.join(' ').split('Brushed').length,
      2,
      mode + ' PDF contains duplicate table content',
    );
    assert(
      pages.join(' ').includes('Intro') && pages.join(' ').includes('After'),
      mode + ' PDF lost adjacent text',
    );
  }
}
