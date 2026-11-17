import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-editor-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-editor-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-editor-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        preload: path.join(root, 'desktop/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    const timer = setTimeout(() => void finish(1, { error: 'Editor component timeout' }), 20000);
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
      if (!event.message?.startsWith('IVO_EDITOR_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_EDITOR_RESULT:'.length));
      if (result.error) return finish(1, result);
      try {
        result.zoomFactors = [];
        for (const scale of [1, 1.5, 2]) {
          window.webContents.setZoomFactor(scale);
          const actual = await window.webContents.executeJavaScript(
            'window.ivoNative.zoomFactor()',
          );
          if (Math.abs(actual - scale) > 1e-9) throw new Error('Zoom bridge mismatch');
          result.zoomFactors.push(actual);
        }
        await finish(0, result);
      } catch (error) {
        await finish(1, { error: error.stack });
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL('ivo-editor-test://app/tests/runtime/editor/fixture.html');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
