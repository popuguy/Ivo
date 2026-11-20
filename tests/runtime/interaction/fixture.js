import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { selectCaretWord } from '../../../src/shared/dom/text-selection.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  next = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
try {
  await document.fonts.ready;
  const doc = createSceneDocument('Interaction'),
    p = doc.pages[0],
    a = insertObject(doc, 'text', p.id, {
      x: 80,
      y: 100,
      w: 130,
      h: 80,
      html: '<p>First <strong>word</strong></p><p>Next paragraph</p>',
    }),
    _b = insertObject(doc, 'polygon', p.id, { x: 260, y: 110, w: 100, h: 80 });
  insertObject(doc, 'polygon', p.id, { x: 480, y: 480, w: 50, h: 50 });
  const target = createSceneDocument('Target');
  let commits = 0;
  const host = document.querySelector('#host'),
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc, target],
      editing: true,
      nativeContextMenu: false,
      source: (s) => s,
      onCommit: () => commits++,
      onChange: () => {},
      onUndo: () => {},
      onRedo: () => {},
      onAsset: async () => {},
      onNotify: () => {},
      onLink: async () => target.id,
    });
  await next();
  const viewport = host.querySelector('.canvas-viewport');
  viewport.setPointerCapture = () => {};
  viewport.releasePointerCapture = () => {};
  const send = (type, target, x, y, extra = {}) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        ...extra,
      }),
    );
  const box = host.querySelector('.canvas-page').getBoundingClientRect(),
    z = editor.getState().camera.zoom;
  const point = (x, y) => [box.left + x * z, box.top + y * z];
  const start = point(60, 80),
    end = point(380, 210);
  send('pointerdown', viewport, ...start);
  send('pointermove', viewport, ...end);
  send('pointerup', viewport, ...end);
  await next();
  assert(editor.getState().selection.length === 2, 'Marquee did not select two objects');
  assert(host.querySelectorAll('.canvas-resize').length === 8, 'Common bounding box missing');
  assert(commits === 0, 'Selection must not enter document history');
  const third = doc.blocks[2],
    thirdElement = host.querySelector(`[data-object="${third.id}"]`),
    thirdBox = thirdElement.getBoundingClientRect();
  send('pointerdown', thirdElement, thirdBox.x + 8, thirdBox.y + 8, { shiftKey: true });
  send('pointerup', viewport, thirdBox.x + 8, thirdBox.y + 8);
  assert(editor.getState().selection.length === 3, 'Shift click did not add an object');
  send('pointerdown', thirdElement, thirdBox.x + 8, thirdBox.y + 8, { shiftKey: true });
  send('pointerup', viewport, thirdBox.x + 8, thirdBox.y + 8);
  assert(editor.getState().selection.length === 2, 'Shift click did not toggle an object off');
  const partialEnd = point(300, 150);
  send('pointerdown', viewport, ...start);
  send('pointermove', viewport, ...partialEnd);
  assert(editor.getState().selection.length === 2, 'Partial marquee lost intersecting objects');
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }),
  );
  assert(
    editor.getState().selection.length === 0,
    'Enclosed-only marquee retained partial objects',
  );
  send('pointercancel', viewport, ...partialEnd);
  assert(
    editor.getState().selection.length === 2 && commits === 0,
    'Cancelled marquee did not restore selection without a document edit',
  );
  const originalX = a.x,
    element = host.querySelector(`[data-object="${a.id}"]`),
    r = element.getBoundingClientRect();
  const surface = host.querySelector('.scene-editor');
  surface.style.setProperty('--cursor-select', 'default');
  surface.style.setProperty('--cursor-move', 'move');
  const cursorChanges = new MutationObserver(() => {});
  cursorChanges.observe(surface, { attributes: true, attributeFilter: ['data-option'] });
  for (let i = 0; i < 12; i++) send('pointermove', element, r.x + 5 + i, r.y + 5, { buttons: 0 });
  assert(cursorChanges.takeRecords().length === 0, 'Plain hover repeatedly invalidated the cursor');
  cursorChanges.disconnect();
  send('pointerdown', element, r.x + 5, r.y + 5);
  assert(getComputedStyle(viewport).cursor === 'default', 'Clicking a frame announced a drag');
  send('pointermove', viewport, r.x + 6, r.y + 5);
  assert(
    getComputedStyle(viewport).cursor === 'default',
    'A sub-threshold move changed the tool cursor',
  );
  send('pointermove', viewport, r.x + 25, r.y + 15);
  assert(getComputedStyle(viewport).cursor === 'move', 'A real drag lost its move cursor');
  send('pointerup', viewport, r.x + 25, r.y + 15);
  assert(Math.abs(a.x - originalX - 20 / z) < 1e-8, 'Selected group did not move together');
  assert(commits === 1, 'Group move must be one undo entry');
  const afterMove = a.x,
    moveBox = host.querySelector(`[data-object="${a.id}"]`).getBoundingClientRect();
  send('pointerdown', host.querySelector(`[data-object="${a.id}"]`), moveBox.x + 6, moveBox.y + 6);
  send('pointermove', viewport, moveBox.x + 14, moveBox.y + 6);
  send('pointermove', viewport, moveBox.x + 500, moveBox.y + 500, { buttons: 0 });
  assert(
    Math.abs(a.x - afterMove - 8 / z) < 1e-8,
    'Hover after a consumed mouse-up continued moving objects',
  );
  const stopped = a.x;
  send('pointermove', viewport, moveBox.x + 700, moveBox.y + 700, { buttons: 0 });
  assert(a.x === stopped, 'Released transform remained active');
  await editor.command('tool-text');
  const text = host.querySelector(`[data-scene-text="${a.id}"]`),
    rt = text.getBoundingClientRect();
  send('pointerdown', text, rt.x + 8, rt.y + 8);
  send('pointerup', viewport, rt.x + 8, rt.y + 8);
  assert(
    editor.getState().activeTextId === a.id && text.isContentEditable,
    'Type click did not begin editing',
  );
  const same = text;
  text.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
  );
  assert(editor.getState().activeTextId === a.id, 'IME Escape incorrectly exited editing');
  const range = document.createRange();
  range.selectNodeContents(text.querySelector('strong'));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  text.dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, clientX: rt.x + 8, clientY: rt.y + 8, detail: 2 }),
  );
  assert(
    host.querySelector(`[data-scene-text="${a.id}"]`) === same,
    'Double-click replaced the live text node',
  );
  assert(
    window.getSelection().toString() === 'word',
    'Double-click discarded native word selection',
  );
  const caret = document.createRange();
  caret.setStart(text.querySelector('strong').firstChild, 2);
  caret.collapse(true);
  selectCaretWord(text, caret);
  assert(window.getSelection().toString() === 'word', 'Word selection crossed paragraph boundary');
  await editor.command('link');
  assert(
    a.html.includes(`data-doc-id="${target.id}"`),
    'Link command did not wrap the selected word',
  );
  assert(
    a.html.includes('<strong>') && a.html.includes('Next paragraph'),
    'Link command lost text or emphasis',
  );
  const linkClick = new MouseEvent('click', { bubbles: true, cancelable: true });
  host.querySelector(`[data-scene-text="${a.id}"] a`).dispatchEvent(linkClick);
  assert(
    linkClick.defaultPrevented,
    'Editing a linked word navigated instead of keeping text focus',
  );
  const count = doc.blocks.length;
  send('pointerdown', viewport, ...point(500, 500));
  send('pointerup', viewport, ...point(500, 500));
  assert(!editor.getState().activeTextId, 'Click away did not exit text editing');
  assert(doc.blocks.length === count, 'Click away created another text object');
  assert(
    !host.querySelector(
      '.canvas-tools [data-canvas-command="undo"],.canvas-tools [data-canvas-command="redo"],.canvas-tools [data-canvas-command="link"]',
    ),
    'Removed rail actions remain',
  );
  assert(
    /\d+\.\d{2}%/.test(host.querySelector('.zoom-value').textContent),
    'Zoom label lacks two decimals',
  );
  viewport.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 50,
      clientY: box.top + 50,
    }),
  );
  assert(
    host.querySelector('[role="menuitem"][data-canvas-command="link"]'),
    'Link context command missing',
  );
  const nativeParagraphs = 'First<div>Second</div><div><br></div><div>Third</div>';
  assert(
    cleanHTML(nativeParagraphs) === nativeParagraphs,
    'Native DIV paragraph breaks were discarded',
  );
  assert(
    !cleanHTML('<div onclick="bad()">Safe<script>bad()</script></div>').includes('bad'),
    'Paragraph preservation admitted active content',
  );
  const tooltipButton = host.querySelector('[data-canvas-command="tool-select"]'),
    tooltipImage = tooltipButton.querySelector('img');
  tooltipButton.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  tooltipButton.dispatchEvent(
    new PointerEvent('pointerout', { bubbles: true, relatedTarget: tooltipImage }),
  );
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert(
    document.querySelector('.classic-tooltip')?.textContent === 'Selection (V)',
    'Moving across an icon cancelled its tooltip',
  );
  tooltipButton.dispatchEvent(
    new PointerEvent('pointerout', { bubbles: true, relatedTarget: viewport }),
  );
  assert(!document.querySelector('.classic-tooltip'), 'Tooltip did not dismiss on exit');
  await editor.flush();
  editor.destroy();
  console.log(
    'IVO_INTERACTION_RESULT:' +
      JSON.stringify({
        ok: true,
        marquee: true,
        multiMove: true,
        liveTextNodePreserved: true,
        clickAwayDoesNotCreate: true,
        menusAndPrecision: true,
        commits,
      }),
  );
} catch (error) {
  console.log('IVO_INTERACTION_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
