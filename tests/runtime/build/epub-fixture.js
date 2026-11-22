// Run inside the shipped web application origin.
export async function exportFixture() {
  const base = '/dist/src/';
  const [
    { exportReflowableBook },
    { createSceneDocument, insertObject, addPage, continueTableOnNextPage },
    { threadFrame },
  ] = await Promise.all([
    import(base + 'features/export/epub.js'),
    import(base + 'domain/documents/scene.js'),
    import(base + 'domain/documents/text-flows.js'),
  ]);
  const doc = createSceneDocument('Woven & printed'),
    ref = createSceneDocument('Dye notes'),
    hidden = createSceneDocument('Private material');
  const page = doc.pages[0].id,
    next = addPage(doc, page).id;
  const p = insertObject(doc, 'text', page, {
    x: 30,
    y: 15,
    w: 180,
    h: 40,
    html: '<h2>Colour tests</h2><p>Shell &amp; <em>lining</em> [[Dye notes|notes]]</p><ol data-ivo-list-series="default" start="3"><li>Satin</li><li>Twill</li></ol><p>Next batch</p><ol data-ivo-list-series="default"><li>Denim</li><li value="8">Silk</li></ol>',
  });
  const q = insertObject(doc, 'text', next, { x: 0, y: 0, w: 140, h: 36, html: '' });
  threadFrame(doc, p.id, q.id);
  insertObject(doc, 'text', page, {
    hidden: true,
    html: '<p>secret-only [[Private material]]</p>',
  });
  insertObject(ref, 'text', ref.pages[0].id, { html: '<p>Back to [[Woven &amp; printed]].</p>' });
  const target = insertObject(ref, 'text', ref.pages[0].id, {
    html: '<h3 data-paragraph-destination="par-proof">Aftercare</h3>',
  });
  insertObject(doc, 'text', page, {
    html:
      '<p><a data-doc-id="' +
      ref.id +
      '" data-page-id="' +
      ref.pages[0].id +
      '" href="#doc=' +
      ref.id +
      '" data-xref-format="paragraph-text" data-xref-paragraph="' +
      target.id +
      '/par-proof">Aftercare</a></p>',
  });
  const mask = insertObject(doc, 'polygon', page, {
    x: 0,
    y: 300,
    w: 80,
    h: 80,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'orange';
  ctx.fillRect(0, 0, 80, 80);
  insertObject(doc, 'image', page, {
    parentId: mask.id,
    w: 80,
    h: 80,
    src: canvas.toDataURL(),
    alt: 'Orange triangular swatch',
    caption: 'First dye bath',
  });
  const gridFrame = insertObject(doc, 'table', page),
    grid = gridFrame.table;
  continueTableOnNextPage(doc, gridFrame.id);
  grid.headerRows = 1;
  grid.cells[0][0] = 'Fiber & finish';
  grid.cells[1][0] = '<twill>';
  grid.merges = [{ row: 1, column: 0, rows: 1, columns: 2 }];
  const initial = JSON.stringify(doc);
  const bytes = await exportReflowableBook([doc, ref, hidden], doc.id, {
    includeLinked: true,
    getSource: (v) => v,
  });
  if (initial !== JSON.stringify(doc)) throw Error('Export changed authored source');
  const tail = doc.blocks.find((b) => b.id === gridFrame.tableNext);
  tail.hidden = true;
  let hiddenTableBlocked = false;
  try {
    await exportReflowableBook([doc, ref], doc.id, { getSource: (v) => v });
  } catch (error) {
    hiddenTableBlocked = error.message.includes('table crosses visible and hidden frames');
  }
  if (!hiddenTableBlocked) throw Error('Partially hidden table exported');
  delete tail.hidden;
  q.hidden = true;
  let blocked = false;
  try {
    await exportReflowableBook([doc], doc.id, { getSource: (v) => v });
  } catch (error) {
    blocked = error.message.includes('hidden');
  }
  if (!blocked) throw Error('Partially hidden flow exported');
  return Array.from(bytes);
}
