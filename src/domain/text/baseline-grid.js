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

export const FRAME_GRID_ORIGINS = Object.freeze({
  inset: 'Top Inset',
  frame: 'Top of Frame',
  page: 'Top of Page',
});
export const FRAME_GRID_DEFAULTS = Object.freeze({ relativeTo: 'inset', start: 0, increment: 12 });

export function frameGridSettings(value) {
  if (!value || !Object.hasOwn(FRAME_GRID_ORIGINS, value.relativeTo))
    throw Error('Choose a frame grid origin.');
  const { relativeTo, ...spacing } = value;
  return { ...baselineGridSettings(spacing), relativeTo };
}

/** Convert an authored grid in page points to coordinates inside this frame's text inset. */
export function gridInsideFrame(frame, byId, documentGrid = BASELINE_GRID_DEFAULTS) {
  const custom = frame.frameOptions?.baselineGrid;
  const grid = custom || documentGrid;
  const inset = frame.frameOptions?.insetTop || 0;
  const scale = frame.textScale?.y ?? 1;
  let offset = 0;
  if (custom?.relativeTo !== 'inset') offset = inset;
  if (!custom || custom.relativeTo === 'page') {
    const visited = new Set();
    for (let owner = frame; owner; owner = byId.get(owner.parentId)) {
      if (visited.has(owner.id)) throw Error('Baseline grid frame has a circular group ancestry.');
      visited.add(owner.id);
      if (owner.rotation) return null;
      offset += owner.y || 0;
    }
  }
  return { start: (grid.start - offset) / scale, increment: grid.increment / scale };
}
