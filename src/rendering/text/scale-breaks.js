const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const chunks = /[^ \t\r\n]+|[ \t\r\n]+/gu;
export const inlineSeparator = /^[ \t\r\n]+$/u;
const complex = /[\u00ad\u200b/-]|[^\p{Script=Latin}\p{Mark}\p{Number}\p{Punctuation}\s]/u;

const scaled = (plan) => plan.horizontalScale !== 100 || plan.verticalScale !== 100;
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    nodes = [];
  while (walker.nextNode()) if (walker.currentNode.length) nodes.push(walker.currentNode);
  return nodes;
}

// The browser decides discretionary hyphens, emergency breaks, and line starts
// for scripts without spaces. Measure a disposable inline copy at the target
// horizontal size. Only runs spanning actual lines need a boundary search.
export function scaleBreakPlanner(root, plans) {
  let probe, range, columnWidth, columnOrigin;
  const copies = new WeakMap();
  const widths = new WeakMap();
  const affected = new Set(plans.filter(scaled).map((plan) => plan.paragraph));
  function needsProbe(plan, index) {
    if (!scaled(plan)) return false;
    if (complex.test(plan.node.data)) return true;
    const parent = plan.node.parentElement;
    const block = parent.closest('p,div,li,h2,h3,h4,blockquote') || root;
    if (!widths.has(block)) {
      const w =
        parseFloat(getComputedStyle(root).columnWidth) || parseFloat(getComputedStyle(block).width);
      widths.set(block, w);
    }
    const width = widths.get(block);
    const style = getComputedStyle(
      parent.hasAttribute('data-ivo-decoration-run') ? parent.parentElement : parent,
    );
    if (style.hyphens === 'auto') return true;
    if (
      style.overflowWrap !== 'normal' &&
      width > 0 &&
      (plan.node.data.match(chunks) || []).some(
        (word) =>
          !inlineSeparator.test(word) &&
          (word.length *
            (2 * parseFloat(style.fontSize) + Math.abs(parseFloat(style.letterSpacing) || 0)) *
            plan.horizontalScale) /
            100 >=
            width,
      )
    )
      return true;
    return (
      index > 0 &&
      plan.paragraph === plans[index - 1].paragraph &&
      /[^\s]$/u.test(plans[index - 1].node.data) &&
      /^[^\s]/u.test(plan.node.data)
    );
  }
  if (plans.some(needsProbe)) {
    probe = root.cloneNode(true);
    const original = textNodes(root),
      cloned = textNodes(probe);
    for (let i = 0; i < original.length; i++) copies.set(original[i], cloned[i]);
    for (const span of probe.querySelectorAll('[data-ivo-decoration-run]'))
      span.replaceWith(...span.childNodes);
    for (const p of plans) {
      if (p.horizontalScale === 100) continue;
      const node = copies.get(p.node),
        size = document.createElement('span');
      size.style.fontSize = p.horizontalScale + '%';
      size.style.lineHeight = '0';
      node.replaceWith(size);
      size.append(node);
    }
    const layout = getComputedStyle(root);
    Object.assign(probe.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: layout.width,
      height: layout.height,
      visibility: 'hidden',
      pointerEvents: 'none',
      transform: 'none',
      margin: '0',
    });
    probe.removeAttribute('id');
    probe.removeAttribute('contenteditable');
    probe.setAttribute('aria-hidden', 'true');
    (root.parentElement || document.body).append(probe);
    columnWidth = parseFloat(getComputedStyle(probe).columnWidth);
    columnOrigin = probe.getBoundingClientRect().left;
    range = document.createRange();
  }
  const position = (node, start, end) => {
    range.setStart(node, start);
    range.setEnd(node, end);
    const rect = range.getClientRects()[0];
    if (!rect) return null;
    return {
      y: rect.top + rect.height / 2,
      height: rect.height,
      col: columnWidth ? Math.floor((rect.left - columnOrigin + 0.01) / columnWidth) : 0,
    };
  };
  function sameLine(a, b) {
    if (!a || !b || a.col !== b.col) return false;
    // A changed point size moves the centre of the native selection rectangle
    // relative to its baseline, even when both runs belong to the same line.
    const difference = Math.abs(a.y - b.y);
    return (
      difference < 1 ||
      (Math.abs(a.height - b.height) > 1 &&
        difference < Math.max(a.height, b.height) / 2 - Math.min(a.height, b.height) / 6)
    );
  }
  function parts(plan) {
    const node = plan.node;
    const words = scaled(plan) ? (value) => value.match(chunks) || [] : (value) => [value];
    if (!affected.has(plan.paragraph)) return [node.data];
    const text = copies.get(node);
    if (!text) return words(node.data);
    range.selectNodeContents(text);
    const rects = range.getClientRects();
    if (rects.length <= 1) return words(node.data);
    const offsets = [...graphemes.segment(node.data)].map((g) => g.index);
    offsets.push(node.length);
    const out = [];
    for (let start = 0; start < offsets.length - 1;) {
      const line = position(text, offsets[start], offsets[start + 1]);
      let lo = start + 1,
        hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sameLine(line, position(text, offsets[mid], offsets[mid + 1]))) lo = mid + 1;
        else hi = mid;
      }
      out.push(...words(node.data.slice(offsets[start], offsets[lo])));
      start = lo;
    }
    return out;
  }
  function boundary(a, b) {
    if (
      !a ||
      a.paragraph !== b.paragraph ||
      !affected.has(b.paragraph) ||
      (!probe && !a.scaled && !b.scaled)
    )
      return null;
    const adjacentWords = !/[ \t\r\n]$/u.test(a.node.data) && !/^[ \t\r\n]/u.test(b.node.data);
    if (!probe) return a.scope !== b.scope && adjacentWords ? 'join' : null;
    const before = position(copies.get(a.source), a.end - 1, a.end);
    const after = position(copies.get(b.source), b.start, b.start + 1);
    if (!before || !after) return null;
    if (!sameLine(before, after)) return 'line';
    return adjacentWords ? 'join' : null;
  }
  function visibleHyphen(plan) {
    if (!probe || !plan.node.data.endsWith('\u00ad')) return false;
    const copy = copies.get(plan.source);
    range.setStart(copy, plan.end - 1);
    range.setEnd(copy, plan.end);
    return [...range.getClientRects()].some((rect) => rect.width > 0.01);
  }
  return { parts, boundary, visibleHyphen, dispose: () => probe?.remove() };
}
