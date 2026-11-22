import { compileStylePattern, forEachStyleMatch } from './style-pattern.js';

export const nestedDelimiters = {
  word: 'Words',
  character: 'Characters',
  letter: 'Letters',
  digit: 'Digits',
  sentence: 'Sentences',
  tab: 'Tab Characters',
  lineBreak: 'Forced Line Breaks',
  emSpace: 'Em Spaces',
  enSpace: 'En Spaces',
  nonbreakingSpace: 'Nonbreaking Spaces',
  literal: 'Character',
};
const delimiters = {
  word: /\S+(\s*)/gu,
  sentence: /[.!?](\s*)/gu,
  character: /./gsu,
  letter: /\p{L}/gu,
  digit: /\p{Nd}/gu,
  tab: /\t/g,
  lineBreak: /\u2028/g,
  emSpace: /\u2003/g,
  enSpace: /\u2002/g,
  nonbreakingSpace: /\u00a0/g,
};

export function validatedStyleRules(style, kind, characterIds) {
  const result = {};
  for (const key of ['nestedStyles', 'grepStyles']) {
    if (style[key] === undefined) continue;
    if (kind !== 'paragraph' || !Array.isArray(style[key]) || style[key].length > 24)
      throw Error('Choose up to 24 rules in a paragraph style.');
    result[key] = style[key].map((rule) => {
      if (
        !rule ||
        (!characterIds.has(rule.style) && !(key === 'nestedStyles' && rule.style === null))
      )
        throw Error('Choose an existing character style for the rule.');
      if (key === 'grepStyles') {
        compileStylePattern(rule.pattern);
        return { style: rule.style, pattern: rule.pattern };
      }
      if (
        !Object.hasOwn(nestedDelimiters, rule.delimiter) ||
        typeof rule.inclusive !== 'boolean' ||
        !Number.isInteger(rule.count) ||
        rule.count < 1 ||
        rule.count > 999
      )
        throw Error('Invalid nested style delimiter or count.');
      if (
        rule.delimiter === 'literal' &&
        (typeof rule.literal !== 'string' || [...rule.literal].length !== 1)
      )
        throw Error('Choose one delimiter character.');
      return {
        style: rule.style,
        delimiter: rule.delimiter,
        count: rule.count,
        inclusive: rule.inclusive,
        ...(rule.delimiter === 'literal' ? { literal: rule.literal } : {}),
      };
    });
  }
  return result;
}

function nestedEnd(text, start, rule) {
  const expression = delimiters[rule.delimiter];
  let from = start,
    end,
    upTo;
  if (expression) expression.lastIndex = start;
  for (let i = 0; i < rule.count; i++) {
    if (expression) {
      const match = expression.exec(text);
      if (!match) return text.length;
      end = expression.lastIndex;
      upTo = match[1] === undefined ? match.index : end - match[1].length;
    } else {
      upTo = text.indexOf(rule.literal, from);
      if (upTo < 0) return text.length;
      end = upTo + rule.literal.length;
    }
    from = end;
  }
  return rule.inclusive ? end : upTo;
}

// Each run records character styles from lowest to highest precedence. Returned
// positions are canonical UTF-16 offsets within a paragraph.
export function paragraphRuleRuns(text, { nestedStyles = [], grepStyles = [] }) {
  // At most 24 GREP rules fit in one unsigned mask. Even a one-character
  // pattern matching the whole paragraph does not allocate an event per glyph.
  const matches = grepStyles.length ? new Uint32Array(text.length) : null;
  for (const [index, rule] of grepStyles.entries()) {
    const flag = 1 << index;
    forEachStyleMatch(text, rule.pattern, (start, end) => {
      for (let at = start; at < end; at++) matches[at] |= flag;
    });
  }
  const nested = [];
  let from = 0;
  for (const rule of nestedStyles) {
    if (from >= text.length) break;
    const end = nestedEnd(text, from, rule);
    if (end > from) nested.push({ end, style: rule.style });
    from = end;
  }
  const runs = [],
    stylesByMask = new Map();
  let nestIndex = 0;
  for (let start = 0; start < text.length;) {
    if (nested[nestIndex]?.end === start) nestIndex++;
    const nest = nested[nestIndex],
      mask = matches?.[start] || 0;
    let end = nest?.end ?? text.length;
    if (matches) {
      let pos = start + 1;
      while (pos < end && matches[pos] === mask) pos++;
      end = pos;
    }
    if (mask || nest?.style) {
      if (!stylesByMask.has(mask)) {
        const styles = [];
        for (let i = grepStyles.length - 1; i >= 0; i--)
          if (mask & (1 << i)) styles.push(grepStyles[i].style);
        stylesByMask.set(mask, styles);
      }
      const styles = stylesByMask.get(mask);
      runs.push({ start, end, styles: nest?.style ? [...styles, nest.style] : styles });
    }
    start = end;
  }
  return runs;
}

export function inheritedStyleRules(doc, id) {
  const definitions = doc.publishing?.paragraphStyles || [],
    rules = {},
    seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const style = definitions.find((s) => s.id === id);
    if (!style) break;
    for (const key of ['grepStyles', 'nestedStyles'])
      if (rules[key] === undefined && style[key] !== undefined) rules[key] = style[key];
    id = style.basedOn;
  }
  return rules;
}
