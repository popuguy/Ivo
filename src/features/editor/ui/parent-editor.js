import { protectParentFieldSelections } from '../text/parent-fields.js';
import { uid } from '../../../domain/documents/model.js';
import { commitParentDefinition } from '../../../domain/documents/publishing.js';
import { createDocumentHistory } from '../../../domain/history/document-history.js';
import { escapeHTML } from '../../../shared/html/sanitize.js';

/** An isolated parent editing session commits one reversible document command when closed/flushed. */
export function openParentEditor(editor, id, { getDocument, mount, options, onCommit, onClose }) {
  const parent = getDocument().publishing?.parents.find((p) => p.id === id);
  if (!parent) return null;
  let proxy = {
    ...structuredClone(getDocument()),
    id: uid('parent-edit-'),
    title: parent.prefix + '-' + parent.name,
    pages: [
      {
        id: parent.id,
        name: parent.name,
        width: parent.width,
        height: parent.height,
      },
    ],
    blocks: parent.blocks.map((b) => ({ ...structuredClone(b), pageId: parent.id })),
    textFlows: [],
  };
  const overlay = document.createElement('section');
  overlay.className = 'parent-editor-overlay';
  overlay.innerHTML = `<header><span>${escapeHTML(proxy.title)}</span><button data-finish-parent>Done</button></header><div class="parent-editor-host"></div>`;
  editor.append(overlay);
  protectParentFieldSelections(overlay);
  const history = createDocumentHistory();
  let handle,
    closed = false;
  const step = (direction) => {
    if (!handle.prepareHistory()) return;
    const result = history[direction](proxy);
    if (result) {
      proxy = result.document;
      handle.restoreView(result.view);
    }
  };
  handle = mount(overlay.querySelector('.parent-editor-host'), {
    ...options,
    getDocument: () => proxy,
    documents: [proxy],
    parentMode: true,
    sessionId: proxy.id,
    initialState: null,
    isActive: () => options.isActive?.() !== false,
    onCommit: (before, metadata) => history.record(before, proxy, metadata),
    onChange: () => {},
    onUndo: () => step('undo'),
    onRedo: () => step('redo'),
    onPanelLayout: () => {},
    onMetadata: () => {},
  });
  function commit() {
    if (closed) return;
    handle.finish();
    const before = structuredClone(getDocument());
    commitParentDefinition(getDocument(), id, proxy);
    onCommit(before, { label: 'Edit parent page' });
    closed = true;
    handle.destroy();
    overlay.remove();
    onClose();
  }
  const result = {
    flush: async () => {
      if (closed) return;
      await handle.flush();
      commit();
    },
    get pending() {
      return handle.pending;
    },
    finish: commit,
    destroy() {
      if (closed) return;
      closed = true;
      handle.destroy();
      overlay.remove();
    },
  };
  overlay.querySelector('[data-finish-parent]').onclick = () =>
    result.flush().catch((e) => options.onNotify?.(e.message));
  return result;
}
