const styles = new Set(['decimal', 'roman-upper', 'roman-lower']);
const romanDigits = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function pageSection(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some((k) => !['start', 'style', 'prefix'].includes(k)) ||
    !styles.has(value.style) ||
    (value.start !== null &&
      (!Number.isSafeInteger(value.start) || value.start < 1 || value.start > 9999)) ||
    typeof value.prefix !== 'string' ||
    [...value.prefix].length > 8 ||
    /[+,\p{C}]/u.test(value.prefix)
  )
    throw Error(
      'Choose a numbering style, a start from 1 to 9999, and a prefix of up to eight characters without commas or plus signs.',
    );
  return { start: value.start, style: value.style, prefix: value.prefix };
}
function numberLabel(number, style) {
  if (style === 'decimal') return String(number);
  let label = '';
  for (const [n, symbol] of romanDigits) {
    label += symbol.repeat(Math.floor(number / n));
    number %= n;
  }
  return style === 'roman-lower' ? label.toLowerCase() : label;
}

export function pageFolios(pages) {
  let n = 0,
    section = { style: 'decimal', prefix: '' };
  return pages.map((page) => {
    n++;
    if (page.section) {
      section = page.section;
      n = section.start ?? n;
    }
    return section.prefix + numberLabel(n, section.style);
  });
}
