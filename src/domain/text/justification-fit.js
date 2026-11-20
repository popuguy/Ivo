/** Width at a point in the paragraph's word/letter/glyph adjustment ranges.
 * The letter basis is a sum of the real space advance for each eligible
 * adjacent pair of shaped clusters. A scale applies to the finished line.
 */
export function justificationWidth(natural, spaces, letters, word, letter, glyph) {
  return Math.max(
    0,
    ((natural + (spaces * (word - 100)) / 100 + (letters * letter) / 100) * glyph) / 100,
  );
}

export function fitJustification(row, area, alignment, last, policy) {
  const measured = row.wordSpacing;
  const spaces = measured.nominalSpaceWidth,
    letters = measured.letterBasis;
  const desired = measured.desiredWidth;
  const justified = alignment.startsWith('justify');
  const full = justified && (!last || alignment === 'justify-all');
  const condense = justified && !full && desired > area;
  if (
    area + 0.000001 <
    (full ? measured.physicalMinimum : condense ? measured.minimumWidth : desired)
  )
    return null;
  const target = full || condense ? area : desired;
  const stretch = target >= desired;
  const edge = stretch ? 'Maximum' : 'Minimum';
  let word = policy.desired,
    letter = policy.letterDesired,
    glyph = policy.glyphDesired;
  let ratio = 0;
  if (Math.abs(target - desired) > 0.000001) {
    // First consume the available word-space adjustment in points. Remaining
    // room is divided between the letter and glyph ranges. Keeping the chosen
    // space adjustment in points avoids enlarging it a second time when the
    // glyphs are widened. The reference control sweep distinguishes these regimes.
    const wordBound = policy[stretch ? 'maximum' : 'minimum'];
    const wordRoom = (spaces * (wordBound - word) * glyph) / 10000;
    const appliedWord = stretch
      ? Math.min(target - desired, wordRoom)
      : Math.max(target - desired, wordRoom);
    const remaining = target - desired - appliedWord;
    const letterRoom = (letters * (policy['letter' + edge] - letter) * glyph) / 10000;
    const glyphRoom = (row.width * (policy['glyph' + edge] - glyph)) / 100;
    const combined = letterRoom + glyphRoom;
    const fraction = combined === 0 ? 0 : Math.min(1, Math.max(0, remaining / combined));
    const wordAddition = (spaces * (word - 100) * glyph) / 10000 + appliedWord;
    const letterAddition = (letters * letter * glyph) / 10000 + fraction * letterRoom;
    glyph += fraction * (policy['glyph' + edge] - glyph);
    if (spaces) word = 100 + (wordAddition * 10000) / (spaces * glyph);
    if (letters) letter = Math.max(-100, (letterAddition * 10000) / (letters * glyph));
    const delta = target - desired;
    const bound = stretch ? measured.maximumWidth : measured.minimumWidth;
    ratio = Math.abs(delta) / Math.max(0.000001, Math.abs(bound - desired));
    const residual = target - justificationWidth(row.width, spaces, letters, word, letter, glyph);
    if (Math.abs(residual) > 0.000001) {
      if (spaces > 0) word += (residual * 10000) / (spaces * glyph);
      else if (full && stretch && letters > 0) letter += (residual * 10000) / (letters * glyph);
      else if (!stretch) return null;
      ratio += 1 + Math.abs(residual) / Math.max(1, Math.abs(bound - desired), spaces);
    }
  }
  const visibleWidth = justificationWidth(row.width, spaces, letters, word, letter, glyph);
  if (word < -0.00001 || visibleWidth > area + 0.000001) return null;
  return {
    fitsMinimum: area + 0.000001 >= measured.minimumWidth,
    percentage: Math.max(0, word),
    letterPercentage: letter,
    glyphPercentage: glyph,
    eligibleGaps: measured.eligibleGaps,
    nominalSpaceWidth: spaces,
    justified: full || condense,
    fallback: null,
    ratio,
    visibleWidth,
    scoreWidth: visibleWidth,
    badness: full || condense ? Math.min(10000, 100 * ratio ** 3) : null,
    diagnostic:
      ratio > 1
        ? {
            kind: 'justification-outside-preferences',
            amount: Math.abs(target - (stretch ? measured.maximumWidth : measured.minimumWidth)),
            percentage: word,
          }
        : null,
  };
}
