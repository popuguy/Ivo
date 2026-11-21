import { changeCaseParts } from '../../domain/text/change-case.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../shared/dom/text-selection.js';

export function changeSelectedCase(root, command, language) {
  const bookmark = captureTextSelection(root);
  if (!bookmark) return false;
  const { anchor, focus } = bookmark,
    begin = Math.min(anchor.index, focus.index),
    end = Math.max(anchor.index, focus.index);
  if (begin === end) return false;
  const state = { sentenceStart: true };
  let group = [],
    locale = null,
    previousEnd = null,
    delta = 0,
    changed = false;
  function flush() {
    if (!group.length) return;
    const values = changeCaseParts(
      group.map((v) => v.value),
      command,
      locale,
      state,
    );
    group.forEach(({ node, offset, value }, i) => {
      if (value !== values[i]) {
        node.replaceData(offset, value.length, values[i]);
        delta += values[i].length - value.length;
        changed = true;
      }
    });
    group = [];
  }
  for (const { node, start, end: stop } of textIndexMap(root).segments) {
    if (stop <= begin) continue;
    if (start >= end) break;
    const offset = Math.max(0, begin - start),
      limit = Math.min(node.length, end - start);
    if (limit <= offset) continue;
    const owner = node.parentElement.closest('[data-ivo-lang],[lang]');
    const nextLocale =
      (owner && root.contains(owner) && (owner.dataset.ivoLang || owner.lang)) ||
      language ||
      'en-US';
    if (previousEnd !== start || nextLocale !== locale) flush();
    if (previousEnd !== start) state.sentenceStart = true;
    group.push({ node, offset, value: node.data.slice(offset, limit) });
    previousEnd = stop;
    locale = nextLocale;
  }
  flush();
  if (changed) {
    const high = anchor.index > focus.index ? anchor : focus;
    high.index += delta;
    restoreTextSelection(root, bookmark);
  }
  return changed;
}
