import { TEXT_DEFAULTS } from '../../domain/text/typography.js';
import { resolvedTextStyle } from '../../domain/documents/publishing.js';
import { captureTextSelection, restoreTextSelection } from '../../shared/dom/text-selection.js';
import { nodeTextStyle } from './selection-style.js';

const contexts = new WeakMap(),
  composing = new WeakSet();
const marker = 'data-ivo-decoration-run';
function ownsUnderline(node, doc) {
  if (node.hasAttribute('data-ivo-underline') || node.tagName === 'U') return true;
  return ['paragraph', 'character'].some((kind) => {
    const id = node.getAttribute('data-ivo-' + (kind === 'paragraph' ? 'pstyle' : 'cstyle'));
    return id && resolvedTextStyle(doc, kind, id).underline !== undefined;
  });
}
function observeComposition(root) {
  root.addEventListener('compositionstart', () => composing.add(root));
  root.addEventListener('compositionend', () => {
    composing.delete(root);
    queueMicrotask(() => {
      const context = contexts.get(root);
      if (root.isConnected && context && !composing.has(root))
        applyTextDecorations(root, context.doc);
    });
  });
}
function classOn(node, name) {
  if (!node.classList.contains(name)) node.classList.add(name);
}

/**
 * CSS cannot cancel a decoration painted by an ancestor. Keep source declarations
 * intact, suppress that ancestor paint, and decorate effective text runs instead.
 * These transparent inline wrappers never own fonts, metrics or canonical text.
 */
export function applyTextDecorations(root, doc) {
  if (!contexts.has(root)) observeComposition(root);
  contexts.set(root, { doc });
  if (composing.has(root)) return false;
  const bookmark = captureTextSelection(root),
    plans = [];
  let changed = false;
  // Native editing may split a derived run. Remove only its view wrapper; retain
  // the existing text/format nodes and restore any parent-offset selection below.
  for (const wrapper of root.querySelectorAll('span[' + marker + ']')) {
    if (wrapper.childNodes.length === 1 && wrapper.firstChild.nodeType === Node.TEXT_NODE) continue;
    wrapper.replaceWith(...wrapper.childNodes);
    changed = true;
  }
  function visit(node, inherited, link = null) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.length)
        plans.push({
          node,
          line: [
            inherited.underline || link ? 'underline' : '',
            inherited.strikethrough ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' '),
          link,
        });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.hasAttribute(marker)) {
      for (const child of node.childNodes) visit(child, inherited, link);
      return;
    }
    const style = nodeTextStyle(node, inherited, doc);
    // Hyperlink decoration is a view affordance. Explicit run/character styling
    // inside a link still controls its underline, independently of link color.
    if (node !== root && ownsUnderline(node, doc)) link = null;
    if (
      node.tagName === 'A' &&
      !ownsUnderline(node, doc) &&
      (node.hasAttribute('href') || node.classList.contains('unresolved'))
    )
      link = node.classList.contains('unresolved') ? 'unresolved' : 'link';
    classOn(node, 'ivo-decoration-source');
    for (const child of node.childNodes) visit(child, style, link);
  }
  visit(root, TEXT_DEFAULTS);
  for (const { node, line, link } of plans) {
    let wrapper = node.parentElement.hasAttribute(marker) ? node.parentElement : null;
    if (!line) {
      if (wrapper) {
        wrapper.replaceWith(node);
        changed = true;
      }
      continue;
    }
    if (!wrapper) {
      wrapper = document.createElement('span');
      wrapper.setAttribute(marker, '');
      wrapper.className = 'ivo-decoration-run';
      node.replaceWith(wrapper);
      wrapper.append(node);
      changed = true;
    }
    if (wrapper.style.textDecorationLine !== line) {
      wrapper.style.textDecorationLine = line;
      changed = true;
    }
    if (link) {
      if (wrapper.dataset.ivoDecorationLink !== link) {
        wrapper.dataset.ivoDecorationLink = link;
        changed = true;
      }
    } else if (wrapper.hasAttribute('data-ivo-decoration-link')) {
      wrapper.removeAttribute('data-ivo-decoration-link');
      changed = true;
    }
  }
  if (changed && bookmark) restoreTextSelection(root, bookmark, { focus: false });
  return changed;
}
