import { firstListText, listMarkers } from '../../shared/dom/list-numbering.js';

// Keep the original inline nodes (including links, overrides and selection endpoints)
// when changing paragraph structure. An item owns its descendants in outline order.
const paragraphs = 'li,p,div,h2,h3,h4,blockquote';
function endpoint(root, node, offset, ending) {
  if (!root.contains(node)) return null;
  if (node === root || node.matches?.('ol,ul')) {
    const previous = (ending || offset === node.childNodes.length) && offset > 0;
    node = node.childNodes[offset - Number(previous)] || node;
    while (node?.matches?.('ol,ul'))
      node = previous ? node.lastElementChild : node.firstElementChild;
  }
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const block = el?.closest(paragraphs);
  return block && block !== root && root.contains(block) ? block : null;
}

function replaceBlock(block, tag) {
  const result = block.ownerDocument.createElement(tag);
  for (const attr of block.attributes) {
    if (attr.name === 'style' || attr.name.startsWith('data-ivo-'))
      result.setAttribute(attr.name, attr.value);
  }
  result.append(...block.childNodes);
  block.replaceWith(result);
  return result;
}

function prependPrintedLabel(item, text) {
  const first = firstListText(item);
  let label = item.ownerDocument.createTextNode(text);
  for (let el = first?.parentElement; el && el !== item; el = el.parentElement) {
    if (el.tagName === 'A') continue;
    const shell = el.cloneNode(false);
    shell.append(label);
    label = shell;
  }
  item.prepend(label);
}

export function applyListCommand(root, range, name) {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  const endpoints = [
    selection.anchorNode,
    selection.anchorOffset,
    selection.focusNode,
    selection.focusOffset,
  ];
  let implicit;
  let first = endpoint(root, range.startContainer, range.startOffset, false);
  let last = range.collapsed ? first : endpoint(root, range.endContainer, range.endOffset, true);
  const apply = name === 'apply-bullets' || name === 'apply-numbering';
  if (!first && !last && apply && !root.querySelector(paragraphs + ',ol,ul')) {
    first = last = implicit = doc.createElement('p');
    first.append(...root.childNodes);
    root.append(first);
  }
  if (!first || !last || first.parentNode !== last.parentNode) return false;
  const parent = first.parentElement;
  const items = [];
  for (let el = first; el; el = el.nextElementSibling) {
    if (!el.matches(paragraphs) || (el.tagName === 'LI') !== (first.tagName === 'LI')) return false;
    items.push(el);
    if (el === last) break;
    for (
      let between = el.nextSibling;
      between && between !== el.nextElementSibling;
      between = between.nextSibling
    )
      if (between.textContent.trim()) return false;
  }
  if (items.at(-1) !== last) return false;
  const inList = first.tagName === 'LI' && parent.matches('ol,ul');
  if (!inList && (!apply || parent !== root)) return false;
  const next = last.nextElementSibling;
  const replaced = new Map();
  const replace = (block, tag) => {
    const result = replaceBlock(block, tag);
    replaced.set(block, result);
    return result;
  };
  if (name === 'increase-list-level') {
    const previous = first.previousElementSibling;
    if (!previous?.matches('li')) return false;
    let depth = 1;
    for (let el = parent.parentElement; el && el !== root; el = el.parentElement)
      if (el.matches('ol,ul')) depth++;
    if (depth >= 9) return false;
    let nested = previous.lastElementChild;
    if (nested?.tagName !== parent.tagName) {
      nested = doc.createElement(parent.localName);
      previous.append(nested);
    }
    nested.append(...items);
  } else if (name === 'decrease-list-level' && parent.parentElement.matches('li')) {
    const owner = parent.parentElement;
    if (next) {
      const tail = doc.createElement(parent.localName);
      tail.append(...Array.from(parent.children).slice(Array.from(parent.children).indexOf(next)));
      last.append(tail);
    }
    owner.after(...items);
    if (!parent.children.length) parent.remove();
  } else if (name === 'decrease-list-level') return false;
  else if (name === 'restart-numbering' || name === 'continue-numbering') {
    if (parent.tagName !== 'OL') return false;
    if (name === 'restart-numbering') first.setAttribute('value', '1');
    else {
      if (!first.hasAttribute('value') && first.previousElementSibling) return false;
      first.removeAttribute('value');
      if (!first.previousElementSibling) {
        let previous = parent.previousElementSibling;
        while (previous && previous.tagName !== 'OL') previous = previous.previousElementSibling;
        if (previous) previous.dataset.ivoListSeries = 'default';
        parent.dataset.ivoListSeries = 'default';
        parent.removeAttribute('start');
        delete parent.dataset.flowListStart;
      }
    }
  } else if (apply && !inList) {
    const tag = name === 'apply-bullets' ? 'ul' : 'ol';
    let list = first.previousElementSibling;
    if (list?.localName !== tag) {
      list = doc.createElement(tag);
      if (tag === 'ol') list.dataset.ivoListSeries = 'default';
      first.before(list);
    }
    for (const item of items) list.append(replace(item, 'li'));
    if (next?.localName === tag && (tag === 'ul' || next.dataset.ivoListSeries === 'default')) {
      list.append(...next.childNodes);
      next.remove();
    }
  } else {
    const tag = apply ? (name === 'apply-bullets' ? 'ul' : 'ol') : '';
    if (tag === parent.localName) return false;
    // A nested item's detached paragraph would be an invalid sibling of <li>.
    // Promote it explicitly first, preserving its descendants.
    if (!apply && parent.parentElement !== root) return false;
    const markers = listMarkers(root);
    if (next) {
      const right = doc.createElement(parent.localName);
      if (parent.dataset.ivoListSeries === 'default') right.dataset.ivoListSeries = 'default';
      if (parent.tagName === 'OL' && !right.dataset.ivoListSeries && markers.get(next).number !== 1)
        right.start = markers.get(next).number;
      right.append(...Array.from(parent.children).slice(Array.from(parent.children).indexOf(next)));
      parent.after(right);
    }
    const output = doc.createDocumentFragment();
    if (apply) {
      const list = doc.createElement(tag);
      if (tag === 'ol') list.dataset.ivoListSeries = 'default';
      for (const item of items) {
        item.removeAttribute('value');
        list.append(item);
      }
      output.append(list);
    } else {
      for (const item of items) {
        const children = [...item.children].filter((el) => el.matches('ol,ul'));
        children.forEach((el) => el.remove());
        if (name === 'convert-list-to-text') prependPrintedLabel(item, markers.get(item).text);
        output.append(replace(item, 'p'), ...children);
      }
    }
    parent.after(output);
    if (!parent.children.length) parent.remove();
  }
  const [a, ao, b, bo] = endpoints;
  if (a && b) {
    const current = (node) =>
      (implicit && node === root ? replaced.get(implicit) : replaced.get(node)) || node;
    const an = current(a),
      bn = current(b);
    if (root.contains(an) && root.contains(bn))
      selection.setBaseAndExtent(
        an,
        Math.min(ao, an.length ?? an.childNodes.length),
        bn,
        Math.min(bo, bn.length ?? bn.childNodes.length),
      );
  }
  return true;
}
