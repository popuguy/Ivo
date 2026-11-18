import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildNativeText } from '../../../scripts/build-native-text.mjs';
import { createTextComposition } from '../../../desktop/text-composition.mjs';
import { inspectFont } from '../../../src/domain/text/fonts.js';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-native-input-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-native-input',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    const service = createTextComposition(await buildNativeText()),
      resources = [];
    for (const [id, file] of Object.entries({
      'cmu-regular': 'cmunrm.ttf',
      'cmu-italic': 'cmunti.ttf',
      'cmu-bold': 'cmunbx.ttf',
      'cmu-bold-italic': 'cmunbi.ttf',
    })) {
      const bytes = await readFile(path.join(root, 'public/fonts/cmu-serif', file));
      resources.push({
        id,
        postscript: inspectFont(bytes).postscript,
        digest: createHash('sha256').update(bytes).digest('hex'),
        data: bytes.toString('base64'),
      });
    }
    protocol.handle('ivo-native-input', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: true,
      width: 1100,
      height: 850,
      webPreferences: {
        preload: path.join(root, 'tests/runtime/native-composition-geometry/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    const timer = setTimeout(
      () => void finish(1, { error: 'Native input geometry timeout' }),
      90000,
    );
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(result, null, 2));
      service.close();
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    ipcMain.handle('ivo-native-input-test', async (event, action, value) => {
      if (event.sender !== window.webContents) throw Error('Invalid native input test owner');
      if (action === 'compose')
        return service.compose({
          ...value,
          sourceDigest: createHash('sha256').update(value.sourceHTML).digest('hex'),
          resources,
          allowFallback: false,
          includeVectors: true,
          frames: [
            { id: 'first', width: 200, height: 90 },
            { id: 'second', width: 300, height: 250 },
          ],
        });
      if (action === 'insert' && typeof value === 'string' && value.length < 100)
        return window.webContents.insertText(value);
      if (
        action === 'drag' &&
        [value?.from, value?.to].every(
          (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
        )
      ) {
        window.focus();
        window.webContents.focus();
        const [from, to] = [value.from, value.to];
        window.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(from[0]),
          y: Math.round(from[1]),
        });
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          x: Math.round(from[0]),
          y: Math.round(from[1]),
          button: 'left',
          clickCount: 1,
        });
        for (let i = 1; i <= 8; i++) {
          window.webContents.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(from[0] + ((to[0] - from[0]) * i) / 8),
            y: Math.round(from[1] + ((to[1] - from[1]) * i) / 8),
            button: 'left',
            modifiers: ['leftButtonDown'],
          });
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          x: Math.round(to[0]),
          y: Math.round(to[1]),
          button: 'left',
          clickCount: 1,
        });
        return;
      }
      throw Error('Unknown native input test action');
    });
    window.webContents.on('console-message', (event) => {
      if (event.message?.startsWith('IVO_NATIVE_INPUT_RESULT:')) {
        const result = JSON.parse(event.message.slice('IVO_NATIVE_INPUT_RESULT:'.length));
        void finish(result.error ? 1 : 0, result);
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL(
      'ivo-native-input://app/tests/runtime/native-composition-geometry/fixture.html',
    );
    window.focus();
    window.webContents.focus();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
