/** One document timeline for text, formatting, geometry and structural commands. */
import { authoredLayoutDocument } from '../documents/derived-text-layout.js';
const clone = (value) => (value == null ? value : structuredClone(value));
export function documentContent(document) {
  const { version, updatedAt, ...content } = authoredLayoutDocument(document);
  return JSON.stringify(content);
}
export function createDocumentHistory({
  limit = 100,
  mergeDelay = 900,
  now = () => Date.now(),
} = {}) {
  const past = [],
    future = [];
  let boundary = 0;
  function record(before, after, metadata = {}) {
    if (before.id !== after.id) throw new TypeError('History cannot span different documents.');
    const previousContent = documentContent(before),
      nextContent = documentContent(after);
    if (previousContent === nextContent) return false;
    const time = now(),
      last = past.at(-1),
      mergeKey = metadata.mergeKey || null;
    const merge =
      last &&
      mergeKey &&
      last.mergeKey === mergeKey &&
      last.boundary === boundary &&
      time - last.time <= mergeDelay &&
      last.afterContent === previousContent &&
      JSON.stringify(last.viewAfter) === JSON.stringify(metadata.viewBefore);
    if (merge) {
      last.after = clone(after);
      last.afterContent = nextContent;
      last.viewAfter = clone(metadata.viewAfter);
      last.time = time;
    } else {
      past.push({
        before: clone(before),
        after: clone(after),
        beforeContent: previousContent,
        afterContent: nextContent,
        viewBefore: clone(metadata.viewBefore),
        viewAfter: clone(metadata.viewAfter),
        label: metadata.label || 'Edit',
        mergeKey,
        boundary,
        time,
      });
      if (past.length > limit) past.shift();
    }
    future.length = 0;
    return true;
  }
  function step(current, from, to, direction) {
    const entry = from.at(-1);
    if (!entry) return null;
    const expected = direction === 'undo' ? entry.afterContent : entry.beforeContent;
    if (current.id !== entry.before.id || documentContent(current) !== expected)
      throw new Error('The document changed outside its history.');
    from.pop();
    to.push(entry);
    boundary++;
    return {
      document: clone(direction === 'undo' ? entry.before : entry.after),
      view: clone(direction === 'undo' ? entry.viewBefore : entry.viewAfter),
      label: entry.label,
    };
  }
  return Object.freeze({
    record,
    undo: (current) => step(current, past, future, 'undo'),
    redo: (current) => step(current, future, past, 'redo'),
    breakGroup() {
      boundary++;
    },
    clear() {
      past.length = 0;
      future.length = 0;
      boundary++;
    },
    get canUndo() {
      return !!past.length;
    },
    get canRedo() {
      return !!future.length;
    },
    get undoLabel() {
      return past.at(-1)?.label || '';
    },
    get redoLabel() {
      return future.at(-1)?.label || '';
    },
    get size() {
      return past.length;
    },
  });
}
