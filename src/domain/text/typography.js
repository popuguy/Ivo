export const TEXT_FONTS = Object.freeze({
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: 'Georgia, Times New Roman, serif',
  'cmu-serif': '"CMU Serif", Georgia, serif',
  display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
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
});

export const PARAGRAPH_FIELDS = Object.freeze({
  align: 'align',
  paragraphBefore: 'before',
  paragraphAfter: 'after',
});

const bounds = {
  size: [1, 2000],
  leading: [0, 4000],
  tracking: [-1000, 10000],
  before: [0, 2000],
  after: [0, 2000],
};

export function validTextAttribute(name, value) {
  if (name === 'font') return Object.hasOwn(TEXT_FONTS, value) ? value : null;
  if (name === 'color') return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  if (name === 'align')
    return ['left', 'right', 'center', 'justify'].includes(value) ? value : null;
  if (['bold', 'italic', 'underline'].includes(name))
    return value === 'true' || value === 'false' ? value : null;
  if (bounds[name] && String(value).trim() !== '') {
    const n = Number(value),
      [min, max] = bounds[name];
    return Number.isFinite(n) && n >= min && n <= max ? String(n) : null;
  }
  return null;
}
