import { annotatedSource, copyRange, displayHTML, globalIndex, lift } from './flow-source.js';
import { applyFrameTypography } from './format.js';
import { applyNamedTextStyles } from './styles.js';
import { effectiveTextStyle } from '../../domain/documents/publishing.js';
import { projectFlowInput } from './flow-input.js';
import { rangeFromBookmark } from '../../shared/dom/text-selection.js';
import { TEXT_DEFAULTS } from '../../domain/text/typography.js';
import { nodeTextStyle } from './selection-style.js';

const blocks = 'p,div,li,h1,h2,h3,h4,h5,h6,blockquote',
  segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
let context;

/** Browser shaping stays authoritative for existing-layout flows. The probe is
 * disposable, unscaled, never focused and never copied back into authored HTML. */
export function createWrapLineMeasurer(doc, flow) {
  const source = annotatedSource(flow.html, doc, flow.style),
    root = document.createElement('div');
  root.className = 'rich-text canvas-text canvas-flow-input flow-fragment flow-layout-probe';
  root.dataset.flowRoot = 'true';
  root.innerHTML = source.html;
  const validate = (node, inherited) => {
    const style = nodeTextStyle(node, inherited, doc);
    if (
      ['SUP', 'SUB'].includes(node.tagName) ||
      style.keepTogether ||
      style.keepBoundaryLines ||
      style.keepWithNext ||
      style.hyphenate ||
      style.widows !== 2 ||
      style.orphans !== 2
    )
      throw Error(
        'Wrapped text does not yet support superscript/subscript, hyphenation or paragraph keep overrides.',
      );
    for (const child of node.children) validate(child, style);
  };
  validate(root, { ...TEXT_DEFAULTS, ...effectiveTextStyle(doc, flow.style) });
  Object.assign(root.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    height: 'auto',
    minHeight: '0',
    maxHeight: 'none',
    overflow: 'visible',
    padding: '0',
    border: '0',
    margin: '0',
    transform: 'none',
    columnCount: 'auto',
    columnWidth: 'auto',
    columnGap: 'normal',
    overflowWrap: 'normal',
    boxSizing: 'content-box',
  });
  document.body.append(root);
  applyFrameTypography(root, effectiveTextStyle(doc, flow.style));
  applyNamedTextStyles(root, doc);
  // An empty paragraph still owns a line and a source interval. This zero-ink
  // marker establishes its browser baseline without adding a source character.
  for (const block of root.querySelectorAll(blocks))
    if (!block.childNodes.length) {
      const marker = document.createElement('span');
      marker.dataset.wrapEmpty = '';
      marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      block.append(marker);
    }
  const pointRange = (index) => {
    const point = { path: [], offset: 0, kind: 'text', index, affinity: 'forward' };
    const range = rangeFromBookmark(root, { anchor: point, focus: point });
    if (!range) throw Error('Text wrapping lost a canonical source boundary.');
    return range;
  };
  function baseline(node) {
    const marker = document.createElement('span');
    marker.style.cssText =
      'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;font-size:0;line-height:0;vertical-align:baseline';
    node.parentNode.insertBefore(marker, node);
    let y = marker.getBoundingClientRect().top - root.getBoundingClientRect().top;
    marker.remove();
    // A source-owned baseline shift moves glyph ink, not its parent line. Keep
    // adjacent raised/lowered runs on that same row (as frame measurement does).
    for (
      let parent = node.parentElement;
      parent && parent !== root;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      if (style.position === 'relative') y -= parseFloat(style.top) || 0;
    }
    return y;
  }
  function measure(start, width) {
    if (!Number.isFinite(width) || width < 0.1)
      throw Error('Text wrapping leaves no measurable line width.');
    root.style.width = width + 'px';
    projectFlowInput(root, start);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT),
      range = document.createRange(),
      origin = root.getBoundingClientRect();
    let node,
      first = null,
      endPoint = { node: root, offset: root.childNodes.length, index: source.total },
      advance = 0,
      before = 0,
      after = 0,
      hard = false,
      sawBreak = false,
      nextBlock = null,
      top = Infinity,
      bottom = -Infinity,
      firstBlock = null;
    let firstGlyphFits = true,
      lineFits = true,
      sawGlyph = false;
    const metrics = { ascent: 0, 'cap-height': 0, 'x-height': 0, leading: 0 };
    while ((node = walker.nextNode())) {
      const text = node.nodeType === Node.TEXT_NODE;
      if (
        (!text && node.nodeName !== 'BR' && !node.hasAttribute?.('data-wrap-empty')) ||
        (text && !node.length) ||
        node.parentElement.closest('[data-flow-input-hidden],[data-flow-input-prefix]')
      )
        continue;
      if (text) range.selectNodeContents(node);
      else range.selectNode(node);
      const rects = [...range.getClientRects()].filter(
        (r) => r.height > 0 && (r.width > 0 || !text),
      );
      if (!rects.length && !node.hasAttribute?.('data-wrap-empty')) continue;
      const y = baseline(node),
        block = node.parentElement.closest(blocks),
        style = getComputedStyle(node.parentElement);
      if (first !== null && Math.abs(y - first) > 0.1) {
        endPoint = lift(node, 0);
        endPoint.index = globalIndex(endPoint, source.total);
        nextBlock = block;
        hard = sawBreak || block !== firstBlock;
        break;
      }
      if (first === null) {
        first = y;
        firstBlock = block;
        before =
          block && !block.hasAttribute('data-flow-input-continuation')
            ? parseFloat(getComputedStyle(block).marginTop) || 0
            : 0;
      }
      const leading = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      advance = Math.max(advance, leading);
      metrics.leading = Math.max(metrics.leading, leading);
      context ||= document.createElement('canvas').getContext('2d');
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      for (const [key, sample] of [
        ['ascent', 'd'],
        ['cap-height', 'H'],
        ['x-height', 'x'],
      ])
        metrics[key] = Math.max(metrics[key], context.measureText(sample).actualBoundingBoxAscent);
      const rect = rects[0];
      if (text && rect)
        lineFits &&= rect.left >= origin.left - 0.01 && rect.right <= origin.left + width + 0.01;
      if (text && !sawGlyph && rect) {
        for (const glyph of segmenter.segment(node.data)) {
          if (!/\S/.test(glyph.segment)) continue;
          const ink = document.createRange();
          ink.setStart(node, glyph.index);
          ink.setEnd(node, glyph.index + glyph.segment.length);
          const r = ink.getBoundingClientRect();
          if (Math.abs(r.top - rect.top) > 0.1) break;
          if (r.width > 0) {
            sawGlyph = true;
            firstGlyphFits = r.left >= origin.left - 0.01 && r.right <= origin.left + width + 0.01;
            break;
          }
        }
      }
      top = Math.min(top, rect ? rect.top - origin.top : y - metrics.ascent);
      bottom = Math.max(bottom, rect ? rect.bottom - origin.top : y);
      if (node.nodeName === 'BR') sawBreak = true;
      if (text && rects.some((r) => Math.abs(r.top - rect.top) > 0.1)) {
        const edges = segmenter.segment(node.data);
        let lo = 0,
          hi = node.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1,
            part = edges.containing(mid),
            a = part.index,
            b = a + part.segment.length;
          range.setStart(node, a);
          range.setEnd(node, b);
          const r = [...range.getClientRects()].find((r) => r.height > 0);
          if (r && Math.abs(r.top - rect.top) > 0.1) hi = a;
          else lo = b;
        }
        if (lo < node.length) {
          endPoint = lift(node, lo);
          endPoint.index = globalIndex(endPoint, source.total);
          hard = /[\r\n]$/.test(node.data.slice(0, lo));
          break;
        }
      }
    }
    if (first === null) return { end: source.total, empty: true };
    if (endPoint.index <= start) throw Error('Text wrapping could not advance its source range.');
    const selection = pointRange(start);
    selection.setEnd(endPoint.node, endPoint.offset);
    const a = { node: selection.startContainer, offset: selection.startOffset, index: start },
      html = displayHTML(copyRange(selection, a), source.origins, start, endPoint.index);
    if (hard && firstBlock && nextBlock !== firstBlock && endPoint.index < source.total)
      after = parseFloat(getComputedStyle(firstBlock).marginBottom) || 0;
    return {
      start,
      end: endPoint.index,
      html,
      baseline: first,
      before,
      after,
      advance,
      top,
      bottom,
      metrics,
      hard: hard || endPoint.index === source.total,
      justify:
        !hard &&
        endPoint.index < source.total &&
        getComputedStyle(firstBlock || root).textAlign === 'justify',
      direction: getComputedStyle(firstBlock || root).direction,
      fits: firstGlyphFits && lineFits,
    };
  }
  return { total: source.total, measure, destroy: () => root.remove() };
}
