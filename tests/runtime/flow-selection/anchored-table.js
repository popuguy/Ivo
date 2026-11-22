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
