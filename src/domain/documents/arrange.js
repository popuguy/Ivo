import { layerFor, objectAvailable } from './publishing.js';

export const ARRANGE_COMMANDS = Object.freeze({
  'bring-front': { label: 'Bring to Front', accelerator: 'CmdOrCtrl+Shift+]' },
  'bring-forward': { label: 'Bring Forward', accelerator: 'CmdOrCtrl+]' },
  'send-backward': { label: 'Send Backward', accelerator: 'CmdOrCtrl+[' },
  'send-back': { label: 'Send to Back', accelerator: 'CmdOrCtrl+Shift+[' },
});

/** Stable sibling ordering within each page, layer and clipping parent. */
export function arrangeObjects(doc, ids, command) {
  if (!Object.hasOwn(ARRANGE_COMMANDS, command)) throw Error('Unknown arrangement command');
  const selected = new Set(ids),
    byId = new Map(doc.blocks.map((item) => [item.id, item]));
  for (const id of selected) {
    let item = byId.get(id),
      parent = item?.parentId,
      seen = new Set();
    if (!item || !objectAvailable(doc, item)) {
      selected.delete(id);
      continue;
    }
    while (parent && !seen.has(parent)) {
      if (selected.has(parent)) {
        selected.delete(id);
        break;
      }
      seen.add(parent);
      parent = byId.get(parent)?.parentId;
    }
  }
  const groups = new Map();
  doc.blocks.forEach((item, index) => {
    const key = JSON.stringify([item.pageId, item.parentId || null, layerFor(doc, item).id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, index });
  });
  let changed = false;
  for (const siblings of groups.values()) {
    if (!siblings.some(({ item }) => selected.has(item.id))) continue;
    let ordered = siblings.map(({ item }) => item);
    if (command === 'bring-front' || command === 'send-back') {
      const chosen = ordered.filter((item) => selected.has(item.id)),
        rest = ordered.filter((item) => !selected.has(item.id));
      ordered = command === 'bring-front' ? [...rest, ...chosen] : [...chosen, ...rest];
    } else if (command === 'bring-forward') {
      for (let i = ordered.length - 2; i >= 0; i--)
        if (selected.has(ordered[i].id) && !selected.has(ordered[i + 1].id))
          [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
    } else {
      for (let i = 1; i < ordered.length; i++)
        if (selected.has(ordered[i].id) && !selected.has(ordered[i - 1].id))
          [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
    }
    siblings.forEach(({ item, index }, order) => {
      changed ||= item !== ordered[order];
      doc.blocks[index] = ordered[order];
    });
  }
  return changed;
}
