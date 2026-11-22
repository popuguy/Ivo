import { inheritedStyleRules, paragraphRuleRuns } from '../../domain/text/paragraph-style-rules.js';
import { resolvedTextStyle } from '../../domain/documents/publishing.js';
import { CHARACTER_FIELDS } from '../../domain/text/typography.js';
import { applyTextAttributes } from '../../shared/dom/text-attributes.js';
import { nodeTextStyle } from './node-text-style.js';

// Reuse unchanged paragraphs across selection, typing and export. Definition edits
// replace the paragraph-style array. The source strings and cached run count are bounded.
const caches = new WeakMap();
function rangesFor(definitions, id, text, rules) {
  let cache = caches.get(definitions);
  if (!cache) {
    cache = { entries: new Map(), cost: 0 };
    caches.set(definitions, cache);
  }
  const key = id + '\n' + text,
    cached = cache.entries.get(key);
  if (cached) return cached.runs;
  const runs = paragraphRuleRuns(text, rules),
    cost = key.length + 16 * runs.length;
  if (cost <= 16000) {
    while (cache.cost + cost > 150000 || cache.entries.size >= 256) {
      const first = cache.entries.keys().next().value;
      cache.cost -= cache.entries.get(first).cost;
      cache.entries.delete(first);
    }
    cache.entries.set(key, { runs, cost });
    cache.cost += cost;
  }
  return runs;
}
const blocks = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

// The paragraph spans all inline elements and soft returns. Each text node
// receives relative ranges, so a thread boundary never restarts a rule.
export function conditionalTextRuns(root, doc, settings = {}) {
  if (
    !doc?.publishing?.paragraphStyles?.some(
      (s) => s.nestedStyles !== undefined || s.grepStyles !== undefined,
    )
  )
    return;
  const nodeRuns = new Map(),
    ruleCache = new Map(),
    styleCache = new Map();
  let owner,
    pieces = [],
    parts = [],
    length = 0;
  const finish = () => {
    if (!pieces.length) {
      parts = [];
      length = 0;
      return;
    }
    const id = owner?.closest('[data-ivo-pstyle]')?.dataset.ivoPstyle ?? settings.paragraphStyle;
    if (!ruleCache.has(id)) ruleCache.set(id, inheritedStyleRules(doc, id));
    const rules = ruleCache.get(id);
    if (rules.grepStyles?.length || rules.nestedStyles?.length) {
      const runs = rangesFor(doc.publishing.paragraphStyles, id, parts.join(''), rules);
      let i = 0;
      for (const { node, start, end, offset } of pieces) {
        while (i < runs.length && runs[i].end <= start) i++;
        for (let j = i; j < runs.length && runs[j].start < end; j++) {
          const run = runs[j],
            automatic = {};
          for (const id of run.styles) {
            if (!styleCache.has(id)) styleCache.set(id, resolvedTextStyle(doc, 'character', id));
            Object.assign(automatic, styleCache.get(id));
          }
          if (!Object.keys(automatic).length) continue;
          // Reapply only explicit character styling and local overrides over the
          // automatic cascade, including a direct override equal to the paragraph default.
          const ancestry = [];
          for (let n = node.parentElement; n && n !== root; n = n.parentElement) ancestry.push(n);
          let effective = {
            ...automatic,
            ...resolvedTextStyle(doc, 'character', settings.characterStyle),
            ...settings.textOverrides,
          };
          for (let k = ancestry.length - 1; k >= 0; k--)
            effective = nodeTextStyle(ancestry[k], effective, doc, { paragraph: false });
          const attributes = Object.fromEntries(
            Object.keys(automatic).map((key) => [key, effective[key]]),
          );
          if (!nodeRuns.has(node)) nodeRuns.set(node, []);
          nodeRuns.get(node).push({
            start: offset + Math.max(start, run.start) - start,
            end: offset + Math.min(end, run.end) - start,
            attributes,
          });
        }
      }
    }
    pieces = [];
    parts = [];
    length = 0;
  };
  const visit = (node, paragraph) => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') {
      if (paragraph !== owner) finish();
      owner = paragraph;
      const value = node.nodeName === 'BR' ? '\u2028' : node.data;
      let offset = 0;
      for (const part of value.split('\u2029')) {
        if (offset) finish();
        if (node.nodeType === Node.TEXT_NODE && part.length)
          pieces.push({ node, start: length, end: length + part.length, offset });
        parts.push(part);
        length += part.length;
        offset += part.length + 1;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node !== root && blocks.has(node.tagName)) {
      finish();
      paragraph = node;
    }
    for (const child of node.childNodes) visit(child, paragraph);
    if (node === paragraph) finish();
  };
  visit(root, root);
  return nodeRuns;
}

// Intended for a disposable export/layout tree. Never paint a source input
// with spans carrying authoring attributes.
export function paintConditionalText(root, doc, settings) {
  const runs = conditionalTextRuns(root, doc, settings);
  if (!runs) return;
  for (const [node, ranges] of runs) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { start, end, attributes } of ranges) {
      if (start > cursor) fragment.append(node.data.slice(cursor, start));
      const span = document.createElement('span');
      for (const [key, value] of Object.entries(attributes))
        span.setAttribute('data-ivo-' + CHARACTER_FIELDS[key], String(value));
      applyTextAttributes(span);
      span.dataset.ivoRuleRun = '';
      span.textContent = node.data.slice(start, end);
      fragment.append(span);
      cursor = end;
    }
    if (cursor < node.length) fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
}
