import { app, BrowserWindow, clipboard, ClipboardItem } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openVault } from '../../../desktop/vault.mjs';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
const directory = await mkdtemp(path.join(tmpdir(), 'ivo-native-document-clipboard-')),
  vaultPath = path.join(directory, 'Vault');
process.env.IVO_USER_DATA_DIR = path.join(directory, 'Profile');
process.env.IVO_ATLAS_DIR = vaultPath;
app.setPath('userData', process.env.IVO_USER_DATA_DIR);
const doc = createSceneDocument('A <native> & "quoted" note');
doc.id = 'native-clipboard-document';
insertObject(doc, 'text', doc.pages[0].id, { html: '<p>Only disposable fixture content.</p>' });
const vault = await openVault(vaultPath);
await vault.saveImport({ schemaVersion: 2, documents: [doc], assets: [] });
const originalDocument = JSON.stringify((await vault.loadDocuments())[0]);
let previous = [],
  captured = false,
  window,
  settled = false,
  timer;
const write = clipboard.write.bind(clipboard),
  writeText = clipboard.writeText.bind(clipboard),
  pause = () => new Promise((resolve) => setTimeout(resolve, 25));
async function wait(predicate, label) {
  for (let i = 0; i < 400; i++) {
    const value = await predicate();
    if (value) return value;
    await pause();
  }
  throw new Error(label + ' timed out.');
}
async function finish(code, result) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  clipboard.write = write;
  clipboard.writeText = writeText;
  try {
    if (captured) {
      if (previous.length) await write(previous);
      else clipboard.clear();
    }
  } catch (error) {
    code = 1;
    result.ok = false;
    result.originalClipboardRestored = false;
    result.restoreError = error.message;
  }
  // The production quit-on-last-window callback must not preempt this fixture's cleanup/result.
  app.removeAllListeners('window-all-closed');
  for (const item of BrowserWindow.getAllWindows()) if (!item.isDestroyed()) item.destroy();
  await rm(directory, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify(result, null, 2));
  app.exit(code);
}
void (async () => {
  try {
    const snapshotClipboard = app.whenReady().then(async () => {
      previous = await Promise.all(
        (await clipboard.read()).map(
          async (item) =>
            new ClipboardItem(
              Object.fromEntries(
                await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])),
              ),
            ),
        ),
      );
      captured = true;
    });
    timer = setTimeout(() => void finish(1, { error: 'Native document clipboard timeout' }), 40000);
    await import('../../../desktop/main.mjs');
    await snapshotClipboard;
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
    await wait(
      async () =>
        window.webContents.executeJavaScript(
          "!!globalThis.ivoNative?.documents && !!document.querySelector('.workspace-pane')",
          true,
        ),
      'Production document',
    );
    const execute = (code) => window.webContents.executeJavaScript(code, true),
      info = await execute(`ivoNative.documents.info(${JSON.stringify(doc.id)})`);
    // Delay actual native writes, verifying IPC does not falsely acknowledge them first.
    for (const kind of ['relative', 'absolute']) {
      let release,
        entered = false,
        acknowledged = false;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      clipboard.writeText = async (value) => {
        entered = true;
        await gate;
        await writeText(value);
      };
      const pending = execute(
        `ivoNative.documents.copyPath(${JSON.stringify(doc.id)},${JSON.stringify(kind)})`,
      ).then((value) => {
        acknowledged = true;
        return value;
      });
      await wait(() => entered, 'Native path write entry');
      assert.equal(acknowledged, false);
      release();
      assert.equal(await pending, true);
      assert.equal(
        await clipboard.readText(),
        kind === 'relative' ? info.relativePath : info.absolutePath,
      );
      clipboard.writeText = writeText;
    }
    let release,
      entered = false,
      acknowledged = false;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    clipboard.write = async (items) => {
      assert.ok(
        Array.isArray(items) && items.length === 1 && items[0] instanceof ClipboardItem,
        'Production link did not construct ClipboardItem[]',
      );
      assert.deepEqual([...items[0].types].sort(), ['text/html', 'text/plain']);
      entered = true;
      await gate;
      await write(items);
    };
    const copied = execute(`ivoNative.documents.copyLink(${JSON.stringify(doc.id)})`).then(
      (value) => {
        acknowledged = true;
        return value;
      },
    );
    await wait(() => entered, 'Native rich write entry');
    assert.equal(acknowledged, false);
    release();
    assert.equal(await copied, true);
    assert.equal(await clipboard.readText(), '[[' + doc.title + ']]');
    const rich = (await clipboard.read()).find((item) => item.types.includes('text/html'));
    assert.ok(rich, 'Native clipboard omitted HTML');
    const html = await (await rich.getType('text/html')).text();
    assert.ok(
      html.includes(`data-doc-id="${doc.id}"`) &&
        html.includes('A &lt;native&gt; &amp; &quot;quoted&quot; note'),
      'Native rich link lost stable identity or escaped title',
    );
    clipboard.write = async () => {
      throw new Error('Simulated native clipboard failure');
    };
    await assert.rejects(
      execute(`ivoNative.documents.copyLink(${JSON.stringify(doc.id)})`),
      /Simulated native clipboard failure/,
    );
    clipboard.write = write;
    clipboard.writeText = async () => {
      throw new Error('Simulated path clipboard failure');
    };
    await assert.rejects(
      execute(`ivoNative.documents.copyPath(${JSON.stringify(doc.id)},'relative')`),
      /Simulated path clipboard failure/,
    );
    clipboard.writeText = writeText;
    await assert.rejects(
      execute("ivoNative.documents.copyLink('../outside')"),
      /existing document/,
    );
    assert.equal(
      JSON.stringify((await vault.loadDocuments())[0]),
      originalDocument,
      'Clipboard operations changed the document',
    );
    await finish(0, {
      ok: true,
      productionIpc: true,
      actualClipboardItemPayload: true,
      actualPlainAndHtml: true,
      awaitedPathAndLinkAcknowledgments: true,
      failurePropagation: true,
      stableEscapedDocumentLink: true,
      documentUnchanged: true,
      originalClipboardRestored: true,
    });
  } catch (error) {
    await finish(1, { error: error.stack });
  }
})();
