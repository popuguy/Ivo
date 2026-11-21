// Saved paragraph attributes use a compact, markup-safe representation. The alignment
// character is a Unicode scalar number, so commas and quotes survive rich-text paste.
const alignments = new Set(['left', 'center', 'right', 'decimal']);
export const MAX_TAB_STOPS = 64;

export function tabStopsValue(stops) {
  if (!Array.isArray(stops) || stops.length > MAX_TAB_STOPS)
    throw Error('A paragraph can have up to 64 tab stops.');
  let previous = 0;
  return (
    stops
      .map(({ position, alignment, character, leader }) => {
        if (
          !Number.isFinite(position) ||
          position <= previous ||
          position > 14400 ||
          !alignments.has(alignment)
        )
          throw Error('Tab stops need distinct increasing positions within 14400 pt.');
        previous = position;
        if (
          leader !== undefined &&
          (typeof leader !== 'string' ||
            !leader.length ||
            leader.length > 16 ||
            [...leader].length > 8 ||
            /[\p{C}\p{Zl}\p{Zp}]/u.test(leader))
        )
          throw Error('A tab leader accepts one to eight printable characters.');
        const suffix =
          leader === undefined ? '' : '|' + [...leader].map((c) => c.codePointAt(0)).join('.');

        if (alignment !== 'decimal') {
          if (character !== undefined)
            throw Error('Only decimal-aligned tabs have an alignment character.');
          return position + ':' + alignment + suffix;
        }
        if (
          typeof character !== 'string' ||
          character.length > 2 ||
          [...character].length !== 1 ||
          /[\p{C}\p{Z}]/u.test(character)
        )
          throw Error('Choose one visible alignment character.');
        return position + ':decimal:' + character.codePointAt(0) + suffix;
      })
      .join(',') || 'normal'
  );
}

export function tabStopSettings(value) {
  if (value === undefined || value === 'normal') return [];
  if (typeof value !== 'string' || value.length > 8192) throw Error('Invalid paragraph tab stops.');
  const stops = value.split(',').map((entry) => {
    const [stop, leader] = entry.split('|');
    const [position, alignment, scalar] = stop.split(':');
    return {
      position: Number(position),
      alignment,
      ...(leader === undefined
        ? {}
        : { leader: String.fromCodePoint(...leader.split('.').map(Number)) }),
      ...(scalar === undefined ? {} : { character: String.fromCodePoint(Number(scalar)) }),
    };
  });
  if (tabStopsValue(stops) !== value) throw Error('Invalid paragraph tab stops.');
  return stops;
}
