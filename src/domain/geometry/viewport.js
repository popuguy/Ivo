/** Pure camera math. One affine viewport maps page/world points to CSS screen points. */
export const MIN_ZOOM = 0.0001,
  MAX_ZOOM = 8;
export function screenToWorld(point, camera) {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
export function worldToScreen(point, camera) {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}
export function zoomAt(camera, screen, zoom) {
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const world = screenToWorld(screen, camera);
  return { zoom, x: screen.x - world.x * zoom, y: screen.y - world.y * zoom };
}
export function fitCamera(rect, size, padding = 48) {
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(2, (size.width - padding * 2) / rect.w, (size.height - padding * 2) / rect.h),
  );
  return {
    zoom,
    x: (size.width - rect.w * zoom) / 2 - rect.x * zoom,
    y: (size.height - rect.h * zoom) / 2 - rect.y * zoom,
  };
}
export function easeCamera(current, target, elapsed, reducedMotion = false) {
  const amount = reducedMotion ? 1 : 1 - Math.exp(-Math.min(elapsed, 64) / 55);
  const next = {};
  for (const key of ['x', 'y', 'zoom'])
    next[key] =
      Math.abs(target[key] - current[key]) < 0.0001
        ? target[key]
        : current[key] + (target[key] - current[key]) * amount;
  return next;
}

/** WheelEvent units are explicit. Trackpad pixels pass through without quantization or inertia. */
export function wheelDelta(event, size, lineHeight = 16) {
  const mode = event.deltaMode || 0;
  return {
    x: event.deltaX * (mode === 1 ? lineHeight : mode === 2 ? size.width : 1),
    y: event.deltaY * (mode === 1 ? lineHeight : mode === 2 ? size.height : 1),
  };
}
export function panBy(camera, delta) {
  return { ...camera, x: camera.x - delta.x, y: camera.y - delta.y };
}

/** Chromium's macOS pinch bridge exposes DOM deltaY = -100 * log(native scale). */
export function pinchWheelScale(deltaY) {
  return Math.exp(-deltaY / 100);
}
