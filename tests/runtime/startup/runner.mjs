import { app, dialog, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openVault } from '../../../desktop/vault.mjs';
import { openVaultRegistry } from '../../../desktop/vault-registry.mjs';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';

const directory = await mkdtemp(path.join(tmpdir(), 'ivo-quiet-startup-')),
  profile = path.join(directory, 'Profile'),
  a = await openVault(path.join(directory, 'A')),
  b = await openVault(path.join(directory, 'B'));
for (const [vault, title] of [
  [a, 'Quiet Alpha'],
  [b, 'Quiet Beta'],
]) {
  const doc = createSceneDocument(title);
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    x: 48.125,
    y: 48,
    w: 400,
    h: 200,
    html: '<p>Preserved startup source.</p>',
  });
  if (title === 'Quiet Beta')
    enableNativeComposition(
      doc,
      startTextFlow(doc, frame.id, { automaticPages: false }),
      'single-line',
    );
  await vault.saveImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
}
const originalA = JSON.stringify(await a.loadDocuments()),
  originalB = JSON.stringify(await b.loadDocuments()),
  registry = await openVaultRegistry(path.join(profile, 'vaults.json')),
  bEntry = await registry.remember(b.directory);
await registry.setOpen(bEntry.id, false);
process.env.IVO_USER_DATA_DIR = profile;
process.env.IVO_ATLAS_DIR = a.directory;
app.on('window-all-closed', () => {});
let releaseDocuments,
  releaseManager,
  holdDocuments = true,
  holdManager = false,
  holdNative = false,
  nativeStarted = false,
  releaseNative,
  failedContents = null,
  writes = 0;
const documentGate = new Promise((resolve) => {
    releaseDocuments = resolve;
  }),
  managerGate = new Promise((resolve) => {
    releaseManager = resolve;
  }),
  nativeGate = new Promise((resolve) => {
    releaseNative = resolve;
  }),
  originalHandle = ipcMain.handle.bind(ipcMain),
  created = [],
  firstShows = [];
ipcMain.handle = (channel, callback) =>
  originalHandle(channel, async (event, ...args) => {
    if (channel === 'ivo:store' && args[0] === 'loadDocuments') {
      if (holdDocuments) await documentGate;
      if (event.sender.id === failedContents)
        throw new Error('Simulated startup read failure <untrusted>');
    }
    if (
      channel === 'ivo:store' &&
      ['saveDocument', 'saveAsset', 'saveImport', 'changeLibrary'].includes(args[0])
    )
      writes++;
    if (channel === 'ivo:vaults' && args[0] === 'list' && holdManager) await managerGate;
    if (channel === 'ivo:text-composition' && args[0] === 'compose' && holdNative) {
      nativeStarted = true;
      await nativeGate;
    }
    return callback(event, ...args);
  });
dialog.showErrorBox = (title, message) => {
  console.error(title, message);
  app.exit(1);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 20)),
  execute = (window, code) => window.webContents.executeJavaScript(code, true);
async function wait(predicate, label) {
  for (let i = 0; i < 600; i++) {
    if (await predicate()) return;
    await pause();
  }
  throw new Error(
    label +
      ' ' +
      JSON.stringify(
        await Promise.all(
          created
            .filter((window) => !window.isDestroyed())
            .map(async (window) => ({
              url: window.webContents.getURL(),
              body: await execute(window, 'document.body.innerText.slice(0,1500)').catch(
                () => 'unavailable',
              ),
            })),
        ),
      ),
  );
}
async function capture(window, name) {
  const image = await window.webContents.capturePage(),
    size = image.getSize(),
    bitmap = image.toBitmap();
  let dark = 0;
  for (let y = Math.min(70, size.height - 1); y < size.height; y += 2)
    for (let x = Math.min(100, size.width - 1); x < size.width; x += 2) {
      const at = (y * size.width + x) * 4;
      if (bitmap[at] < 150 && bitmap[at + 1] < 150 && bitmap[at + 2] < 150) dark++;
    }
  assert.ok(dark > 100, 'First shown window was an empty background');
  if (process.env.IVO_REVIEW_DIR) {
    await mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
    await writeFile(path.join(process.env.IVO_REVIEW_DIR, name + '.png'), image.toPNG());
  }
}
app.on('browser-window-created', (_event, window) => {
  assert.equal(window.isVisible(), false, 'A window became visible before renderer readiness');
  created.push(window);
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('Renderer:', event.message);
  });
  window.once('show', () => {
    firstShows.push(
      (async () => {
        const state = await execute(
          window,
          `({state:document.querySelector('#app')?.dataset.startupState,loading:!!document.querySelector('.loading'),busy:document.querySelector('#app')?.getAttribute('aria-busy'),hasContent:!!document.querySelector('.canvas-world,.vault-manager,.startup-error')})`,
        );
        assert.ok(
          ['ready', 'error'].includes(state.state),
          'Window shown before workspace/error was ready',
        );
        assert.equal(state.loading, false);
        assert.equal(state.busy, 'false');
        assert.equal(state.hasContent, true);
        await capture(
          window,
          state.state === 'error'
            ? 'startup-error'
            : created.indexOf(window) === 0
              ? 'first-workspace-frame'
              : 'vault-manager-frame',
        );
      })(),
    );
    firstShows.at(-1).catch(() => {});
  });
});
const timer = setTimeout(() => {
  console.error('Quiet startup timed out');
  app.exit(1);
}, 40000);
void (async () => {
  try {
    await import('../../../desktop/main.mjs');
    await wait(() => created.length === 1, 'Initial hidden window');
    const first = created[0];
    await wait(() => first.webContents.getURL().startsWith('ivo://app/'), 'Initial navigation');
    await pause();
    assert.equal(first.isVisible(), false, 'Slow vault exposed an unfinished workspace');
    const info = await execute(first, 'ivoNative.vaults.info()');
    await execute(first, 'ivoNative.vaults.open(' + JSON.stringify(info.id) + ')');
    assert.equal(first.isVisible(), false, 'Repeated open exposed an unfinished workspace');
    holdDocuments = false;
    releaseDocuments();
    await wait(() => first.isVisible(), 'Restored workspace did not appear');
    await wait(() => firstShows.length >= created.length, 'First presentation observation');
    await Promise.all(firstShows);
    assert.equal(
      await execute(first, "document.querySelector('[data-document-title]').value"),
      'Quiet Alpha',
    );
    assert.equal((await execute(first, 'ivoNative.windows.info()')).ready, true);
    holdManager = true;
    await execute(first, 'ivoNative.vaults.manager()');
    await wait(() => created.length === 2, 'Hidden manager');
    const manager = created[1];
    await pause();
    assert.equal(manager.isVisible(), false, 'Manager exposed incomplete UI');
    holdManager = false;
    releaseManager();
    await wait(() => manager.isVisible(), 'Manager never appeared');
    await wait(() => firstShows.length >= created.length, 'First presentation observation');
    await Promise.all(firstShows);
    assert.equal(await execute(manager, "document.querySelectorAll('.vault-list-row').length"), 2);
    await execute(manager, 'ivoNative.windows.close()');
    await wait(() => manager.isDestroyed(), 'Manager close command');
    // The third window fails during startup: it must show a readable error and allow retry.
    app.once('browser-window-created', (_e, window) => {
      failedContents = window.webContents.id;
    });
    await execute(first, 'ivoNative.vaults.open(' + JSON.stringify(bEntry.id) + ')');
    await wait(() => created.length === 3 && created[2].isVisible(), 'Startup error stayed hidden');
    const failed = created[2];
    await wait(() => firstShows.length >= created.length, 'First presentation observation');
    await Promise.all(firstShows);
    assert.equal(
      await execute(failed, "document.querySelector('#app').dataset.startupState"),
      'error',
    );
    assert.equal(
      await execute(
        failed,
        "document.querySelector('.startup-error').textContent.includes('<untrusted>')",
      ),
      true,
    );
    assert.equal(
      await execute(failed, "document.querySelector('.startup-error untrusted') === null"),
      true,
    );
    assert.ok(
      await execute(
        failed,
        "document.querySelector('.startup-error').getBoundingClientRect().width > 400",
      ),
      'Error trapped in narrow shell column',
    );
    assert.equal(writes, 0, 'Startup/recovery rewrote authored data');
    failedContents = null;
    holdNative = true;
    await execute(failed, "document.querySelector('[data-retry-startup]').click()");
    await wait(() => nativeStarted, 'Restored native composition did not start');
    await execute(
      failed,
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))',
    );
    assert.equal(
      (await execute(failed, 'ivoNative.windows.info()')).ready,
      false,
      'Native startup was declared ready before its first text result',
    );
    holdNative = false;
    releaseNative();
    await wait(
      async () =>
        await execute(
          failed,
          "document.querySelector('[data-document-title]')?.value === 'Quiet Beta'",
        ),
      'Retry failed to restore original document',
    );
    await wait(
      async () => (await execute(failed, 'ivoNative.windows.info()')).ready,
      'Retry did not restore native readiness',
    );
    assert.ok(
      await execute(failed, "document.querySelectorAll('svg[data-composed-text] use').length > 0"),
      'Native startup reveal contained no text ink',
    );
    assert.equal(JSON.stringify(await a.loadDocuments()), originalA);
    assert.equal(JSON.stringify(await b.loadDocuments()), originalB);
    assert.equal(writes, 0);
    console.log(
      JSON.stringify(
        {
          ok: true,
          hiddenDuringSlowRead: true,
          repeatedOpenStaysHidden: true,
          paintedFirstWorkspaceFrame: true,
          managerWaitsForContent: true,
          visibleReadableError: true,
          retryRestoresOriginalDocument: true,
          nativeFirstInkBeforeReveal: true,
          sourceUnchanged: true,
        },
        null,
        2,
      ),
    );
    clearTimeout(timer);
    for (const window of created) if (!window.isDestroyed()) window.destroy();
    await rm(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
})();
