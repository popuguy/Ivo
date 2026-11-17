import { applyTextAttributes } from './text-attributes.js';
const METRICS = ['size', 'leading'];
// These elements do not introduce a relative font size of their own. Keep links,
// emphasis and other character properties in place while resolving metric runs.
const TRANSPARENT = new Set(['SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A']);

/** Remove overridden inline metric ancestors without touching text, blocks or deliberate leading. */
export function normalizeInlineMetrics(root) {
  let changed = false;
  // Extracting a selection can leave empty old-style spans at both boundaries.
  // Empty inline boxes still have metrics; they must not retain a former large size.
  for (const span of [
    ...root.querySelectorAll('span[data-ivo-size],span[data-ivo-leading]'),
  ].reverse())
    if (
      !span.textContent.length &&
      (span.closest('p,div,li,h2,h3,h4,blockquote') || root).textContent.length > 0 &&
      !span.querySelector('br,a,code,sub,sup,p,div,li,h2,h3,h4,blockquote')
    ) {
      span.remove();
      changed = true;
    }
  const candidates = [
    ...root.querySelectorAll('span[data-ivo-size],span[data-ivo-leading]'),
  ].filter(
    (span) =>
      (span.textContent.length > 0 || span.querySelector('br')) &&
      METRICS.some(
        (name) =>
          span.hasAttribute('data-ivo-' + name) &&
          span.querySelector('span[data-ivo-' + name + ']'),
      ),
  );
  const roots = candidates.filter(
    (span) => !candidates.some((other) => other !== span && other.contains(span)),
  );
  function wrap(node, metrics) {
    if (!Object.keys(metrics).length) return node;
    const span = document.createElement('span');
    for (const [name, value] of Object.entries(metrics))
      span.setAttribute('data-ivo-' + name, value);
    applyTextAttributes(span);
    span.append(node);
    return span;
  }
  function copy(node, inherited) {
    if (node.nodeType === Node.TEXT_NODE)
      return node.length ? wrap(node.cloneNode(), inherited) : node.cloneNode();
    if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(true);
    if (!TRANSPARENT.has(node.tagName)) {
      // Relative-size code/sup/sub and structural blocks retain their original scope.
      // Resolve nested runs inside them independently, without moving an outer style in.
      const clone = node.cloneNode(true);
      normalizeInlineMetrics(clone);
      return wrap(clone, inherited);
    }
    const next = { ...inherited },
      clone = node.cloneNode(false);
    if (node.tagName === 'SPAN')
      for (const name of METRICS) {
        const attr = 'data-ivo-' + name;
        if (node.hasAttribute(attr)) next[name] = node.getAttribute(attr);
        clone.removeAttribute(attr);
        clone.style.removeProperty(name === 'size' ? 'font-size' : 'line-height');
      }
    if (!clone.getAttribute('style')) clone.removeAttribute('style');
    for (const child of node.childNodes) clone.append(copy(child, next));
    if (clone.tagName === 'SPAN' && !clone.attributes.length) {
      const fragment = document.createDocumentFragment();
      fragment.append(...clone.childNodes);
      return fragment;
    }
    return clone;
  }
  for (const span of roots) span.replaceWith(copy(span, {}));
  return changed || roots.length > 0;
}
