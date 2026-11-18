import { app, BrowserWindow, protocol, net, ipcMain, clipboard, ClipboardItem } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-clipboard-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-clipboard-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    // Preserve every native clipboard representation while testing our own copy.
    const previous = await Promise.all(
      (await clipboard.read()).map(
        async (item) =>
          new ClipboardItem(
            Object.fromEntries(
              await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])),
            ),
          ),
      ),
    );
    protocol.handle('ivo-clipboard-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 850,
      webPreferences: {
        preload: path.join(root, 'tests/runtime/clipboard/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    const timer = setTimeout(() => void finish(1, { error: 'Native clipboard timeout' }), 45000);
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(result, null, 2));
      if (previous.length) await clipboard.write(previous);
      else clipboard.clear();
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    ipcMain.handle('ivo-test-native-edit', (event, command) => {
      if (event.sender !== window.webContents || !['copy', 'cut', 'paste'].includes(command))
        throw new Error('Invalid test edit');
      window.webContents[command]();
    });
    window.webContents.on('console-message', (event) => {
      if (event.message?.startsWith('IVO_CLIPBOARD_RESULT:')) {
        const result = JSON.parse(event.message.slice('IVO_CLIPBOARD_RESULT:'.length));
        void finish(result.error ? 1 : 0, result);
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL('ivo-clipboard-test://app/tests/runtime/clipboard/fixture.html');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
