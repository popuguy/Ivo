import { SHIPPED_TEXT_FONT_FILES } from './font-resource-data.js';
export * from './font-resource-data.js';

export function shippedTextFontURL(id) {
  const file = SHIPPED_TEXT_FONT_FILES[id];
  if (!file) throw Error('Unknown bundled text font.');
  return new URL('../../../public/fonts/' + file, import.meta.url);
}
