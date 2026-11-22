import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSceneDocument, addPage, insertObject } from '../../../src/domain/documents/scene.js';
import {
  anchorObject,
  anchorObjectMarker,
} from '../../../src/domain/documents/anchored-objects.js';
import { threadFrame, enableNativeComposition } from '../../../src/domain/documents/text-flows.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

export async function verifyAnchoredPDF({ root, output, renderPDF }) {
  if (process.platform !== 'darwin') return;
  const doc = createSceneDocument('Anchored artwork'),
    second = addPage(doc, doc.pages[0].id);
  const rect = { x: 40, y: 40, w: 230, h: 54, fontSize: 12, textStyle: 'cmu-serif' };
  const first = insertObject(doc, 'text', doc.pages[0].id, { ...rect, html: '' });
  const next = insertObject(doc, 'text', second.id, { ...rect, h: 190, html: '' });
  const flow = threadFrame(doc, first.id, next.id);
  enableNativeComposition(doc, flow);
  const shape = insertObject(doc, 'polygon', doc.pages[0].id, { w: 45, h: 30, x: 0, y: 0 });
  shape.fill = '#783fa8';
  shape.strokeWidth = 0;
  shape.points = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y], i) => ({ x, y, id: 'point-' + i }));
  anchorObject(doc, shape, flow.id, 'inline');
  flow.html =
    '<p>One</p><p>Two</p><p>Three</p><p>Before ' +
    anchorObjectMarker(shape.id) +
    ' after artwork.</p>';
  const snapshot = createPDFSnapshot([doc], [], doc.id);
  const pdf = await renderPDF(snapshot, {
    project: root,
    onRendered: async (win) => {
      const placed = await win.webContents
        .executeJavaScript(`[...document.querySelectorAll('.pdf-page')].map(page=>({
      artwork:page.querySelectorAll('[data-anchored-artwork]').length,
      svg:page.querySelectorAll('svg[data-composed-text] [data-anchor-site]').length,
      x:parseFloat(page.querySelector('[data-anchored-artwork]')?.style.left),
      y:parseFloat(page.querySelector('[data-anchored-artwork]')?.style.top)
    }))`);
      assert.deepEqual(
        placed.map((p) => p.artwork),
        [0, 1],
        'Wrong anchored-object page: ' + JSON.stringify(placed),
      );
      assert.deepEqual(
        placed.map((p) => p.svg),
        [0, 1],
      );
      assert(
        placed[1].x > rect.x + 20 && placed[1].x < rect.x + 75 && placed[1].y >= rect.y - 1,
        'The baseline box lost its inline position: ' + JSON.stringify(placed),
      );
    },
  });
  assert.deepEqual(pdf.manifest.warnings, []);
  await writeFile(path.join(output, 'anchored-native.pdf'), pdf.bytes);
  await writeFile(path.join(output, 'anchored-source.json'), JSON.stringify(doc, null, 2));
}
