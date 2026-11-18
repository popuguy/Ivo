import { TEXT_FONTS, validTextAttribute } from '../../domain/text/typography.js';

const fontNames = new Map(
  Object.entries(TEXT_FONTS).map(([id, stack]) => [firstFamily(stack), id]),
);
// Display and Sans intentionally share a family. Preserve existing authored IDs;
// a native declaration of that family resolves to the ordinary Sans preset.
fontNames.set('helvetica neue', 'sans');
function firstFamily(value) {
  const first = String(value).match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
  return (first?.[1] || first?.[2] || first?.[3] || '').trim().toLowerCase();
}
function pixels(value) {
  return /^\d+(?:\.\d+)?px$/.test(value) ? Number(value.slice(0, -2)) : null;
}
function color(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const channels = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*1(?:\.0*)?)?\s*\)$/i,
  );
  if (!channels || channels.slice(1).some((n) => Number(n) > 255)) return null;
  return (
    '#' +
    channels
      .slice(1)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Native contenteditable may express a deliberate Normal mark as inline CSS.
 * Translate only representable declarations; never copy arbitrary CSS, resolve
 * computed/inherited styles, or substitute an unrecognized font family.
 */
export function nativeTextAttributes(style) {
  const result = {},
    put = (name, value) => {
      if (value === null || value === undefined) return;
      const valid = validTextAttribute(name, String(value));
      if (valid !== null) result[name] = valid;
    };
  if (['normal', 'italic'].includes(style.fontStyle)) put('italic', style.fontStyle === 'italic');
  if (['normal', '400', 'bold', '700'].includes(style.fontWeight))
    put('bold', ['bold', '700'].includes(style.fontWeight));
  const decoration = style.textDecorationLine;
  if (decoration && /^(?:none|(?:(?:underline|line-through|overline)\s*)+)$/.test(decoration)) {
    put('underline', decoration.split(/\s+/).includes('underline'));
    put('strike', decoration.split(/\s+/).includes('line-through'));
  }
  const size = pixels(style.fontSize || ''),
    leading = pixels(style.lineHeight || '');
  put('size', size);
  // Canonical zero means Auto, whereas CSS 0px means zero height. Do not conflate them.
  if (leading > 0) put('leading', leading);
  if (style.fontFamily) {
    const family = firstFamily(style.fontFamily),
      id =
        fontNames.get(family) || (/^ivo-font-[a-f0-9]{64}$/.test(family) ? family.slice(4) : null);
    put('font', id);
  }
  put('color', color(style.color || ''));
  if (['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)) put('highlight', 'none');
  else put('highlight', color(style.backgroundColor || ''));
  const tracking = (style.letterSpacing || '').match(/^(-?\d+(?:\.\d+)?)em$/);
  if (tracking) put('tracking', Number(tracking[1]) * 1000);
  else if (['normal', '0px'].includes(style.letterSpacing)) put('tracking', 0);
  return result;
}
