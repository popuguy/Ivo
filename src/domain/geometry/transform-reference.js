export function referencePoint(rect, index = 0) {
  const x = (index % 3) / 2,
    y = Math.floor(index / 3) / 2;
  return { x: rect.x + rect.w * x, y: rect.y + rect.h * y };
}
/** Numeric transforms keep the selected reference stationary, without rounding point geometry. */
export function editReferenceRect(rect, key, value, index = 0, constrain = false) {
  const point = referencePoint(rect, index),
    next = { ...rect },
    x = (index % 3) / 2,
    y = Math.floor(index / 3) / 2;
  if (key === 'w' || key === 'h') {
    if (constrain && rect.w > 0 && rect.h > 0) {
      const scale = Math.max(
        0.01 / Math.min(rect.w, rect.h),
        Math.min(value / rect[key], 100000 / Math.max(rect.w, rect.h)),
      );
      next.w = rect.w * scale;
      next.h = rect.h * scale;
    } else next[key] = value;
    next.x = point.x - next.w * x;
    next.y = point.y - next.h * y;
  } else if (key === 'x') next.x = value - next.w * x;
  else if (key === 'y') next.y = value - next.h * y;
  return next;
}
