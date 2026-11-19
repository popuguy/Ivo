import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  textFlowForFrame,
} from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../../src/domain/history/document-history.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { referenceArt } from '../../../src/shared/ui/reference-art-data.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  near = (a, b) => Math.abs(a - b) < 1e-7,
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const host = document.querySelector('#host');
let editor, doc, viewport, history, commits;
async function mount(value) {
  editor?.setBusy(true);
  editor?.destroy();
  doc = value;
  history = createDocumentHistory();
  commits = 0;
  editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (s) => s,
    onCommit: (before, meta) => {
      commits++;
      history.record(before, doc, meta);
    },
    onChange: () => {},
    onUndo: () => step('undo'),
    onRedo: () => step('redo'),
    onAsset: async () => {
      throw Error('Duplication must reuse original assets');
    },
    onNotify: (message) => {
      throw Error(message);
    },
  });
  viewport = host.querySelector('.canvas-viewport');
  viewport.setPointerCapture = () => {};
  viewport.releasePointerCapture = () => {};
  if (editor.getState().snap) await editor.command('toggle-smart-guides');
  await tick();
}
function step(direction) {
  const result = history[direction](doc);
  if (result) {
    doc = result.document;
    editor.restoreView(result.view);
  }
}
const send = (type, target, x, y, extra = {}) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 5,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  );
function begin(id, mods = {}) {
  const el = host.querySelector(`[data-object="${id}"]`),
    r = el.getBoundingClientRect(),
    p = { x: r.x + 12, y: r.y + 12 };
  send('pointerdown', el, p.x, p.y, mods);
  return p;
}
function move(p, dx, dy, mods = {}) {
  const z = editor.getState().camera.zoom;
  send('pointermove', viewport, p.x + dx * z, p.y + dy * z, mods);
  return { x: p.x + dx * z, y: p.y + dy * z };
}
function up(p, mods = {}) {
  send('pointerup', viewport, p.x, p.y, mods);
}
function key(type, key, mods = {}) {
  viewport.dispatchEvent(
    new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...mods }),
  );
}
function basic() {
  const d = createSceneDocument('Duplicate'),
    p = d.pages[0];
  insertObject(d, 'polygon', p.id, { x: 80.125, y: 100.375, w: 100, h: 80 });
  return d;
}
try {
  await document.fonts.ready;
  await mount(basic());
  let a = doc.blocks[0],
    before = structuredClone(doc),
    p = begin(a.id, { altKey: true });
  assert(doc.blocks.length === 1, 'Option click created a copy before dragging');
  let end = move(p, 37.25, 19.125, { altKey: true }),
    copy = doc.blocks.find((b) => b.id !== a.id);
  assert(
    copy && near(copy.x, a.x + 37.25) && near(copy.y, a.y + 19.125),
    'Option drag did not create a fractional copy',
  );
  assert(
    documentContent({ ...doc, blocks: [a] }) === documentContent(before),
    'Copy preview modified original source',
  );
  const copyCursor = getComputedStyle(viewport).cursor,
    referenceCopyCursor = referenceArt.cursors['move-copy'];
  assert(
    referenceCopyCursor ? copyCursor.includes(referenceCopyCursor.url) : copyCursor === 'copy',
    'Copy cursor must use the installed reference or the public build’s native copy fallback',
  );
  up(end, { altKey: true });
  assert(commits === 1 && history.size === 1, 'Copy + move must be one history action');
  const copiedId = copy.id,
    after = documentContent(doc);
  await editor.command('undo');
  assert(
    doc.blocks.length === 1 && documentContent(doc) === documentContent(before),
    'Single undo did not restore the original',
  );
  await editor.command('redo');
  assert(
    documentContent(doc) === after && doc.blocks.some((b) => b.id === copiedId),
    'Redo did not restore the same duplicate IDs',
  );
  await mount(basic());
  a = doc.blocks[0];
  const original = structuredClone(a);
  p = begin(a.id);
  end = move(p, 43, 17);
  assert(doc.blocks.length === 1 && near(a.x, original.x + 43), 'Ordinary move failed');
  key('keydown', 'Alt', { altKey: true });
  assert(
    doc.blocks.length === 2 && near(a.x, original.x),
    'Late Option did not restore the original and copy',
  );
  key('keyup', 'Alt');
  assert(
    doc.blocks.length === 1 && near(a.x, original.x + 43),
    'Releasing Option without pointer movement did not revert to move',
  );
  key('keydown', 'Alt', { altKey: true });
  assert(
    doc.blocks.length === 2 && near(a.x, original.x),
    'Repeated Option made extra copies or moved original',
  );
  up(end, { altKey: true });
  assert(history.size === 1 && commits === 1, 'Modifier toggling leaked intermediate history');
  key('keyup', 'Alt');
  assert(doc.blocks.length === 2, 'Option release after mouse-up removed the completed copy');
  await mount(basic());
  a = doc.blocks[0];
  p = begin(a.id, { altKey: true });
  end = move(p, 25, 11, { altKey: true });
  up(end);
  assert(
    doc.blocks.length === 1 && near(doc.blocks[0].x, 105.125),
    'Final mouse-up modifiers were ignored',
  );
  await mount(basic());
  a = doc.blocks[0];
  p = begin(a.id, { altKey: true, shiftKey: true });
  end = move(p, 50, 7, { altKey: true, shiftKey: true });
  copy = doc.blocks.find((b) => b.id !== a.id);
  assert(
    copy && near(copy.y, a.y) && near(copy.x, a.x + 50),
    'Option + Shift at mouse-down deselected instead of constrained copy',
  );
  key('keyup', 'Shift', { altKey: true });
  assert(near(copy.y, a.y + 7), 'Shift release did not update stationary drag');
  up(end, { altKey: true });
  const masks = basic(),
    mask = masks.blocks[0],
    child = insertObject(masks, 'image', mask.pageId, {
      parentId: mask.id,
      x: 13.125,
      y: 8.375,
      w: 120,
      h: 90,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWsAAAAASUVORK5CYII=',
      fit: 'contain',
      crop: { x: 37, y: 63 },
    });
  await mount(masks);
  before = structuredClone(doc);
  p = begin(child.id, { altKey: true });
  end = move(p, 31, 24, { altKey: true });
  copy = doc.blocks.find((b) => b.id !== mask.id && b.type === 'polygon');
  const imageCopy = doc.blocks.find((b) => b.parentId === copy.id);
  assert(
    imageCopy.src === child.src && imageCopy.crop.x === 37 && imageCopy.x === child.x,
    'Mask copy changed original media or local position',
  );
  assert(
    copy.points.every((point, i) => point.id !== mask.points[i].id),
    'Mask copy reused vertex IDs',
  );
  send('pointercancel', viewport, end.x, end.y);
  assert(
    documentContent(doc) === documentContent(before) && commits === 0,
    'Pointer cancellation failed to restore complete mask source',
  );
  const textFlows = basic(),
    first = insertObject(textFlows, 'text', textFlows.pages[0].id, {
      x: 220,
      y: 100,
      w: 170,
      h: 140,
      html: '<p>Rich <strong>original textFlow</strong></p>',
    }),
    _textFlow = startTextFlow(textFlows, first.id, { automaticPages: false }),
    second = insertObject(textFlows, 'text', addPage(textFlows, textFlows.pages[0].id).id, {
      x: 220,
      y: 100,
      w: 170,
      h: 140,
    });
  threadFrame(textFlows, first.id, second.id);
  await mount(textFlows);
  await editor.command('select-all');
  before = structuredClone(doc);
  p = begin(first.id);
  end = move(p, 41, 20, { altKey: true });
  assert(
    doc.textFlows.length === 2 && doc.textFlows[1].frameIds.length === 2,
    'Selected textFlow frames copied as separate textFlows',
  );
  key('keydown', 'Escape');
  assert(
    documentContent(doc) === documentContent(before) && commits === 0,
    'Escape left duplicated textFlow/page data',
  );
  await editor.command('select-all');
  p = begin(first.id);
  end = move(p, 41, 20, { altKey: true });
  window.dispatchEvent(new Event('blur'));
  assert(
    documentContent(doc) === documentContent(before) && commits === 0,
    'Focus loss committed an unfinished duplicate',
  );
  await editor.command('select-all');
  p = begin(first.id);
  end = move(p, 41, 20, { altKey: true });
  up(end, { altKey: true });
  assert(
    doc.textFlows.length === 2 && doc.textFlows[0].html === before.textFlows[0].html,
    'Completed textFlow duplicate lost original rich source',
  );
  const persisted = validateImport(
    JSON.parse(JSON.stringify({ schemaVersion: 5, documents: [doc], assets: [] })),
  ).documents[0];
  await mount(persisted);
  assert(
    doc.textFlows.length === 2 &&
      textFlowForFrame(doc, doc.textFlows[1].frameIds[1]).id === doc.textFlows[1].id,
    'TextFlow copy did not survive reopening',
  );
  await mount(basic());
  a = doc.blocks[0];
  if (!editor.getState().snap) await editor.command('toggle-smart-guides');
  p = begin(a.id);
  end = move(p, 40, 2, { altKey: true });
  copy = doc.blocks.find((b) => b.id !== a.id);
  assert(
    copy.y === a.y && host.querySelector('.canvas-guide.y'),
    'Option duplication bypassed alignment snapping',
  );
  up(end, { altKey: true });
  const pages = basic(),
    page2 = addPage(pages, pages.pages[0].id);
  await mount(pages);
  a = doc.blocks[0];
  const oldPage = a.pageId;
  p = begin(a.id);
  end = move(p, 10, pages.pages[0].height + 64, { altKey: true });
  up(end, { altKey: true });
  copy = doc.blocks.find((b) => b.id !== a.id);
  assert(
    a.pageId === oldPage && copy.pageId === page2.id && near(copy.y, a.y),
    'Cross-page copy transferred the original or changed placement',
  );
  assert(
    host.querySelector(`[data-page="${page2.id}"] [data-object="${copy.id}"]`),
    'Dropped copy painted on wrong page',
  );
  await mount(basic());
  a = doc.blocks[0];
  p = begin(a.id, { altKey: true });
  up(p, { altKey: true });
  assert(
    doc.blocks.length === 1 && commits === 0,
    'Option click created a duplicate/history entry',
  );
  p = begin(a.id, { shiftKey: true });
  end = move(p, 28, 4, { shiftKey: true });
  up(end, { shiftKey: true });
  assert(
    doc.blocks.length === 1 && near(a.y, 100.375) && near(a.x, 108.125),
    'Shift drag at mouse-down toggled selection instead of moving',
  );
  await editor.command('tool-direct');
  p = begin(a.id, { altKey: true });
  end = move(p, 20, 15, { altKey: true });
  up(end, { altKey: true });
  assert(
    doc.blocks.length === 2 && history.size === 2,
    'Whole-object Direct Selection copy failed',
  );
  await editor.flush();
  editor.destroy();
  console.log(
    'IVO_DUPLICATE_RESULT:' +
      JSON.stringify({
        ok: true,
        liveModifiers: true,
        oneUndoRedo: true,
        masksAndOriginalMedia: true,
        sharedTextFlowCopies: true,
        escapePointerCancelBlurRollback: true,
        shift45: true,
        snapping: true,
        crossPage: true,
        saveReopen: true,
        directWholeObject: true,
      }),
  );
} catch (error) {
  console.log('IVO_DUPLICATE_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
