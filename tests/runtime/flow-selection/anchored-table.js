import { fittingRoomProof } from '../../fixtures/text-review/document.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

const paint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function firstLetter(root, phrase) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const at = walker.currentNode.data.indexOf(phrase);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(walker.currentNode, at);
    range.setEnd(walker.currentNode, at + 1);
    return range.getBoundingClientRect();
  }
  throw Error('Missing review text: ' + phrase);
}
export async function verifyEditingBelowInlineTable(host, mouse) {
  const doc = fittingRoomProof(),
    flow = doc.textFlows[0];
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    initialState: { tool: 'text' },
    source: (s) => s,
    onChange() {},
    onCommit() {},
    sessionId: 'editing-below-table',
  });
  const artwork = () =>
    host.querySelector(
      '[data-anchored-artwork][data-object="' +
        doc.blocks.find((b) => b.type === 'table').id +
        '"]',
    );
  try {
    await editor.command('fit-all');
    await paint();
    const preview = () => artwork().closest('[data-page]').querySelector('[data-flow-frame]');
    const text = 'After the schedule';
    const before = firstLetter(preview(), text);
    const bottom = () => artwork().getBoundingClientRect().bottom;
    if (before.top < bottom() - 1) throw Error('Reading layout overlapped the table');
    const original = flow.html;
    const input = host.querySelector('.canvas-flow-input');
    function checkPosition(phrase) {
      const rect = firstLetter(input, phrase);
      if (rect.top < bottom() - 1 || Math.abs(rect.top - before.top) > 1)
        throw Error(
          'Paragraph jumped on entering text: preview=' +
            before.top +
            ', input=' +
            rect.top +
            ', table bottom=' +
            bottom(),
        );
    }
    for (const phrase of ['Finish schedule', text]) {
      const point = firstLetter(preview(), phrase);
      await mouse.select({ from: [point.left + point.width / 2, point.top + point.height / 2] });
      await paint();
      if (document.activeElement !== input || !input.isContentEditable)
        throw Error('Click missed ' + phrase);
      checkPosition(text);
      if (original !== flow.html) throw Error('Entering the paragraph changed its source');
      if (phrase !== text) {
        await mouse.key('Escape');
        await paint();
        if (input.isContentEditable)
          throw Error('Could not leave the frame before the second click');
        await editor.command('tool-text');
        await paint();
      }
    }
    await mouse.type('x');
    await paint();
    checkPosition('the schedule');
    if (!/xAfter the schedule|Axfter the schedule/.test(flow.html))
      throw Error('Typing missed the clicked insertion point');
    const cell = artwork().querySelector('[data-table-row="1"][data-table-column="1"]');
    const box = cell.getBoundingClientRect();
    await mouse.select({ from: [box.left + box.width / 2, box.top + box.height / 2], clicks: 2 });
    await paint();
    if (
      document.activeElement.closest('[data-table-row]') !== cell ||
      !document.activeElement.matches('[data-table-editor]')
    )
      throw Error('Clicking the table from prose did not enter its cell');
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
}

export async function verifyDraggingInlineTable(host, mouse) {
  const doc = fittingRoomProof();
  const table = doc.blocks.find((b) => b.type === 'table');
  const original = structuredClone(table);
  const moves = [];
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    initialState: { tool: 'select', activePage: doc.pages[1].id },
    source: (s) => s,
    onChange() {},
    onCommit(before) {
      moves.push(before);
    },
    sessionId: 'dragging-threaded-table',
  });
  const hadGuides = editor.getState().snap;
  const art = () => host.querySelector('[data-object="' + table.id + '"]');
  const rect = () => art().getBoundingClientRect();
  function near(actual, expected, label) {
    if (Math.abs(actual - expected) > 1.1)
      throw Error(label + ': expected ' + expected + ', saw ' + actual);
  }
  async function drag(from, delta, check) {
    const start = from.map(Math.round);
    const samples = [];
    const sample = (e) => {
      if (e.buttons === 1) samples.push([e.clientX - start[0], e.clientY - start[1], rect()]);
    };
    host.addEventListener('pointermove', sample);
    try {
      await mouse.drag(
        start,
        start.map((v, i) => v + delta[i]),
      );
      await paint();
    } finally {
      host.removeEventListener('pointermove', sample);
    }
    const moving = samples.filter(([x, y]) => Math.hypot(x, y) >= 3);
    if (moving.length < 2) throw Error('No intermediate table drag samples');
    for (const [x, y, r] of moving) check(r, x, y);
    check(rect(), ...delta);
  }
  try {
    if (hadGuides) await editor.command('toggle-smart-guides');
    await editor.command('fit-page');
    await paint();
    const page = art().closest('[data-page]');
    if (page.dataset.page === table.pageId) throw Error('Expected a table on a continuation page');
    const frameId = page.querySelector('[data-flow-frame]').dataset.flowFrame;
    const source = doc.textFlows[0].html;
    for (const [row, col, dx, dy] of [
      [0, 0, 23, 12],
      [3, 1, -27, -11],
    ]) {
      const count = moves.length;
      const before = rect();
      const cell = art().querySelector(
        '[data-table-row="' + row + '"][data-table-column="' + col + '"]',
      );
      const b = cell.getBoundingClientRect();
      await drag([b.left + b.width * 0.64, b.top + b.height * 0.56], [dx, dy], (r, x, y) => {
        near(r.left - before.left, x, 'Inline table horizontal grab point');
        near(r.top - before.top, y, 'Inline table vertical grab point');
      });
      const lastMove = moves.at(-1);
      if (moves.length !== count + 1 || !lastMove.blocks.some((b) => b.id === frameId))
        throw Error('Frame drag did not produce one undoable edit');
      if (
        editor.getState().selection[0] !== frameId ||
        JSON.stringify(table) !== JSON.stringify(original) ||
        doc.textFlows[0].html !== source
      )
        throw Error('Dragging a cell changed the anchor, contents or selected the wrong frame');
    }
    editor.restoreView({ selection: [table.id], activePage: page.dataset.page, tool: 'select' });
    await paint();
    const grip = art().querySelector('[data-table-divider="0"]').getBoundingClientRect();
    const before = rect();
    await drag([grip.left + grip.width / 2, grip.top + grip.height / 2], [19, 0], (r) => {
      near(r.left, before.left, 'Column divider moved the table horizontally');
      near(r.top, before.top, 'Column divider moved the table vertically');
    });
    if (JSON.stringify(table.table.widths) === JSON.stringify(original.table.widths))
      throw Error('Column divider missed the table');
    const cell = art().querySelector('[data-table-row="1"][data-table-column="0"]');
    const b = cell.getBoundingClientRect();
    await mouse.select({ from: [b.left + b.width / 2, b.top + b.height / 2], clicks: 2 });
    await paint();
    if (
      document.activeElement.closest('[data-table-row]') !== cell ||
      !document.activeElement.matches('[data-table-editor]')
    )
      throw Error('Double-clicking a cell with the Selection tool did not enter it');
  } finally {
    if (hadGuides) await editor.command('toggle-smart-guides');
    editor.destroy();
    host.replaceChildren();
  }
}
