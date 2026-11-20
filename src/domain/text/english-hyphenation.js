import { HYPHENATION_DEFAULTS } from './hyphenation.js';
import { patterns, exceptions } from './dictionaries/en-us.js';

let dictionary;
function englishDictionary() {
  if (dictionary) return dictionary;
  const root = new Map();
  for (const pattern of patterns.split(/\s+/)) {
    let node = root;
    const weights = [0];
    for (const character of pattern) {
      if (character >= '0' && character <= '9') weights[weights.length - 1] = Number(character);
      else {
        if (!node.has(character)) node.set(character, new Map());
        node = node.get(character);
        weights.push(0);
      }
    }
    node.set('', weights);
  }
  const words = new Map();
  for (const entry of exceptions.split(' ')) {
    let index = 0;
    const breaks = [];
    for (const character of entry) {
      if (character === '-') breaks.push(index);
      else index++;
    }
    words.set(entry.replaceAll('-', ''), breaks);
  }
  dictionary = { root, words };
  return dictionary;
}

function wordBreaks(word) {
  const { root, words } = englishDictionary();
  if (words.has(word)) return words.get(word);
  const padded = '.' + word + '.';
  const weights = new Uint8Array(padded.length + 1);
  for (let start = 0; start < padded.length; start++) {
    let node = root;
    for (let end = start; end < padded.length; end++) {
      node = node.get(padded[end]);
      if (!node) break;
      const matched = node.get('');
      if (matched)
        for (let i = 0; i < matched.length; i++)
          weights[start + i] = Math.max(weights[start + i], matched[i]);
    }
  }
  const breaks = [];
  for (let i = 1; i < word.length; i++) if (weights[i + 1] % 2) breaks.push(i);
  return breaks;
}

/** Absolute UTF-16 boundaries within this paragraph. An explicit discretionary
 * hyphen gives its author control over that word. Skip unsupported word forms
 * whole so a partial Latin match never splits a combining mark or identifier. */
export function englishHyphenationPoints(text, settings = {}) {
  const points = [];
  const words =
    /[\p{L}\p{M}\p{N}_\u00ad\u2060\ufeff]+(?:['’][\p{L}\p{M}\p{N}_\u00ad\u2060\ufeff]+)*/gu;
  const policy = { ...HYPHENATION_DEFAULTS, ...settings };
  const matches = Array.from(text.matchAll(words));
  if (!policy.hyphenLastWord) matches.pop();
  for (const match of matches) {
    if (
      match[0].length < policy.hyphenWordLength ||
      !/^[a-z]{2,128}$/i.test(match[0]) ||
      (!policy.hyphenCapitals && /^[A-Z]/.test(match[0]))
    )
      continue;
    for (const at of wordBreaks(match[0].toLowerCase())) {
      if (at >= policy.hyphenAfterFirst && at <= match[0].length - policy.hyphenBeforeLast)
        points.push(match.index + at);
    }
  }
  return points;
}
