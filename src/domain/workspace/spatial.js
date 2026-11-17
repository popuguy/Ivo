/** Normalized leaf bounds follow the split tree, independent of document/page geometry. */
export function paneRects(layout, rect = { x: 0, y: 0, w: 1, h: 1 }, result = new Map()) {
  if (layout.type === 'group') {
    result.set(layout.id, rect);
    return result;
  }
  const ratio = Math.max(0.1, Math.min(0.9, layout.ratio)),
    row = layout.axis === 'row';
  paneRects(
    layout.first,
    { ...rect, w: row ? rect.w * ratio : rect.w, h: row ? rect.h : rect.h * ratio },
    result,
  );
  paneRects(
    layout.second,
    {
      x: row ? rect.x + rect.w * ratio : rect.x,
      y: row ? rect.y : rect.y + rect.h * ratio,
      w: row ? rect.w * (1 - ratio) : rect.w,
      h: row ? rect.h : rect.h * (1 - ratio),
    },
    result,
  );
  return result;
}
export function adjacentPane(workspace, currentId, direction) {
  const rects = paneRects(workspace.layout),
    current = rects.get(currentId);
  if (!current || !['left', 'right', 'up', 'down'].includes(direction)) return null;
  const horizontal = ['left', 'right'].includes(direction),
    sign = ['left', 'up'].includes(direction) ? -1 : 1;
  const cx = current.x + current.w / 2,
    cy = current.y + current.h / 2;
  const ranked = [];
  for (const [id, rect] of rects) {
    if (id === currentId) continue;
    const dx = rect.x + rect.w / 2 - cx,
      dy = rect.y + rect.h / 2 - cy,
      forward = (horizontal ? dx : dy) * sign;
    if (forward <= 1e-8) continue;
    const overlap = horizontal
      ? Math.min(current.y + current.h, rect.y + rect.h) - Math.max(current.y, rect.y)
      : Math.min(current.x + current.w, rect.x + rect.w) - Math.max(current.x, rect.x);
    ranked.push({
      id,
      score: (overlap > 1e-8 ? 0 : 100) + forward + Math.abs(horizontal ? dy : dx) * 0.25,
    });
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked[0]?.id || null;
}
