import { inlineSeparator } from './scale-breaks.js';
// CSS transforms paint glyphs but do not change inline advances. Give each
// word its scaled advance, then paint its original glyphs about the baseline.
// Whitespace remains in the paragraph's own line-breaking and tab context.
const intrinsicSize = globalThis.CSS?.supports?.('width', 'calc-size(max-content, size * 1.25)');
let measurement;
function fontMetrics(element) {
  const computed = getComputedStyle(element);
  measurement ||= document.createElement('canvas').getContext('2d');
  measurement.font = [
    computed.fontStyle,
    computed.fontWeight,
    computed.fontSize,
    computed.fontFamily,
  ]
    .filter(Boolean)
    .join(' ');
  measurement.letterSpacing = computed.letterSpacing === 'normal' ? '0px' : computed.letterSpacing;
  return measurement.measureText(element.textContent);
}

export function applyCharacterScale(wrapper, horizontalScale, verticalScale) {
  const x = horizontalScale / 100,
    y = verticalScale / 100;
  if (x === 1 && y === 1) {
    if (!wrapper.hasAttribute('data-ivo-scale-paint')) return;
    wrapper.removeAttribute('data-ivo-scale-paint');
    for (const key of [
      'display',
      'transform',
      'transform-origin',
      'white-space',
      'text-align',
      'text-indent',
      'width',
      'font-size',
      'line-height',
    ])
      wrapper.style.removeProperty(key);
    return;
  }
  wrapper.setAttribute('data-ivo-scale-paint', '');
  const whitespace = inlineSeparator.test(wrapper.textContent);
  const css = wrapper.style;
  css.display = whitespace ? '' : 'inline-block';
  css.fontSize = whitespace && x !== 1 ? x + 'em' : '';
  css.lineHeight = whitespace && x !== 1 ? '0' : '';
  css.whiteSpace = whitespace ? '' : 'nowrap';
  css.textAlign = whitespace ? '' : 'start';
  css.textIndent = whitespace ? '' : '0';
  if (whitespace) {
    css.transform = css.transformOrigin = css.width = '';
    return;
  }
  const metrics = y !== 1 ? fontMetrics(wrapper) : null;
  // WebKit versions without calc-size() still use real glyph advances,
  // including ligatures, variation axes, and custom OpenType substitutions.
  let fallbackWidth;
  if (x !== 1 && !intrinsicSize) {
    css.width = 'max-content';
    fallbackWidth = parseFloat(getComputedStyle(wrapper).width);
    if (!Number.isFinite(fallbackWidth)) fallbackWidth = (metrics || fontMetrics(wrapper)).width;
  }
  css.width =
    x === 1
      ? ''
      : intrinsicSize
        ? 'calc-size(max-content, size * ' + x + ')'
        : fallbackWidth * x + 'px';
  // Inline line boxes center the leading above and below the font's ascent/descent.
  const baseline =
    y === 1
      ? '50%'
      : 'calc(50% + ' +
        (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 +
        'px)';
  css.transformOrigin =
    (getComputedStyle(wrapper).direction === 'rtl' ? 'right ' : 'left ') + baseline;
  css.transform = 'scale(' + x + ', ' + y + ')';
}
