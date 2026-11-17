import { normalizeInlineMetrics } from '../../shared/dom/inline-metrics.js';
import { bookmarkForRange, rangeFromBookmark } from '../../shared/dom/text-selection.js';
import { TEXT_FONTS, CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../../domain/text/typography.js';
import { setTextAttribute } from '../../shared/dom/text-attributes.js';
export function applyFrameTypography(element, item) {
  element.style.fontSize = (item.fontSize || 16) + 'px';
  element.style.textAlign = item.align || 'left';
  for (const name of Object.keys(TEXT_FONTS))
    element.classList.toggle(name, item.textStyle === name);
  element.style.color = item.textColor || '';
  element.style.lineHeight =
    item.leading === undefined ? '' : item.leading === 0 ? '1.2' : item.leading + 'px';
  element.style.letterSpacing = item.tracking === undefined ? '' : item.tracking / 1000 + 'em';
  for (const [prop, name] of [
    ['paragraphBefore', '--paragraph-before'],
    ['paragraphAfter', '--paragraph-after'],
  ])
    if (item[prop] === undefined) element.style.removeProperty(name);
    else element.style.setProperty(name, item[prop] + 'px');
}

export function rangeUsesFormat(element, range, field, value) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
    styles = [];
  let node;
  while ((node = walker.nextNode()))
    if (node.length && range.intersectsNode(node)) {
      const start = node === range.startContainer ? range.startOffset : 0,
        end = node === range.endContainer ? range.endOffset : node.length;
      if (end > start) styles.push(getComputedStyle(node.parentElement));
    }
  const near = (a, b) => Math.abs(a - b) < 0.001;
  return (
    styles.length > 0 &&
    styles.every((style) => {
      if (field === 'fontSize') return near(parseFloat(style.fontSize), Number(value));
      if (field === 'leading')
        return near(
          parseFloat(style.lineHeight),
          Number(value) === 0 ? parseFloat(style.fontSize) * 1.2 : Number(value),
        );
      if (field === 'tracking')
        return near(
          style.letterSpacing === 'normal'
            ? 0
            : (parseFloat(style.letterSpacing) / parseFloat(style.fontSize)) * 1000,
          Number(value),
        );
      if (field === 'textStyle')
        return (
          style.fontFamily.replace(/["']/g, '').split(',')[0].trim().toLowerCase() ===
          (TEXT_FONTS[value] || '').replace(/["']/g, '').split(',')[0].trim().toLowerCase()
        );
      if (field === 'textColor') {
        const rgb = style.color
          .match(/\d+/g)
          ?.slice(0, 3)
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('');
        return '#' + rgb === String(value).toLowerCase();
      }
      if (field === 'bold') return parseInt(style.fontWeight) >= 600 === !!value;
      if (field === 'italic') return (style.fontStyle === 'italic') === !!value;
      if (field === 'underline') return style.textDecorationLine.includes('underline') === !!value;
      return false;
    })
  );
}

export function formatRange(element, range, field, value) {
  const attr = CHARACTER_FIELDS[field];
  if (!attr || range.collapsed) return null;
  // Style each selected text leaf. Wrapping a cross-paragraph fragment in SPAN
  // would create invalid nested blocks and change paragraph source on reopening.
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
    parts = [];
  let node;
  while ((node = walker.nextNode()))
    if (range.intersectsNode(node)) {
      const start = node === range.startContainer ? range.startOffset : 0,
        end = node === range.endContainer ? range.endOffset : node.length;
      if (end > start) parts.push({ node, start, end });
    }
  const spans = [];
  for (const part of parts.reverse()) {
    const selected = document.createRange();
    selected.setStart(part.node, part.start);
    selected.setEnd(part.node, part.end);
    const span = document.createElement('span');
    setTextAttribute(span, attr, value);
    span.append(selected.extractContents());
    selected.insertNode(span);
    spans.unshift(span);
  }
  if (spans.length) {
    range.setStart(spans[0], 0);
    range.setEnd(spans.at(-1), spans.at(-1).childNodes.length);
  }
  // Repeated changes must replace effective runs, rather than leave an obsolete
  // large-font ancestor contributing its own CSS line box around smaller text.
  const bookmark = bookmarkForRange(element, range);
  if (normalizeInlineMetrics(element)) {
    const restored = rangeFromBookmark(element, bookmark);
    if (restored) {
      range.setStart(restored.startContainer, restored.startOffset);
      range.setEnd(restored.endContainer, restored.endOffset);
    }
  }
  return range;
}

export function formatParagraphs(element, range, field, value) {
  const attr = PARAGRAPH_FIELDS[field];
  if (!attr) return false;
  if (range.collapsed) {
    let node =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    if (node === element) node = element.childNodes[Math.max(0, range.startOffset - 1)] || element;
    const block = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(
      'p,div,li,h2,h3,h4,blockquote',
    );
    if (block && block !== element && element.contains(block)) {
      setTextAttribute(block, attr, value);
      return true;
    }
  }
  const paragraphs = [...element.querySelectorAll('p,div,li,h2,h3,h4,blockquote')].filter(
    (node) => !node.querySelector('p,div,li,h2,h3,h4,blockquote'),
  );
  let changed = false;
  for (const node of paragraphs) {
    if (!range.intersectsNode(node)) continue;
    const whole = document.createRange();
    whole.selectNodeContents(node);
    if (
      !range.collapsed &&
      (range.compareBoundaryPoints(Range.END_TO_START, whole) >= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, whole) <= 0)
    )
      continue;
    setTextAttribute(node, attr, value);
    changed = true;
  }
  return changed;
}
