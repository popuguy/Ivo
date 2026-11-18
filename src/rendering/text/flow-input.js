import { cleanHTML } from '../../shared/html/sanitize.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../shared/dom/text-selection.js';

/** Serialize the canonical text, including text outside the active physical frame. */
export function flowInputHTML(root) {
  const copy = root.cloneNode(true);
  for (const prefix of copy.querySelectorAll('[data-flow-input-prefix]'))
    prefix.replaceWith(...prefix.childNodes);
  return cleanHTML(copy.innerHTML);
}

/**
 * Project one column of a retained canonical input onto its page. Hidden prefixes
 * keep their logical offsets and source formatting; they never enter saved HTML.
 * This changes view state only, and is deferred until composition has finished.
 */
export function projectFlowInput(root, start) {
  if (root.dataset.projectedStart === String(start)) return false;
  const bookmark = captureTextSelection(root);
  for (const node of root.querySelectorAll(
    '[data-flow-input-hidden],[data-flow-input-continuation]',
  )) {
    delete node.dataset.flowInputHidden;
    delete node.dataset.flowInputContinuation;
  }
  for (const prefix of root.querySelectorAll('[data-flow-input-prefix]'))
    prefix.replaceWith(...prefix.childNodes);
  root.normalize();
  const map = textIndexMap(root),
    segments = new Map(map.segments.map((part) => [part.node, part]));
  function hide(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const segment = segments.get(node);
      if (!segment || segment.start >= start) return;
      const count = Math.min(node.length, start - segment.start);
      if (!count) return;
      if (count < node.length) node.splitText(count);
      const prefix = document.createElement('span');
      prefix.dataset.flowInputPrefix = '';
      node.replaceWith(prefix);
      prefix.append(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const points = map.boundaries.get(node);
    // Block boundaries surround their content in the logical text model.
    if (points && points.at(-1) <= start) {
      node.dataset.flowInputHidden = '';
      return;
    }
    if (points && points[0] < start && node.matches('p,div,li,h2,h3,h4,blockquote'))
      node.dataset.flowInputContinuation = '';
    for (const child of [...node.childNodes]) hide(child);
  }
  for (const node of [...root.childNodes]) hide(node);
  root.dataset.projectedStart = String(start);
  if (bookmark) restoreTextSelection(root, bookmark, { focus: document.activeElement === root });
  return true;
}

/** Physical columns expose their source intervals as well as their frame geometry. */
export function inputColumn(fragment, item, offset) {
  if (fragment?.columns?.length) {
    return (
      fragment.columns.find((part) => offset >= part.start && offset < part.end) ||
      [...fragment.columns].reverse().find((part) => offset >= part.start) ||
      fragment.columns[0]
    );
  }
  return {
    start: fragment?.start || 0,
    end: fragment?.end || 0,
    left: 0,
    top: 0,
    width: item.w / (item.textScale?.x || 1),
    height: item.h / (item.textScale?.y || 1),
    index: 0,
  };
}
