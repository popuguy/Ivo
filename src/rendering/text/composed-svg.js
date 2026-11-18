import { escapeHTML as esc } from '../../shared/html/sanitize.js';
const checked = new WeakMap(),
  identifier = /^[A-Za-z][A-Za-z0-9_-]{0,159}$/,
  pathCharacters = /^[MmLlQqCcZzHhVvSsTtAa0-9eE+.,\s-]*$/,
  finite = (value) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 10000000,
  color = (value) => (/^#[\da-f]{6}$/i.test(value || '') ? value : '#252525');
function vectorsFor(result) {
  if (checked.has(result)) return checked.get(result);
  if (!Array.isArray(result.vectors) || result.vectors.length > 12000)
    throw Error('Invalid composed glyph data.');
  const vectors = new Map();
  let length = 0;
  for (const vector of result.vectors) {
    if (
      !identifier.test(vector.id) ||
      vectors.has(vector.id) ||
      typeof vector.pathD !== 'string' ||
      vector.pathD.length > 250000 ||
      !pathCharacters.test(vector.pathD) ||
      [...vector.pathD.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)].some(
        (number) => !finite(Number(number[0])),
      )
    )
      throw Error('Invalid composed glyph path.');
    length += vector.pathD.length;
    if (length > 16000000) throw Error('Composed glyph data exceeds its display budget.');
    vectors.set(vector.id, vector.pathD);
  }
  checked.set(result, vectors);
  return vectors;
}

/** Paint the compositor's glyphs without asking the browser to shape or wrap strings. */
export function composedSVG(
  result,
  frame,
  { text = '', styles = [], links = [], label = 'Document text', idPrefix = 'ivo' } = {},
) {
  const vectors = vectorsFor(result),
    used = new Set(),
    ink = [],
    decorations = [],
    linkRegions = [],
    lines = result.layout.lines.filter((line) => line.frame === frame.id);
  if (
    ![frame.width, frame.height].every(finite) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    !identifier.test(idPrefix)
  )
    throw Error('Invalid composed frame geometry.');
  for (const line of lines) {
    if (![line.baseline, line.ascent, line.descent].every(finite))
      throw Error('Invalid composed line geometry.');
    for (const run of line.runs) {
      const style = styles.find((s) => s.start <= run.start && s.end > run.start) || {},
        fill = color(run.textColor || style.textColor),
        glyphs = run.glyphs;
      if (glyphs.length > 100000) throw Error('Too many composed glyphs.');
      let left = Infinity,
        right = -Infinity;
      for (const glyph of glyphs) {
        if (
          !Number.isSafeInteger(glyph.index) ||
          !Number.isSafeInteger(glyph.end) ||
          glyph.index < 0 ||
          glyph.end < glyph.index ||
          glyph.end > text.length ||
          !Array.isArray(glyph.position) ||
          glyph.position.length !== 2 ||
          !Array.isArray(glyph.advance) ||
          glyph.advance.length !== 2 ||
          !glyph.position.every(finite) ||
          !glyph.advance.every(finite)
        )
          throw Error('Invalid composed glyph source range.');
        const a = glyph.position[0],
          b = a + glyph.advance[0];
        if (!finite(a) || !finite(b)) throw Error('Invalid composed glyph position.');
        left = Math.min(left, a, b);
        right = Math.max(right, a, b);
      }
      const width = glyphs.length ? right - left : 0;
      if (style.highlight && style.highlight !== 'none' && width > 0)
        decorations.push(
          `<rect x="${left}" y="${line.baseline - line.ascent}" width="${width}" height="${line.ascent + line.descent}" fill="${color(style.highlight)}"/>`,
        );
      for (const glyph of glyphs) {
        if (!glyph.vector) {
          if (text.slice(glyph.index, glyph.end).trim())
            throw Error('A composed glyph has no vector representation.');
          continue;
        }
        if (!vectors.has(glyph.vector) || !glyph.position.every(finite))
          throw Error('Invalid composed glyph reference.');
        used.add(glyph.vector);
        ink.push(
          `<use data-composed-index="${glyph.index}" data-composed-end="${glyph.end}" href="#${idPrefix}-${glyph.vector}" transform="translate(${glyph.position[0]} ${line.baseline - glyph.position[1]}) scale(1 -1)" fill="${fill}"/>`,
        );
      }
      for (const [enabled, position] of [
        [style.underline, run.underlinePosition],
        [style.strikethrough, (run.xHeight || 0) / 2],
      ])
        if (enabled && width > 0) {
          if (!finite(position) || !finite(run.underlineThickness))
            throw Error('Composed text decoration has no font metrics.');
          ink.push(
            `<rect x="${left}" y="${line.baseline - position}" width="${width}" height="${run.underlineThickness}" fill="${fill}"/>`,
          );
        }
    }
    for (const link of links) {
      const glyphs = line.runs
        .flatMap((run) => run.glyphs)
        .filter((glyph) => glyph.index < link.end && glyph.end > link.start);
      if (!glyphs.length) continue;
      const left = Math.min(
          ...glyphs.map((glyph) =>
            Math.min(glyph.position[0], glyph.position[0] + glyph.advance[0]),
          ),
        ),
        right = Math.max(
          ...glyphs.map((glyph) =>
            Math.max(glyph.position[0], glyph.position[0] + glyph.advance[0]),
          ),
        ),
        attributes =
          link.documentId && /^[\w-]{1,120}$/.test(link.documentId)
            ? `data-doc-id="${esc(link.documentId)}" href="#doc=${esc(link.documentId)}"`
            : /^https?:\/\//.test(link.url || '')
              ? `href="${esc(link.url)}"`
              : '';
      if (attributes)
        linkRegions.push(
          `<a ${attributes}><title>${esc(text.slice(link.start, link.end))}</title><rect x="${left}" y="${line.baseline - line.ascent}" width="${Math.max(0, right - left)}" height="${line.ascent + line.descent}" fill="transparent" pointer-events="all"/></a>`,
        );
    }
  }
  const definitions = [...used]
    .map((id) => `<path id="${idPrefix}-${id}" d="${vectors.get(id)}"/>`)
    .join('');
  return `<svg data-composed-text="true" class="composed-text" xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-label="${esc(label)}"><defs>${definitions}</defs>${decorations.join('')}${ink.join('')}${linkRegions.join('')}</svg>`;
}
