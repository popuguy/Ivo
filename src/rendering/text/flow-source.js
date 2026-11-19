import { cleanHTML } from '../../shared/html/sanitize.js';
import { textIndexMap, textIndexAt } from '../../shared/dom/text-selection.js';

export const blockTags = new Set(['P', 'DIV', 'LI', 'OL', 'UL', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);
export function annotatedSource(html) {
  const root = document.createElement('div');
  root.innerHTML = cleanHTML(html);
  const map = textIndexMap(root),
    origins = new Map();
  let serial = 0;
  for (const element of root.querySelectorAll('*')) {
    const id = String(serial++);
    element.dataset.flowOrigin = id;
    element.dataset.flowBefore = textIndexAt(
      map,
      element.parentNode,
      [...element.parentNode.childNodes].indexOf(element),
    );
    const points = map.boundaries.get(element);
    if (points && blockTags.has(element.tagName)) {
      element.dataset.flowBlockStart = points[0];
      element.dataset.flowBlockEnd = points.at(-1);
      const at = [...element.parentNode.childNodes].indexOf(element);
      element.dataset.flowBlockBefore = textIndexAt(map, element.parentNode, at);
      element.dataset.flowBlockAfter = textIndexAt(map, element.parentNode, at + 1);
      if (
        !['OL', 'UL'].includes(element.tagName) &&
        !element.querySelector('p,div,li,h2,h3,h4,blockquote')
      )
        element.dataset.flowParagraph = 'true';
    }
    if (element.tagName === 'BR') element.dataset.flowBreak = points?.[0];
    origins.set(id, {
      tag: element.tagName,
      before: Number(element.dataset.flowBefore),
      listIndex:
        element.tagName === 'LI'
          ? [...element.parentNode.children].filter((n) => n.tagName === 'LI').indexOf(element)
          : 0,
      listStart: element.tagName === 'OL' ? element.start || 1 : 1,
    });
  }
  for (const segment of map.segments) {
    const span = document.createElement('span');
    span.dataset.flowText = segment.start;
    span.dataset.flowBefore = segment.start;
    segment.node.replaceWith(span);
    span.append(segment.node);
  }
  return { html: root.innerHTML, origins, total: textIndexAt(map, root, root.childNodes.length) };
}
export function lift(node, offset) {
  if (offset) return { node, offset };
  while (
    node.parentNode &&
    node.parentNode.dataset?.flowRoot !== 'true' &&
    node === node.parentNode.firstChild
  )
    node = node.parentNode;
  return { node: node.parentNode, offset: [...node.parentNode.childNodes].indexOf(node) };
}
function enclosingTextMarker(node) {
  return (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest?.(
    '[data-flow-text]',
  );
}
export function globalIndex(point, total) {
  const marker = enclosingTextMarker(point.node);
  if (marker) {
    const prefix = document.createRange();
    prefix.selectNodeContents(marker);
    prefix.setEnd(point.node, point.offset);
    return Number(marker.dataset.flowText) + prefix.toString().length;
  }
  const next = point.node.childNodes[point.offset];
  return next
    ? Number(next.dataset?.flowBefore ?? next.parentElement?.dataset.flowText ?? total)
    : total;
}
export function copyRange(range, start) {
  let fragment = range.cloneContents();
  let context = range.commonAncestorContainer;
  if (context.nodeType === Node.TEXT_NODE) context = context.parentElement;
  while (context && context.dataset?.flowRoot !== 'true') {
    const wrapper = context.cloneNode(false);
    wrapper.append(fragment);
    const outer = document.createDocumentFragment();
    outer.append(wrapper);
    fragment = outer;
    context = context.parentElement;
  }
  const origin = enclosingTextMarker(start.node)?.dataset.flowText;
  if (origin !== undefined) {
    const first = fragment.querySelector(`[data-flow-text="${origin}"]`);
    if (first) {
      first.dataset.flowText = globalIndex(start, 0);
      first.dataset.flowBefore = first.dataset.flowText;
    }
  }
  return fragment;
}
export function displayHTML(fragment, origins, start, _end) {
  for (const list of fragment.querySelectorAll('ol')) {
    const first = list.querySelector('li'),
      source = first && origins.get(first.dataset.flowOrigin),
      original = origins.get(list.dataset.flowOrigin);
    if (source) list.start = (original?.listStart || 1) + source.listIndex;
  }
  for (const element of fragment.querySelectorAll('[data-flow-origin]')) {
    const source = origins.get(element.dataset.flowOrigin);
    if (source && source.before < start && blockTags.has(element.tagName)) {
      element.dataset.flowContinuation = 'true';
      if (element.tagName === 'LI') element.style.listStyleType = 'none';
    }
    delete element.dataset.flowOrigin;
    delete element.dataset.flowBefore;
  }
  // Derived text origins let a preview click locate the same caret in the canonical TextFlow Editor.
  for (const span of fragment.querySelectorAll('[data-flow-text]')) delete span.dataset.flowBefore;
  const host = document.createElement('div');
  host.append(fragment);
  return host.innerHTML;
}
