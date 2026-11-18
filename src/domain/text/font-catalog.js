/** Picker identities are transient. Documents only store shipped names or immutable font digests. */
export const SYSTEM_FONT_PREFIX = 'system:';
export const SHIPPED_FONT_FACES = Object.freeze({
  'CMUSerif-Roman': { textStyle: 'cmu-serif', bold: false, italic: false },
  'CMUSerif-Bold': { textStyle: 'cmu-serif', bold: true, italic: false },
  'CMUSerif-Italic': { textStyle: 'cmu-serif', bold: false, italic: true },
  'CMUSerif-BoldItalic': { textStyle: 'cmu-serif', bold: true, italic: true },
  'Geist-Regular': { textStyle: 'geist', bold: false, italic: false },
});
export const systemFontId = (postscript) => SYSTEM_FONT_PREFIX + encodeURIComponent(postscript);
export function fontChoices(assets = [], installed = [], current) {
  const result = [
    ['cmu-serif', 'CMU Serif'],
    ['geist', 'Geist'],
    ...assets.map((a) => [a.id, `${a.font.family} · ${a.font.subfamily}`]),
    ...installed
      .filter(
        (face) =>
          !SHIPPED_FONT_FACES[face.postscript] &&
          !assets.some((asset) => asset.font.postscript === face.postscript),
      )
      .map((face) => [face.id || systemFontId(face.postscript), `${face.family} · ${face.style}`]),
  ];
  const legacy = { sans: 'Helvetica Neue', serif: 'Georgia', display: 'Helvetica Neue Display' };
  if (!installed.length) result.push(...Object.entries(legacy));
  else if (legacy[current]) result.push([current, legacy[current]]);
  return result;
}
export function regularFace(rows, family, bold = false, italic = false) {
  return rows
    .filter((face) => face.family.toLocaleLowerCase() === family.toLocaleLowerCase())
    .sort((a, b) => {
      const score = (f) =>
        (Boolean(f.italic ?? /italic|oblique/i.test(f.style || '')) !== italic ? 10000 : 0) +
        Math.abs((f.weight || (/bold/i.test(f.style || '') ? 700 : 400)) - (bold ? 700 : 400));
      return score(a) - score(b) || a.postscript.localeCompare(b.postscript);
    })[0];
}
