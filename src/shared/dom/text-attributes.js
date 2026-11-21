import {
  OPENTYPE_FEATURES,
  fontFamilyFor,
  validTextAttribute,
} from '../../domain/text/typography.js';
const featureTags = Object.values(OPENTYPE_FEATURES);
export function setTextAttribute(element, name, value) {
  const valid = validTextAttribute(name, String(value));
  if (valid === null) throw new TypeError('Unsupported text attribute ' + name);
  element.setAttribute('data-ivo-' + name, valid);
  applyTextAttributes(element);
}

export function applyTextAttributes(element, attributes) {
  const value = attributes
      ? (name) => attributes[name] ?? null
      : (name) => element.getAttribute('data-ivo-' + name),
    style = element.style;
  if (value('autoleading') !== null)
    style.setProperty('--ivo-auto-leading', String(Number(value('autoleading')) / 100));
  const values = {
    fontFamily: value('font') ? fontFamilyFor(value('font')) : null,
    fontSize: value('size') !== null ? value('size') + 'px' : null,
    lineHeight:
      value('leading') !== null
        ? Number(value('leading')) === 0
          ? 'var(--ivo-auto-leading, 1.2)'
          : value('leading') + 'px'
        : null,
    letterSpacing: value('tracking') !== null ? Number(value('tracking')) / 1000 + 'em' : null,
    color: value('color'),
    fontWeight: value('bold') !== null ? (value('bold') === 'true' ? '700' : '400') : null,
    fontStyle: value('italic') !== null ? (value('italic') === 'true' ? 'italic' : 'normal') : null,
    textDecoration:
      value('underline') !== null ? (value('underline') === 'true' ? 'underline' : 'none') : null,
    textAlign: value('align'),
    marginTop: value('before') !== null ? value('before') + 'px' : null,
    marginBottom: value('after') !== null ? value('after') + 'px' : null,
    backgroundColor:
      value('highlight') !== null
        ? value('highlight') === 'none'
          ? 'transparent'
          : value('highlight')
        : null,
    textTransform:
      value('caps') !== null ? (value('caps') === 'true' ? 'uppercase' : 'none') : null,
    fontKerning: value('kern') !== null ? (value('kern') === 'none' ? 'none' : 'normal') : null,
    marginLeft: value('left') !== null ? value('left') + 'px' : null,
    marginRight: value('right') !== null ? value('right') + 'px' : null,
    textIndent: value('first') !== null ? value('first') + 'px' : null,
    hyphens: value('hyphens') !== null ? (value('hyphens') === 'true' ? 'auto' : 'manual') : null,
    breakInside: value('keep') !== null ? (value('keep') === 'true' ? 'avoid' : 'auto') : null,
    breakAfter: value('next') !== null ? (value('next') === 'true' ? 'avoid' : 'auto') : null,
    widows: value('widows'),
    orphans: value('orphans'),
    direction: value('dir') === 'auto' ? null : value('dir'),
  };
  if (value('align')?.startsWith('justify')) {
    values.textAlign = 'justify';
    values.textAlignLast =
      { 'justify-center': 'center', 'justify-right': 'right', 'justify-all': 'justify' }[
        value('align')
      ] || 'start';
  }
  if (value('baseline') !== null) {
    values.position = 'relative';
    values.top = -Number(value('baseline')) + 'px';
  }
  const decorations = [];
  if (value('underline') === 'true') decorations.push('underline');
  if (value('strike') === 'true') decorations.push('line-through');
  if (value('strike') !== null || value('underline') !== null)
    values.textDecoration = decorations.join(' ') || 'none';
  const features = featureTags.filter((name) => value(name) !== null);
  if (features.length)
    values.fontFeatureSettings = features
      .map((name) => `"${name}" ${value(name) === 'true' ? 1 : 0}`)
      .join(',');
  if (value('lang')) element.lang = value('lang');
  if (value('axes') !== null)
    values.fontVariationSettings =
      value('axes') === 'normal'
        ? 'normal'
        : value('axes')
            .split(',')
            .map((entry) => {
              const [tag, number] = entry.split(':');
              return `"${tag}" ${number}`;
            })
            .join(',');
  if (value('optical') !== null)
    values.fontOpticalSizing = value('optical') === 'true' ? 'auto' : 'none';
  if (value('dir') === 'auto') element.dir = 'auto';
  for (const [key, v] of Object.entries(values)) if (v !== null) style[key] = v;
}
