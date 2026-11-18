import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { verifyTextZoom } from './text-zoom.js';
const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
try {
  await document.fonts.ready;
  const doc = createSceneDocument('Viewport response');
  addPage(doc, doc.pages[0].id);
  for (let i = 0; i < 500; i++)
    insertObject(doc, i % 5 ? 'polygon' : 'text', doc.pages[i % 2].id, {
      x: 24 + (i % 12) * 42,
      y: 24 + (Math.floor(i / 12) % 26) * 24,
      w: 36,
      h: 20,
      html: '<p>Type</p>',
      fontSize: 9,
    });
  const host = document.querySelector('#host'),
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing: true,
      source: (s) => s,
      onCommit: () => {},
      onChange: () => {},
      onAsset: async () => {},
      onNotify: () => {},
    });
  // This fixture mounts into an empty host; its interface font was not used by
  // the earlier ready promise. Benchmark camera work after the mounted font settles.
  await document.fonts.ready;
  await next();
  const viewport = host.querySelector('.canvas-viewport');
  viewport.setPointerCapture = () => {};
  viewport.releasePointerCapture = () => {};
  const selected = host.querySelector('.object-text'),
    bounds = selected.getBoundingClientRect(),
    point = { clientX: bounds.x + 5, clientY: bounds.y + 5 };
  selected.dispatchEvent(
    new PointerEvent('pointerdown', { ...point, bubbles: true, button: 0, pointerId: 1 }),
  );
  viewport.dispatchEvent(
    new PointerEvent('pointerup', { ...point, bubbles: true, button: 0, pointerId: 1 }),
  );
  await next();
  await next();
  let insertedNodes = 0,
    overflowReads = 0;
  const mutations = new MutationObserver((records) => {
    for (const r of records) insertedNodes += r.addedNodes.length;
  });
  mutations.observe(host.querySelector('.canvas-selection'), { childList: true, subtree: true });
  const text = host.querySelector('[data-scene-text]');
  for (const name of ['scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth']) {
    const getter = Object.getOwnPropertyDescriptor(Element.prototype, name)?.get;
    if (getter)
      Object.defineProperty(text, name, {
        configurable: true,
        get() {
          overflowReads++;
          return getter.call(this);
        },
      });
  }
  const before = JSON.stringify(doc),
    times = [],
    lags = [],
    frameTimes = [];
  let previous = performance.now();
  for (let i = 0; i < 60; i++) {
    await next();
    const now = performance.now();
    frameTimes.push(now - previous);
    previous = now;
    const t = performance.now();
    viewport.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: 3.25,
        deltaY: 7.5,
        clientX: 600,
        clientY: 400,
      }),
    );
    times.push(performance.now() - t);
    const { camera, target } = editor.getState();
    lags.push(Math.hypot(camera.x - target.x, camera.y - target.y));
  }
  await next();
  const pan = {
    maxInputLag: Math.max(...lags),
    eventMsP95: percentile(times, 0.95),
    insertedOverlayNodes: insertedNodes,
    overflowLayoutReads: overflowReads,
  };
  const zoomBefore = editor.getState().camera;
  viewport.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -20,
      ctrlKey: true,
      clientX: 600,
      clientY: 400,
    }),
  );
  const zoomAfter = editor.getState();
  const viewBounds = viewport.getBoundingClientRect(),
    anchor = { x: 600 - viewBounds.x, y: 400 - viewBounds.y };
  const oldAnchor = {
    x: (anchor.x - zoomBefore.x) / zoomBefore.zoom,
    y: (anchor.y - zoomBefore.y) / zoomBefore.zoom,
  };
  const newAnchor = {
    x: (anchor.x - zoomAfter.camera.x) / zoomAfter.camera.zoom,
    y: (anchor.y - zoomAfter.camera.y) / zoomAfter.camera.zoom,
  };
  if (Math.hypot(oldAnchor.x - newAnchor.x, oldAnchor.y - newAnchor.y) > 1e-9)
    throw new Error('Pinch-wheel zoom moved its focal point');
  const result = {
    ok: true,
    objects: doc.blocks.length,
    pan,
    zoom: {
      immediate: Math.abs(zoomAfter.camera.zoom - zoomAfter.target.zoom) < 1e-12,
      changed: zoomAfter.camera.zoom !== zoomBefore.zoom,
    },
    geometryUnchanged: JSON.stringify(doc) === before,
    frameMsP95: percentile(frameTimes.slice(1), 0.95),
  };
  if (pan.maxInputLag > 1e-9 || !result.zoom.immediate || !result.zoom.changed)
    throw new Error('Camera must follow wheel input without an easing queue');
  if (pan.insertedOverlayNodes || pan.overflowLayoutReads)
    throw new Error('Camera movement rebuilt controls or forced text overflow measurement');
  if (!result.geometryUnchanged) throw new Error('Camera movement changed stored object geometry');
  // The selected frame survives both pan and zoom, then reports its true geometry on the next frame.
  const handle = host.querySelector('[data-resize="nw"]');
  await next();
  if (handle !== host.querySelector('[data-resize="nw"]'))
    throw new Error('Zoom replaced a resize handle');
  const element = host.querySelector(`[data-object="${doc.blocks[0].id}"]`).getBoundingClientRect(),
    frame = host.querySelector('.canvas-object-frame').getBoundingClientRect();
  if (
    Math.abs(element.x - frame.x) > 0.1 ||
    Math.abs(element.y - frame.y) > 0.1 ||
    Math.abs(element.width - frame.width) > 0.1
  )
    throw new Error('Screen overlay diverged from its object');
  const touch = (type, id, x, y) =>
    viewport.dispatchEvent(
      new PointerEvent(type, {
        pointerType: 'touch',
        pointerId: id,
        button: 0,
        clientX: viewBounds.x + x,
        clientY: viewBounds.y + y,
        bubbles: true,
        cancelable: true,
      }),
    );
  const pinchBefore = editor.getState().camera;
  touch('pointerdown', 11, 300, 300);
  touch('pointerdown', 12, 400, 300);
  touch('pointermove', 12, 430, 320);
  const pinchState = editor.getState();
  result.pinch = {
    immediate: JSON.stringify(pinchState.camera) === JSON.stringify(pinchState.target),
    changed: pinchState.camera.zoom !== pinchBefore.zoom,
  };
  if (!result.pinch.immediate || !result.pinch.changed)
    throw new Error('Two-touch camera did not follow its input immediately');
  touch('pointerup', 12, 430, 320);
  touch('pointerup', 11, 300, 300);
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
  );
  window.dispatchEvent(new Event('blur'));
  if (
    viewport.classList.contains('space-pan') ||
    host.querySelector('.scene-editor').dataset.gesture
  )
    throw new Error('Pan cursor remained active after focus loss');
  mutations.disconnect();
  editor.destroy();
  result.textZoom = await verifyTextZoom(host);
  console.log('IVO_VIEWPORT_RESULT:' + JSON.stringify(result));
} catch (error) {
  console.log('IVO_VIEWPORT_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
