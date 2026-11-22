import { app, BrowserWindow, dialog, Menu } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { openVault } from '../../../desktop/vault.mjs';
import { openVaultRegistry } from '../../../desktop/vault-registry.mjs';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
const root = await fs.mkdtemp(path.join(tmpdir(), 'ivo-native-vaults-')),
  aPath = path.join(root, 'A'),
  bPath = path.join(root, 'B'),
  profile = path.join(root, 'Profile');
const a = await openVault(aPath),
  b = await openVault(bPath),
  doc = createSceneDocument('A original');
doc.id = 'same-id';
insertObject(doc, 'text', doc.pages[0].id, { html: '<p>A original source.</p>' });
await a.saveImport({
  schemaVersion: 5,
  documents: [doc],
  assets: [
    {
      id: 'same-asset',
      name: 'A.bin',
      mimeType: 'image/png',
      data: 'data:image/png;base64,AQIDBA==',
    },
  ],
});
const other = structuredClone(doc);
other.title = 'B original';
other.blocks[0].html = '<p>B original source.</p>';
await b.saveImport({
  schemaVersion: 5,
  documents: [other],
  assets: [
    {
      id: 'same-asset',
      name: 'B.bin',
      mimeType: 'image/png',
      data: 'data:image/png;base64,BAQDAg==',
    },
  ],
});
const registry = await openVaultRegistry(path.join(profile, 'vaults.json')),
  bEntry = await registry.remember(bPath);
await registry.setOpen(bEntry.id, false);
const collection = path.join(root, 'UnbrokenPathComponent'.repeat(5));
for (let index = 1; index <= 10; index++) {
  const folder = path.join(collection, 'Collection ' + index);
  await fs.mkdir(folder, { recursive: true });
  const entry = await registry.remember(folder);
  await registry.setOpen(entry.id, false);
}
process.env.IVO_USER_DATA_DIR = profile;
process.env.IVO_ATLAS_DIR = aPath;
let pick = { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: path.join(root, 'native-export.pdf'),
});
dialog.showOpenDialog = async () => structuredClone(pick);
dialog.showErrorBox = (title, message) => {
  console.error(title, message);
  app.exit(1);
};
const timer = setTimeout(() => {
  console.error('Vault window test timed out');
  app.exit(1);
}, 40000);
const pause = () => new Promise((resolve) => setTimeout(resolve, 25)),
  wait = async (predicate) => {
    for (let i = 0; i < 400; i++) {
      const value = await predicate();
      if (value) return value;
      await pause();
    }
    throw new Error(
      'Vault window wait failed: ' +
        JSON.stringify(
          windows().map((window) => ({
            url: window.webContents.getURL(),
            title: window.getTitle(),
            visible: window.isVisible(),
            focusable: window.isFocusable(),
            focused: window.isFocused(),
          })),
        ),
    );
  };
const execute = (window, code) => window.webContents.executeJavaScript(code, true),
  windows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
void (async () => {
  try {
    app.on('browser-window-created', (_event, window) => {
      window.webContents.on('did-fail-load', (_event, code, description, url) =>
        console.error('Window load failed', code, description, url),
      );
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error('Renderer:', event.message);
      });
    });
    await import('../../../desktop/main.mjs');
    const wa = await wait(() =>
      windows().find((w) => w.webContents.getURL().startsWith('ivo://app/index.html')),
    );
    await wait(async () => execute(wa, "!!document.querySelector('.canvas-world')"));
    const aInfo = await execute(wa, 'ivoNative.vaults.info()');
    assert.equal(aInfo.name, 'A');
    await execute(wa, 'ivoNative.vaults.open(' + JSON.stringify(bEntry.id) + ')');
    const wb = await wait(() => windows().find((w) => w !== wa));
    await wait(async () => execute(wb, "!!document.querySelector('.canvas-world')"));
    assert.equal((await execute(wb, 'ivoNative.store.loadDocuments()'))[0].title, 'B original');
    assert.notEqual(wa.webContents.session, wb.webContents.session);
    await execute(
      wa,
      "ivoNative.store.loadDocuments().then(d=>ivoNative.store.saveDocument({...d[0],title:'A saved after opening B'}))",
    );
    assert.equal((await execute(wb, 'ivoNative.store.loadDocuments()'))[0].title, 'B original');
    assert.equal((await execute(wa, 'ivoNative.store.loadAssets()'))[0].name, 'A.bin');
    assert.equal((await execute(wb, 'ivoNative.store.loadAssets()'))[0].name, 'B.bin');
    const count = windows().length;
    await execute(wb, 'ivoNative.vaults.open(' + JSON.stringify(aInfo.id) + ')');
    assert.equal(windows().length, count, 'Opening an already open vault created a second writer');
    const snapshot = createPDFSnapshot(
      await execute(wa, 'ivoNative.store.loadDocuments()'),
      await execute(wa, 'ivoNative.store.loadAssets()'),
      'same-id',
    );
    const exported = await execute(wa, 'ivoNative.exportPDF(' + JSON.stringify(snapshot) + ')');
    assert.equal(exported.pages, 1);
    assert.equal(
      (await fs.readFile(path.join(root, 'native-export.pdf'))).subarray(0, 5).toString(),
      '%PDF-',
    );
    // The picker is replaced only inside this test process; renderer requests never accept arbitrary paths.
    assert.equal((await execute(wa, 'ivoNative.vaults.choose()')).canceled, true);
    const foreign = path.join(root, 'Foreign');
    await fs.mkdir(foreign);
    await fs.writeFile(path.join(foreign, 'keep.txt'), 'Keep original');
    pick = { canceled: false, filePaths: [foreign] };
    await assert.rejects(execute(wa, 'ivoNative.vaults.choose()'), /not an Ivo atlas/);
    assert.equal(await fs.readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'Keep original');
    assert.equal(
      (await execute(wa, 'ivoNative.store.loadDocuments()'))[0].title,
      'A saved after opening B',
    );
    // Real app menus and file-backed workspace restore include nested split references.
    await execute(wb, 'document.querySelector(\'[data-action="options"]\').click()');
    await wait(async () =>
      execute(wb, '!!document.querySelector(\'#dialog [data-action="split-right"]\')'),
    );
    await execute(wb, 'document.querySelector(\'#dialog [data-action="split-right"]\').click()');
    await wait(async () =>
      execute(
        wb,
        "document.querySelectorAll('[data-workspace-group]').length===2&&!document.querySelector('#dialog').open",
      ),
    );
    // A native-focus assertion needs to activate its own isolated process on macOS.
    app.focus({ steal: true });
    wb.focus();
    await wait(() => BrowserWindow.getFocusedWindow() === wb);
    const windowMenu = Menu.getApplicationMenu().items.find(
      (item) => item.label === 'Window',
    ).submenu;
    windowMenu.items.find((item) => item.label === 'Split Down').click();
    await wait(async () =>
      execute(wb, "document.querySelectorAll('[data-workspace-group]').length===3"),
    );
    await execute(wb, 'document.querySelector(\'[data-action="options"]\').click()');
    await wait(async () =>
      execute(wb, '!!document.querySelector(\'#dialog [data-action="merge-pane"]\')'),
    );
    await execute(wb, 'document.querySelector(\'#dialog [data-action="merge-pane"]\').click()');
    await wait(async () =>
      execute(wb, "document.querySelectorAll('[data-workspace-group]').length===2"),
    );
    await execute(wb, 'document.querySelector(\'[data-action="new-tab"]\').click()');
    await wait(async () => execute(wb, "!!document.querySelector('.empty-document-tab')"));
    wb.close();
    await wait(() => wb.isDestroyed());
    await execute(wa, 'ivoNative.vaults.open(' + JSON.stringify(bEntry.id) + ')');
    const reopened = await wait(() => windows().find((w) => w !== wa));
    await wait(async () => execute(reopened, "!!document.querySelector('.empty-document-tab')"));
    assert.equal(
      (await execute(reopened, 'ivoNative.store.loadDocuments()'))[0].title,
      'B original',
    );
    assert.equal(
      await execute(reopened, "document.querySelectorAll('[data-workspace-group]').length"),
      2,
    );
    assert.equal(
      (await execute(reopened, "ivoNative.store.getMeta('workspace:1')")).value.groups.length,
      2,
    );
    await assert.rejects(
      execute(wa, 'ivoNative.vaults.forget(' + JSON.stringify(bEntry.id) + ')'),
      /Close this vault/,
    );
    pick = { canceled: false, filePaths: [root] };
    await execute(wa, "ivoNative.vaults.create('Created vault')");
    const created = await wait(() => windows().find((w) => w !== wa && w !== reopened));
    await wait(async () => execute(created, "!!document.querySelector('.empty-document-tab')"));
    assert.equal((await execute(created, 'ivoNative.store.loadDocuments()')).length, 0);
    assert.equal((await execute(created, 'ivoNative.vaults.info()')).name, 'Created vault');
    await execute(wa, 'ivoNative.vaults.manager()');
    const manager = await wait(() =>
      windows().find((w) => w.webContents.getURL().endsWith('#vault-manager')),
    );
    await wait(async () => execute(manager, "!!document.querySelector('.vault-manager')"));
    await assert.rejects(
      execute(manager, 'ivoNative.store.loadDocuments()'),
      /Invalid vault operation/,
    );
    assert.deepEqual(manager.getSize(), [800, 650]);
    assert.equal(manager.isResizable(), false);
    if (process.platform === 'darwin') {
      assert.equal(manager.isMaximizable(), false);
      assert.equal(manager.isFullScreenable(), false);
    }
    assert.ok(wa.isResizable());
    await execute(wa, 'ivoNative.vaults.manager()');
    assert.equal(
      windows().filter((window) => window.webContents.getURL().endsWith('#vault-manager')).length,
      1,
    );
    const layout = await execute(
      manager,
      `(() => {
      const list = document.querySelector('.vault-list'), sidebar = list.parentElement.getBoundingClientRect();
      const options = [...list.querySelectorAll('.vault-list-options')];
      const action = document.querySelector('[data-picker="create"]');
      const withinSidebar = options.every(option => {
        const bounds = option.getBoundingClientRect();
        return bounds.left >= sidebar.left && bounds.right <= sidebar.right &&
          option.previousElementSibling.getBoundingClientRect().right <= bounds.left;
      });
      list.scrollTop = list.scrollHeight;
      const last = options.at(-1).getBoundingClientRect();
      const reachable = document.elementFromPoint(last.x + last.width/2,last.y + last.height/2)?.closest('button') === options.at(-1);
      list.scrollTop = 0;
      const button = action.getBoundingClientRect();
      return {rail:sidebar.width, withinSidebar, reachable, scrolls:list.scrollHeight>list.clientHeight,
        overflow:list.scrollWidth-list.clientWidth, actionClickable:document.elementFromPoint(button.x+button.width/2,button.y+button.height/2) === action};
    })()`,
    );
    assert.deepEqual(layout, {
      rail: 280,
      withinSidebar: true,
      reachable: true,
      scrolls: true,
      overflow: 0,
      actionClickable: true,
    });
    if (process.env.IVO_VAULT_PICKER_SCREENSHOT) {
      await fs.writeFile(
        process.env.IVO_VAULT_PICKER_SCREENSHOT,
        (await manager.webContents.capturePage()).toPNG(),
      );
    }
    // Cancel both folder dialogs and preserve the name when the user returns.
    pick = { canceled: true, filePaths: [] };
    await execute(manager, "document.querySelector('[data-picker=choose]').click()");
    await wait(async () =>
      execute(manager, "!document.querySelector('.vault-manager[aria-busy=true]')"),
    );
    await execute(manager, "document.querySelector('[data-picker=create]').click()");
    await wait(async () => execute(manager, "!!document.getElementById('new-vault-name')"));
    await execute(
      manager,
      `const input = document.getElementById('new-vault-name');
      input.value = 'Studio'; input.dispatchEvent(new Event('input',{bubbles:true}));
      input.form.requestSubmit();`,
    );
    await wait(async () =>
      execute(
        manager,
        "document.getElementById('new-vault-name')?.value === 'Studio' && !document.querySelector('.vault-manager[aria-busy=true]')",
      ),
    );
    await execute(manager, "document.querySelector('[data-picker=back]').click()");
    await wait(async () => execute(manager, "!!document.querySelector('[data-picker=create]')"));
    await execute(
      manager,
      `document.querySelector('[data-id="${bEntry.id}"] .vault-list-options').click()`,
    );
    assert.ok(
      await execute(
        manager,
        "!!document.querySelector('[data-navigation-action=forget]:disabled')",
      ),
    );
    await execute(
      manager,
      "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    created.close();
    await wait(() => created.isDestroyed());
    const createdId = (await execute(wa, 'ivoNative.vaults.list()')).find(
      (entry) => entry.name === 'Created vault',
    ).id;
    const rowSelector = '[data-id="' + createdId + '"]';
    await execute(
      manager,
      `document.querySelector('${rowSelector}').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await wait(async () => execute(manager, "!!document.querySelector('[role=menu]')"));
    await execute(
      manager,
      "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    assert.equal(await execute(manager, "!!document.querySelector('[role=menu]')"), false);
    await execute(manager, `document.querySelector('${rowSelector} .vault-list-options').click()`);
    await wait(async () =>
      execute(
        manager,
        "!!document.querySelector('[data-navigation-action=forget]:not(:disabled)')",
      ),
    );
    await execute(manager, "document.querySelector('[data-navigation-action=forget]').click()");
    await wait(
      async () =>
        !(await execute(wa, 'ivoNative.vaults.list()')).some((entry) => entry.id === createdId),
    );
    assert.ok((await fs.stat(path.join(root, 'Created vault', 'atlas.json'))).isFile());
    await execute(manager, `document.querySelector('[data-vault-open="${bEntry.id}"]').click()`);
    await wait(() => manager.isDestroyed());
    assert.ok(!reopened.isDestroyed());
    clearTimeout(timer);
    console.log(
      JSON.stringify(
        {
          ok: true,
          nativePDFExportStillWorks: true,
          windowPerVault: true,
          focusDeduplication: true,
          independentPartitions: true,
          sameDocumentAndAssetIdsIsolated: true,
          lateWriteStaysWithOwner: true,
          cancelAndForeignFolderPreservation: true,
          workspaceReopened: true,
          splitMenusAndFileBackedRestore: true,
          createVault: true,
          forgetOpenBlocked: true,
          managerHasNoDocumentAccess: true,
          managerRefreshAndForgetPreserveFolder: true,
        },
        null,
        2,
      ),
    );
    app.exit(0);
  } catch (error) {
    clearTimeout(timer);
    console.error(error.stack || error);
    app.exit(1);
  }
})();
