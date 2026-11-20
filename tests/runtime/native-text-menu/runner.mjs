import { app, BrowserWindow, Menu, ipcMain, systemPreferences } from 'electron';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openVault } from '../../../desktop/vault.mjs';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
const directory = await mkdtemp(path.join(tmpdir(), 'ivo-native-text-menu-')),
  vaultPath = path.join(directory, 'Vault');
process.env.IVO_USER_DATA_DIR = path.join(directory, 'Profile');
process.env.IVO_ATLAS_DIR = vaultPath;
app.setPath('userData', process.env.IVO_USER_DATA_DIR);
const doc = createSceneDocument('Native menu text');
doc.id = 'native-text-menu-document';
const frame = insertObject(doc, 'text', doc.pages[0].id, {
  x: 48,
  y: 48,
  w: 480,
  h: 300,
  html: '<p>Alpha beta gamma.</p><p>Second regular paragraph.</p>',
});
startTextFlow(doc, frame.id, { automaticPages: false });
const lowerShape = insertObject(doc, 'polygon', doc.pages[0].id, { x: 48, y: 400, w: 60, h: 60 }),
  upperShape = insertObject(doc, 'polygon', doc.pages[0].id, { x: 140, y: 400, w: 60, h: 60 });
const vault = await openVault(vaultPath);
await vault.saveImport({ schemaVersion: 5, documents: [doc], assets: [] });
const original = doc.textFlows[0].html;
const globalForceClick = () => {
  const result = spawnSync('/usr/bin/defaults', ['read', '-g', 'com.apple.trackpad.forceClick'], {
    encoding: 'utf8',
  });
  return { status: result.status, value: result.stdout };
};
const originalGlobalForceClick = process.platform === 'darwin' && globalForceClick();
let window,
  state = null,
  stage = 'startup',
  settled = false;
const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const timer = setTimeout(
  () => void finish(1, { error: 'Native text menu timeout', stage, state }),
  45000,
);
ipcMain.on('ivo:history-state', (event, value) => {
  if (event.sender === window?.webContents) state = value;
});
async function wait(predicate, label) {
  stage = label;
  for (let i = 0; i < 600; i++) {
    const result = await predicate();
    if (result) return result;
    await pause();
  }
  const details =
    window && !window.isDestroyed()
      ? await window.webContents
          .executeJavaScript(
            `JSON.stringify({active:document.activeElement?.outerHTML?.slice(0,250),tool:document.querySelector('.scene-editor')?.dataset.tool,editor:document.querySelector('.scene-editor')?.className,notice:document.querySelector('#toast')?.textContent,composer:document.querySelector('[data-flow-composer]')?.value,editable:document.querySelector('.canvas-flow-input')?.contentEditable,selection:window.getSelection()?.toString()})`,
          )
          .catch(() => null)
      : null;
  throw new Error(label + ' timed out: ' + JSON.stringify({ state, details }));
}
async function finish(code, result) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  app.removeAllListeners('window-all-closed');
  for (const item of BrowserWindow.getAllWindows()) if (!item.isDestroyed()) item.destroy();
  await rm(directory, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify(result, null, 2));
  app.exit(code);
}
void (async () => {
  try {
    await import('../../../desktop/main.mjs');
    window = await wait(
      () =>
        BrowserWindow.getAllWindows().find(
          (item) =>
            !item.isDestroyed() &&
            item.webContents.getURL().startsWith('ivo://app/index.html') &&
            !item.webContents.getURL().includes('#vault-manager'),
        ),
      'Production window',
    );
    const execute = (code) => window.webContents.executeJavaScript(code, true),
      item = (name) => Menu.getApplicationMenu()?.getMenuItemById('type-' + name),
      send = (name) => window.webContents.send('ivo:command', name),
      source = async () => (await execute('ivoNative.store.loadDocuments()'))[0].textFlows[0].html;
    await wait(() => execute("!!document.querySelector('.workspace-pane')"), 'Workspace');
    if (process.platform === 'darwin') {
      assert.equal(systemPreferences.getUserDefault('com.apple.trackpad.forceClick', 'integer'), 0);
      assert.deepEqual(
        globalForceClick(),
        originalGlobalForceClick,
        'Ivo changed the global trackpad preference',
      );
    }
    const labels = (menu) =>
      menu.items.flatMap((item) => [item.label, ...(item.submenu ? labels(item.submenu) : [])]);
    assert.ok(
      !labels(Menu.getApplicationMenu()).some((label) =>
        ['Workspaces…', 'Restore Previous Workspace'].includes(label),
      ),
      'Paused workspace commands remain in the native menu',
    );
    window.show();
    window.focus();
    await wait(() => execute('ivoNative.windows.info().then(s=>s.active)'), 'Writer');
    const nativeItem = (id) => Menu.getApplicationMenu()?.getMenuItemById(id);
    await wait(
      () => nativeItem('show-panel-text-wrap')?.enabled,
      'Text Wrap panel in reading view',
    );
    assert.equal(nativeItem('wrap-preferences').enabled, false);
    assert.equal(nativeItem('show-contextual').enabled, false);
    send('toggle-edit');
    await wait(() => execute("!!document.querySelector('.scene-editing')"), 'Edit view');
    await execute(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const objectOrder = async () =>
        (await execute('ivoNative.store.loadDocuments()'))[0].blocks.map((item) => item.id),
      point = await execute(
        `(()=>{const r=document.querySelector('[data-object="${upperShape.id}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
      window.webContents.sendInputEvent({
        type,
        ...point,
        ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }),
      });
    await wait(() => nativeItem('send-backward')?.enabled, 'Object arrangement menu');
    assert.equal(nativeItem('wrap-preferences').enabled, true);
    assert.equal(nativeItem('show-contextual').enabled, false);
    nativeItem('show-panel-text-wrap').click();
    await wait(
      () =>
        execute(
          "document.querySelector('[data-canvas-panel=\"text-wrap\"]')?.getAttribute('aria-selected') === 'true'",
        ),
      'Window menu opened Text Wrap',
    );
    nativeItem('show-panel-properties').click();
    await wait(
      () =>
        execute(
          "document.querySelector('[data-canvas-panel=\"properties\"]')?.getAttribute('aria-selected') === 'true'",
        ),
      'Window menu reopened Properties',
    );
    assert.equal(nativeItem('send-backward').accelerator, 'CmdOrCtrl+[');
    assert.equal(nativeItem('send-back').accelerator, 'CmdOrCtrl+Shift+[');
    assert.equal(nativeItem('type-keep-options').accelerator, 'CmdOrCtrl+Alt+K');
    assert.equal(
      nativeItem('type-keep-options').enabled,
      false,
      'Keep Options enabled for an unrelated selection',
    );
    assert.equal(nativeItem('go-back').accelerator, 'CmdOrCtrl+Alt+[');
    for (const type of ['keyDown', 'keyUp'])
      window.webContents.sendInputEvent({
        type,
        keyCode: '[',
        modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
      });
    await wait(
      async () => (await objectOrder()).join() === [frame.id, upperShape.id, lowerShape.id].join(),
      'Trusted send-backward shortcut',
    );
    nativeItem('send-back').click();
    await wait(async () => (await objectOrder())[0] === upperShape.id, 'Native send-to-back menu');
    send('undo');
    await wait(async () => (await objectOrder())[1] === upperShape.id, 'Native arrangement undo');
    nativeItem('bring-front').click();
    await wait(
      async () => (await objectOrder()).at(-1) === upperShape.id,
      'Native bring-to-front menu',
    );
    const priorGuides = nativeItem('toggle-smart-guides').checked;
    nativeItem('toggle-smart-guides').click();
    await wait(
      () =>
        nativeItem('toggle-smart-guides').checked !== priorGuides &&
        state.smartGuides !== priorGuides,
      'Smart Guides checked state',
    );
    assert.equal(await source(), original, 'Smart Guides changed text source');
    for (const expected of [true, false]) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await wait(
        () =>
          execute(
            `document.querySelector('.scene-editor').classList.contains('tools-hidden')===${expected}`,
          ),
        'Production Tab panel behavior',
      );
    }
    await execute(
      `(()=>{const element=document.querySelector('[data-object="${frame.id}"]'),r=element.getBoundingClientRect();element.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,detail:2,clientX:r.x+10,clientY:r.y+10}));})()`,
    );
    send('document-text');
    await wait(
      () => execute("!!document.querySelector('.canvas-flow-input[contenteditable=true]')"),
      'Live text',
    );
    await wait(() => nativeItem('show-contextual').enabled, 'Contextual bar for text');
    const select = async (word) => {
      const selection = await execute(
        `(async()=>{const {captureTextSelection}=await import('ivo://app/src/shared/dom/text-selection.js');const root=document.querySelector('.canvas-flow-input'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const at=node.data.indexOf(${JSON.stringify(word)});if(at<0)continue;root.focus({preventScroll:true});const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+${word.length});window.getSelection().removeAllRanges();window.getSelection().addRange(range);return captureTextSelection(root);}throw new Error('Missing selected word');})()`,
      );
      await wait(() => {
        if (!state?.canFormat || !state.textTarget || !item('italic')?.enabled) return false;
        const parts = JSON.parse(state.textTarget);
        return (
          parts[4] === selection.anchor.index &&
          parts[5] === selection.focus.index &&
          parts[6] === selection.anchor.affinity &&
          parts[7] === selection.focus.affinity
        );
      }, 'Enabled text menu');
    };
    const style = (word) =>
      execute(
        `(()=>{const input=document.querySelector('.canvas-flow-input'),root=input.isContentEditable?input:document.querySelector('[data-flow-frame="${frame.id}"]'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.data.includes(${JSON.stringify(word)})){const s=getComputedStyle(node.parentElement);return {italic:s.fontStyle==='italic',bold:Number(s.fontWeight)>=600,underline:s.textDecorationLine.includes('underline')};}throw new Error('Missing styled word');})()`,
      );
    await select('beta');
    item('italic').click();
    await wait(async () => (await style('beta')).italic, 'Menu italic');
    await wait(async () => (await source()).includes('data-ivo-italic="true"'), 'Saved italic');
    assert.equal((await style('Alpha')).italic, false);
    assert.equal((await style('gamma')).italic, false);
    send('undo');
    await wait(async () => (await source()) === original, 'One-step menu undo');
    send('redo');
    await wait(async () => (await style('beta')).italic, 'Menu redo');
    await wait(async () => (await source()).includes('data-ivo-italic="true"'), 'Saved menu redo');
    await select('beta');
    const staleRangeToken = state.textTarget;
    await select('gamma');
    const changedToken = state.textTarget;
    assert.notEqual(changedToken, staleRangeToken);
    assert.equal(
      JSON.parse(changedToken)[1],
      JSON.parse(staleRangeToken)[1],
      'A pure selection changed the document version',
    );
    const beforeStale = await source();
    window.webContents.send('ivo:command', { name: 'bold', textTarget: staleRangeToken });
    await pause(100);
    assert.equal(await source(), beforeStale, 'Stale range changed source');
    item('bold').click();
    await wait(async () => (await style('gamma')).bold, 'Current bold menu');
    assert.equal((await style('beta')).bold, false);
    await wait(async () => (await source()).includes('data-ivo-bold="true"'), 'Saved range bold');
    send('undo');
    await wait(async () => !(await style('gamma')).bold, 'Bold undo');
    await wait(async () => (await source()) === beforeStale, 'Saved bold undo');
    for (const selector of ['[data-document-title]', 'input[data-object-prop="fontSize"]']) {
      const token = state.textTarget,
        before = await source();
      await execute(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await wait(
        () => state?.canFormat === false && item('italic')?.enabled === false,
        'Disabled native field',
      );
      window.webContents.send('ivo:command', { name: 'italic', textTarget: token });
      await pause(100);
      assert.equal(await source(), before, 'Native field formatted the document');
    }
    await select('Alpha');
    // Trusted Chromium input must not be double-dispatched by both menu and browser formatting.
    window.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'U',
      modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'shift'],
    });
    window.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'U',
      modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'shift'],
    });
    await wait(async () => (await style('Alpha')).underline, 'Native underline shortcut');
    assert.equal((await style('beta')).underline, false);
    await wait(
      async () => (await source()).includes('data-ivo-underline="true"'),
      'Saved native underline',
    );
    send('undo');
    await wait(async () => !(await style('Alpha')).underline, 'One-step shortcut undo');
    await wait(async () => (await source()) === beforeStale, 'Saved shortcut undo');
    send('tool-select');
    await wait(
      () =>
        execute(
          "document.querySelector('.scene-editor')?.dataset.tool === 'select' && !document.querySelector('.scene-editor').inert && document.querySelector('.canvas-flow-input')?.contentEditable !== 'true'",
        ),
      'Selection tool activated',
    );
    await execute("document.querySelector('.canvas-viewport').focus()");
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift', modifiers: [] });
    // Whole-frame formatting requires a selected text frame; this fixture now
    // also contains independent shape selections from its arrangement cases.
    const framePoint = await execute(
      `(()=>{const r=document.querySelector('[data-object="${frame.id}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
      window.webContents.sendInputEvent({
        type,
        ...framePoint,
        modifiers: [],
        ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }),
      });
    await execute(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    await wait(
      () =>
        state?.canFormat &&
        item('bold')?.enabled &&
        JSON.parse(state.textTarget)[4] === null &&
        JSON.parse(state.textTarget)[5] === null,
      'Frame target menu',
    );
    item('bold').click();
    await wait(
      async () => (await style('Alpha')).bold && (await style('Second')).bold,
      'Whole-frame menu formatting',
    );
    await wait(async () => (await source()).includes('data-ivo-bold="true"'), 'Saved frame bold');
    send('undo');
    await wait(async () => !(await style('Second')).bold, 'Whole-frame undo');
    await wait(async () => (await source()) === beforeStale, 'Saved frame undo');
    // Native continuation is delivered after the source command has committed.
    // Its revision must refresh the native menu token without another selection.
    await execute(
      `(()=>{const el=document.querySelector('[data-flow-composer]');el.value='single-line';el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      () => execute("!!document.querySelector('svg[data-composed-text]')"),
      'Native composer activation',
    );
    await execute(
      `(()=>{const auto=document.querySelector('[data-flow-auto]');auto.checked=true;auto.dispatchEvent(new Event('change',{bubbles:true}));const height=document.querySelector('[data-object-prop="h"]');height.value='20';height.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.canvas-viewport').focus();})()`,
    );
    await wait(async () => {
      const stored = (await execute('ivoNative.store.loadDocuments()'))[0];
      return (
        stored.pages.length > 1 &&
        state?.canFormat &&
        JSON.parse(state.textTarget)[1] === stored.version
      );
    }, 'Native continuation menu revision');
    item('italic').click();
    await wait(
      async () => (await style('Alpha')).italic && (await style('Second')).italic,
      'Native menu after asynchronous continuation',
    );
    send('new-tab');
    await wait(
      () => !nativeItem('show-panel-text-wrap').enabled,
      'Empty tab cleared panel commands',
    );
    assert.equal(nativeItem('wrap-preferences').enabled, false);
    assert.equal(nativeItem('show-contextual').enabled, false);
    await finish(0, {
      ok: true,
      actualTypeMenu: true,
      actualArrangeMenu: true,
      trustedBracketShortcut: true,
      smartGuidesCheckedState: true,
      productionTabPanels: true,
      partialRange: true,
      oneStepUndoRedo: true,
      staleTargetRejected: true,
      titleAndNumericDisabled: true,
      trustedShortcutNoDoubleDispatch: true,
      wholeFrameSameCommand: true,
      nativeContinuationRefreshesMenu: true,
    });
  } catch (error) {
    await finish(1, { error: error.stack });
  }
})();
