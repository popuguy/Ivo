// Each entry is a source character. Layout-generated hyphens and page markers
// have no editable source position and cannot be substituted as characters.
export const findCharacters = [
  [
    'Breaks and tabs',
    [
      ['End of Paragraph', 'p', '\r', '\\r'],
      ['Forced Line Break', 'n', '\n', '\\n'],
      ['Discretionary Line Break', 'k', '\u200b'],
      ['Tab', 't', '\t', '\\t'],
    ],
  ],
  [
    'White space',
    [
      ['Nonbreaking Space', 's', '\u00a0'],
      ['Nonbreaking Space (Fixed Width)', 'S', '\u202f'],
      ['Em Space', 'm', '\u2003'],
      ['En Space', '>', '\u2002'],
      ['Thin Space', '<', '\u2009'],
      ['Hair Space', '|', '\u200a'],
      ['Figure Space', '/', '\u2007'],
      ['Punctuation Space', '.', '\u2008'],
      ['Third Space', '3', '\u2004'],
      ['Quarter Space', '4', '\u2005'],
      ['Sixth Space', '%', '\u2006'],
    ],
  ],
  [
    'Punctuation and symbols',
    [
      ['Em Dash', '_', '—'],
      ['En Dash', '=', '–'],
      ['Discretionary Hyphen', '-', '\u00ad'],
      ['Nonbreaking Hyphen', '~', '\u2011'],
      ['Ellipsis', 'e', '…'],
      ['Bullet', '8', '•'],
      ['Left Double Quotation Mark', '{', '“'],
      ['Right Double Quotation Mark', '}', '”'],
      ['Left Single Quotation Mark', '[', '‘'],
      ['Right Single Quotation Mark', ']', '’'],
      ['Paragraph Symbol', '7', '¶'],
      ['Section Symbol', '6', '§'],
      ['Copyright', '2', '©'],
      ['Registered Trademark', 'r', '®'],
      ['Trademark', 'd', '™'],
    ],
  ],
];

const entries = findCharacters.flatMap(([, group]) => group);
const textCodes = new Map(entries.map(([, code, value]) => [code, value]));
textCodes.set('^', '^');
export const grepTildeCodes = new Map(
  entries.filter(([, , , escape]) => !escape).map(([, code, value]) => [code, value]),
);

export function decodeFindField(value) {
  return value.replace(/\^(.)/gu, (match, code) => textCodes.get(code) ?? match);
}

// Older saved queries treated the newly supported codes as literal text.
// Translate those queries on read without writing to device preferences.
export function readFindQuery(query) {
  if (query.characterSyntax === 2) return query;
  function translate(value, replacement) {
    if (query.mode === 'text')
      return value.replace(/\^(.)/gu, (match, code) =>
        textCodes.has(code) && !['p', 't', '^'].includes(code) ? '^' + match : match,
      );
    let result = '';
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === '\\' && i + 1 < value.length) {
        // A backslash before a tilde was itself literal in Change To.
        if (replacement && value[i + 1] === '~') result += '\\\\';
        else {
          result += c + value[++i];
          continue;
        }
      } else if (c === '~' && grepTildeCodes.has(value[i + 1])) result += '\\~';
      else result += c;
    }
    return result;
  }
  return {
    ...query,
    needle: translate(query.needle, false),
    replacement: translate(query.replacement, true),
  };
}
