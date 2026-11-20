export const BASELINE_GRID_DEFAULTS = Object.freeze({ start: 36, increment: 12 });
export const BASELINE_ALIGNMENT = Object.freeze(['none', 'all', 'first']);

export function baselineGridSettings(value = BASELINE_GRID_DEFAULTS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'start' && key !== 'increment') ||
    !Number.isFinite(value.start) ||
    value.start < 0 ||
    value.start > 14400 ||
    !Number.isFinite(value.increment) ||
    value.increment < 1 ||
    value.increment > 2000
  )
    throw Error(
      'Choose a baseline grid start from 0 to 14,400 pt and an increment from 1 to 2,000 pt.',
    );
  return { start: value.start, increment: value.increment };
}

// The first grid line is the document's start position on this page.
// No grid line exists at a negative index, even if the frame begins above it.
export function nextGridBaseline(baseline, grid) {
  const step = Math.max(0, Math.ceil((baseline - grid.start) / grid.increment - 1e-8));
  return grid.start + step * grid.increment;
}
