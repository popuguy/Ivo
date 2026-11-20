// Renderer hit testing is in viewport CSS pixels. Native placement is in screen DIP.
export function palettePosition(point, grip, size, area) {
  const fit = (value, origin, available, length) =>
    Math.round(Math.max(origin, Math.min(value, origin + Math.max(0, available - length))));
  return {
    x: fit(point.x - grip.x, area.x, area.width, size.width),
    y: fit(point.y - grip.y, area.y, area.height, size.height),
  };
}

/** A held window can straddle a seam between displays. Clamping its full bounds
 * to the pointer's current display would jump by a window width at that seam. */
export function draggedPalettePosition(point, grip) {
  return { x: Math.round(point.x - grip.x), y: Math.round(point.y - grip.y) };
}

const contains = (box, x, y) =>
  box.width > 0 &&
  box.height > 0 &&
  x >= box.left &&
  x < box.right &&
  y >= box.top &&
  y < box.bottom;

/** Tab headers merge, thin ends stack, the empty right dock can be recreated.
 * Bounds are the actual visible workspace, including the shared rail in split view. */
export function panelDockTarget(x, y, workspace, groups) {
  if (!contains(workspace, x, y)) return null;
  for (const group of groups) {
    const { box, header, tabs, id, floating } = group;
    if (!contains(box, x, y)) continue;
    if (!floating && y < Math.min(box.top + 28, header.top + 4)) return { type: 'above', id };
    if (contains(header, x, y)) {
      const after = tabs.find((tab) => x < (tab.left + tab.right) / 2);
      return { type: 'tabs', id, before: after?.kind };
    }
    if (!floating) {
      if (box.bottom - y <= 28) return { type: 'below', id };
      if (box.right - x <= 28) return { type: 'edge' };
    }
    return null;
  }
  if (workspace.right - x <= 28) return { type: 'edge' };
  return null;
}
