import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import {
  prepareBackgroundTest,
  testWindowOptions,
  focusTestWindow,
} from '../helpers/background.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectWithMouse } from '../helpers/text-mouse.mjs';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-text-wrap-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivo-text-wrap', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-text-wrap', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      return target.startsWith(root + path.sep)
        ? net.fetch(pathToFileURL(target).href)
        : new Response('Forbidden', { status: 403 });
    });
    let window,
      settled = false;
    const timer = setTimeout(
      () => void finish(1, { error: 'Text-wrap component timeout' }),
      120000,
    );
    async function finish(code, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(value, null, 2));
      window?.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    ipcMain.handle('ivo-text-wrap-test', async (event, action, value) => {
      if (event.sender !== window?.webContents) throw Error('Invalid text-wrap test owner');
      if (action === 'capture') {
        const directory = process.env.IVO_TEST_CAPTURE_DIRECTORY;
        if (!directory) return false;
        if (!path.isAbsolute(directory)) throw Error('Use an absolute test capture directory');
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, 'wrap-properties.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        return true;
      }
      if (action === 'save')
        return writeFile(path.join(profile, 'archive.json'), JSON.stringify(value));
      if (action === 'load')
        return JSON.parse(await readFile(path.join(profile, 'archive.json'), 'utf8'));
      if (action === 'select') {
        focusTestWindow(window);
        return selectWithMouse(window.webContents, value);
      }
      if (
        action === 'key' &&
        ['Down', 'Up', 'Home', 'End', 'Left', 'Right'].includes(value?.key) &&
        Array.isArray(value.modifiers) &&
        value.modifiers.every((key) => key === 'shift' || key === 'meta')
      ) {
        focusTestWindow(window);
        for (const type of ['keyDown', 'keyUp'])
          window.webContents.sendInputEvent({
            type,
            keyCode: value.key,
            modifiers: value.modifiers,
          });
        return;
      }
      if (action === 'insert' && typeof value === 'string' && value.length <= 100) {
        focusTestWindow(window);
        return window.webContents.insertText(value);
      }
      throw Error('Invalid text-wrap test operation');
    });
    async function open(phase) {
      window = new BrowserWindow(
        testWindowOptions({
          show: false,
          width: 1320,
          height: 980,
          webPreferences: {
            preload: path.join(root, 'tests/runtime/text-wrap/preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        }),
      );
      window.webContents.on('console-message', (event) => {
        if (!event.message?.startsWith('IVO_TEXT_WRAP_RESULT:')) return;
        const result = JSON.parse(event.message.slice('IVO_TEXT_WRAP_RESULT:'.length));
        if (result.error) return void finish(1, result);
        if (result.phase === 'edit') {
          window.destroy();
          void open('reopen').catch((e) => finish(1, { error: e.stack }));
        } else void finish(0, result);
      });
      window.webContents.on('render-process-gone', (_event, result) => void finish(1, result));
      await window.loadURL(
        'ivo-text-wrap://app/tests/runtime/text-wrap/fixture.html?phase=' + phase,
      );
      window.webContents.focus();
    }
    await open('edit');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
