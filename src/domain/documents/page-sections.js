export const sectionNumberStyles = {
  decimal: '1, 2, 3, 4…',
  'roman-upper': 'I, II, III, IV…',
  'roman-lower': 'i, ii, iii, iv…',
  'letters-upper': 'A, B, C, D…',
  'letters-lower': 'a, b, c, d…',
  'decimal-2': '01, 02, 03, 04…',
  'decimal-3': '001, 002, 003, 004…',
  'decimal-4': '0001, 0002, 0003, 0004…',
};
export const extendedPageSection = (section) =>
  section?.includePrefix === false ||
  ['letters-upper', 'letters-lower', 'decimal-2', 'decimal-3', 'decimal-4'].includes(
    section?.style,
  );
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
    Object.keys(value).some(
      (k) => !['start', 'style', 'prefix', 'includePrefix', 'marker'].includes(k),
    ) ||
    !Object.hasOwn(sectionNumberStyles, value.style) ||
    (value.includePrefix !== undefined && typeof value.includePrefix !== 'boolean') ||
    (value.start !== null &&
      (!Number.isSafeInteger(value.start) || value.start < 1 || value.start > 9999)) ||
    (value.marker !== undefined &&
      (typeof value.marker !== 'string' ||
        [...value.marker].length > 256 ||
        /[\p{C}]/u.test(value.marker))) ||
    typeof value.prefix !== 'string' ||
    [...value.prefix].length > 8 ||
    /[+,\p{C}]/u.test(value.prefix)
  )
    throw Error(
      'Check the section numbering, eight-character prefix and section marker (up to 256 characters).',
    );
  return {
    start: value.start,
    style: value.style,
    prefix: value.prefix,
    ...(value.marker && { marker: value.marker }),
    ...(value.includePrefix === false ? { includePrefix: false } : {}),
  };
}
function numberLabel(number, style) {
  if (style === 'decimal') return String(number);
  if (style.startsWith('decimal-')) return String(number).padStart(Number(style.slice(-1)), '0');
  let label = '';
  if (style.startsWith('letters-')) {
    while (number) {
      number--;
      label = String.fromCharCode(65 + (number % 26)) + label;
      number = Math.floor(number / 26);
    }
    return style === 'letters-lower' ? label.toLowerCase() : label;
  }
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
    return (section.includePrefix === false ? '' : section.prefix) + numberLabel(n, section.style);
  });
}
