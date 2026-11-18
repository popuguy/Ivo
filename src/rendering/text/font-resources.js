/** Public, licensed source font bytes used by the composition boundary. */
export const SHIPPED_TEXT_FONT_FILES = Object.freeze({
  'cmu-regular': 'cmu-serif/cmunrm.ttf',
  'cmu-italic': 'cmu-serif/cmunti.ttf',
  'cmu-bold': 'cmu-serif/cmunbx.ttf',
  'cmu-bold-italic': 'cmu-serif/cmunbi.ttf',
});
export function shippedTextFontURL(id) {
  const file = SHIPPED_TEXT_FONT_FILES[id];
  if (!file) throw Error('Unknown bundled text font.');
  return new URL('../../../public/fonts/' + file, import.meta.url);
}
