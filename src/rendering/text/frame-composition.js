import { frameCompositionOffset } from '../../domain/text/frame-composition.js';

let context;
const typography = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'fontVariantCaps',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontOpticalSizing',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textAlign',
  'textIndent',
  'direction',
  'whiteSpace',
];

/** Measure a disposable copy, outside camera transforms and without inserting nodes into authored input. */
export function measureFrameText(element, { html, width } = {}) {
  const style = getComputedStyle(element),
    probe = element.cloneNode(true);
  probe.removeAttribute('contenteditable');
  if (html !== undefined) probe.innerHTML = html;
  for (const name of typography) probe.style[name] = style[name];
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width:
      (width ??
        Math.max(
          1,
          element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        )) + 'px',
    height: 'auto',
    minHeight: '0',
    maxHeight: 'none',
    padding: '0',
    border: '0',
    margin: '0',
    transform: 'none',
    visibility: 'hidden',
    overflow: 'visible',
    columnCount: 'auto',
    columnWidth: 'auto',
    columnGap: 'normal',
    alignContent: 'start',
    boxSizing: 'content-box',
  });
  probe.classList.add('flow-fragment');
  document.body.append(probe);
  try {
    const height = probe.getBoundingClientRect().height,
      top = probe.getBoundingClientRect().top;
    const walker = document.createTreeWalker(probe, NodeFilter.SHOW_TEXT),
      metrics = { ascent: 0, 'cap-height': 0, 'x-height': 0, leading: 0 };
    let node,
      baseline = null;
    while ((node = walker.nextNode())) {
      if (!node.length) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some((r) => r.height && r.width)) continue;
      const parent = node.parentElement,
        computed = getComputedStyle(parent),
        marker = document.createElement('span');
      Object.assign(marker.style, {
        display: 'inline-block',
        width: '0',
        height: '0',
        padding: '0',
        margin: '0',
        border: '0',
        verticalAlign: 'baseline',
        position: 'static',
      });
      parent.insertBefore(marker, node);
      let shifted = 0;
      for (
        let ancestor = parent;
        ancestor && ancestor !== probe;
        ancestor = ancestor.parentElement
      ) {
        const s = getComputedStyle(ancestor);
        if (s.position === 'relative') shifted += parseFloat(s.top) || 0;
      }
      const current = marker.getBoundingClientRect().top - top - shifted;
      marker.remove();
      if (baseline === null) baseline = current;
      if (current > baseline + 0.5) break;
      if (Math.abs(current - baseline) > 0.5) continue;
      context ||= document.createElement('canvas').getContext('2d');
      context.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      const ascent = (sample) => context.measureText(sample).actualBoundingBoxAscent;
      metrics.ascent = Math.max(metrics.ascent, ascent('d'));
      metrics['cap-height'] = Math.max(metrics['cap-height'], ascent('H'));
      metrics['x-height'] = Math.max(metrics['x-height'], ascent('x'));
      metrics.leading = Math.max(
        metrics.leading,
        parseFloat(computed.lineHeight) || range.getBoundingClientRect().height,
      );
    }
    if (baseline === null) {
      const marker = document.createElement('span');
      Object.assign(marker.style, {
        display: 'inline-block',
        height: '0',
        width: '0',
        verticalAlign: 'baseline',
      });
      probe.append(marker);
      baseline = marker.getBoundingClientRect().top - top;
      marker.remove();
      context ||= document.createElement('canvas').getContext('2d');
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      metrics.ascent = context.measureText('d').actualBoundingBoxAscent;
      metrics['cap-height'] = context.measureText('H').actualBoundingBoxAscent;
      metrics['x-height'] = context.measureText('x').actualBoundingBoxAscent;
      metrics.leading = parseFloat(style.lineHeight) || baseline;
    }
    return { naturalBaseline: baseline, contentHeight: height, metrics };
  } finally {
    probe.remove();
  }
}

export function composeFrameText(element, options, availableHeight, measurement) {
  return frameCompositionOffset({
    ...(measurement || measureFrameText(element)),
    policy: options.firstBaseline,
    minimum: options.minimumFirstBaseline || 0,
    availableHeight,
    verticalAlign: options.verticalAlign || 'top',
  });
}
