import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

export async function verifyNextStyle() {
  const doc = createSceneDocument('Style sequences');
  const body = saveTextStyle(doc, 'paragraph', { name: 'Copy', attributes: { fontSize: 12 } });
  const byline = saveTextStyle(doc, 'paragraph', {
    name: 'Byline',
    nextStyle: body.id,
    attributes: { italic: true },
  });
  const title = saveTextStyle(doc, 'paragraph', {
    name: 'Title',
    nextStyle: byline.id,
    attributes: { fontSize: 24 },
  });
  const item = insertObject(doc, 'text', doc.pages[0].id, {
    paragraphStyle: title.id,
    html: '<p>Headline</p>',
  });
  const host = document.createElement('div');
  document.body.append(host);
  host.style.cssText = 'width:800px;height:560px;display:flex;position:relative';
  const history = [];
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (v) => v,
    onChange() {},
    onCommit(before, meta) {
      history.push([before, meta]);
    },
    onUndo() {},
    onRedo() {},
  });
  const pt = (index) => ({ path: [], offset: index, index, kind: 'text', affinity: 'forward' });
  const enter = (type, data) =>
    host
      .querySelector('[contenteditable=true]')
      .dispatchEvent(
        new InputEvent('beforeinput', { inputType: type, data, bubbles: true, cancelable: true }),
      );
  try {
    editor.restoreView({
      selection: [item.id],
      activeTextId: item.id,
      tool: 'text',
      textSelection: { anchor: pt(8), focus: pt(8) },
    });
    const input = host.querySelector('[contenteditable=true]'),
      range = document.createRange();
    range.selectNodeContents(input.querySelector('p'));
    range.collapse(false);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    enter('insertParagraph');
    enter('insertText', 'Author');
    enter('insertParagraph');
    enter('insertText', 'Lead');
    const parse = () => {
      const root = document.createElement('div');
      root.innerHTML = item.html;
      return [...root.querySelectorAll('p')];
    };
    if (
      parse()
        .map((p) => p.textContent)
        .join('|') !== 'Headline|Author|Lead' ||
      parse()[1].dataset.ivoPstyle !== byline.id ||
      parse()[2].dataset.ivoPstyle !== body.id
    )
      throw Error('Return did not advance Title → Byline → Copy: ' + item.html);
    editor.restoreView({ selection: [item.id], tool: 'select' });
    await editor.command('apply-next-styles');
    const dialog = document.querySelector('dialog[open]');
    dialog.querySelector('[name=start]').value = byline.id;
    dialog.querySelector('form').requestSubmit();
    if (
      parse()
        .map((p) => p.dataset.ivoPstyle)
        .join('|') !== [byline.id, body.id, body.id].join('|') ||
      history.at(-1)?.[1].label !== 'Apply Style Sequence'
    )
      throw Error('Bulk paragraph style sequence did not apply as one action: ' + item.html);
  } finally {
    editor.destroy();
    host.remove();
  }
}
