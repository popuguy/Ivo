/**
 * Keep document layout at its authored scale and transform its paint coordinates.
 * A plain, script-updated 2D transform lets Chromium raster at the current scale
 * without CSS zoom re-shaping/re-wrapping text. Do not promote this to a fixed
 * raster with will-change or a 3D transform: live zoom must remain sharp.
 */
const views = new WeakMap();
export function applyPageCamera(world, camera) {
  const { x, y, zoom } = camera;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0)
    throw new TypeError('A finite positive page camera is required.');
  let previous = views.get(world);
  if (!previous) {
    world.style.transformOrigin = '0 0';
    world.style.left = '0px';
    world.style.top = '0px';
    world.style.willChange = 'auto';
    world.style.zoom = '1';
    previous = {};
    views.set(world, previous);
  }
  if (previous.x !== x || previous.y !== y || previous.zoom !== zoom) {
    world.style.transform = `matrix(${zoom},0,0,${zoom},${x},${y})`;
    previous.x = x;
    previous.y = y;
    previous.zoom = zoom;
  }
}
