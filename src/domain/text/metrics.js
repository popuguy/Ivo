/** Renderer-side text layout. The document keeps original rich HTML and glyph scales. */
export function textScale(block) {
  return { x: block.textScale?.x ?? 1, y: block.textScale?.y ?? 1 };
}

/** Normalize vertical point scaling into font size, as measured in the native fixture. */
export function scaledPointType(block, widthRatio, heightRatio, { min = 10, max = 120 } = {}) {
  const original = textScale(block),
    size = block.fontSize || 16;
  const fontSize = Math.max(min, Math.min(max, size * heightRatio));
  const fontRatio = fontSize / size;
  return {
    fontSize,
    textScale: {
      x: Math.max(0.01, Math.min(100, (original.x * widthRatio) / fontRatio)),
      y: Math.max(0.01, Math.min(100, (original.y * heightRatio) / fontRatio)),
    },
  };
}
