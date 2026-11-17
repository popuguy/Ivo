const TYPE = 'application/x-ivo-library';
/** Only logical IDs/paths from this vault are accepted. External files are not library moves. */
export function installLibraryDrag(root, { scope, allowed, onMove, onError }) {
  const controller = new AbortController(),
    listen = (name, callback, options = {}) =>
      root.addEventListener(name, callback, { signal: controller.signal, ...options });
  let current = null,
    hover = null,
    timer = null;
  function clear() {
    clearTimeout(timer);
    timer = null;
    hover = null;
    for (const item of root.querySelectorAll('.library-drop-target'))
      item.classList.remove('library-drop-target');
  }
  const destination = (target) => {
    const list = target.closest('#document-list');
    if (!list) return null;
    return target.closest('[data-folder]')?.dataset.folder ?? '';
  };
  listen('dragstart', (event) => {
    const list = event.target.closest('#document-list');
    if (!list || !allowed()) return;
    const folder = event.target.closest('summary[data-folder-path]'),
      document = event.target.closest('[data-open]');
    current = folder
      ? { type: 'folder', path: folder.dataset.folderPath }
      : document
        ? { type: 'document', id: document.dataset.open }
        : null;
    if (!current) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TYPE, JSON.stringify({ version: 1, scope: scope(), ...current }));
  });
  listen('dragover', (event) => {
    if (!allowed() || !event.dataTransfer.types.includes(TYPE)) return;
    const folder = destination(event.target);
    if (folder === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target =
      event.target.closest('[data-folder]')?.querySelector(':scope > summary') ||
      event.target.closest('#document-list');
    if (hover === target) return;
    clear();
    hover = target;
    target?.classList.add('library-drop-target');
    const details = target?.closest('details');
    if (details && !details.open)
      timer = setTimeout(() => {
        details.open = true;
      }, 600);
  });
  listen('dragleave', (event) => {
    if (!root.contains(event.relatedTarget) || !event.relatedTarget?.closest?.('#document-list'))
      clear();
  });
  listen('drop', (event) => {
    if (!allowed() || !event.dataTransfer.types.includes(TYPE)) return;
    const folder = destination(event.target);
    if (folder === null) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
    try {
      const raw = event.dataTransfer.getData(TYPE);
      if (raw.length > 10000) throw new Error('Invalid library drag.');
      const value = JSON.parse(raw);
      if (
        value.version !== 1 ||
        value.scope !== scope() ||
        !['folder', 'document'].includes(value.type)
      )
        throw new Error('Move items within their original vault.');
      const command =
        value.type === 'folder'
          ? { type: 'move-folder', path: value.path, destination: folder }
          : { type: 'move-document', id: value.id, destination: folder };
      Promise.resolve(onMove(command)).catch(onError);
    } catch (error) {
      onError(error);
    } finally {
      current = null;
    }
  });
  listen('dragend', () => {
    clear();
    current = null;
  });
  return {
    cancel() {
      clear();
      current = null;
    },
    destroy() {
      clear();
      controller.abort();
    },
  };
}
