import { addTab, moveTab, normalizeWorkspace } from './state.js';

/** Import a view into an existing group. Source and document histories stay in their vault. */
export function receiveTab(workspace, input, documents, groupId, index) {
  if (!input || !['document', 'graph', 'library', 'empty', 'backlinks'].includes(input.kind))
    throw new Error('Choose a valid tab.');
  if (input.kind === 'document' && !documents.some((doc) => doc.id === input.docId))
    throw new Error('This document is no longer available.');
  const incoming = normalizeWorkspace({ version: 1, tabs: [input] }, documents).tabs[0],
    next = structuredClone(workspace),
    tab = addTab(next, { ...incoming, groupId, atEnd: true });
  // A copied view can already have the same ID in this window. Always allocate a local identity.
  Object.assign(tab, incoming, { id: tab.id });
  delete tab.textView;
  if (tab.canvasState) delete tab.canvasState.activeTextId;
  if (Number.isInteger(index))
    moveTab(
      next,
      tab.id,
      Math.max(
        0,
        Math.min(index, next.groups.find((group) => group.id === groupId).tabIds.length - 1),
      ),
    );
  // Existing tabs can have ephemeral caret/closed-tab bookmarks. Only the incoming
  // view crosses a trust boundary; normal persistence strips those bookmarks later.
  return next;
}
