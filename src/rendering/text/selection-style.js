import { TEXT_DEFAULTS } from '../../domain/text/typography.js';
import { nodeTextStyle } from './node-text-style.js';
import { conditionalTextRuns } from './paragraph-style-rules.js';
export { nodeTextStyle };

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
    at = textStyleReader(root, doc, defaults),
    rules = conditionalTextRuns(root, doc, defaults);
  const sampleRange = (node, start, end) => {
    const base = at(node),
      ranges = rules?.get(node);
    if (!ranges) {
      samples.push(base);
      return;
    }
    let cursor = start;
    for (const run of ranges) {
      if (run.end <= start) continue;
      if (run.start >= end) break;
      if (run.start > cursor) samples.push(base);
      samples.push({ ...base, ...run.attributes });
      cursor = run.end;
    }
    if (cursor < end) samples.push(base);
  };
  if (range?.collapsed) {
    let node = range.startContainer;
    if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length)
      node = node.childNodes[range.startOffset] || node.childNodes[range.startOffset - 1] || node;
    const index = range.startContainer === node ? Math.max(0, range.startOffset - 1) : 0;
    const automatic = rules?.get(node)?.find((r) => r.start <= index && r.end > index)?.attributes;
    samples.push({ ...at(node), ...automatic, ...pending });
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
      let start = 0,
        end = node.length;
      if (range) {
        if (!range.intersectsNode(node)) continue;
        const part = document.createRange();
        part.selectNodeContents(node);
        if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
          part.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
          part.setEnd(range.endContainer, range.endOffset);
        if (text && part.collapsed) continue;
        if (text) {
          start = part.startOffset;
          end = part.endOffset;
        }
      }
      sampleRange(node, start, end);
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
  return {
    values,
    mixed,
    ...(mixed.includes('wordSpacing')
      ? { justificationValues: [...new Set(samples.map((sample) => sample.wordSpacing))] }
      : {}),
    fonts: [...new Set(samples.map((sample) => sample.textStyle))],
  };
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
