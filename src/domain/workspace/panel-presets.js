import { uid } from '../documents/model.js';
import { layoutName } from './layouts.js';
import { normalizePanels } from './panels.js';
/** A small, profile-local preset catalog; never a part of document source. */
export function normalizePanelPresets(value) {
  if (value === undefined || value === null) return { version: 1, presets: [] };
  if (value.version !== 1 || !Array.isArray(value.presets) || JSON.stringify(value).length > 48000)
    throw new Error('Unsupported panel presets.');
  const ids = new Set(),
    names = new Set(),
    presets = [];
  for (const raw of value.presets.slice(0, 16)) {
    if (
      !raw ||
      typeof raw.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(raw.id) ||
      ids.has(raw.id)
    )
      continue;
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
    presets.push({ id: raw.id, name, layout: normalizePanels(raw.layout) });
  }
  return { version: 1, presets };
}
export function savePanelPreset(value, name, layout) {
  const catalog = normalizePanelPresets(value),
    title = layoutName(name),
    item = catalog.presets.find(
      (preset) => preset.name.toLocaleLowerCase('en-US') === title.toLocaleLowerCase('en-US'),
    );
  if (!item && catalog.presets.length >= 16) throw new Error('Save up to 16 panel presets.');
  const next = {
    id: item?.id || uid('panel-preset-'),
    name: title,
    layout: normalizePanels(layout),
  };
  if (item) catalog.presets[catalog.presets.indexOf(item)] = next;
  else catalog.presets.push(next);
  return catalog;
}
