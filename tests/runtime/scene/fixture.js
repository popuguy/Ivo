import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import {
  createSceneDocument,
  insertObject,
  worldRect,
} from '../../../src/domain/documents/scene.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { referenceArt } from '../../../src/shared/ui/reference-art-data.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const next = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = async () => {
  for (let i = 0; i < 30; i++) await next();
};
try {
  await document.fonts.ready;
  const doc = createSceneDocument('Scene test'),
    first = doc.pages[0],
    mask = insertObject(doc, 'polygon', first.id, { x: 72, y: 100, w: 240, h: 180 }),
    child = insertObject(doc, 'text', first.id, {
      parentId: mask.id,
      x: 10,
      y: 20,
      w: 200,
      h: 100,
      html: '<p><strong>Retained</strong> text [[Other]]</p>',
      textStyle: 'cmu-serif',
    });
  const timeline = createDocumentHistory();
  let commits = 0,
    changes = 0,
    assetCount = 0;
  const errors = [];
  const host = document.querySelector('#host'),
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing: true,
      source: (s) => s,
      onCommit: (before, metadata) => {
        commits++;
        timeline.record(before, doc, metadata);
      },
      onUndo: () => {
        const result = timeline.undo(doc);
        if (result) {
          Object.assign(doc, result.document);
          editor.restoreView(result.view);
        }
      },
      onRedo: () => {
        const result = timeline.redo(doc);
        if (result) {
          Object.assign(doc, result.document);
          editor.restoreView(result.view);
        }
      },
      onChange: () => changes++,
      onAsset: async () => assetCount++,
      onNotify: (message) => errors.push(message),
    });
  await next();
  const viewport = host.querySelector('.canvas-viewport');
  // Component events use the real rendering/event paths; native pointer capture is checked separately.
  viewport.setPointerCapture = () => {};
  viewport.releasePointerCapture = () => {};
  const pointer = (type, target, x, y, extra = {}) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  const drag = (target, dx, dy) => {
    const r = target.getBoundingClientRect(),
      x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    pointer('pointerdown', target, x, y);
    pointer('pointermove', viewport, x + dx, y + dy);
    pointer('pointerup', viewport, x + dx, y + dy);
  };
  const click = (target) => {
    const r = target.getBoundingClientRect();
    pointer('pointerdown', target, r.x + 4, r.y + 4);
    pointer('pointerup', viewport, r.x + 4, r.y + 4);
  };
  const maskElement = () => host.querySelector(`[data-object="${mask.id}"]`);
  click(maskElement());
  assert(host.querySelectorAll('.canvas-resize').length === 8, 'Eight object handles missing');
  for (const [direction, name] of [
    ['n', 'resize-vertical'],
    ['s', 'resize-vertical'],
    ['e', 'resize-horizontal'],
    ['w', 'resize-horizontal'],
    ['nw', 'resize-tlbr'],
    ['se', 'resize-tlbr'],
    ['ne', 'resize-trbl'],
    ['sw', 'resize-trbl'],
  ])
    if (referenceArt.cursors[name])
      assert(
        getComputedStyle(host.querySelector(`[data-resize="${direction}"]`)).cursor.includes(
          referenceArt.cursors[name].url,
        ),
        'Wrong resize cursor ' + direction,
      );
  const z = editor.getState().camera.zoom,
    oldX = mask.x;
  drag(maskElement(), 20, 10);
  assert(Math.abs(mask.x - oldX - 20 / z) < 1e-8, 'Drag did not invert viewport coordinates');
  assert(commits === 1, 'Drag must make one history entry');
  const w = mask.w;
  drag(host.querySelector('[data-resize="e"]'), 30, 0);
  assert(Math.abs(mask.w - w - 30 / z) < 1e-8, 'Side resize was not applied');
  assert(commits === 2, 'Resize history missing');
  await editor.command('tool-direct');
  assert(host.querySelectorAll('.canvas-vertex').length === 4, 'Polygon points missing');
  const before = worldRect(doc, child),
    other = { x: mask.x + mask.points[2].x * mask.w, y: mask.y + mask.points[2].y * mask.h };
  drag(host.querySelector('.canvas-vertex'), -17, -11);
  assert(
    JSON.stringify(worldRect(doc, child)) === JSON.stringify(before),
    'Point edit displaced clipped content',
  );
  assert(
    Math.abs(mask.x + mask.points[2].x * mask.w - other.x) < 1e-8,
    'Point edit moved another vertex',
  );
  await editor.command('inside');
  const data =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGN49vorVmSUsgUrYhjVQBMNuCRwGTSqgSYaACk0CB+bcN8GAAAAAElFTkSuQmCC';
  const clipboard = new DataTransfer();
  clipboard.items.add(
    new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'test.png', {
      type: 'image/png',
    }),
  );
  document.body.dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
  );
  await editor.flush();
  assert(
    assetCount === 1 && doc.blocks.at(-1).parentId === mask.id,
    'Workspace-level paste did not insert inside mask',
  );
  // Source data belongs to the asset backend, outside the scene payload.
  doc.blocks.at(-1).src = '';
  const geometry = JSON.stringify(doc.blocks);
  await editor.command('zoom-in');
  await wait();
  assert(editor.getState().camera.zoom > z, 'Page camera did not zoom');
  assert(JSON.stringify(doc.blocks) === geometry, 'Zoom mutated document geometry');
  await editor.command('add-page');
  assert(doc.pages.length === 2, 'New page missing');
  assert(
    doc.pages[1].width === first.width && doc.pages[1].height === first.height,
    'Page did not inherit preceding dimensions',
  );
  const input = host.querySelector('[data-page-prop="width"]');
  input.value = '800.25';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  assert(doc.pages[1].width === 800.25, 'Independent page width not retained');
  await editor.command('fit-all');
  await wait();
  assert(host.querySelectorAll('.canvas-page').length === 2, 'Both pages not rendered');
  // Text fitting measures content rather than the existing area-frame height.
  await editor.command('tool-text');
  const textElement = host.querySelector(`[data-scene-text="${child.id}"]`);
  click(textElement);
  const oldHeight = child.h,
    sourceHTML = child.html;
  await editor.command('fit-text');
  assert(
    child.h < oldHeight,
    `Fit text did not shrink the frame: ${JSON.stringify({ before: oldHeight, after: child.h, selected: editor.getState().selected, childId: child.id, live: doc.blocks.find((b) => b.id === child.id)?.h, element: host.querySelector(`[data-scene-text="${child.id}"]`)?.getBoundingClientRect().height, camera: editor.getState().camera })}`,
  );
  const active = host.querySelector(`[data-scene-text="${child.id}"]`);
  active.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await next();
  const circle = host.querySelector('[data-type-circle]');
  const areaCursor = getComputedStyle(circle).cursor;
  if (referenceArt.cursors['convert-to-point'])
    assert(
      areaCursor.includes(referenceArt.cursors['convert-to-point'].url),
      'Area type switch has the wrong cursor',
    );
  circle.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  assert(child.textKind === 'point', 'Keyboard type conversion failed');
  assert(child.html.replace(/<br>/g, '') === sourceHTML, 'Type conversion lost source formatting');
  await next();
  const pointCircle = host.querySelector('[data-type-circle]');
  if (referenceArt.cursors['convert-to-area'])
    assert(
      getComputedStyle(pointCircle).cursor.includes(referenceArt.cursors['convert-to-area'].url),
      'Point type switch has the wrong cursor',
    );
  for (const image of host.querySelectorAll('.reference-icon')) await image.decode();
  assert(
    [...host.querySelectorAll('.reference-icon')].every((image) =>
      ['Illustrator', 'Obsidian/Lucide'].includes(image.dataset.iconSource),
    ),
    'Unsourced interface icon',
  );
  await editor.command('tool-polygon');
  const pageElement = host.querySelectorAll('.canvas-page')[1],
    bounds = pageElement.getBoundingClientRect();
  for (const [x, y] of [
    [0.1, 0.1],
    [0.4, 0.15],
    [0.25, 0.4],
  ]) {
    pointer(
      'pointerdown',
      pageElement,
      bounds.left + bounds.width * x,
      bounds.top + bounds.height * y,
    );
    pointer('pointerup', viewport, bounds.left + bounds.width * x, bounds.top + bounds.height * y);
  }
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  assert(
    doc.blocks.at(-1).type === 'polygon' && doc.blocks.at(-1).points.length === 3,
    'Polygon tool did not finish a three-point path',
  );
  // A cross-page drop keeps the mask and every descendant together in world space.
  await editor.command('tool-select');
  await editor.command('fit-all');
  await next();
  const snap = host.querySelector('[data-canvas-snap]');
  snap.checked = false;
  snap.dispatchEvent(new Event('change', { bubbles: true }));
  const maskSource = child.html,
    maskY = mask.y,
    sourcePage = doc.pages[0].id,
    destination = doc.pages[1].id,
    offset = doc.pages[0].height + 64,
    dropZoom = editor.getState().camera.zoom;
  drag(maskElement(), 0, offset * dropZoom);
  assert(
    mask.pageId === destination && child.pageId === destination,
    'Cross-page drop did not transfer clipping subtree',
  );
  assert(
    Math.abs(mask.y - maskY) < 0.001,
    `Drop changed page-local placement after one-page translation: ${mask.y} vs ${maskY}`,
  );
  assert(child.html === maskSource, 'Cross-page transfer changed rich text');
  assert(
    maskElement().closest('[data-page]').dataset.page === destination,
    'Transferred object DOM remained under old page',
  );
  host.querySelector('[data-canvas-panel="properties"]').click();
  const assign = host.querySelector('[data-selection-page]');
  assign.value = sourcePage;
  assign.dispatchEvent(new Event('change', { bubbles: true }));
  assert(
    mask.pageId === sourcePage && child.pageId === sourcePage,
    'Explicit page assignment did not transfer subtree',
  );
  const pageTab = host.querySelector('[data-canvas-panel="pages"]');
  pageTab.click();
  const order = host.querySelector('[data-page-order]');
  order.value = '2';
  order.dispatchEvent(new Event('change', { bubbles: true }));
  assert(doc.pages[1].id === sourcePage, 'Page order control did not reorder pages');
  assert(
    mask.pageId === sourcePage && child.pageId === sourcePage,
    'Reordering broke page references',
  );
  await editor.command('undo');
  assert(doc.pages[0].id === sourcePage, 'Reorder did not share document undo');
  await editor.command('undo');
  assert(
    doc.blocks.find((item) => item.id === mask.id).pageId === destination,
    'Page assignment undo did not restore destination',
  );
  await editor.command('undo');
  assert(
    doc.blocks.find((item) => item.id === mask.id).pageId === sourcePage &&
      doc.blocks.find((item) => item.id === child.id).html === maskSource,
    'Pointer transfer undo lost source page or rich text',
  );
  await editor.command('redo');
  await editor.command('redo');
  await editor.command('redo');
  assert(
    doc.pages[1].id === sourcePage &&
      doc.blocks.find((item) => item.id === mask.id).pageId === sourcePage,
    'Page sequence redo did not restore result',
  );
  validateImport({ schemaVersion: 2, documents: [doc], assets: [] });
  assert(!errors.length, errors.join('; '));
  await editor.flush();
  editor.destroy();
  console.log(
    'IVO_SCENE_RESULT:' +
      JSON.stringify({
        ok: true,
        commits,
        changes,
        eightHandles: true,
        zoomDoesNotMutateGeometry: true,
        vertexPreservesContent: true,
        mixedSizePages: true,
        pageTransfer: true,
        pageReorder: true,
      }),
  );
} catch (error) {
  console.log('IVO_SCENE_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
