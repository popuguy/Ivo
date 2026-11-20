import { normalizePanelPresets, savePanelPreset } from '../domain/workspace/panel-presets.js';
import { isDrawingTool } from '../domain/workspace/state.js';
import { normalizeChrome } from '../domain/workspace/chrome.js';
import {
  normalizeLayoutCatalog,
  saveLayout,
  renameLayout,
  removeLayout,
} from '../domain/workspace/layouts.js';
/** Profile-local preferences. Read the latest catalog at each change; never overwrite from a cached dialog. */
export function createWorkspacePreferences({
  storage = globalThis.localStorage,
  vaultId = 'browser',
  windowId = 'main',
} = {}) {
  const scope = encodeURIComponent(String(vaultId)),
    toolKey = 'ivo:drawing-tool:1:' + scope,
    panelKey = 'ivo:panel-presets:1:' + scope,
    catalogKey = 'ivo:workspace-layouts:1:' + scope,
    chromeKey = 'ivo:workspace-chrome:1:' + scope + ':' + encodeURIComponent(String(windowId));
  const read = (key) => {
    const raw = storage.getItem(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error('Saved workspace preferences could not be read.', { cause: error });
    }
  };
  const catalog = (documents) => normalizeLayoutCatalog(read(catalogKey), documents);
  const write = (value) => {
    storage.setItem(catalogKey, JSON.stringify(value));
    return value;
  };
  return Object.freeze({
    catalog,
    readDrawingTool() {
      const value = storage.getItem(toolKey);
      return isDrawingTool(value) ? value : null;
    },
    writeDrawingTool(value) {
      if (isDrawingTool(value)) storage.setItem(toolKey, value);
    },
    panelPresets: () => normalizePanelPresets(read(panelKey)),
    savePanelPreset: (name, layout) => {
      const value = savePanelPreset(read(panelKey), name, layout);
      storage.setItem(panelKey, JSON.stringify(value));
      return value;
    },
    removePanelPreset: (id) => {
      const value = normalizePanelPresets(read(panelKey));
      value.presets = value.presets.filter((preset) => preset.id !== id);
      storage.setItem(panelKey, JSON.stringify(value));
      return value;
    },
    save: (name, snapshot, options) => write(saveLayout(catalog(), name, snapshot, options)),
    rename: (id, name) => write(renameLayout(catalog(), id, name)),
    remove: (id) => write(removeLayout(catalog(), id)),
    readChrome: () => normalizeChrome(read(chromeKey)),
    writeChrome: (input) => {
      const value = normalizeChrome(input);
      storage.setItem(chromeKey, JSON.stringify(value));
      return value;
    },
  });
}
