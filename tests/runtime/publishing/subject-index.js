import { createSceneDocument, addPage, insertObject } from '../../../src/domain/documents/scene.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

export async function verifySubjectIndex(host, assert) {
  const doc = createSceneDocument('Material studies');
  const pages = [doc.pages[0]];
  for (let i = 1; i < 5; i++) pages.push(addPage(doc, pages.at(-1).id));
  pages[0].section = { start: 1, style: 'roman-lower', prefix: '' };
  pages[3].section = { start: 20, style: 'decimal', prefix: 'A–' };
  const copy = [
    '<p>Wo<em>ol</em> coat. Wool again. Woollen.</p>',
    '<p>Wool, wool and Wool.</p>',
    '<p>Wool. Lining.</p>',
    '<p>Wool coat.</p>',
    '<p>Woollen. wool. Coating.</p>',
  ].map((html, i) =>
    insertObject(doc, 'text', pages[i].id, { x: 25, y: 30, w: 380, h: 150, html }),
  );
  insertObject(doc, 'text', pages[4].id, {
    x: 20,
    y: 100,
    w: 220,
    h: 22,
    html: '<p>Body</p><p>Brocade</p>',
  });
  const samples = insertObject(doc, 'table', pages[1].id, {
    x: 10,
    y: 310,
    w: 300,
    h: 48,
    fontSize: 12,
  }).table;
  samples.cells[0][0] = 'Mohair';
  samples.cells[1][0] = 'first\nsecond\nthird\nfourth';
  samples.cells[3][0] = 'Clipped cell';
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'subject-index',
    source: (s) => s,
    onChange() {},
    onCommit() {},
  });
  try {
    await editor.command('generate-index');
    const form = document.querySelector('dialog[aria-label="Generate Index"] form');
    assert(form, 'Generate Index did not open');
    form.elements.topics.value =
      'Materials > Wool\nGarments > Wool coat\nLining\nBrocade\nMaterials > Wool';
    form.elements.topics.value += '\nMohair\nClipped cell';
    form.querySelector('[data-add-reference]').click();
    form.elements.namedItem('ref-from').value = 'Fleece';
    form.elements.namedItem('ref-to').value = 'Materials > Wool';
    form.querySelector('[data-add-sort]').click();
    form.elements.namedItem('sort-path').value = 'Mohair';
    form.elements.namedItem('sort-key').value = 'AAA';
    form.requestSubmit();
    const flow = doc.textFlows?.find((f) => f.index);
    assert(
      flow,
      'Generate Index could not place a flow: ' + form.querySelector('[role=alert]').textContent,
    );
    await editor.flush();
    const html = () => {
      const root = document.createElement('div');
      root.innerHTML = flow.html;
      return root;
    };
    const row = (name) =>
      [...html().querySelectorAll('p')].find((p) => p.textContent.startsWith(name + '\u2003'));
    assert(
      row('Fleece')?.textContent === 'Fleece\u2003See Materials > Wool' &&
        row('Fleece').querySelector('a').hash === '#page=' + pages[0].id,
      'Missing or misdirected See reference',
    );
    assert(
      row('Mohair')?.textContent === 'Mohair\u2003ii' && !row('Clipped cell'),
      'Incorrect table index page: ' + flow.html,
    );
    assert(
      [...html().querySelectorAll('p')][1].textContent.startsWith('Mohair'),
      'Custom sort key ignored',
    );
    assert(row('Wool')?.textContent === 'Wool\u2003i–iii, A–20', 'Bad page ranges: ' + flow.html);
    assert(
      row('Wool coat')?.textContent === 'Wool coat\u2003i, A–20',
      'A phrase split by formatting was lost',
    );
    assert(
      row('Lining')?.querySelector('a')?.getAttribute('href') === '#page=' + pages[2].id,
      'Wrong topic destination',
    );
    assert(!html().textContent.includes('Brocade'), 'Clipped text was indexed');
    assert(
      [...html().querySelectorAll('p')].map((p) => p.textContent).indexOf('Garments') <
        [...html().querySelectorAll('p')].map((p) => p.textContent).indexOf('Materials'),
      'Incorrect alphabetical order',
    );
    assert(
      flow.index.topics.length === 6 && doc.pages.length === 6,
      'Duplicate topics or unexpected pagination',
    );
    copy[1].html = '<p>Other material.</p>';
    const indexFrame = doc.blocks.find((b) => b.textFlowId === flow.id);
    editor.restoreView({
      selection: [indexFrame.id],
      activePage: indexFrame.pageId,
      tool: 'select',
    });
    await editor.command('update-index');
    assert(
      row('Wool').textContent === 'Wool\u2003i, iii, A–20',
      'Update indexed itself or retained a removed mention: ' + flow.html,
    );
    const restored = validateImport({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [],
    }).documents[0];
    assert(
      JSON.stringify(restored.textFlows.find((f) => f.index).index) === JSON.stringify(flow.index),
      'Index settings did not survive reopening',
    );
  } finally {
    editor.destroy();
  }
}
