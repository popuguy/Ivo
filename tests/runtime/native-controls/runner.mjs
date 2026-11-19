import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import {
  prepareBackgroundTest,
  testWindowOptions,
  focusTestWindow,
} from '../helpers/background.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-controls-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivo-controls', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-controls', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      return target.startsWith(root + path.sep)
        ? net.fetch(pathToFileURL(target).href)
        : new Response('Forbidden', { status: 403 });
    });
    const window = new BrowserWindow(
      testWindowOptions({
        show: false,
        width: 1240,
        height: 900,
        webPreferences: {
          preload: path.join(root, 'tests/runtime/native-controls/preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      }),
    );
    let settled = false;
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(result, null, 2));
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    const timer = setTimeout(() => void finish(1, { error: 'Native controls timeout' }), 45000);
    ipcMain.handle('controls-input', async (event, action, value) => {
      if (event.sender !== window.webContents) throw Error('Invalid input owner');
      focusTestWindow(window);
      if (action === 'insert' && typeof value === 'string' && value.length < 100)
        return window.webContents.insertText(value);
      if (
        action !== 'key' ||
        !['Tab', 'U', '[', ']'].includes(value?.key) ||
        !Array.isArray(value.modifiers)
      )
        throw Error('Invalid test key');
      for (const type of ['keyDown', 'keyUp'])
        window.webContents.sendInputEvent({ type, keyCode: value.key, modifiers: value.modifiers });
    });
    window.webContents.on('console-message', (event) => {
      if (!event.message?.startsWith('IVO_CONTROLS_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_CONTROLS_RESULT:'.length));
      void finish(result.error ? 1 : 0, result);
    });
    window.webContents.on('render-process-gone', (_event, result) => void finish(1, result));
    await window.loadURL('ivo-controls://app/tests/runtime/native-controls/fixture.html');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
