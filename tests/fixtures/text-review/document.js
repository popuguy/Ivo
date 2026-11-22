import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { createTable } from '../../../src/domain/documents/tables.js';
import { setCellRuns } from '../../../src/domain/documents/inline-tables.js';
import {
  anchorObject,
  anchorObjectMarker,
} from '../../../src/domain/documents/anchored-objects.js';
import { markTypographyVersion } from '../../../src/domain/documents/capabilities.js';

export function fittingRoomProof() {
  const doc = createSceneDocument('Fitting room proof', { width: 360, height: 340 });
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const page = i ? addPage(doc, doc.pages.at(-1).id) : doc.pages[0];
    frames.push(
      insertObject(doc, 'text', page.id, {
        x: 30,
        y: 30,
        w: 300,
        h: 265,
        html: '',
        fontSize: 13,
        textStyle: 'cmu-serif',
        leading: 17,
      }),
    );
  }
  const flow = startTextFlow(doc, frames[0].id, { automaticPages: false });
  for (let i = 1; i < frames.length; i++) threadFrame(doc, frames[i - 1].id, frames[i].id);
  const swatch = insertObject(doc, 'polygon', frames[0].pageId, {
    name: 'Cobalt swatch',
    w: 32,
    h: 16,
    fill: '#4057ad',
    stroke: 'none',
    strokeWidth: 0,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0.16 },
      { x: 0.84, y: 1 },
      { x: 0, y: 0.9 },
    ],
  });
  anchorObject(doc, swatch, flow.id);
  const data = createTable(4, 2);
  data.cells = [
    ['Sample', 'Finish'],
    ['A-17', 'brushed twill'],
    ['B-04', 'satin facing'],
    ['C-22', 'raw edge'],
  ];
  data.headerRows = 1;
  setCellRuns(data, 1, 1, [{ start: 8, end: 13, italic: true }]);
  const table = insertObject(doc, 'table', frames[0].pageId, {
    name: 'Finish schedule',
    w: 234,
    h: 96,
    fontSize: 11,
    table: data,
  });
  anchorObject(doc, table, flow.id, 'above-line');
  const footnote =
    '<span data-footnote="' +
    encodeURIComponent(
      'Measured after steaming. Dry measurements are kept with the original swatch.',
    ) +
    '" data-ivo-size="7.579" data-ivo-baseline="4.329">1</span>';
  flow.html = [
    '<p><strong>Fitting room proof</strong></p>',
    '<p>The first fitting took place under a low north light. Keep this paragraph for testing the insertion point beside <em>bias cut</em> and the return to roman here.</p>',
    '<p>Under the collar, mark the seam allowance' +
      footnote +
      ' before moving the lining. Read the number at the bottom of the column.</p>',
    '<p>Compare this cobalt swatch ' +
      anchorObjectMarker(swatch.id) +
      ' with the charcoal facing. The two edges should stay distinct when the line moves.</p>',
    '<p>Compare the binding under daylight. Record the change along the fold in the margin of the cutting sheet.</p>',
    '<p>Finish schedule</p>',
    '<p>' + anchorObjectMarker(table.id) + '</p>',
    '<p>After the schedule, pin the sleeve at the elbow and compare the two silhouettes. Keep the paper pattern with the sample.</p>',
    '<p>Names on the order sheet read Café, Αθήνα, Москва, İstanbul, Žofie and 東京. The inventory code is A-17.</p>',
    '<p>Cut a narrow sample across the bias and hang it overnight. The paper tag belongs to the left side of each piece.</p>',
    '<p>Turn the facing out. Check for puckering along the neckline. Baste both sides before measuring again.</p>',
    '<p>Final check. Close the garment, record the finished width and return the tested samples to the archive.</p>',
  ].join('');
  markTypographyVersion(doc);
  return doc;
}
