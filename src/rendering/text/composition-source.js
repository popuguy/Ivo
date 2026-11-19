import { textIndexMap } from '../../shared/dom/text-selection.js';
import { nodeTextStyle } from './selection-style.js';
import { TEXT_DEFAULTS } from '../../domain/text/typography.js';
import { safeURL } from '../../shared/html/sanitize.js';
import { PARAGRAPH_LAYOUT_FIELDS } from '../../domain/text/paragraph-layout.js';
import { PARAGRAPH_KEEP_FIELDS } from '../../domain/text/paragraph-keep-policy.js';
import {
  NATIVE_CHARACTER_STYLE_FIELDS,
  nativeCharacterStyle,
  hasNondefaultNativeCharacter,
} from '../../domain/text/native-character-style.js';

const blockTags = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']),
  supportedTags = new Set(['P', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'BR']),
  paragraphFields = [...PARAGRAPH_LAYOUT_FIELDS, ...PARAGRAPH_KEEP_FIELDS],
  supportedFields = new Set([
    'textStyle',
    'fontSize',
    'bold',
    'italic',
    'leading',
    'autoLeading',
    'tracking',
    'kerning',
    'textColor',
    'ligatures',
    'underline',
    'strikethrough',
    'highlight',
    'characterStyle',
    'paragraphStyle',
    ...paragraphFields,
    ...NATIVE_CHARACTER_STYLE_FIELDS,
  ]),
  labels = {
    align: 'paragraph alignment',
    paragraphBefore: 'space before',
    paragraphAfter: 'space after',
    baselineShift: 'baseline shift',
    horizontalScale: 'horizontal text scaling',
    verticalScale: 'vertical text scaling',
    leftIndent: 'left indent',
    rightIndent: 'right indent',
    firstLineIndent: 'first-line indent',
    smallCaps: 'small capitals',
    allCaps: 'all capitals',
    hyphenate: 'hyphenation',
    keepTogether: 'paragraph keeps',
    keepWithNext: 'keep with next',
    direction: 'writing direction',
    fontVariations: 'variable font coordinates',
    language: 'language-specific shaping',
  };
export class UnsupportedComposition extends Error {
  constructor(feature) {
    super(`This composer does not yet support ${labels[feature] || feature}.`);
    this.name = 'UnsupportedComposition';
    this.feature = feature;
  }
}

function sameRunStyle(previous, current) {
  const fields = new Set([...Object.keys(previous), ...Object.keys(current)]);
  fields.delete('start');
  fields.delete('end');
  for (const field of fields) {
    if (field === 'features') {
      const before = previous.features || {},
        after = current.features || {},
        tags = new Set([...Object.keys(before), ...Object.keys(after)]);
      if ([...tags].some((tag) => before[tag] !== after[tag])) return false;
    } else if (previous[field] !== current[field]) return false;
  }
  return true;
}

/**
 * A source-preserving transport projection. Virtual marks and collapsed HTML
 * whitespace retain their canonical UTF-16 intervals instead of entering saved text.
 */
export function compositionSource(root, { id, doc, settings, fontFor } = {}) {
  const sourceHTML = root.innerHTML,
    map = textIndexMap(root),
    logicalLength = map.boundaries.get(root).at(-1),
    tokens = [],
    styles = new WeakMap(),
    base = { ...TEXT_DEFAULTS, ...settings },
    leafBlocks = new Set(),
    paragraphEnds = new Set();
  const styleAt = (node) => {
    if (node === root) return base;
    if (!styles.has(node)) styles.set(node, nodeTextStyle(node, styleAt(node.parentElement), doc));
    return styles.get(node);
  };
  const add = (kind, start, end, text, node, priority = 1) => {
    const style = styleAt(node);
    for (const [key, value] of Object.entries(style))
      if (!supportedFields.has(key) && value !== TEXT_DEFAULTS[key])
        throw new UnsupportedComposition(key);
    // Paragraph marks, including generated implicit marks, own these settings.
    // Inline character formatting must not silently create another paragraph or
    // discard a conflicting paragraph property when it becomes native text.
    if (kind !== 'whitespace' && node !== root && !blockTags.has(node.tagName)) {
      let owner = node.parentElement;
      while (owner !== root && !blockTags.has(owner.tagName)) owner = owner.parentElement;
      const paragraphStyle = styleAt(owner);
      if (paragraphFields.some((key) => style[key] !== paragraphStyle[key]))
        throw new UnsupportedComposition('paragraph properties on inline text');
    }
    const anchor = node.closest?.('a'),
      target = anchor?.getAttribute('data-doc-id'),
      url = safeURL(anchor?.getAttribute('href'));
    tokens.push({
      kind,
      logicalStart: start,
      logicalEnd: end,
      text,
      style,
      priority,
      link: target && /^[\w-]{1,120}$/.test(target) ? { documentId: target } : url ? { url } : null,
    });
  };
  for (const node of root.querySelectorAll('*')) {
    if (!supportedTags.has(node.tagName))
      throw new UnsupportedComposition(node.tagName.toLowerCase() + ' elements');
    const points = map.boundaries.get(node);
    if (blockTags.has(node.tagName)) {
      add('structure', points[0] - 1, points[0], '', node);
      const leaf = !node.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,blockquote');
      if (leaf) {
        leafBlocks.add(node);
        paragraphEnds.add(points.at(-1));
      }
      add(
        leaf ? 'paragraph' : 'structure',
        points.at(-1),
        points.at(-1) + 1,
        leaf ? '\u2029' : '',
        node,
      );
    } else if (node.tagName === 'BR') {
      const placeholder =
        blockTags.has(node.parentElement.tagName) && node.parentElement.childNodes.length === 1;
      add(
        placeholder ? 'placeholder' : 'soft-break',
        points[0],
        points[0] + 1,
        placeholder ? '' : '\u2028',
        node,
      );
    }
  }
  // A browser Enter can produce `first line<div>second line</div>`. Inline
  // groups outside leaf paragraphs need their own generated paragraph boundary.
  const suppressed = new Set();
  function implicit(container) {
    if (leafBlocks.has(container)) return;
    const hasBlocks = [...container.children].some(
      (node) =>
        blockTags.has(node.tagName) || node.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,blockquote'),
    );
    let group = [];
    const finish = (end) => {
      if (!group.length) return;
      const meaningful = group.some(
        (node) =>
          /[^ \t\r\n\f]/.test(node.textContent) ||
          node.nodeName === 'BR' ||
          node.querySelector?.('br'),
      );
      if (meaningful || !hasBlocks) {
        add('paragraph', end, end, '\u2029', container, 0);
        paragraphEnds.add(end);
      } else
        for (const node of group) {
          if (node.nodeType === Node.TEXT_NODE) suppressed.add(node);
          else {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            let text;
            while ((text = walker.nextNode())) suppressed.add(text);
          }
        }
      group = [];
    };
    const points = map.boundaries.get(container);
    for (const [index, node] of [...container.childNodes].entries()) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (blockTags.has(node.tagName) || node.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,blockquote'))
      ) {
        finish(points[index]);
        implicit(node);
      } else group.push(node);
    }
    finish(points.at(-1));
  }
  implicit(root);
  for (const part of map.segments)
    add(
      suppressed.has(part.node) ? 'whitespace' : 'text',
      part.start,
      part.end,
      suppressed.has(part.node) ? '' : part.node.data,
      part.node.parentElement,
    );
  if (!paragraphEnds.size) add('paragraph', logicalLength, logicalLength, '\u2029', root, 2);
  tokens.sort((a, b) => a.logicalStart - b.logicalStart || a.priority - b.priority);
  let logical = 0,
    text = '',
    paragraphStart = 0;
  const spans = [],
    runs = [],
    paragraphs = [],
    links = [];
  for (const token of tokens) {
    if (token.logicalStart !== logical) throw Error('Text composition lost a source boundary.');
    const start = text.length;
    text += token.text;
    spans.push({
      kind: token.kind,
      logicalStart: token.logicalStart,
      logicalEnd: token.logicalEnd,
      start,
      end: text.length,
    });
    if (token.text.length) {
      const style = token.style,
        character = nativeCharacterStyle(style),
        font = fontFor?.(style);
      if (!font) throw new UnsupportedComposition('the selected font face');
      const run = {
        start,
        end: text.length,
        font,
        size: style.fontSize,
        leading: style.leading,
        autoLeading: style.autoLeading,
        tracking: style.tracking,
        kerning: style.kerning,
        ligatures: style.ligatures,
        textColor: style.textColor,
        underline: style.underline,
        strikethrough: style.strikethrough,
        highlight: style.highlight,
        language: style.language,
        ...character,
      };
      const previous = runs.at(-1);
      if (previous && previous.end === start && sameRunStyle(previous, run)) previous.end = run.end;
      else runs.push(run);
      if (token.link) links.push({ start, end: text.length, ...token.link });
    }
    // Literal Unicode paragraph separators retain their original text/source
    // spans while creating the same paragraph policy boundary as an HTML mark.
    for (const match of token.text.matchAll(/\u2029/g)) {
      const end = start + match.index + 1;
      paragraphs.push({
        start: paragraphStart,
        end,
        contentEnd: end - 1,
        logicalEnd:
          token.kind === 'paragraph' ? token.logicalEnd : token.logicalStart + match.index + 1,
        ...Object.fromEntries(paragraphFields.map((key) => [key, token.style[key]])),
      });
      paragraphStart = end;
    }
    logical = token.logicalEnd;
  }
  if (logical !== logicalLength || root.innerHTML !== sourceHTML)
    throw Error('Text composition changed its source.');
  return {
    protocol: runs.some(hasNondefaultNativeCharacter) ? 4 : 2,
    id,
    mode: 'greedy-geometry-proof',
    sourceHTML,
    logicalLength,
    text,
    spans,
    runs,
    paragraphs,
    links,
  };
}
