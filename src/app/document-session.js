import { createDocumentHistory } from '../domain/history/document-history.js';
import { createSaveQueue } from '../storage/save-queue.js';
/** Document command lifecycle shared by all panes in one window.
 * The storage adapter owns IO; the workspace owns selection, cameras and tab identity.
 * A legacy revision is preserved before its first edited replacement is committed.
 */
export function createDocumentSession({
  save,
  snapshot,
  onStatus,
  onError,
  onChanged = () => {},
  now = () => new Date().toISOString(),
}) {
  const histories = new Map(),
    originals = new Map();
  const saves = createSaveQueue({
    save: async (document) => {
      const original = originals.get(document.id);
      if (original) await snapshot(original);
      await save(document);
      if (original) originals.delete(document.id);
    },
    onStatus,
    onError,
  });
  return Object.freeze({
    saves,
    history(id) {
      if (!histories.has(id)) histories.set(id, createDocumentHistory());
      return histories.get(id);
    },
    legacyOriginal: (id) => originals.get(id),
    discardLegacy: (id) => originals.delete(id),
    clearLegacy: () => originals.clear(),
    existingHistory: (id) => histories.get(id),
    discardHistory: (id) => histories.delete(id),
    preserveLegacy(document) {
      if (!originals.has(document.id)) originals.set(document.id, structuredClone(document));
    },
    changed(document) {
      if (!document) return;
      document.updatedAt = now();
      document.version = (document.version || 1) + 1;
      saves.enqueue(document);
      onChanged(document.id);
    },
  });
}
