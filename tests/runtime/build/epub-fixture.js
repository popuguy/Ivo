// Run inside the shipped web application origin.
export async function exportFixture() {
  const base = '/dist/src/';
  const [
    { exportReflowableBook },
    { createSceneDocument, insertObject, addPage },
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
  const initial = JSON.stringify(doc);
  const bytes = await exportReflowableBook([doc, ref, hidden], doc.id, {
    includeLinked: true,
    getSource: (v) => v,
  });
  if (initial !== JSON.stringify(doc)) throw Error('Export changed authored source');
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
