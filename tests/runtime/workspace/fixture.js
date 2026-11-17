import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { prepareTextFlowFonts } from '../../../src/rendering/text/flow-layout.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function keyboard(name) {
  console.log('IVO_WORKSPACE_KEYBOARD:' + name);
  for (let i = 0; i < 120; i++) {
    if (window.ivoWorkspaceKeyboard === name) return;
    await tick();
  }
  throw new Error('Trusted keyboard delivery timed out: ' + name);
}
try {
  localStorage.removeItem('ivo:workspace-panels:1');
  await prepareTextFlowFonts();
  const doc = createSceneDocument('Workspace'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: 400,
      h: 100,
      fontSize: 18,
      html: Array.from(
        { length: 8 },
        (_, i) => `<p>Paragraph ${i} keeps its text selection while panels move.</p>`,
      ).join(''),
    });
  startTextFlow(doc, frame.id);
  const host = document.querySelector('#host');
  let commits = 0;
  const options = {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (s) => s,
    onCommit: () => commits++,
    onChange: () => {},
    onUndo: () => {},
    onRedo: () => {},
  };
  let editor = mountCanvasEditor(host, options);
  await tick();
  await editor.command('document-text');
  const shell = host.querySelector('.scene-editor'),
    source = host.querySelector('.canvas-document-source'),
    world = host.querySelector('.canvas-world'),
    panel = host.querySelector('.canvas-properties');
  let selection = window.getSelection();
  source.focus();
  selection.setBaseAndExtent(
    source.querySelector('p').firstChild,
    0,
    source.querySelector('p').firstChild,
    9,
  );
  document.dispatchEvent(new Event('selectionchange'));
  const original = JSON.stringify(doc),
    camera = editor.getState().camera;
  const pointer = (target, type, x, y, extra = {}) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        button: 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  for (const el of host.querySelectorAll(
    '.canvas-panel-microbar,.workspace-panel-resize,.workspace-document-divider',
  )) {
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
  }
  const resize = host.querySelector('.workspace-panel-resize'),
    grip = host.querySelector('.canvas-panel-microbar'),
    divider = host.querySelector('.workspace-document-divider');
  pointer(resize, 'pointerdown', panel.getBoundingClientRect().x, 200);
  pointer(resize, 'pointermove', panel.getBoundingClientRect().x - 60, 200);
  pointer(resize, 'pointerup', 0, 200);
  await tick();
  assert(
    Math.abs(panel.getBoundingClientRect().width - 284) < 1,
    'Dock resize did not change panel width',
  );
  assert(document.activeElement === resize, 'Pointer resize did not acquire keyboard ownership');
  assert(
    getComputedStyle(resize).outlineStyle === 'none' &&
      getComputedStyle(resize).backgroundColor === 'rgba(0, 0, 0, 0)',
    'Pointer resize left the full-height focus highlight visible',
  );
  await keyboard('resize');
  assert(
    Math.abs(panel.getBoundingClientRect().width - 294) < 1,
    'Keyboard resize did not follow pointer focus',
  );
  assert(
    !resize.hasAttribute('data-pointer-focus') && getComputedStyle(resize).outlineStyle === 'solid',
    'Keyboard resize lost its visible focus affordance',
  );
  pointer(resize, 'pointerdown', panel.getBoundingClientRect().x, 200);
  pointer(resize, 'pointerup', panel.getBoundingClientRect().x, 200);
  assert(
    getComputedStyle(resize).outlineStyle === 'none',
    'Pointer resize inherited the preceding keyboard focus ring',
  );
  assert(
    host.querySelector('.canvas-document-source') === source &&
      host.querySelector('.canvas-world') === world &&
      selection.toString() === 'Paragraph',
    'Resizing panel replaced text/camera DOM or selection',
  );
  await editor.command('toggle-panel-floating');
  await tick();
  assert(shell.classList.contains('panel-floating'), 'Panel did not float');
  assert(
    source.isContentEditable && selection.toString() === 'Paragraph',
    'Floating panel interrupted text editing',
  );
  const beforeDrag = panel.getBoundingClientRect();
  pointer(grip, 'pointerdown', beforeDrag.x + 40, beforeDrag.y + 5);
  pointer(grip, 'pointermove', beforeDrag.x - 100, beforeDrag.y + 45);
  pointer(grip, 'pointerup', beforeDrag.x - 100, beforeDrag.y + 45);
  assert(panel.getBoundingClientRect().x < beforeDrag.x, 'Floating panel did not move');
  const stable = panel.getBoundingClientRect();
  pointer(grip, 'pointerdown', stable.x + 40, stable.y + 5);
  pointer(grip, 'pointermove', stable.x - 50, stable.y + 55);
  grip.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert(
    Math.abs(panel.getBoundingClientRect().x - stable.x) < 1,
    'Escape did not cancel panel movement',
  );
  pointer(grip, 'pointerdown', stable.x + 40, stable.y + 5);
  pointer(grip, 'pointermove', shell.getBoundingClientRect().right - 2, 100);
  assert(!host.querySelector('.workspace-dock-target').hidden, 'Dock drop target did not appear');
  pointer(grip, 'pointerup', shell.getBoundingClientRect().right - 2, 100);
  assert(!shell.classList.contains('panel-floating'), 'Right-edge drop did not dock panel');
  const oldHeight = host.querySelector('.canvas-document-text').getBoundingClientRect().height;
  pointer(divider, 'pointerdown', 500, 600);
  pointer(divider, 'pointermove', 500, 550);
  pointer(divider, 'pointerup', 500, 550);
  await tick();
  assert(
    host.querySelector('.canvas-document-text').getBoundingClientRect().height > oldHeight + 40,
    'TextFlow divider did not resize',
  );
  assert(
    source === host.querySelector('.canvas-document-source') &&
      selection.toString() === 'Paragraph',
    'TextFlow divider lost source selection',
  );
  assert(
    getComputedStyle(divider).outlineStyle === 'none',
    'TextFlow divider retained a pointer focus highlight',
  );
  await keyboard('textFlow');
  assert(
    getComputedStyle(divider).outlineStyle === 'solid',
    'TextFlow divider keyboard focus is no longer visible',
  );
  const tabs = [...host.querySelectorAll('[data-canvas-panel]')];
  tabs[0].focus();
  tabs[0].dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
  );
  assert(
    tabs[1].ariaSelected === 'true' && document.activeElement === tabs[1],
    'Panel tabs lack keyboard navigation',
  );
  assert(
    JSON.stringify(doc) === original && commits === 0,
    'Workspace layout entered document history',
  );
  assert(
    JSON.stringify(editor.getState().camera) === JSON.stringify(camera),
    'Panel layout changed document camera',
  );
  const saved = JSON.parse(localStorage.getItem('ivo:workspace-panels:1'));
  editor.destroy();
  editor = mountCanvasEditor(host, options);
  await tick();
  assert(
    Math.abs(host.querySelector('.canvas-properties').getBoundingClientRect().width - saved.dock) <
      1,
    'Workspace layout did not persist across editor mounts',
  );
  assert(JSON.stringify(doc) === original, 'Workspace restoration changed document source');
  editor.destroy();
  console.log(
    'IVO_WORKSPACE_RESULT:' +
      JSON.stringify({
        ok: true,
        dockResize: true,
        pointerHighlightCleared: true,
        keyboardResizeFocusVisible: true,
        floatAndMove: true,
        dockDrop: true,
        cancel: true,
        textFlowDivider: true,
        sourceAndSelectionRetained: true,
        keyboardTabs: true,
        viewOnly: true,
        persistentLayout: true,
      }),
  );
} catch (error) {
  console.log('IVO_WORKSPACE_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
