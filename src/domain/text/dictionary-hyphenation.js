import { HYPHENATION_DEFAULTS } from './hyphenation.js';
import * as us from './dictionaries/en-us.js';
import * as british from './dictionaries/en-gb.js';
import * as spanish from './dictionaries/es.js';
import * as italian from './dictionaries/it.js';
import * as russian from './dictionaries/ru.js';
import * as turkish from './dictionaries/tr.js';
import * as czech from './dictionaries/cs.js';
import * as greek from './dictionaries/el-monoton.js';

const englishLetters = /^[a-z]+$/;
const dictionaries = {
  'en-us': { data: us, letters: englishLetters },
  'en-gb': { data: british, letters: englishLetters, left: 2, right: 3 },
  ru: { data: russian, letters: /^[а-яё]+$/, left: 2, right: 2 },
  tr: { data: turkish, letters: /^[abcçdefgğhıijklmnoöprsştuüvyzâîû]+$/, left: 2, right: 2 },
  es: { data: spanish, letters: /^[a-záéíóúüñ]+$/, left: 2, right: 2 },
  it: { data: italian, letters: /^[a-zàèéìíîòóùú]+$/, left: 2, right: 2 },
  cs: { data: czech, letters: /^[a-záčďéěíňóřšťúůýž]+$/, left: 2, right: 2 },
  el: { data: greek, letters: /^[α-ωάέήίόύώϊϋΐΰ]+$/, left: 1, right: 1 },
};
const compiled = new Map();

export function dictionaryForLanguage(tag) {
  if (typeof tag !== 'string') return null;
  let locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return null;
  }
  const { language, region } = locale;
  if (language === 'en')
    return region === 'GB' ? 'en-gb' : !region || region === 'US' ? 'en-us' : null;
  if (language === 'el' && locale.baseName.split('-').includes('polyton')) return null;
  return Object.hasOwn(dictionaries, language) ? language : null;
}

function compileDictionary(key) {
  if (compiled.has(key)) return compiled.get(key);
  const { patterns, exceptions } = dictionaries[key].data;
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
  for (const entry of exceptions.split(' ').filter(Boolean)) {
    let index = 0;
    const breaks = [];
    for (const character of entry) {
      if (character === '-') breaks.push(index);
      else index++;
    }
    words.set(entry.replaceAll('-', ''), breaks);
  }
  const result = { root, words };
  compiled.set(key, result);
  return result;
}

function wordBreaks(word, key) {
  const { root, words } = compileDictionary(key);
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

// Look up complete words so a language or style boundary inside a word cannot
// accidentally hyphenate a substring. Offsets returned to the editor always
// refer to the original UTF-16 source, even for decomposed accented letters.
export function dictionaryHyphenationPoints(
  text,
  settings = {},
  languageAt = () => 'en-us',
  exceptions,
) {
  const points = [];
  const policy = { ...HYPHENATION_DEFAULTS, ...settings };
  const words =
    /[\p{L}\p{M}\p{N}_\u00ad\u2060\ufeff]+(?:['’][\p{L}\p{M}\p{N}_\u00ad\u2060\ufeff]+)*/gu;
  const matches = Array.from(text.matchAll(words));
  if (!policy.hyphenLastWord) matches.pop();
  for (const match of matches) {
    const raw = match[0];
    if (
      raw.length < policy.hyphenWordLength ||
      raw.length > 256 ||
      (!policy.hyphenCapitals && /^\p{Lu}/u.test(raw))
    )
      continue;
    const key = languageAt(match.index, match.index + raw.length);
    if (!key) continue;
    const base = Object.hasOwn(dictionaries, key) ? key : dictionaryForLanguage(key);
    const dictionary = base && dictionaries[base];
    const word = raw.normalize('NFC').toLocaleLowerCase(key);
    if (
      word.length < policy.hyphenWordLength ||
      word.length > 128 ||
      !(exceptions?.get(key)?.has(word) || dictionary?.letters.test(word))
    )
      continue;
    const left = Math.max(dictionary?.left ?? 1, policy.hyphenAfterFirst, policy.hyphenBeforeLast);
    const right = Math.max(dictionary?.right ?? 1, policy.hyphenBeforeLast);
    const breaks = (exceptions?.get(key)?.get(word) ?? wordBreaks(word, base)).filter(
      (at) => at >= left && at <= word.length - right,
    );
    if (!breaks.length) continue;
    if (raw.length === word.length) {
      for (const at of breaks) points.push(match.index + at);
    } else {
      const clusters = Array.from(raw.matchAll(/\p{L}\p{M}*/gu));
      if (clusters.length !== word.length) continue;
      for (const at of breaks) points.push(match.index + clusters[at].index);
    }
  }
  return points;
}
