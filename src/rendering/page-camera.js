/**
 * Paint document text/SVG at the current zoom, then translate the result.
 * CSS layout zoom changes font/vector rasterization scale. The compositor
 * transform only translates: it never enlarges a previously painted bitmap.
 * Document coordinates and editable DOM nodes remain unchanged.
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
    previous = {};
    views.set(world, previous);
  }
  if (previous.zoom !== zoom) {
    world.style.zoom = String(zoom);
    previous.zoom = zoom;
  }
  // CSS zoom also scales this element's translation units.
  if (previous.x !== x || previous.y !== y || previous.translationZoom !== zoom) {
    world.style.transform = `translate3d(${x / zoom}px,${y / zoom}px,0)`;
    previous.x = x;
    previous.y = y;
    previous.translationZoom = zoom;
  }
}
