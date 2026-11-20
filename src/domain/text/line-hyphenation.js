import { HYPHENATION_DEFAULTS, validHyphenationAttribute } from './hyphenation.js';

export function lineHyphenationOptions({
  hyphenLimit = HYPHENATION_DEFAULTS.hyphenLimit,
  hyphenZone = HYPHENATION_DEFAULTS.hyphenZone,
} = {}) {
  if (
    typeof hyphenLimit !== 'number' ||
    validHyphenationAttribute('hyplimit', hyphenLimit) === null ||
    typeof hyphenZone !== 'number' ||
    validHyphenationAttribute('hypzone', hyphenZone) === null
  )
    throw Error('Invalid paragraph hyphenation limit or zone.');
  return { hyphenLimit, hyphenZone };
}

export function retainedHyphenCount(lines, endings, limit) {
  let count = 0;
  for (let i = lines.length - 1; i >= 0 && count < limit;) {
    if (!endings.has(lines[i].end)) break;
    count++;
    while (i > 0 && lines[i].continuesRow) i--;
    i--;
  }
  return count;
}

const identity = (line) => line;
export function lineHyphenation(opportunities, options, mode, align) {
  const { hyphenLimit, hyphenZone } = lineHyphenationOptions(options);
  const automatic = new Set(opportunities.filter((p) => p.automatic).map((p) => p.index));
  const endings = new Set(
    opportunities.filter((p) => p.automatic || p.authoredHyphen).map((p) => p.index),
  );
  const useZone = mode === 'single-line' && !align.startsWith('justify');
  return {
    countAfter(count, end) {
      return automatic.size && endings.has(end) ? Math.min(hyphenLimit, count + 1) : 0;
    },
    candidates(available, priorCount, lineOf = identity) {
      if (!automatic.size) return available;
      // A very narrow column can have only hyphenated exits. Preserve forward progress.
      if (hyphenLimit && priorCount >= hyphenLimit) {
        const other = available.filter((choice) => !automatic.has(lineOf(choice).end));
        if (other.length) return other;
      }
      if (useZone && automatic.has(lineOf(available[0]).end)) {
        const intact = available.find((choice) => {
          const line = lineOf(choice);
          return (
            !automatic.has(line.end) &&
            line.width - (line.wordSpacing?.visibleWidth ?? line.naturalWidth) <= hyphenZone
          );
        });
        if (intact) return [intact];
      }
      return available;
    },
  };
}
