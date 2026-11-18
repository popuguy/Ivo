export const FIRST_BASELINES = Object.freeze([
  'ascent',
  'cap-height',
  'x-height',
  'leading',
  'fixed',
]);

/** All values are unscaled text-space points. Font and line metrics are supplied by the renderer. */
export function firstBaselineOffset(policy, minimum, metrics) {
  if (!FIRST_BASELINES.includes(policy)) throw new TypeError('Unsupported first-baseline policy.');
  if (!Number.isFinite(minimum) || minimum < 0)
    throw new TypeError('Invalid minimum first baseline.');
  const metric = policy === 'fixed' ? 0 : metrics[policy];
  if (!Number.isFinite(metric) || metric < 0)
    throw new TypeError('The first-line font metrics are unavailable.');
  return Math.max(minimum, metric);
}

/** Alignment is derived geometry, never a rewrite of source leading or paragraph spacing. */
export function frameCompositionOffset({
  policy,
  minimum = 0,
  metrics,
  naturalBaseline,
  contentHeight,
  availableHeight,
  verticalAlign = 'top',
}) {
  const baseline = policy ? firstBaselineOffset(policy, minimum, metrics) : naturalBaseline;
  const baselineShift = baseline - naturalBaseline;
  const spare = Math.max(0, availableHeight - baselineShift - contentHeight);
  const alignmentShift =
    spare * (verticalAlign === 'center' ? 0.5 : verticalAlign === 'bottom' ? 1 : 0);
  return {
    baseline,
    baselineShift,
    alignmentShift,
    top: baselineShift + alignmentShift,
    height: Math.max(1, availableHeight - baselineShift - alignmentShift),
  };
}
