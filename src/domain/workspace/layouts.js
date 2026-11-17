import { uid } from '../documents/model.js';
import { normalizeWorkspace } from './state.js';
import { normalizeChrome } from './chrome.js';
const MAX_LAYOUTS = 16,
  MAX_BYTES = 240000;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
export function layoutName(value) {
  if (typeof value !== 'string') throw new TypeError('Workspace name must be text.');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 80)
    throw new TypeError('Workspace name must contain 1–80 characters.');
  // eslint-disable-next-line no-control-regex -- Names cannot contain control characters.
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name))
    throw new TypeError('Workspace name contains an invalid character.');
  return name;
}
/** A reusable view snapshot excludes navigation trails, source, active input and local undo. */
export function layoutSnapshot(workspace, chrome, documents) {
  const view = normalizeWorkspace(workspace, documents);
  for (const tab of view.tabs) {
    delete tab.navigation;
    if (tab.canvasState) delete tab.canvasState.activeTextId;
  }
  return { workspace: view, chrome: normalizeChrome(chrome) };
}
export function normalizeLayoutCatalog(value, documents) {
  if (value === undefined || value === null) return { version: 1, layouts: [] };
  if (value?.version !== 1 || !Array.isArray(value.layouts))
    throw new TypeError('Unsupported saved workspace preferences.');
  if (JSON.stringify(value).length > MAX_BYTES)
    throw new RangeError('Saved workspaces exceed the storage limit.');
  const ids = new Set(),
    names = new Set(),
    layouts = [];
  for (const raw of value.layouts.slice(0, MAX_LAYOUTS)) {
    if (!raw || !validId(raw.id) || ids.has(raw.id)) continue;
    let name;
    try {
      name = layoutName(raw.name);
    } catch {
      continue;
    }
    const key = name.toLocaleLowerCase('en-US');
    if (names.has(key)) continue;
    ids.add(raw.id);
    names.add(key);
    layouts.push({ id: raw.id, name, ...layoutSnapshot(raw.workspace, raw.chrome, documents) });
  }
  return { version: 1, layouts };
}
export function saveLayout(catalog, name, snapshot, { id = null } = {}) {
  const current = normalizeLayoutCatalog(catalog),
    title = layoutName(name),
    item = id && current.layouts.find((layout) => layout.id === id);
  if (id && !item) throw new Error('This saved workspace no longer exists.');
  if (
    current.layouts.some(
      (layout) =>
        layout.id !== id &&
        layout.name.toLocaleLowerCase('en-US') === title.toLocaleLowerCase('en-US'),
    )
  )
    throw new Error('A workspace with this name already exists.');
  if (!item && current.layouts.length >= MAX_LAYOUTS)
    throw new RangeError(`Save up to ${MAX_LAYOUTS} workspaces.`);
  const next = {
    id: item?.id || uid('workspace-'),
    name: title,
    ...layoutSnapshot(snapshot.workspace, snapshot.chrome),
  };
  if (item) current.layouts[current.layouts.indexOf(item)] = next;
  else current.layouts.push(next);
  if (JSON.stringify(current).length > MAX_BYTES)
    throw new RangeError(
      'Saved workspaces exceed the storage limit. Remove a saved workspace first.',
    );
  return current;
}
export function renameLayout(catalog, id, name) {
  const item = catalog.layouts.find((layout) => layout.id === id);
  if (!item) throw new Error('This saved workspace no longer exists.');
  return saveLayout(catalog, name, item, { id });
}
export function removeLayout(catalog, id) {
  const current = normalizeLayoutCatalog(catalog);
  return { ...current, layouts: current.layouts.filter((layout) => layout.id !== id) };
}
