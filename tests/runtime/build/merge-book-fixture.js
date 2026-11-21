// Exercise generated documents with the modules shipped in the hosted build.
export async function verifyMergedBook() {
  const root = '/dist/src/';
  const [
    { createSceneDocument, insertObject, addPage },
    { threadFrame },
    { enablePublishing, saveTextStyle },
    { generateMergeDocuments },
    { exportReflowableBook },
    { markTypographyVersion },
  ] = await Promise.all(
    [
      'domain/documents/scene.js',
      'domain/documents/text-flows.js',
      'domain/documents/publishing.js',
      'features/data-merge/generate.js',
      'features/export/epub.js',
      'domain/documents/capabilities.js',
    ].map((path) => import(root + path)),
  );
  const template = createSceneDocument('Swatch card');
  enablePublishing(template);
  const style = saveTextStyle(template, 'paragraph', {
    name: 'Collection',
    attributes: { bold: true },
  });
  const page = template.pages[0].id,
    page2 = addPage(template, page).id;
  const a = insertObject(template, 'text', page, {
    html:
      '<p data-ivo-pstyle="' +
      style.id +
      '"><i>{{Col</i><b>our}}</b></p><h4>Weave</h4><p>{{Note}} {{Note}}</p>',
  });
  const b = insertObject(template, 'text', page2, { html: '' });
  threadFrame(template, a.id, b.id);
  const privateBlock = insertObject(template, 'text', page, {
    html: '<p>excluded swatch text</p>',
  });
  const beforeText = insertObject(template, 'text', page2, { html: '<p>Introduction</p>' });
  const mask = insertObject(template, 'polygon', page, {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
  });
  const image = insertObject(template, 'image', page, {
    parentId: mask.id,
    alt: 'Swatch',
    src: '',
  });
  const templateFlow = template.textFlows[0];
  template.publication = {
    version: 1,
    order: [beforeText.id, templateFlow.id],
    excluded: [privateBlock.id],
    chapters: [template.id],
    headings: { [style.id]: 2 },
  };
  markTypographyVersion(template);
  const source = JSON.stringify(template);
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  canvas.getContext('2d').fillRect(0, 0, 4, 4);
  const assets = [
    { id: 'swatch-blue', name: 'blue.png', mimeType: 'image/png', data: canvas.toDataURL() },
  ];
  const table = {
    headers: ['Colour', 'Note', '@Photo'],
    records: [
      ['Écru', '  <ink>\nβ{{Colour}}', 'blue.png'],
      ['藍', 'Синий', 'asset:swatch-blue'],
    ],
  };
  const opts = { first: 1, last: 2, bindings: new Map([[image.id, '@Photo']]), assets };
  const [one, two] = await generateMergeDocuments(template, table, opts);
  const assert = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  assert(
    one.id !== two.id &&
      one.pages[1].id !== two.pages[1].id &&
      one.textFlows[0].frameIds.length === 2,
    'Independent multi-page records',
  );
  const text = document.createElement('div');
  text.innerHTML = one.textFlows[0].html;
  assert(
    text.querySelector('i').textContent === 'Écru' &&
      !text.querySelector('ink') &&
      text.querySelectorAll('br').length === 2 &&
      text.textContent.includes('  <ink>β{{Colour}}'),
    'Escaped multiline values inherit opening character style and remain literal',
  );
  const outputImage = one.blocks.find((b) => b.type === 'image');
  assert(
    outputImage.src === 'asset:swatch-blue' &&
      one.blocks.find((b) => b.id === outputImage.parentId)?.type === 'polygon',
    'Image keeps mask and shared vault reference',
  );
  try {
    await generateMergeDocuments(
      template,
      { ...table, records: [table.records[0], ['z', 'ok', 'unknown.png']] },
      opts,
    );
    throw Error('Accepted missing picture');
  } catch (e) {
    assert(e.message.includes('Record 2') && e.message.includes('missing'), e.message);
  }
  assert(JSON.stringify(template) === source, 'Merge mutated source');
  one.publication.chapters = [two.id, one.id];
  let missing = false;
  try {
    await exportReflowableBook([one], one.id, { useBook: true, getSource: () => assets[0].data });
  } catch (e) {
    missing = e.message.includes('missing');
  }
  assert(missing, 'Missing chapter silently omitted');
  return Array.from(
    await exportReflowableBook([one, two], one.id, {
      useBook: true,
      getSource: () => assets[0].data,
    }),
  );
}
