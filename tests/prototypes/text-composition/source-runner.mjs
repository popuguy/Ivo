import { app, BrowserWindow, protocol } from 'electron';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-composition-source-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-source-proof',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-source-proof', async (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      const type = target.endsWith('.html') ? 'text/html' : 'text/javascript';
      try {
        return new Response(await readFile(target), { headers: { 'Content-Type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let finished = false,
      loaded = false,
      pending = null;
    const timer = setTimeout(() => void finish({ error: 'Source adapter timed out' }), 15000);
    async function finish(value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (value.error) console.error(value.error);
      else await writeFile(process.argv[2], JSON.stringify(value));
      window.destroy();
      await rm(profile, { recursive: true, force: true });
      app.exit(value.error ? 1 : 0);
    }
    window.webContents.on('console-message', (event) => {
      if (event.message.startsWith('IVO_COMPOSITION_SOURCE:')) {
        pending = JSON.parse(event.message.slice('IVO_COMPOSITION_SOURCE:'.length));
        if (loaded) void finish(pending);
      }
    });
    window.webContents.on(
      'render-process-gone',
      (_event, details) => void finish({ error: JSON.stringify(details) }),
    );
    await window.loadURL('ivo-source-proof://app/tests/prototypes/text-composition/fixture.html');
    loaded = true;
    if (pending) await finish(pending);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
