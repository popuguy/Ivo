import {
  TEXT_DEFAULTS,
  CHARACTER_FIELDS,
  PARAGRAPH_FIELDS,
  validTextAttribute,
} from '../../domain/text/typography.js';
import { resolvedTextStyle } from '../../domain/documents/publishing.js';

const fields = { ...CHARACTER_FIELDS, ...PARAGRAPH_FIELDS };
/** Resolve source-owned attributes, never generated CSS, along one ancestry path. */
export function nodeTextStyle(node, inherited, doc) {
  const result = { ...inherited };
  if (['B', 'STRONG'].includes(node.tagName)) result.bold = true;
  if (['I', 'EM'].includes(node.tagName)) result.italic = true;
  if (node.tagName === 'U') result.underline = true;
  if (node.tagName === 'S') result.strikethrough = true;
  Object.assign(
    result,
    resolvedTextStyle(doc, 'paragraph', node.getAttribute('data-ivo-pstyle')),
    resolvedTextStyle(doc, 'character', node.getAttribute('data-ivo-cstyle')),
  );
  for (const [key, attr] of Object.entries(fields)) {
    const raw = node.getAttribute('data-ivo-' + attr);
    if (raw === null) continue;
    const value = validTextAttribute(attr, raw);
    if (value === null) continue;
    result[key] =
      typeof TEXT_DEFAULTS[key] === 'boolean'
        ? value === 'true'
        : typeof TEXT_DEFAULTS[key] === 'number'
          ? Number(value)
          : value;
  }
  return result;
}

export function textStyleReader(root, doc, defaults) {
  const base = { ...TEXT_DEFAULTS, ...defaults },
    styles = new WeakMap();
  const at = (node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element === root) return base;
    if (!styles.has(element))
      styles.set(element, nodeTextStyle(element, at(element.parentElement), doc));
    return styles.get(element);
  };
  return at;
}

/** Uniform and mixed formatting for a frame, range or insertion point. Source is never changed. */
export function summarizeTextStyle(root, doc, defaults, { range = null, pending = {} } = {}) {
  const samples = [],
    at = textStyleReader(root, doc, defaults);
  if (range?.collapsed) {
    let node = range.startContainer;
    if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length)
      node = node.childNodes[range.startOffset] || node.childNodes[range.startOffset - 1] || node;
    samples.push({ ...at(node), ...pending });
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeType === Node.TEXT_NODE && node.length > 0;
      const blank =
        node.nodeType === Node.ELEMENT_NODE &&
        ['P', 'DIV', 'LI', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(node.tagName) &&
        !node.textContent &&
        !node.querySelector('p,div,li,h2,h3,h4,blockquote');
      if (!text && !blank) continue;
      if (range) {
        if (!range.intersectsNode(node)) continue;
        const part = document.createRange();
        part.selectNodeContents(node);
        if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
          part.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
          part.setEnd(range.endContainer, range.endOffset);
        if (text && part.collapsed) continue;
      }
      samples.push(at(node));
    }
  }
  if (!samples.length) samples.push(at(root));
  const values = {},
    mixed = [];
  for (const key of Object.keys(TEXT_DEFAULTS)) {
    const first = samples[0][key];
    if (samples.some((sample) => sample[key] !== first)) mixed.push(key);
    else values[key] = first;
  }
  return { values, mixed, fonts: [...new Set(samples.map((sample) => sample.textStyle))] };
}

/** Patch retained controls without stealing a live field's focus or replacing its DOM. */
export function reflectTextStyle(container, summary) {
  if (!summary) return;
  for (const input of container.querySelectorAll('[data-object-prop]')) {
    const key = input.dataset.objectProp;
    if (!(key in TEXT_DEFAULTS) || document.activeElement === input) continue;
    const mixed = summary.mixed.includes(key),
      value = summary.values[key];
    input.dataset.mixed = String(mixed);
    if (input.type === 'checkbox') {
      input.checked = !mixed && value === true;
      input.indeterminate = mixed;
    } else if (input.tagName === 'SELECT') {
      let option = input.querySelector('[data-mixed-option]');
      if (mixed && !option) {
        option = document.createElement('option');
        option.value = '';
        option.textContent = 'Mixed';
        option.disabled = true;
        option.dataset.mixedOption = '';
        input.prepend(option);
      }
      if (!mixed) option?.remove();
      input.value = mixed ? '' : String(value ?? '');
    } else if (input.type === 'color') {
      if (!mixed && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
      input.setAttribute(
        'aria-label',
        input.getAttribute('aria-label')?.replace(/ \(mixed\)$/, '') || key,
      );
      if (mixed) input.setAttribute('aria-label', input.getAttribute('aria-label') + ' (mixed)');
    } else {
      input.value = mixed
        ? ''
        : String(typeof value === 'number' ? Number(value.toFixed(4)) : (value ?? ''));
      input.placeholder = mixed ? 'Mixed' : '';
    }
  }
  for (const key of ['bold', 'italic'])
    for (const button of container.querySelectorAll(`[data-canvas-command="${key}"]`))
      button.setAttribute(
        'aria-pressed',
        summary.mixed.includes(key) ? 'mixed' : String(summary.values[key] === true),
      );
}
