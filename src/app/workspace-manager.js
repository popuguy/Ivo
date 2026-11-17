import { layoutSnapshot } from '../domain/workspace/layouts.js';
/** Reusable layouts never replace source documents or transfer live undo state. */
export function createWorkspaceManager({
  preferences,
  getWorkspace,
  getChrome,
  getDocuments,
  capture,
  flush,
  apply,
  allowed = () => true,
}) {
  let previous = null;
  const current = () => layoutSnapshot(getWorkspace(), getChrome(), getDocuments());
  return Object.freeze({
    list: () => preferences().catalog(getDocuments()).layouts,
    get canRestorePrevious() {
      return previous !== null;
    },
    async save(name, id = null, { isCurrent = () => true } = {}) {
      if (!allowed() || !isCurrent() || !(await flush()) || !allowed() || !isCurrent())
        return false;
      capture();
      preferences().save(name, current(), { id });
      return true;
    },
    async replace(id, options) {
      const item = preferences()
        .catalog()
        .layouts.find((layout) => layout.id === id);
      if (!item) throw new Error('This saved workspace no longer exists.');
      return this.save(item.name, id, options);
    },
    rename(id, name) {
      if (!allowed()) throw new Error('This window is waiting for editing access.');
      return preferences().rename(id, name);
    },
    remove(id) {
      if (!allowed()) throw new Error('This window is waiting for editing access.');
      return preferences().remove(id);
    },
    async load(id, { isCurrent = () => true } = {}) {
      const item = preferences()
        .catalog(getDocuments())
        .layouts.find((layout) => layout.id === id);
      if (!item) throw new Error('This saved workspace no longer exists.');
      if (!allowed() || !isCurrent() || !(await flush()) || !allowed() || !isCurrent())
        return false;
      capture();
      const before = current();
      await apply(item);
      previous = before;
      return true;
    },
    async restorePrevious({ isCurrent = () => true } = {}) {
      if (!previous || !allowed() || !isCurrent() || !(await flush()) || !allowed() || !isCurrent())
        return false;
      capture();
      const before = current(),
        target = layoutSnapshot(previous.workspace, previous.chrome, getDocuments());
      await apply(target);
      previous = before;
      return true;
    },
  });
}
