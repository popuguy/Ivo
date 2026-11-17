import { TEXT_FONTS, validTextAttribute } from '../../domain/text/typography.js';
export function setTextAttribute(element, name, value) {
  const valid = validTextAttribute(name, String(value));
  if (valid === null) throw new TypeError('Unsupported text attribute ' + name);
  element.setAttribute('data-ivo-' + name, valid);
  applyTextAttributes(element);
}

export function applyTextAttributes(element) {
  const value = (name) => element.getAttribute('data-ivo-' + name),
    style = element.style;
  const values = {
    fontFamily: value('font') ? TEXT_FONTS[value('font')] : null,
    fontSize: value('size') !== null ? value('size') + 'px' : null,
    lineHeight:
      value('leading') !== null
        ? Number(value('leading')) === 0
          ? '1.2'
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
  };
  for (const [key, v] of Object.entries(values)) if (v !== null) style[key] = v;
}
