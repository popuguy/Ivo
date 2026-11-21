// InDesign's paragraph anchors and horizontal spaces have different semantics from JavaScript's.
const horizontal = '\\t\\p{Zs}';
const word = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d';
function compile(needle, caseSensitive) {
  const flags = new Set('gdu' + (caseSensitive ? '' : 'i'));
  const modifiers = needle.match(/^\(\?([is]+)\)/);
  if (modifiers) {
    for (const flag of modifiers[1]) flags.add(flag);
    needle = needle.slice(modifiers[0].length);
  }
  let source = '',
    inClass = false;
  for (let i = 0; i < needle.length; i++) {
    const c = needle[i];
    if (c === '\\' && i + 1 < needle.length) {
      const escaped = needle[++i];
      const groups = { w: word, h: horizontal, d: '\\p{Nd}' };
      const group = groups[escaped.toLowerCase()];
      if (group && !inClass)
        source += '[' + (escaped === escaped.toUpperCase() ? '^' : '') + group + ']';
      else if (inClass && groups[escaped]) source += groups[escaped];
      else if (inClass && group)
        throw new Error('Use this negated character class outside brackets.');
      else if (!inClass && ['b', 'B', '<', '>'].includes(escaped)) {
        const enter = '(?<![' + word + '])(?=[' + word + '])';
        const leave = '(?<=[' + word + '])(?![' + word + '])';
        const boundary = '(?:' + enter + '|' + leave + ')';
        source += { b: boundary, B: '(?!' + boundary + ')', '<': enter, '>': leave }[escaped];
      } else if (!inClass && escaped === 'A') source += '^';
      else if (!inClass && escaped === 'z') source += '(?![\\s\\S])';
      else if (!inClass && escaped === 'R') source += '[\\r\\n]';
      else source += '\\' + escaped;
    } else if (c === '^' && !inClass) source += '(?<![^\\r])';
    else if (c === '$' && !inClass) source += '(?![^\\r])';
    else {
      if (c === '[') inClass = true;
      if (c === ']') inClass = false;
      source += c;
    }
  }
  return new RegExp(source, [...flags].join(''));
}

export function scanGrep({ texts, needle, caseSensitive }) {
  const pattern = compile(needle, caseSensitive);
  let count = 0,
    capturedLength = 0;
  return texts.map((text) => {
    const hits = [];
    for (const match of text.matchAll(pattern)) {
      // A broad query should fail as a whole before building unbounded results in the editor.
      count += match.indices.length;
      if (count > 100000)
        throw new Error('Too many matches. Narrow the search or select a smaller range.');
      for (const span of match.indices) if (span) capturedLength += span[1] - span[0];
      if (capturedLength > 20000000)
        throw new Error('Captured text exceeds the document budget. Narrow the search.');
      hits.push(match.indices);
    }
    return hits;
  });
}

if (typeof self !== 'undefined' && typeof document === 'undefined')
  self.onmessage = ({ data }) => {
    try {
      self.postMessage({ rows: scanGrep(data) });
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
