import { textScale } from '../../domain/text/metrics.js';
export function applyTextLayout(element, block) {
  const scale = textScale(block);
  element.dataset.textKind = block.textKind || 'area';
  element.style.setProperty('--text-scale-x', scale.x);
  element.style.setProperty('--text-scale-y', scale.y);
  const f = block.frameOptions || {};
  element.style.padding = `${f.insetTop || 0}px ${f.insetRight || 0}px ${f.insetBottom || 0}px ${f.insetLeft || 0}px`;
  element.style.boxSizing = 'border-box';
  const columns = !block.textFlowId && (f.columns || 1) > 1;
  element.style.columnCount = columns ? String(f.columns) : '';
  element.style.columnGap = columns ? (f.gutter ?? 12) + 'px' : '';
  element.style.columnFill = columns ? 'auto' : '';
  element.style.alignContent =
    f.verticalAlign === 'center' ? 'center' : f.verticalAlign === 'bottom' ? 'end' : 'start';
}

/** Freeze soft wraps before area→point conversion, retaining inline markup and all overflow. */
export function preserveTextLines(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const breaks = [];
  let previousTop = null,
    node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches('br,p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre')) previousTop = null;
      continue;
    }
    let offset = 0;
    for (const character of node.data) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + character.length);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && /\S/.test(character)) {
        if (previousTop !== null && Math.abs(rect.top - previousTop) > rect.height * 0.5)
          breaks.push([node, offset]);
        previousTop = rect.top;
      }
      offset += character.length;
    }
  }
  for (const [text, offset] of breaks.reverse()) {
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    range.insertNode(document.createElement('br'));
  }
}

export function measuredPointSize(element) {
  const bounds = element.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

export function textIsOverset(element) {
  return (
    element.dataset.textKind !== 'point' &&
    (element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1)
  );
}
