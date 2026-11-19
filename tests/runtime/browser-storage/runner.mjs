import { prepareBackgroundTest, testWindowOptions } from '../helpers/background.mjs';
import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-browser-store-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-browser-store-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-browser-store-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow(
      testWindowOptions({
        show: false,
        width: 1200,
        height: 850,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      }),
    );
    let settled = false;
    const timer = setTimeout(
      () => void finish(1, { error: 'Browser storage migration timeout' }),
      20000,
    );
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(result, null, 2));
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    window.webContents.on('console-message', async (event) => {
      if (!event.message?.startsWith('IVO_BROWSER_STORE_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_BROWSER_STORE_RESULT:'.length));
      if (result.error) return finish(1, result);
      try {
        await finish(0, result);
      } catch (error) {
        await finish(1, { error: error.stack });
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL('ivo-browser-store-test://app/tests/runtime/browser-storage/fixture.html');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
