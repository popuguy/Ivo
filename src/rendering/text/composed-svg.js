import { glyphGeometryIdentity } from './retained-geometry.js';
import { escapeHTML as esc } from '../../shared/html/sanitize.js';
import { characterInkBox, characterDecorationY } from '../../domain/text/character-geometry.js';
import { runExtent, runCaret } from '../../domain/text/run-geometry.js';
const plainInk = new WeakMap();
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

function sourceInterval(line, run, start, end, geometry) {
  const a = runCaret(line, run, start, geometry),
    b = runCaret(line, run, end, geometry);
  if (!a || !b) throw Error('Composed source boundary is not a native run caret.');
  return { left: Math.min(a.x, b.x), width: Math.abs(b.x - a.x) };
}

function linkAttributes(link) {
  return link.documentId && /^[\w-]{1,120}$/.test(link.documentId)
    ? `data-doc-id="${esc(link.documentId)}" href="#doc=${esc(link.documentId)}"`
    : /^https?:\/\//.test(link.url || '')
      ? `href="${esc(link.url)}"`
      : '';
}

function firstIntersecting(ranges, start) {
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  return low;
}

function styleRanges(styles, length) {
  const ordered = [...styles].sort((a, b) => a.start - b.start);
  let end = 0;
  for (const style of ordered) {
    if (
      !Number.isSafeInteger(style.start) ||
      !Number.isSafeInteger(style.end) ||
      style.start < end ||
      style.end <= style.start ||
      style.end > length
    )
      throw Error('Invalid composed style source ranges.');
    end = style.end;
  }
  return ordered;
}

/** Paint the compositor's glyphs without asking the browser to shape or wrap strings. */
export function composedSVG(
  result,
  frame,
  { text = '', styles = [], links = [], label = 'Document text', idPrefix = 'ivo', paint } = {},
) {
  const vectors = vectorsFor(result),
    used = new Set(),
    planes = [[], [], []],
    lines = result.layout.lines.filter((line) => line.frame === frame.id),
    sourceStyles = styleRanges(styles, text.length);
  if (
    ![frame.width, frame.height].every(finite) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    !identifier.test(idPrefix)
  )
    throw Error('Invalid composed frame geometry.');
  // Paint-only formatting and links have their own source ranges. Only reuse a
  // plain row when its native glyphs, horizontal placement and baseline agree.
  const plain =
    paint &&
    !links.length &&
    !sourceStyles.some(
      (style) =>
        style.underline || style.strikethrough || (style.highlight && style.highlight !== 'none'),
    );
  for (const line of lines) {
    const decorations = [],
      ink = [],
      linkRegions = [];
    if (![line.baseline, line.ascent, line.descent].every(finite))
      throw Error('Invalid composed line geometry.');
    const identity =
      plain && line.runs.every((run) => run.textColor) && glyphGeometryIdentity(line.runs);
    const cached = identity && plainInk.get(identity);
    if (
      cached &&
      cached.prefix === idPrefix &&
      cached.baseline === line.baseline &&
      cached.vectors.every((id) => vectors.has(id))
    ) {
      planes[0].push('');
      planes[1].push(cached.ink);
      planes[2].push('');
      for (const id of cached.vectors) used.add(id);
      continue;
    }
    const rowVectors = identity && new Set();
    const carets = new Map(),
      geometry = new Map();
    for (const caret of line.carets || [])
      if (!carets.has(caret.index)) carets.set(caret.index, caret);
    for (const run of line.runs) {
      const first = firstIntersecting(sourceStyles, run.start),
        style = sourceStyles[first]?.start <= run.start ? sourceStyles[first] : {},
        fill = color(run.textColor || style.textColor),
        glyphs = run.glyphs;
      if (glyphs.length > 100000) throw Error('Too many composed glyphs.');
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
      }
      const measured = { extent: runExtent(run), carets };
      geometry.set(run, measured);
      const spans = [];
      for (
        let index = first;
        index < sourceStyles.length && sourceStyles[index].start < run.end;
        index++
      ) {
        const part = sourceStyles[index];
        const start = Math.max(part.start, run.start),
          end = Math.min(part.end, run.end),
          highlight = part.highlight && part.highlight !== 'none';
        if (
          end <= start ||
          !measured.extent ||
          !(highlight || part.underline || part.strikethrough)
        )
          continue;
        const span = { ...sourceInterval(line, run, start, end, measured), style: part };
        spans.push(span);
        if (highlight && span.width > 0) {
          const box = characterInkBox(line, run);
          decorations.push(
            `<rect x="${span.left}" y="${box.y}" width="${span.width}" height="${box.height}" fill="${color(part.highlight)}"/>`,
          );
        }
      }
      for (const glyph of glyphs) {
        if (!glyph.vector) {
          if (text.slice(glyph.index, glyph.end).trim())
            throw Error('A composed glyph has no vector representation.');
          continue;
        }
        if (!vectors.has(glyph.vector) || !glyph.position.every(finite))
          throw Error('Invalid composed glyph reference.');
        used.add(glyph.vector);
        if (rowVectors) rowVectors.add(glyph.vector);
        ink.push(
          `<use data-glyph-offset="${glyph.index - line.start}" href="#${idPrefix}-${glyph.vector}" transform="translate(${glyph.position[0]} ${line.baseline - glyph.position[1]}) scale(1 -1)" fill="${fill}"/>`,
        );
      }
      for (const span of spans)
        for (const [enabled, strike] of [
          [span.style.underline, false],
          [span.style.strikethrough, true],
        ])
          if (enabled && span.width > 0) {
            if (!finite(run.underlineThickness))
              throw Error('Composed text decoration has no font metrics.');
            ink.push(
              `<rect x="${span.left}" y="${characterDecorationY(line, run, strike)}" width="${span.width}" height="${run.underlineThickness}" fill="${fill}"/>`,
            );
          }
    }
    const sourceRuns = [...line.runs].sort((a, b) => a.start - b.start);
    for (const link of links) {
      const attributes = linkAttributes(link),
        regions = [];
      if (!attributes) continue;
      for (
        let index = firstIntersecting(sourceRuns, link.start);
        index < sourceRuns.length && sourceRuns[index].start < link.end;
        index++
      ) {
        const run = sourceRuns[index];
        const start = Math.max(link.start, run.start),
          end = Math.min(link.end, run.end),
          measured = geometry.get(run);
        if (end <= start || !measured.extent) continue;
        const span = sourceInterval(line, run, start, end, measured),
          box = characterInkBox(line, run);
        if (span.width > 0)
          regions.push(
            `<rect x="${span.left}" y="${box.y}" width="${span.width}" height="${box.height}" fill="transparent" pointer-events="all"/>`,
          );
      }
      if (regions.length)
        linkRegions.push(
          `<a ${attributes}><title>${esc(text.slice(link.start, link.end))}</title>${regions.join('')}</a>`,
        );
    }
    planes[0].push(decorations.join(''));
    const rowInk = ink.join('');
    if (identity)
      plainInk.set(identity, {
        prefix: idPrefix,
        baseline: line.baseline,
        vectors: [...rowVectors],
        ink: rowInk,
      });
    planes[1].push(rowInk);
    planes[2].push(linkRegions.join(''));
  }
  const outlines = new Map([...used].map((id) => [idPrefix + '-' + id, vectors.get(id)]));
  const definitions = [...outlines].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('');
  const token = /^ct1-[a-f0-9]{64}$/.test(result.token || '')
    ? ` data-composition-token="${result.token}"`
    : '';
  const starts = lines.map((line) => line.start);
  if (paint) Object.assign(paint, { outlines, planes, starts, token: result.token, label });
  const groups = planes
    .map(
      (rows, plane) =>
        '<g>' +
        rows
          .map(
            (row, i) =>
              (plane === 1 ? '<g data-line-start="' + starts[i] + '">' : '<g>') + row + '</g>',
          )
          .join('') +
        '</g>',
    )
    .join('');
  return `<svg data-composed-text="true"${token} class="composed-text" xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-label="${esc(label)}"><defs>${definitions}</defs>${groups}</svg>`;
}
