// Patterns are evaluated one atom at a time. A suffix table records the greedy
// endpoint at each input position, so even adjacent repetitions never backtrack.
const escapeClasses = {
  d: '\\p{Nd}',
  D: '\\P{Nd}',
  w: '[\\p{L}\\p{M}\\p{N}_]',
  W: '[^\\p{L}\\p{M}\\p{N}_]',
  h: '[\\p{Zs}\\t]',
  H: '[^\\p{Zs}\\t]',
  s: '\\s',
  S: '\\S',
  t: '\\t',
  n: '\\u2028',
};
const word = /[\p{L}\p{M}\p{N}_]/u;
const invalid = () => {
  throw Error(
    'Unsupported GREP style. Use letters, character classes, boundaries or greedy repetitions.',
  );
};
const cache = new Map();
export function compileStylePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.length || pattern.length > 160) invalid();
  if (cache.has(pattern)) return cache.get(pattern);
  const atoms = [];
  for (let i = 0; i < pattern.length;) {
    let c = String.fromCodePoint(pattern.codePointAt(i)),
      source,
      boundary;
    i += c.length;
    if (c === '^' || c === '$') boundary = c;
    else if (c === '[') {
      const cls = /^(?:\\.|[^\]\\])+\]/u.exec(pattern.slice(i));
      if (!cls) invalid();
      i += cls[0].length;
      source = '[' + cls[0];
    } else if (c === '\\') {
      c = pattern[i++];
      if (c === 'b' || c === 'B') boundary = c;
      else if (c === 'p' || c === 'P') {
        const prop = /^\{[A-Za-z_=]+\}/u.exec(pattern.slice(i));
        if (!prop) invalid();
        source = '\\' + c + prop[0];
        i += prop[0].length;
      } else if (Object.hasOwn(escapeClasses, c)) source = escapeClasses[c];
      else if (c && /[\\^$.*+?()[\]{}|/-]/u.test(c)) source = c === '-' ? '-' : '\\' + c;
      else invalid();
    } else if (c === '.') source = '.';
    else if ('*+?(){}|]'.includes(c)) invalid();
    else source = c;
    let min = 1,
      max = 1;
    const q = /^([+*?]|\{(\d{1,4})(?:(,)(\d{0,4}))?\})/u.exec(pattern.slice(i));
    if (q) {
      if (boundary) invalid();
      i += q[0].length;
      if (q[1] === '+') max = Infinity;
      else if (q[1] === '*') {
        min = 0;
        max = Infinity;
      } else if (q[1] === '?') min = 0;
      else {
        min = Number(q[2]);
        max = q[3] ? (q[4] ? Number(q[4]) : Infinity) : min;
      }
      if (max < min) invalid();
    }
    let test;
    if (source) {
      try {
        test = new RegExp(source, 'u');
      } catch {
        invalid();
      }
    }
    atoms.push({ test, boundary, min, max });
    if (atoms.length > 48) invalid();
  }
  if (atoms.every((a) => !a.test)) invalid();
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(pattern, atoms);
  return atoms;
}

export function forEachStyleMatch(text, pattern, visit) {
  const atoms = compileStylePattern(pattern),
    chars = [...text],
    length = chars.length;
  let suffix = new Int32Array(length + 1),
    current = new Int32Array(length + 1);
  const previousValid = new Int32Array(length + 1),
    offsets = new Int32Array(length + 1);
  for (let i = 0; i <= length; i++) {
    suffix[i] = i;
    if (i < length) offsets[i + 1] = offsets[i] + chars[i].length;
  }
  for (let a = atoms.length - 1; a >= 0; a--) {
    const { test, boundary, min, max } = atoms[a];
    if (boundary) {
      for (let i = 0; i <= length; i++) {
        const edge = word.test(chars[i - 1] ?? '') !== word.test(chars[i] ?? '');
        const fits =
          boundary === '^'
            ? i === 0
            : boundary === '$'
              ? i === length
              : boundary === 'b'
                ? edge
                : !edge;
        current[i] = fits ? suffix[i] : -1;
      }
    } else {
      let latest = -1,
        available = 0;
      for (let i = 0; i <= length; i++) {
        if (suffix[i] !== -1) latest = i;
        previousValid[i] = latest;
      }
      for (let i = length; i >= 0; i--) {
        available = i < length && test.test(chars[i]) ? available + 1 : 0;
        const end = previousValid[i + Math.min(available, max)];
        current[i] = end >= i + min ? suffix[end] : -1;
      }
    }
    [suffix, current] = [current, suffix];
  }
  for (let i = 0; i < length;) {
    if (suffix[i] > i) {
      visit(offsets[i], offsets[suffix[i]]);
      i = suffix[i];
    } else i++;
  }
}
