/** Screen-space anchoring, with room for native-style menus near every canvas edge. */
export function placePopover(anchor, size, bounds, { gap = 2, inset = 4 } = {}) {
  const width = Math.min(size.w, Math.max(0, bounds.w - inset * 2)),
    below = Math.max(0, bounds.y + bounds.h - inset - anchor.y - anchor.h - gap),
    above = Math.max(0, anchor.y - bounds.y - inset - gap),
    side = below >= size.h || below >= above ? 'below' : 'above',
    height = Math.min(size.h, side === 'below' ? below : above),
    x = Math.max(bounds.x + inset, Math.min(bounds.x + bounds.w - width - inset, anchor.x)),
    y = side === 'below' ? anchor.y + anchor.h + gap : anchor.y - gap - height;
  return {
    x,
    y: Math.max(bounds.y + inset, Math.min(bounds.y + bounds.h - height - inset, y)),
    w: width,
    h: height,
    side,
  };
}
