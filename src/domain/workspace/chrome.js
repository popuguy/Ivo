import { normalizePanels } from './panels.js';
import { normalizeFolder } from '../documents/library.js';
export const DEFAULT_SIDEBAR_WIDTH = 240;
export function sidebarWidth(value, availableWidth) {
  const desired = Number.isFinite(value)
    ? Math.max(180, Math.min(520, value))
    : DEFAULT_SIDEBAR_WIDTH;
  return Math.min(desired, Math.max(0, availableWidth - 44 - (availableWidth > 760 ? 320 : 0)));
}
/** Device/window preferences, never authored content or a DOM bookmark. */
export function normalizeChrome(input = {}) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const folders = new Set();
  for (const value of Array.isArray(input.collapsedFolders)
    ? input.collapsedFolders.slice(0, 500)
    : []) {
    try {
      const name = normalizeFolder(value);
      if (name) folders.add(name);
    } catch {}
  }
  return {
    sidebarWidth: Number.isFinite(input.sidebarWidth)
      ? Math.max(180, Math.min(520, input.sidebarWidth))
      : DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: input.sidebarCollapsed === true,
    sidebarMode: ['files', 'search', 'bookmarks', 'trash'].includes(input.sidebarMode)
      ? input.sidebarMode
      : 'files',
    sortMode: input.sortMode === 'updated' ? 'updated' : 'name',
    collapsedFolders: [...folders],
    query: typeof input.query === 'string' ? input.query.slice(0, 200) : '',
    bookmarkQuery: typeof input.bookmarkQuery === 'string' ? input.bookmarkQuery.slice(0, 200) : '',
    tag: typeof input.tag === 'string' ? input.tag.slice(0, 256) : '',
    graphScope: input.graphScope === 'local' ? 'local' : 'global',
    graphDepth: [1, 2, 3].includes(input.graphDepth) ? input.graphDepth : 1,
    showTags: input.showTags !== false,
    panelLayout: normalizePanels(input.panelLayout),
  };
}
