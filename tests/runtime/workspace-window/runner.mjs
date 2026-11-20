import { app, BrowserWindow, dialog, Menu, clipboard, ClipboardItem, shell } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openVault } from '../../../desktop/vault.mjs';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';
import { layersFor } from '../../../src/domain/documents/publishing.js';

const directory = process.env.IVO_WINDOW_TEST_DIR,
  stage = process.env.IVO_WINDOW_TEST_STAGE;
if (!directory || !['1', '2'].includes(stage)) throw new Error('Run this fixture through run.mjs.');
const vaultPath = path.join(directory, 'Vault'),
  profile = path.join(directory, 'Profile'),
  statePath = path.join(directory, 'stage-state.json');
process.env.IVO_USER_DATA_DIR = profile;
process.env.IVO_ATLAS_DIR = vaultPath;
const dialogs = [],
  copies = [],
  links = [],
  revealed = [],
  opened = [],
  originalPopup = Menu.prototype.popup,
  originalCopy = clipboard.writeText,
  originalRichCopy = clipboard.write,
  originalReveal = shell.showItemInFolder,
  originalOpen = shell.openPath;
dialog.showMessageBox = async (...args) => {
  dialogs.push(args.at(-1));
  return { response: 0 };
};
dialog.showErrorBox = (title, message) => {
  console.error(title, message);
  app.exit(1);
};
clipboard.writeText = async (value) => {
  assert.equal(typeof value, 'string');
  await Promise.resolve();
  copies.push(value);
};
clipboard.write = async (items) => {
  assert.ok(
    Array.isArray(items) && items.length === 1,
    'Native rich copy requires ClipboardItem[]',
  );
  assert.ok(
    items[0] instanceof ClipboardItem,
    'Native rich copy must construct a real ClipboardItem',
  );
  const [item] = items;
  assert.deepEqual([...item.types].sort(), ['text/html', 'text/plain']);
  const text = await (await item.getType('text/plain')).text();
  const html = await (await item.getType('text/html')).text();
  links.push({ text, html });
};
shell.showItemInFolder = (value) => revealed.push(value);
shell.openPath = async (value) => {
  opened.push(value);
  return '';
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 25)),
  execute = (window, code) => window.webContents.executeJavaScript(code, true),
  windows = () =>
    BrowserWindow.getAllWindows().filter(
      (window) =>
        !window.isDestroyed() &&
        window.webContents.getURL().startsWith('ivo://app/index.html') &&
        !window.webContents.getURL().endsWith('#vault-manager'),
    );
async function wait(predicate, label = 'Native workspace condition') {
  for (let i = 0; i < 600; i++) {
    const value = await predicate();
    if (value) return value;
    await pause();
  }
  throw new Error(
    label +
      ' timed out: ' +
      JSON.stringify(
        windows().map((window) => ({ title: window.getTitle(), url: window.webContents.getURL() })),
      ),
  );
}
async function capture(window, name) {
  if (!process.env.IVO_REVIEW_DIR) return;
  await fs.mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
  await fs.writeFile(
    path.join(process.env.IVO_REVIEW_DIR, name),
    (await window.webContents.capturePage()).toPNG(),
  );
}
const ready = (window) =>
  wait(
    async () =>
      execute(
        window,
        "ivoNative.windows.info().then(state=>state.ready&&!!document.querySelector('.workspace-pane'))",
      ),
    'Renderer readiness',
  );
const focus = async (window) => {
  window.show();
  window.focus();
  try {
    await wait(
      async () =>
        BrowserWindow.getFocusedWindow() === window &&
        (await execute(window, 'ivoNative.windows.info()')).active,
      'Writer focus',
    );
  } catch (error) {
    console.error(
      'Focus diagnostics',
      JSON.stringify({
        focused: BrowserWindow.getFocusedWindow()?.webContents.id,
        target: window.webContents.id,
        dialogs,
        windows: await Promise.all(
          windows().map(async (item) => ({
            id: item.webContents.id,
            focused: item.isFocused(),
            state: await execute(item, 'ivoNative.windows.info()'),
            view: await execute(
              item,
              "({inert:document.querySelector('#app').inert,focus:document.hasFocus(),source:document.querySelector('.canvas-flow-input')?.isContentEditable,toast:document.querySelector('#toast')?.textContent})",
            ),
          })),
        ),
      }),
    );
    throw error;
  }
};
async function edit(window, text) {
  await focus(window);
  if (!(await execute(window, "!!document.querySelector('.scene-editing')"))) {
    window.webContents.send('ivo:command', 'toggle-edit');
    await wait(
      async () => execute(window, "!!document.querySelector('.scene-editing')"),
      'Editing view',
    );
  }
  await execute(
    window,
    `(()=>{const frame=document.querySelector('[data-object="${expected.frameId}"]');if(frame){const rect=frame.getBoundingClientRect();frame.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:rect.x+5,clientY:rect.y+5,detail:2}));}})()`,
  );
  window.webContents.send('ivo:command', 'document-text');
  await wait(
    async () =>
      execute(window, "!!document.querySelector('.canvas-flow-input[contenteditable=true]')"),
    'Writable textFlow source',
  );
  await execute(
    window,
    `(()=>{const source=document.querySelector('.canvas-flow-input[contenteditable=true]');source.focus();document.execCommand('selectAll');document.execCommand('insertText',false,${JSON.stringify(text)});})()`,
  );
  await wait(
    async () =>
      (await execute(window, 'ivoNative.store.loadDocuments()'))[0].textFlows[0].html.includes(
        text,
      ),
    'Canonical text commit',
  );
}
async function verifyPaletteDrag(window, palettes) {
  const frame = window.getBounds();
  const panel = '.workspace-view.active .scene-editor [data-canvas-panel="layers"]';
  const tab = '.workspace-view.active .scene-editor [data-canvas-panel="pages"]';
  const center = (win, selector) =>
    execute(
      win,
      `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return rect?.width && rect?.height && { x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2) };
  })()`,
    );
  const mouse = (win, type, p) =>
    win.webContents.sendInputEvent({
      type,
      x: Math.round(p.x),
      y: Math.round(p.y),
      globalX: Math.round(win.getContentBounds().x + p.x),
      globalY: Math.round(win.getContentBounds().y + p.y),
      button: 'left',
      clickCount: 1,
      modifiers: type === 'mouseUp' ? [] : ['leftButtonDown'],
    });
  await focus(window);
  window.setBounds({ ...frame, width: 820 });
  window.webContents.send('ivo:command', 'show-panel-layers');
  await wait(
    () =>
      execute(
        window,
        "document.querySelector('.workspace-view.active .scene-editor')?.classList.contains('show-properties') && innerWidth < 900",
      ),
    'Narrow layout resized',
  );
  await execute(
    window,
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const source = await wait(() => center(window, panel), 'Narrow layout revealed Layers');
  const viewport = await center(window, '.workspace-view.active .canvas-viewport');
  assert.ok(viewport);
  const begin = async (point) => {
    mouse(window, 'mouseDown', point);
    await wait(
      () =>
        execute(
          window,
          "document.querySelector('.workspace-view.active .scene-editor').dataset.panelGesture === 'tab'",
        ),
      'Pointer pressed the Layers tab',
    );
    mouse(window, 'mouseMove', viewport);
    const lifted = await wait(
      () => palettes()[0],
      'A native window was created during the held drag',
    );
    try {
      await wait(() => lifted.isVisible(), 'Held native palette painted');
    } catch (error) {
      console.error(
        'Unpainted palette',
        await execute(
          lifted,
          "({kind:document.querySelector('[data-palette-name]')?.textContent,content:!!document.querySelector('.layer-tree')})",
        ),
      );
      throw error;
    }
    return lifted;
  };
  // Escape restores the layout even after the native window has painted.
  const cancelled = await begin(source);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(() => cancelled.isDestroyed(), 'Escape rolled back the held tear-off');
  mouse(window, 'mouseUp', viewport);
  const restored = await wait(() => center(window, panel), 'Cancelled Layers tab restored');
  // Stay inside the document window; the separate palette must appear before release.
  const palette = await begin(restored);
  const first = palette.getBounds();
  const moved = { x: viewport.x - 53, y: viewport.y - 28 };
  mouse(window, 'mouseMove', moved);
  await wait(
    () => palette.getBounds().x < first.x - 25,
    'Floating palette followed the continuing drag',
  );
  mouse(window, 'mouseUp', moved);
  await wait(() => center(palette, '[data-palette-name]'), 'Panel chrome has a named tab');
  await wait(
    () => execute(palette, "!!document.querySelector('.layer-tree')"),
    'Layers content reached the detached surface',
  );
  await capture(palette, 'detached-layers-chrome.png');
  const expanded = palette.getBounds();
  await execute(palette, "document.querySelector('[data-palette-collapse]').click()");
  await wait(() => palette.getBounds().height === 42, 'Palette collapsed to its two bars');
  await execute(palette, "document.querySelector('[data-palette-collapse]').click()");
  await wait(
    () => palette.getBounds().height === expanded.height,
    'Palette restored its working height',
  );
  const header = await center(palette, '[data-palette-name]');
  const destination = await center(window, tab);
  assert.ok(destination);
  // Capture starts in the utility. Derive each destination in the moving window’s coordinates.
  mouse(palette, 'mouseDown', header);
  mouse(palette, 'mouseMove', { x: header.x + 12, y: header.y });
  const origin = window.getContentBounds();
  const relative = () => {
    const bounds = palette.getContentBounds();
    return { x: origin.x + destination.x - bounds.x, y: origin.y + destination.y - bounds.y };
  };
  mouse(palette, 'mouseMove', relative());
  await wait(
    () =>
      execute(
        window,
        "Array.from(document.querySelectorAll('.native-panel-dock-guide')).some(el => !el.hidden)",
      ),
    'Returning the palette over a tab previews its insertion',
  );
  mouse(palette, 'mouseUp', relative());
  await wait(() => palette.isDestroyed(), 'Dropping the held native title tab reattached Layers');
  await wait(() => center(window, panel), 'Layers present in document dock');
  assert.equal(
    await execute(
      window,
      `document.querySelector(${JSON.stringify(panel)}).getAttribute('aria-selected')`,
    ),
    'true',
  );
  window.setBounds(frame);
}

async function verifyFloatingPalette(first, originalId) {
  const lock = '[data-layer-toggle="locked"]:not(:disabled)',
    palettes = () =>
      BrowserWindow.getAllWindows().filter((item) =>
        item.webContents.getURL().startsWith('ivo://app/palette.html'),
      ),
    activeDocument = (win) =>
      execute(
        win,
        "document.querySelector('.workspace-view.active [data-document-title]')?.dataset.documentTitle",
      ),
    documents = () => execute(first, 'ivoNative.store.loadDocuments()');
  await verifyPaletteDrag(first, palettes);
  first.webContents.send('ivo:command', 'new-document-right');
  const rightId = await wait(async () => {
    const id = await activeDocument(first);
    return id && id !== originalId && id;
  }, 'Second document in split');
  const right = (await documents()).find((doc) => doc.id === rightId),
    original = (await documents()).find((doc) => doc.id === originalId);
  assert.ok(right && original);
  const locked = async (firstLocked, rightLocked) => {
    const stored = await documents();
    return [
      [originalId, firstLocked],
      [rightId, rightLocked],
    ].every(([id, value]) => layersFor(stored.find((doc) => doc.id === id))[0].locked === value);
  };
  const openPalette = async (win) => {
    assert.equal(await execute(win, "ivoNative.palettes.open('layers')"), true);
    const palette = await wait(() => palettes()[0], 'Native Layers window');
    await wait(
      () => !palette.webContents.isLoading() && palette.isVisible(),
      'Floating Layers ready',
    );
    return palette;
  };
  const palette = await openPalette(first);
  assert.notEqual(palette.webContents.session, first.webContents.session);
  assert.equal(await execute(palette, 'typeof window.ivoNative'), 'undefined');
  assert.equal(await execute(palette, 'typeof window.ivoPalette.act'), 'function');
  assert.equal(palette.isModal(), false);
  assert.equal(palette.getParentWindow(), null);
  assert.equal(palettes().length, 1);
  const showTarget = (doc, state) =>
    wait(
      () =>
        execute(
          palette,
          `document.querySelector('[data-palette-context]')?.textContent.includes(${JSON.stringify(doc.title)}) &&
      document.querySelector(${JSON.stringify(lock)})?.getAttribute('aria-pressed') === '${state}'`,
        ),
      'Layers reflecting ' + doc.title,
    );
  const toggle = () => execute(palette, `document.querySelector(${JSON.stringify(lock)}).click()`);
  await showTarget(right, false);
  // A real utility window can extend beyond its source document's content bounds.
  const previous = first.getBounds(),
    box = palette.getBounds();
  first.setBounds({ ...previous, width: 600 });
  const source = first.getContentBounds();
  palette.setPosition(source.x + source.width - Math.floor(box.width / 2), source.y + 24);
  await wait(() => {
    const placed = palette.getBounds();
    return placed.x + placed.width > source.x + source.width;
  }, 'Layers outside the document window');
  first.setBounds(previous);

  // Keyboard focus in the utility must leave the split's active document writable.
  palette.focus();
  assert.equal((await execute(first, 'ivoNative.windows.info()')).active, true);
  await toggle();
  await wait(() => locked(false, true), 'Only the right document locked');
  await showTarget(right, true);
  const savedAction = await execute(
    palette,
    `ivoPalette.initial().then(({view}) => ({
    revision:view.revision, index:Number(document.querySelector(${JSON.stringify(lock)}).dataset.paletteControl), type:'click'
  }))`,
  );
  assert.ok(savedAction.revision && Number.isInteger(savedAction.index));

  await focus(first);
  await execute(first, `document.querySelector('[data-document-title="${originalId}"]').focus()`);
  await wait(async () => (await activeDocument(first)) === originalId, 'Left split activation');
  if (
    !(await execute(first, "!!document.querySelector('.workspace-view.active .scene-editing')"))
  ) {
    first.webContents.send('ivo:command', 'toggle-edit');
  }
  await showTarget(original, false);
  await execute(palette, 'ivoPalette.act(' + JSON.stringify(savedAction) + ')');
  await toggle();
  await wait(() => locked(true, true), 'Fresh action applied while old split input was discarded');
  await showTarget(original, true);
  await execute(
    first,
    `ivoNative.windows.open({tab:{id:'palette-native-target',kind:'document',docId:${JSON.stringify(rightId)},editing:true}})`,
  );
  const detached = await wait(() => windows().find((item) => item !== first), 'Detached document');
  await ready(detached);
  await focus(detached);
  await showTarget(right, true);
  assert.equal(await openPalette(detached), palette, 'Opening Layers twice duplicated its window');
  await toggle();
  await wait(() => locked(true, false), 'Detached document received the shared action');

  await execute(palette, "document.querySelector('[data-palette-collapse]').click()");
  await wait(() => palette.getBounds().height === 42, 'Collapsed palette retained its native menu');
  Menu.prototype.popup = function (options) {
    assert.equal(options.window, palette);
    assert.ok(this.getMenuItemById('close-panel').enabled);
    this.getMenuItemById('dock-panel').click();
    options.callback();
  };
  try {
    await execute(palette, "document.querySelector('[data-palette-menu]').click()");
    await wait(
      () => palette.isDestroyed(),
      'Docking from the native menu closed the separate Layers window',
    );
  } finally {
    Menu.prototype.popup = originalPopup;
  }
  await wait(
    () =>
      execute(
        detached,
        "!!document.querySelector('.workspace-view.active [data-canvas-panel=layers]')",
      ),
    'Layers returned to the active dock',
  );
  const reopened = await openPalette(detached);
  reopened.close();
  await wait(() => reopened.isDestroyed(), 'Native close dismissed Layers');
  assert.equal(palettes().length, 0);
  assert.ok(await locked(true, false), 'Docking or closing changed an authored layer');
  await verifyInspectorPalettes(detached, right, original, palettes);
  console.log('IVO_NATIVE_PALETTE:PASS');
}

async function verifyInspectorPalettes(win, target, neighbor, palettes) {
  const openTabMenu = async (kind, readySelector) => {
    await focus(win);
    win.webContents.send('ivo:command', 'show-panel-' + kind);
    const tab = `.workspace-view.active [data-canvas-panel="${kind}"]`;
    await wait(
      () =>
        execute(win, `!!document.querySelector(${JSON.stringify(tab)})?.getClientRects().length`),
      'Visible ' + kind + ' tab',
    );
    const existing = new Set(palettes());
    await execute(
      win,
      `document.querySelector(${JSON.stringify(tab)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));document.querySelector('[data-workspace-action=external]').click()`,
    );
    const panel = await wait(
      () => palettes().find((item) => !existing.has(item)),
      kind + ' detached via tab',
    );
    await wait(
      () => execute(panel, `!!document.querySelector(${JSON.stringify(readySelector)})`),
      kind + ' controls',
    );
    return panel;
  };
  const props = await openTabMenu('properties', '[data-page-prop=width]'),
    pages = await openTabMenu('pages', '[data-select-page]'),
    links = await openTabMenu('links', '[data-canvas-command=link]'),
    wrap = await openTabMenu('text-wrap', '[data-text-wrap-mode]');
  assert.equal(palettes().length, 4);
  assert.equal(await execute(wrap, "document.querySelectorAll('[data-text-wrap-mode]').length"), 5);
  assert.ok(
    await execute(
      links,
      "document.body.textContent.includes('Outgoing links') && document.body.textContent.includes('Backlinks')",
    ),
  );

  const size = target.pages[0].width,
    firstPage = target.pages[0].id;
  const widths = async (expected) => {
    const docs = await execute(win, 'ivoNative.store.loadDocuments()');
    return (
      docs.find((doc) => doc.id === target.id).pages[0].width === expected &&
      docs.find((doc) => doc.id === neighbor.id).pages[0].width === neighbor.pages[0].width
    );
  };
  props.focus();
  assert.equal(
    await execute(
      props,
      `(() => {
      const field = document.querySelector('[data-page-prop=width]');
      field.scrollIntoView({block:'nearest'});
      const {left, top, width, height} = field.getBoundingClientRect();
      return width > 0 && height > 0 && document.elementFromPoint(left + width / 2, top + height / 2) === field;
    })()`,
    ),
    true,
    'Properties must expose an actual pointer target in a narrow utility window',
  );
  await execute(
    props,
    "const widthField=document.querySelector('[data-page-prop=width]');widthField.focus();widthField.select()",
  );
  await props.webContents.insertText(String(size + 24));
  await execute(props, 'document.activeElement.blur()');
  await wait(() => widths(size + 24), 'Properties committed the page width to the active document');
  const undo = Menu.getApplicationMenu().getMenuItemById('undo');
  await wait(() => undo.enabled, 'Undo from a focused Properties panel');
  undo.click();
  await wait(() => widths(size), 'Undo restored page width');

  await execute(pages, "document.querySelector('[data-canvas-command=add-page]').click()");
  await wait(
    () => execute(pages, "document.querySelectorAll('[data-select-page]').length === 2"),
    'Pages created a second page',
  );
  await wait(
    () => execute(props, "document.querySelector('[data-property-page]')?.selectedIndex === 1"),
    'Properties showed the newly created page',
  );
  await execute(pages, `document.querySelector('[data-select-page="${firstPage}"]').click()`);
  await wait(
    () =>
      execute(
        props,
        `document.querySelector('[data-property-page]')?.value === ${JSON.stringify(firstPage)}`,
      ),
    'Properties followed Pages navigation',
  );
  const tabs = await execute(win, "document.querySelectorAll('.document-tab').length");
  wrap.focus();
  await wait(() => BrowserWindow.getFocusedWindow() === wrap, 'Text Wrap keyboard focus');
  const close = Menu.getApplicationMenu()
    .items.flatMap((item) => item.submenu?.items || [])
    .find((item) => item.accelerator === 'CmdOrCtrl+W');
  assert.ok(close, 'Close Tab menu shortcut');
  close.click();
  await wait(() => wrap.isDestroyed(), 'Close shortcut docked the focused palette');
  assert.equal(await execute(win, "document.querySelectorAll('.document-tab').length"), tabs);
  assert.equal(palettes().length, 3);
  const before = pages.getBounds(),
    position = props.getPosition();
  props.setPosition(position[0] + 12, position[1] + 8);
  await wait(
    () => props.getPosition().some((value, axis) => value !== position[axis]),
    'Moving Properties independently',
  );
  assert.deepEqual(pages.getBounds(), before, 'Moving Properties moved Pages');
  for (const panel of [props, pages, links]) panel.close();
  await wait(() => !palettes().length, 'Remaining utility windows closed independently');
}
let expected;
if (stage === '1') {
  const vault = await openVault(vaultPath),
    doc = createSceneDocument('Shared native note');
  doc.id = 'native-window-note';
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    x: 48,
    y: 48,
    w: 516,
    h: 696,
    html: '<p>Original shared source.</p>',
  });
  startTextFlow(doc, frame.id);
  await vault.saveImport({ schemaVersion: 5, documents: [doc], assets: [] });
  expected = { docId: doc.id, frameId: frame.id, pageId: doc.pages[0].id };
} else expected = JSON.parse(await fs.readFile(statePath, 'utf8'));
const timer = setTimeout(() => {
  console.error('Native workspace test timed out');
  app.exit(1);
}, 85000);
app.on('quit', () => {
  clearTimeout(timer);
  Menu.prototype.popup = originalPopup;
  clipboard.writeText = originalCopy;
  clipboard.write = originalRichCopy;
  shell.showItemInFolder = originalReveal;
  shell.openPath = originalOpen;
});
void (async () => {
  try {
    app.on('browser-window-created', (_event, window) => {
      window.on('focus', () => console.log('Native window focused', window.webContents.id));
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error('Renderer:', event.message);
      });
    });
    await import('../../../desktop/main.mjs');
    const first = await wait(() => windows()[0]);
    await ready(first);
    await focus(first);
    if (stage === '1') await capture(first, 'native-shell.png');
    if (stage === '1') {
      assert.equal((await execute(first, 'ivoNative.windows.info()')).main, true);
      const firstInfo = await execute(first, 'ivoNative.vaults.info()');
      Menu.prototype.popup = function (options) {
        const item = this.getMenuItemById('open-tab');
        assert.ok(item.enabled);
        item.click();
        options.callback?.();
      };
      assert.equal(
        await execute(
          first,
          "ivoNative.showNavigationMenu([{id:'open-tab',label:'Open in new tab'},{label:'Copy path',submenu:[{id:'copy',label:'Relative path'}]}])",
        ),
        'open-tab',
      );
      Menu.prototype.popup = originalPopup;
      const file = await execute(
        first,
        `ivoNative.documents.info(${JSON.stringify(expected.docId)})`,
      );
      assert.match(file.relativePath, /^documents\/native-window-note-[a-f0-9]{64}\.json$/);
      assert.equal(JSON.parse(await fs.readFile(file.absolutePath, 'utf8')).id, expected.docId);
      await execute(
        first,
        `ivoNative.documents.copyPath(${JSON.stringify(expected.docId)},'relative')`,
      );
      assert.equal(copies.at(-1), file.relativePath);
      await execute(first, `ivoNative.documents.reveal(${JSON.stringify(expected.docId)})`);
      assert.equal(revealed.at(-1), file.absolutePath);
      await assert.rejects(
        execute(first, "ivoNative.documents.info('../outside')"),
        /existing document/,
      );
      const originalDocument = (await execute(first, 'ivoNative.store.loadDocuments()'))[0],
        linkTitle = 'A <native> & "quoted" note';
      await execute(
        first,
        'ivoNative.store.saveDocument(' +
          JSON.stringify({ ...originalDocument, title: linkTitle }) +
          ')',
      );
      await execute(first, 'ivoNative.documents.copyLink(' + JSON.stringify(expected.docId) + ')');
      assert.deepEqual(links.at(-1), {
        text: '[[' + linkTitle + ']]',
        html: '<a data-doc-id="native-window-note" href="#doc=native-window-note">A &lt;native&gt; &amp; &quot;quoted&quot; note</a>',
      });
      await execute(
        first,
        'ivoNative.store.saveDocument(' + JSON.stringify(originalDocument) + ')',
      );
      const transfer = {
        id: 'tab-native-detached',
        kind: 'document',
        docId: expected.docId,
        editing: true,
        canvasState: {
          activePage: expected.pageId,
          selection: [expected.frameId],
          activeTextId: expected.frameId,
          tool: 'text',
          camera: { x: 50, y: 60, zoom: 1.25 },
        },
      };
      const openedInfo = await execute(
        first,
        'ivoNative.windows.open(' +
          JSON.stringify({ tab: transfer, move: false, position: { screenX: 500, screenY: 180 } }) +
          ')',
      );
      const detached = await wait(() => windows().find((window) => window !== first));
      await ready(detached);
      assert.equal(
        openedInfo.windowId,
        (await execute(detached, 'ivoNative.windows.info()')).windowId,
      );
      assert.equal(openedInfo.main, false);
      assert.equal((await execute(first, 'ivoNative.windows.info()')).active, false);
      assert.equal(
        first.webContents.session,
        detached.webContents.session,
        'One vault should share the same partition and byte-store owner',
      );
      await assert.rejects(
        execute(
          first,
          "ivoNative.store.loadDocuments().then(documents=>ivoNative.store.saveDocument({...documents[0],title:'Stale writer must fail'}))",
        ),
        /read-only/,
      );
      await assert.rejects(
        execute(first, "ivoNative.store.putMeta('history:native-window-note',[])"),
        /read-only/,
      );
      await assert.rejects(
        execute(first, "ivoNative.store.putMeta('library:1',{version:1,folders:[]})"),
        /read-only/,
      );
      await assert.rejects(
        execute(first, "ivoNative.store.changeLibrary({type:'create-folder',path:'Forbidden'})"),
        /read-only/,
      );
      await assert.rejects(
        execute(first, "ivoNative.store.getMeta('workspace-window:another-window')"),
        /belongs to its native window/,
      );
      await edit(detached, 'Written in the detached window.');
      await wait(
        async () =>
          execute(
            first,
            "document.querySelector('.canvas-world').textContent.includes('Written in the detached window.')",
          ),
        'Passive source refresh',
      );
      await edit(first, 'Written after returning to the original window.');
      assert.equal((await execute(detached, 'ivoNative.windows.info()')).active, false);
      await execute(first, "ivoNative.store.changeLibrary({type:'create-folder',path:'Review'})");
      await wait(
        () => execute(detached, "!!document.querySelector('details[data-folder=Review]')"),
        'Atomic library metadata peer refresh',
      );
      await wait(
        async () =>
          execute(
            detached,
            "document.querySelector('.canvas-world').textContent.includes('Written after returning to the original window.')",
          ),
        'Second passive source refresh',
      );
      await focus(detached);
      await wait(
        () => Menu.getApplicationMenu().getMenuItemById('undo').enabled === false,
        'External edits invalidate the detached window undo timeline',
      );
      await focus(first);
      expected.assetData = await execute(
        first,
        `(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;const context=canvas.getContext('2d');context.fillStyle='#736699';context.fillRect(0,0,32,16);const data=canvas.toDataURL('image/png'),bytes=Uint8Array.from(atob(data.split(',')[1]),char=>char.charCodeAt(0)),file=new File([bytes],'window-media.png',{type:'image/png'}),transfer=new DataTransfer();transfer.items.add(file);const viewport=document.querySelector('.canvas-viewport'),rect=viewport.getBoundingClientRect();viewport.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.x+100,clientY:rect.y+160}));return data;})()`,
      );
      await wait(
        async () =>
          (await execute(first, 'ivoNative.store.loadDocuments()'))[0].blocks.some(
            (block) => block.type === 'image',
          ),
        'App media import commit',
      );
      await wait(
        async () =>
          execute(
            detached,
            '!!document.querySelector(\'.canvas-world img[src^="data:image/png"]\')',
          ),
        'Passive media burst refresh',
      );
      assert.equal(
        (await execute(detached, 'ivoNative.store.loadAssets()'))[0].data,
        expected.assetData,
      );
      // Move a third window's last tab into an existing window through the real IPC path.
      await focus(first);
      const receiverTabCount = await execute(
        first,
        "document.querySelectorAll('[data-tab-id]').length",
      );
      await execute(
        first,
        `ivoNative.windows.open({tab:{id:'tab-returning-view',kind:'document',docId:${JSON.stringify(expected.docId)},editing:false,pinned:true,canvasState:{camera:{x:22.25,y:10,zoom:.55},tool:'select'}}})`,
      );
      const returning = await wait(
        () => windows().find((window) => window !== first && window !== detached),
        'Return transfer source',
      );
      await ready(returning);
      await focus(returning);
      const targetBar = await execute(
          first,
          "(()=>{const r=document.querySelector('.document-tabs').getBoundingClientRect();return {x:r.right-45,y:r.top+15}})()",
        ),
        targetBounds = first.getContentBounds();
      await execute(
        returning,
        `(()=>{const tab=document.querySelector('[data-tab-id]'),r=tab.getBoundingClientRect(),x=r.x+20,y=r.y+15,endX=innerWidth+100,endY=y;const pointer=(target,type,cx,cy,sx,sy)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:cx,clientY:cy,screenX:sx,screenY:sy}));pointer(tab,'pointerdown',x,y,screenX+x,screenY+y);pointer(window,'pointermove',endX,endY,${targetBounds.x + targetBar.x},${targetBounds.y + targetBar.y});pointer(window,'pointerup',endX,endY,${targetBounds.x + targetBar.x},${targetBounds.y + targetBar.y});})()`,
      );
      await wait(
        () => returning.isDestroyed(),
        'Existing-window transfer closes acknowledged last-tab origin',
      );
      await focus(first);
      assert.equal(windows().length, 2, 'An existing-window drop created another window');
      assert.equal(
        await execute(first, "document.querySelectorAll('[data-tab-id]').length"),
        receiverTabCount + 1,
      );
      assert.equal(
        await execute(
          first,
          "document.querySelector('.workspace-view.active .zoom-value').textContent",
        ),
        '55.00%',
      );
      const returnedState = (await execute(first, "ivoNative.store.getMeta('workspace:1')")).value;
      assert.equal(
        new Set(returnedState.tabs.map((tab) => tab.id)).size,
        returnedState.tabs.length,
      );
      assert.equal(returnedState.tabs.find((tab) => tab.pinned).canvasState.camera.x, 22.25);
      await execute(
        first,
        "document.querySelector('.document-tab.active [data-close-tab]').click()",
      );
      await wait(
        async () =>
          (await execute(first, "document.querySelectorAll('[data-tab-id]').length")) ===
          receiverTabCount,
        'Close returned view',
      );
      await execute(
        first,
        "ivoNative.windows.drag('start',{label:'Shared native note',screenX:800,screenY:200,outside:true})",
      );
      const preview = await wait(
        () =>
          BrowserWindow.getAllWindows().find((window) =>
            window.webContents.getURL().startsWith('data:text/html'),
          ),
        'Native tear-off preview',
      );
      await wait(() => preview.isVisible(), 'Visible preview');
      await capture(preview, 'native-tearoff-preview.png');
      assert.equal(preview.isFocusable(), false);
      assert.equal(BrowserWindow.getFocusedWindow(), first);
      assert.equal((await execute(first, 'ivoNative.windows.info()')).active, true);
      await execute(first, "ivoNative.windows.drag('cancel',{})");
      await wait(() => preview.isDestroyed(), 'Preview cancellation');
      const manifest = JSON.parse(await fs.readFile(path.join(vaultPath, 'atlas.json'), 'utf8'));
      assert.ok(manifest.meta['workspace:1']);
      assert.ok(manifest.meta['workspace-window:' + openedInfo.windowId]);
      assert.notDeepEqual(
        manifest.meta['workspace:1'],
        manifest.meta['workspace-window:' + openedInfo.windowId],
      );
      assert.equal(Object.keys(manifest.documents).length, 1);
      await focus(first);
      const sourceZoom = await execute(first, "document.querySelector('.zoom-value').textContent");
      await execute(
        first,
        `(()=>{const tab=document.querySelector('[data-tab-id][aria-selected=true]'),rect=tab.getBoundingClientRect(),startX=rect.x+rect.width/2,startY=rect.y+rect.height/2,endX=innerWidth+100,endY=startY+60;const pointer=(target,type,x,y)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,screenX:screenX+x,screenY:screenY+y}));pointer(tab,'pointerdown',startX,startY);pointer(window,'pointermove',endX,endY);pointer(window,'pointerup',endX,endY);})()`,
      );
      const moved = await wait(
        () => windows().find((window) => window !== first && window !== detached),
        'Actual tab tear-off destination',
      );
      await wait(async () => {
        const state = await execute(moved, 'ivoNative.windows.info()');
        if (!state.ready)
          assert.equal(first.isDestroyed(), false, 'Source closed before its moved view was ready');
        return state.ready;
      }, 'Moved view readiness');
      await wait(() => first.isDestroyed(), 'Tear-off closes last-tab origin');
      await focus(moved);
      const movedInfo = await execute(moved, 'ivoNative.windows.info()');
      assert.equal(
        await execute(moved, "document.querySelector('.zoom-value').textContent"),
        sourceZoom,
        'Tear-off changed the canvas camera',
      );
      assert.equal(
        (await execute(moved, "ivoNative.store.getMeta('workspace:1')")).value.tabs[0].docId,
        expected.docId,
      );
      assert.equal(
        (await execute(moved, 'ivoNative.store.loadDocuments()')).length,
        1,
        'Moving a view duplicated authored source',
      );
      await execute(detached, 'ivoNative.windows.close()');
      await wait(() => detached.isDestroyed(), 'Closing old copied view');
      assert.equal(windows().length, 1);
      assert.equal(
        (await execute(moved, 'ivoNative.vaults.list()')).find((value) => value.id === firstInfo.id)
          .open,
        true,
      );
      await edit(moved, 'The detached note survives its original window.');
      expected = {
        ...expected,
        windowId: movedInfo.windowId,
        title: 'Shared native note',
        text: 'The detached note survives its original window.',
      };
      await fs.writeFile(statePath, JSON.stringify(expected));
      assert.equal(dialogs.length, 0, JSON.stringify(dialogs));
      console.log('IVO_NATIVE_WINDOWS_STAGE_1:PASS');
      app.quit();
    } else {
      const info = await execute(first, 'ivoNative.windows.info()');
      assert.equal(info.windowId, expected.windowId);
      assert.equal(info.main, false);
      await pause();
      assert.equal(windows().length, 1, 'A closed empty/original window should not reappear');
      assert.equal(
        (await execute(first, 'ivoNative.store.loadDocuments()'))[0].textFlows[0].html,
        `<p>${expected.text}</p>`,
      );
      const view = await execute(first, "ivoNative.store.getMeta('workspace:1')");
      assert.equal(
        view.value.tabs.find((tab) => tab.id === view.value.active).docId,
        expected.docId,
      );
      const docs = await execute(first, 'ivoNative.store.loadDocuments()'),
        assets = await execute(first, 'ivoNative.store.loadAssets()'),
        snapshot = createPDFSnapshot(docs, assets, expected.docId),
        pdf = await execute(
          first,
          'ivoNative.documents.openPreview(' + JSON.stringify(snapshot) + ')',
        );
      assert.equal(pdf.pages, 1);
      const pdfPath = opened.at(-1);
      assert.ok(pdfPath.endsWith('.pdf'));
      assert.equal((await fs.readFile(pdfPath)).subarray(0, 5).toString(), '%PDF-');
      await fs.rm(path.dirname(pdfPath), { recursive: true, force: true });
      const vaultInfo = await execute(first, 'ivoNative.vaults.info()');
      await execute(first, 'ivoNative.vaults.open(' + JSON.stringify(vaultInfo.id) + ')');
      assert.equal(
        windows().length,
        1,
        'Opening a known vault should focus its existing satellite',
      );
      const doc = (await execute(first, 'ivoNative.store.loadDocuments()'))[0];
      assert.equal(doc.title, expected.title);
      assert.equal(
        (await execute(first, 'ivoNative.store.loadAssets()'))[0].data,
        expected.assetData,
      );
      await verifyFloatingPalette(first, expected.docId);
      assert.equal(dialogs.length, 0, JSON.stringify(dialogs));
      console.log('IVO_NATIVE_WINDOWS_STAGE_2:PASS');
      app.quit();
    }
  } catch (error) {
    clearTimeout(timer);
    console.error(error.stack || error);
    app.exit(1);
  }
})();
