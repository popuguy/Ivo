import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-tab-interactions-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivo-tab-test', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-tab-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 850,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let settled = false;
    const timer = setTimeout(() => void finish(1, { error: 'Tab interactions timeout' }), 20000);
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(result, null, 2));
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    window.webContents.on('console-message', (event) => {
      if (!event.message?.startsWith('IVO_TAB_INTERACTION_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_TAB_INTERACTION_RESULT:'.length));
      void finish(result.error ? 1 : 0, result);
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL('ivo-tab-test://app/tests/runtime/tab-interaction/fixture.html');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
