export function referencePoint(rect, index = 0) {
  const x = (index % 3) / 2,
    y = Math.floor(index / 3) / 2;
  return { x: rect.x + rect.w * x, y: rect.y + rect.h * y };
}
/** Numeric transforms keep the selected reference stationary, without rounding point geometry. */
export function editReferenceRect(rect, key, value, index = 0) {
  const point = referencePoint(rect, index),
    next = { ...rect },
    x = (index % 3) / 2,
    y = Math.floor(index / 3) / 2;
  if (key === 'w' || key === 'h') {
    next[key] = value;
    next.x = point.x - next.w * x;
    next.y = point.y - next.h * y;
  } else if (key === 'x') next.x = value - next.w * x;
  else if (key === 'y') next.y = value - next.h * y;
  return next;
}
