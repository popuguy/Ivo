import { listOrdinal } from '../../domain/text/list-numbering.js';

export function listMarkers(root) {
  const markers = new WeakMap(),
    nextInScope = new WeakMap();
  for (const list of root.querySelectorAll('ol,ul')) {
    const owner = list.parentElement.closest('li') || root;
    const shared = list.tagName === 'OL' && list.dataset.ivoListSeries === 'default';
    const start = list.hasAttribute('data-flow-list-start')
      ? null
      : listOrdinal(list.getAttribute('start'));
    let number = start ?? (shared ? (nextInScope.get(owner) ?? 1) : 1);
    for (const item of list.children) {
      if (item.tagName !== 'LI') continue;
      number = listOrdinal(item.getAttribute('value')) ?? number;
      markers.set(item, { number, text: list.tagName === 'OL' ? number + '.\t' : '•\t' });
      number++;
    }
    if (shared) nextInScope.set(owner, number);
  }
  return markers;
}

// Native HTML markers need an explicit start for disjoint runs belonging to
// the same counter. This projection is discarded on serialization.
export function paintListNumbers(root) {
  if (!root.querySelector('ol[data-ivo-list-series]')) return;
  const markers = listMarkers(root);
  for (const list of root.querySelectorAll('ol[data-ivo-list-series]')) {
    if (
      list.hasAttribute('data-flow-list-slice') ||
      (list.hasAttribute('start') && !list.hasAttribute('data-flow-list-start'))
    )
      continue;
    const number = markers.get(list.querySelector(':scope > li'))?.number;
    if (number !== undefined) {
      list.dataset.flowListStart = '';
      list.start = number;
    }
  }
}

// A simple outline paragraph has one editable run of inline contents followed
// by its nested lists. More elaborate pasted HTML remains on its existing path.
export function inlineListPrefix(item) {
  let nested = false,
    prefix = [];
  for (const child of item.childNodes) {
    if (child.matches?.('ol,ul')) {
      nested = true;
      continue;
    }
    if (
      nested ||
      child.matches?.('p,div,h2,h3,h4,blockquote,table') ||
      child.querySelector?.('p,div,li,ol,ul,h2,h3,h4,blockquote,table')
    )
      return null;
    prefix.push(child);
  }
  return prefix;
}

export function firstListText(item) {
  const walker = item.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let text;
  while ((text = walker.nextNode())) {
    if (text.parentElement.closest('li') !== item) return null;
    if (text.length) return text;
  }
  return null;
}
