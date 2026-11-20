import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

export async function verifyNestedLayers(host, assert) {
  let doc = createSceneDocument('Clipped objects');
  const page = doc.pages[0].id;
  const layer = enablePublishing(doc).layers[0];
  const mask = insertObject(doc, 'polygon', page, { name: 'Camera pile' });
  const group = insertObject(doc, 'polygon', page, { parentId: mask.id, name: 'Foreground' });
  const red = insertObject(doc, 'image', page, { parentId: group.id, name: 'Red' });
  const unrelated = insertObject(doc, 'rule', page);
  const white = insertObject(doc, 'image', page, { parentId: group.id, name: 'White' });
  const history = createDocumentHistory();
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (src) => src,
    sessionId: 'nested-layers',
    onCommit: (before, metadata) => history.record(before, doc, metadata),
    onChange() {},
    onUndo() {
      const result = history.undo(doc);
      if (!result) return;
      doc = result.document;
      editor.restoreView(result.view);
    },
  });
  const row = (id) => host.querySelector(`[data-object-row="${id}"]`);
  const button = (id, toggle) => row(id).querySelector(`[data-object-toggle="${toggle}"]`);
  const surface = (id) => host.querySelector(`.canvas-world [data-object="${id}"]`);
  const item = (id) => doc.blocks.find((block) => block.id === id);
  const order = () => doc.blocks.map((block) => block.id).join(',');
  const before = order();
  const usable = (condition, message) => assert(condition, 'Nested Layers: ' + message);
  const drag = (source, target) => {
    const transfer = new DataTransfer();
    const point = target.getBoundingClientRect().top + 1;
    for (const [el, name] of [
      [source, 'dragstart'],
      [target, 'dragover'],
      [target, 'drop'],
      [source, 'dragend'],
    ])
      el.dispatchEvent(
        new DragEvent(name, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientY: point,
        }),
      );
  };
  try {
    await editor.command('show-panel-layers');
    host.querySelector(`[data-layer-disclosure="${layer.id}"]`).click();
    const expand = (id) => host.querySelector(`[data-object-disclosure="${id}"]`).click();
    expand(mask.id);
    expand(group.id);
    usable(
      row(red.id).closest('[role="treeitem"]').getAttribute('aria-level') === '4',
      'member depth',
    );
    row(red.id).querySelector('[data-layer-object]').click();
    usable(editor.getState().selection.join() === red.id, 'individual selection');
    button(red.id, 'hidden').click();
    usable(
      item(red.id).hidden && !surface(red.id) && surface(white.id) && surface(mask.id),
      'hide only specified image',
    );
    await editor.command('undo');
    usable(!item(red.id).hidden && surface(red.id) && order() === before, 'visibility undo');
    drag(row(red.id), row(unrelated.id));
    usable(order() === before && item(red.id).parentId === group.id, 'reject drag out of mask');
    drag(row(red.id), row(white.id));
    usable(
      doc.blocks.at(-1).id === red.id &&
        doc.blocks[3].id === unrelated.id &&
        item(red.id).parentId === group.id &&
        item(white.id).parentId === group.id,
      'reorder only siblings',
    );
    usable(
      [...surface(group.id).querySelectorAll('[data-object]')]
        .map((el) => el.dataset.object)
        .join() === [white.id, red.id].join(),
      'canvas paints the new order',
    );
    await editor.command('undo');
    usable(order() === before, 'object order undo');
    button(group.id, 'locked').click();
    usable(
      button(red.id, 'locked').disabled &&
        row(red.id).querySelector('[data-layer-object]').disabled &&
        !row(red.id).draggable,
      'inherit group lock',
    );
    button(group.id, 'locked').click();
    usable(
      !button(red.id, 'locked').disabled && row(red.id).draggable && !item(red.id).locked,
      'group unlock preserves member flags',
    );
    button(mask.id, 'hidden').click();
    usable(
      !surface(red.id) &&
        button(red.id, 'hidden').disabled &&
        button(red.id, 'hidden').getAttribute('aria-pressed') === 'false',
      'reflect invisible ancestor',
    );
    button(mask.id, 'hidden').click();
    expand(group.id);
    usable(!row(red.id) && !!row(unrelated.id), 'collapse hides only subtree');
  } finally {
    editor.destroy();
  }
}
