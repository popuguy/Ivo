import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../../domain/text/typography.js';
import { cleanHTML } from '../../shared/html/sanitize.js';
const blocks = new Set(['P', 'DIV', 'LI', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL']);
const semantic = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUP', 'SUB']);

/** Split only affected inline containers, preserving links, style references and unselected runs. */
export function clearRangeOverrides(root, range, { characterOnly = false } = {}) {
  const character = Object.values(CHARACTER_FIELDS).filter((n) => n !== 'cstyle'),
    paragraph = Object.values(PARAGRAPH_FIELDS).filter((n) => n !== 'pstyle');
  const intersects = (node) => {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  };
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!intersects(node) || range.collapsed)
        return [{ node: node.cloneNode(), selected: false }];
      const a = node === range.startContainer ? range.startOffset : 0,
        b = node === range.endContainer ? range.endOffset : node.length;
      return [
        { text: node.data.slice(0, a), selected: false },
        { text: node.data.slice(a, b), selected: true },
        { text: node.data.slice(b), selected: false },
      ]
        .filter((p) => p.text)
        .map((p) => ({ node: document.createTextNode(p.text), selected: p.selected }));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [{ node: node.cloneNode(), selected: false }];
    const children = [...node.childNodes].flatMap(copy),
      isBlock = blocks.has(node.tagName);
    if (isBlock) {
      const clone = node.cloneNode(false);
      clone.removeAttribute('style');
      if (
        !characterOnly &&
        (children.some((c) => c.selected) ||
          (range.collapsed && node.contains(range.startContainer)))
      )
        for (const name of paragraph) clone.removeAttribute('data-ivo-' + name);
      clone.append(...children.map((c) => c.node));
      return [{ node: clone, selected: false }];
    }
    if (!children.length) return [{ node: node.cloneNode(), selected: false }];
    const groups = [];
    for (const child of children) {
      let group = groups.at(-1);
      if (!group || group.selected !== child.selected) {
        group = { selected: child.selected, nodes: [] };
        groups.push(group);
      }
      group.nodes.push(child.node);
    }
    return groups.map((group) => {
      const clone =
        group.selected && semantic.has(node.tagName)
          ? document.createElement('span')
          : node.cloneNode(false);
      clone.removeAttribute('style');
      if (group.selected) for (const name of character) clone.removeAttribute('data-ivo-' + name);
      clone.append(...group.nodes);
      return { node: clone, selected: group.selected };
    });
  }
  const holder = document.createElement('div');
  for (const child of [...root.childNodes]) holder.append(...copy(child).map((p) => p.node));
  root.innerHTML = cleanHTML(holder.innerHTML);
}
