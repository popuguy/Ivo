import { TEXT_FONTS, CHARACTER_FIELDS } from '../../domain/text/typography.js';
import { setTextAttribute } from '../../shared/dom/text-attributes.js';

const blockSelector = 'p,div,li,blockquote,h1,h2,h3,h4,h5,h6';
const family = (value) => value.replace(/["']/g, '').split(',')[0].trim().toLowerCase();
const color = (value) => {
  const parts = value.match(/\d+/g)?.slice(0, 3);
  return parts?.length === 3
    ? '#' + parts.map((v) => Number(v).toString(16).padStart(2, '0')).join('')
    : null;
};
function declared(node, root, name) {
  const owner = node.closest('[data-ivo-' + name + ']');
  return owner && root.contains(owner) ? owner.getAttribute('data-ivo-' + name) : null;
}
function attributes(node, root) {
  const style = getComputedStyle(node),
    explicitFont = declared(node, root, 'font'),
    font =
      explicitFont ||
      Object.keys(TEXT_FONTS).find((key) => family(TEXT_FONTS[key]) === family(style.fontFamily)),
    leading = declared(node, root, 'leading');
  return {
    font,
    size: parseFloat(style.fontSize),
    ...(leading !== null ? { leading } : {}),
    tracking:
      style.letterSpacing === 'normal'
        ? 0
        : (parseFloat(style.letterSpacing) / parseFloat(style.fontSize)) * 1000,
    color: color(style.color),
    bold: parseInt(style.fontWeight) >= 600,
    italic: style.fontStyle === 'italic',
    underline: style.textDecorationLine.includes('underline'),
  };
}

/** A bare blank paragraph inherits the preceding run at insertion, not the unrelated frame default.
 * Explicit empty-paragraph/run attributes remain authoritative. Only attributes change; caret/IME nodes stay live.
 */
export function inheritEmptyParagraphTypography(root, range, pending = {}) {
  if (!range?.collapsed || !root.contains(range.startContainer)) return false;
  const node =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement,
    paragraph = node.closest(blockSelector);
  if (!paragraph || paragraph === root || !root.contains(paragraph) || paragraph.textContent.trim())
    return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = paragraph;
  let reference;
  while (walker.previousNode()) {
    const current = walker.currentNode;
    if (current.nodeType === Node.TEXT_NODE && current.data.trim()) {
      reference = current.parentElement;
      break;
    }
  }
  if (!reference) {
    walker.currentNode = paragraph;
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (
        current.nodeType === Node.TEXT_NODE &&
        current.data.trim() &&
        !paragraph.contains(current)
      ) {
        reference = current.parentElement;
        break;
      }
    }
  }
  if (!reference) return false;
  const previous = attributes(reference, root),
    current = attributes(node, root),
    explicit = new Set(Object.keys(pending).map((field) => CHARACTER_FIELDS[field]));
  let changed = false;
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined || value === null || explicit.has(name)) continue;
    const local = node.closest('[data-ivo-' + name + ']');
    if ((local && paragraph.contains(local)) || paragraph.querySelector('[data-ivo-' + name + ']'))
      continue;
    if (String(current[name]) === String(value)) continue;
    setTextAttribute(paragraph, name, value);
    changed = true;
  }
  return changed;
}

/** A direct BR holds an empty paragraph open. A saved empty inline formatting
 * context can precede it after Enter. A wrapped BR is an authored soft return.
 */
export function blankParagraphBreak(block) {
  const last = block.lastChild;
  if (last?.nodeName !== 'BR') return null;
  if (last === block.firstChild) return last;
  return !block.textContent && block.querySelectorAll('br').length === 1 ? last : null;
}
