import { textIndexMap } from '../../../src/shared/dom/text-selection.js';
import { nodeTextStyle } from '../../../src/rendering/text/selection-style.js';
import { TEXT_DEFAULTS } from '../../../src/domain/text/typography.js';

const blocks = new Set(['P', 'DIV', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']),
  supported = new Set(['P', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'BR']);
/** Disposable proof adapter. It neither replaces source nor claims structured-content coverage. */
export function compositionSource(root, { id, doc = {}, settings = {} } = {}) {
  const original = root.innerHTML,
    map = textIndexMap(root),
    length = map.boundaries.get(root).at(-1),
    tokens = [],
    base = { ...TEXT_DEFAULTS, ...settings },
    styles = new WeakMap();
  const styleAt = (node) => {
    if (node === root) return base;
    if (!styles.has(node)) styles.set(node, nodeTextStyle(node, styleAt(node.parentElement), doc));
    return styles.get(node);
  };
  const add = (kind, start, end, text, node) =>
    tokens.push({ kind, logicalStart: start, logicalEnd: end, text, style: styleAt(node) });
  for (const node of root.querySelectorAll('*')) {
    if (!supported.has(node.tagName)) throw Error('Prototype does not support ' + node.tagName);
    const positions = map.boundaries.get(node);
    if (blocks.has(node.tagName)) {
      add('structure', positions[0] - 1, positions[0], '', node);
      const leaf = !node.querySelector('p,div,blockquote,h1,h2,h3,h4,h5,h6');
      add(
        leaf ? 'paragraph' : 'structure',
        positions.at(-1),
        positions.at(-1) + 1,
        leaf ? '\u2029' : '',
        node,
      );
    } else if (node.tagName === 'BR') {
      const placeholder =
        node.parentElement !== root &&
        blocks.has(node.parentElement.tagName) &&
        node.parentElement.childNodes.length === 1;
      add(
        placeholder ? 'placeholder' : 'soft-break',
        positions[0],
        positions[0] + 1,
        placeholder ? '' : '\u2028',
        node,
      );
    }
  }
  for (const part of map.segments)
    add('text', part.start, part.end, part.node.data, part.node.parentElement);
  tokens.sort((a, b) => a.logicalStart - b.logicalStart);
  const hasBlocks = !!root.querySelector('p,div,blockquote,h1,h2,h3,h4,h5,h6');
  if (hasBlocks && [...root.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.length))
    throw Error('Prototype does not support mixed implicit and explicit paragraphs');
  if (!hasBlocks) add('paragraph', length, length, '\u2029', root);
  let logical = 0,
    text = '';
  const spans = [],
    runs = [];
  for (const part of tokens) {
    if (part.logicalStart !== logical) throw Error('Incomplete logical source map');
    const start = text.length;
    text += part.text;
    const { textStyle, bold, italic, fontSize, ligatures, tracking } = part.style;
    if (textStyle !== 'cmu-serif') throw Error('Prototype requires an explicit CMU resource');
    const represented = new Set([
      'textStyle',
      'bold',
      'italic',
      'fontSize',
      'ligatures',
      'tracking',
      'paragraphStyle',
      'characterStyle',
    ]);
    for (const [key, value] of Object.entries(part.style))
      if (!represented.has(key) && value !== TEXT_DEFAULTS[key])
        throw Error('Prototype does not implement ' + key);
    spans.push({
      kind: part.kind,
      logicalStart: part.logicalStart,
      logicalEnd: part.logicalEnd,
      start,
      end: text.length,
    });
    if (part.text.length) {
      const run = {
        start,
        end: text.length,
        font: bold
          ? italic
            ? 'cmu-bold-italic'
            : 'cmu-bold'
          : italic
            ? 'cmu-italic'
            : 'cmu-regular',
        size: fontSize,
        ligatures,
        tracking,
      };
      const prior = runs.at(-1);
      if (
        prior &&
        prior.end === run.start &&
        ['font', 'size', 'ligatures', 'tracking'].every((k) => prior[k] === run[k])
      )
        prior.end = run.end;
      else runs.push(run);
    }
    logical = part.logicalEnd;
  }
  if (logical !== length || root.innerHTML !== original)
    throw Error('Source mapping changed or lost authored data');
  return {
    protocol: 1,
    mode: 'greedy-geometry-proof',
    id,
    sourceHTML: original,
    logicalLength: length,
    text,
    spans,
    runs,
  };
}
