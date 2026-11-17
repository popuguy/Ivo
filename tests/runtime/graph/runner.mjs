import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-graph-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivo-test', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// Do not await app readiness at module top level: Electron completes loading its
// main ES module before it emits ready.
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 700,
      webPreferences: {
        backgroundThrottling: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    let finished = false;
    const finish = async (code, result) => {
      if (finished) return;
      finished = true;
      console.log(JSON.stringify(result, null, 2));
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    };
    window.webContents.on('console-message', (event) => {
      const message = event.message;
      if (message?.startsWith('IVO_GRAPH_RESULT:')) {
        const result = JSON.parse(message.slice('IVO_GRAPH_RESULT:'.length));
        void finish(result.error ? 1 : 0, result);
      } else if (message) console.log(message);
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    window.webContents.on(
      'did-fail-load',
      (_event, code, message) => void finish(1, { error: `Load failed (${code}): ${message}` }),
    );
    setTimeout(() => void finish(1, { error: 'Graph runtime test timed out' }), 30000);
    await window.loadURL('ivo-test://app/tests/runtime/graph/fixture.html');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
