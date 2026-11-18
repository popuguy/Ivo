export const TEXT_FONTS = Object.freeze({
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: 'Georgia, Times New Roman, serif',
  'cmu-serif': '"CMU Serif", Georgia, serif',
  display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
});
export const OPENTYPE_FEATURES = Object.freeze({
  ligatures: 'liga',
  discretionaryLigatures: 'dlig',
  smallCaps: 'smcp',
  oldstyleFigures: 'onum',
  tabularFigures: 'tnum',
  slashedZero: 'zero',
  fractions: 'frac',
  ordinals: 'ordn',
  stylisticAlternates: 'salt',
});
/** Effective authoring defaults, independent of a particular renderer's computed CSS. */
export const TEXT_DEFAULTS = Object.freeze({
  textStyle: 'sans',
  fontSize: 16,
  leading: 0,
  tracking: 0,
  textColor: '#252525',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  highlight: 'none',
  baselineShift: 0,
  horizontalScale: 100,
  verticalScale: 100,
  autoLeading: 120,
  kerning: 'metrics',
  ligatures: true,
  discretionaryLigatures: false,
  smallCaps: false,
  allCaps: false,
  oldstyleFigures: false,
  tabularFigures: false,
  slashedZero: false,
  fractions: false,
  ordinals: false,
  stylisticAlternates: false,
  language: 'en-US',
  characterStyle: 'none',
  paragraphStyle: 'none',
  fontVariations: 'normal',
  opticalSizing: true,
  align: 'left',
  paragraphBefore: 0,
  paragraphAfter: 0,
  leftIndent: 0,
  rightIndent: 0,
  firstLineIndent: 0,
  hyphenate: false,
  keepTogether: false,
  keepWithNext: false,
  widows: 2,
  orphans: 2,
  direction: 'ltr',
});

export const CHARACTER_FIELDS = Object.freeze({
  textStyle: 'font',
  fontSize: 'size',
  leading: 'leading',
  tracking: 'tracking',
  textColor: 'color',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  highlight: 'highlight',
  strikethrough: 'strike',
  baselineShift: 'baseline',
  horizontalScale: 'hscale',
  verticalScale: 'vscale',
  autoLeading: 'autoleading',
  kerning: 'kern',
  ligatures: 'liga',
  discretionaryLigatures: 'dlig',
  smallCaps: 'smcp',
  allCaps: 'caps',
  oldstyleFigures: 'onum',
  tabularFigures: 'tnum',
  slashedZero: 'zero',
  fractions: 'frac',
  ordinals: 'ordn',
  stylisticAlternates: 'salt',
  language: 'lang',
  characterStyle: 'cstyle',
  fontVariations: 'axes',
  opticalSizing: 'optical',
});

export const PARAGRAPH_FIELDS = Object.freeze({
  align: 'align',
  paragraphBefore: 'before',
  paragraphAfter: 'after',
  leftIndent: 'left',
  rightIndent: 'right',
  firstLineIndent: 'first',
  hyphenate: 'hyphens',
  keepTogether: 'keep',
  keepWithNext: 'next',
  widows: 'widows',
  orphans: 'orphans',
  direction: 'dir',
  paragraphStyle: 'pstyle',
});

export const TEXT_ATTRIBUTE_NAMES = Object.freeze([
  ...Object.values(CHARACTER_FIELDS),
  ...Object.values(PARAGRAPH_FIELDS),
]);
export const HIGHLIGHT_COLORS = Object.freeze([
  '#fff176',
  '#a5efb1',
  '#9cddff',
  '#ffc2df',
  '#ffce85',
  '#d3c0ff',
]);
export const ALIGNMENTS = Object.freeze([
  'left',
  'center',
  'right',
  'justify',
  'justify-center',
  'justify-right',
  'justify-all',
  'start',
  'end',
]);
export function fontFamilyFor(name) {
  return TEXT_FONTS[name] || (/^font-[a-f0-9]{64}$/.test(name || '') ? `"ivo-${name}"` : null);
}

const bounds = {
  size: [1, 2000],
  leading: [0, 4000],
  tracking: [-1000, 10000],
  before: [0, 2000],
  after: [0, 2000],
  baseline: [-2000, 2000],
  hscale: [10, 1000],
  vscale: [10, 1000],
  autoleading: [50, 500],
  left: [-2000, 2000],
  right: [-2000, 2000],
  first: [-2000, 2000],
  widows: [1, 20],
  orphans: [1, 20],
};

export function validTextAttribute(name, value) {
  if (name === 'axes') {
    if (value === 'normal') return value;
    const entries = value.split(',');
    if (entries.length > 16) return null;
    const seen = new Set();
    for (const entry of entries) {
      const pair = entry.split(':');
      if (
        pair.length !== 2 ||
        !/^[A-Za-z0-9]{4}$/.test(pair[0]) ||
        seen.has(pair[0]) ||
        pair[1].trim() === '' ||
        !Number.isFinite(Number(pair[1])) ||
        Math.abs(Number(pair[1])) > 1000000
      )
        return null;
      seen.add(pair[0]);
    }
    return entries
      .map((entry) => entry.split(':')[0] + ':' + Number(entry.split(':')[1]))
      .join(',');
  }
  if (name === 'font') return fontFamilyFor(value) ? value : null;
  if (name === 'color' || name === 'highlight')
    return name === 'highlight' && value === 'none'
      ? value
      : /^#[0-9a-f]{6}$/i.test(value)
        ? value.toLowerCase()
        : null;
  if (name === 'align') return ALIGNMENTS.includes(value) ? value : null;
  if (
    [
      'bold',
      'italic',
      'underline',
      'strike',
      'liga',
      'dlig',
      'smcp',
      'caps',
      'onum',
      'tnum',
      'zero',
      'frac',
      'ordn',
      'salt',
      'hyphens',
      'keep',
      'next',
      'optical',
    ].includes(name)
  )
    return value === 'true' || value === 'false' ? value : null;
  if (name === 'kern')
    return ['metrics', 'optical', 'none'].includes(value)
      ? value
      : /^-?\d+(?:\.\d+)?$/.test(value) && Math.abs(Number(value)) <= 1000
        ? String(Number(value))
        : null;
  if (name === 'dir') return ['ltr', 'rtl', 'auto'].includes(value) ? value : null;
  if (name === 'lang')
    return /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value) && value.length < 64 ? value : null;
  if (name === 'pstyle' || name === 'cstyle')
    return value === 'none' || /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value) ? value : null;
  if (bounds[name] && String(value).trim() !== '') {
    const n = Number(value),
      [min, max] = bounds[name];
    return Number.isFinite(n) && n >= min && n <= max ? String(n) : null;
  }
  return null;
}
