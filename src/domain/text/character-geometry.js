/** Signed ink metrics belong to transformed runs; positive struts own pagination.
 * A whole shifted run can lie above/below its baseline, so neither side clamps to zero. */
export function characterInkBox(line, run = line) {
  const advanced = run.inkAscent !== undefined || run.inkDescent !== undefined,
    ascent = advanced ? run.inkAscent : line.ascent,
    descent = advanced ? run.inkDescent : line.descent;
  if (![line.baseline, ascent, descent].every(Number.isFinite) || ascent + descent < 0)
    throw Error('Character ink geometry is invalid.');
  return {
    y: line.baseline - ascent,
    height: advanced ? ascent + descent : Math.max(1, ascent + descent),
  };
}

/** Underline metrics already include the native font matrix. xHeight is a strut
 * metric, so strike placement alone additionally applies vertical character scale. */
export function characterDecorationY(line, run, strike = false) {
  const shift = run.baselineShift ?? 0,
    position = strike
      ? ((run.xHeight || 0) * (run.verticalScale ?? 100)) / 200
      : run.underlinePosition;
  if (![line.baseline, shift, position].every(Number.isFinite))
    throw Error('Character decoration geometry is invalid.');
  return line.baseline - shift - position;
}
