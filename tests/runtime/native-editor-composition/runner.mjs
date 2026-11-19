import {
  prepareBackgroundTest,
  testWindowOptions,
  focusTestWindow,
} from '../helpers/background.mjs';
import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nativeTextTestExecutable } from '../helpers/native-text.mjs';
import { createTextComposition } from '../../../desktop/text-composition.mjs';
import { installTextCompositionBridge } from '../../../desktop/text-composition-bridge.mjs';
import { selectWithMouse } from '../helpers/text-mouse.mjs';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-native-editor-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-native-editor-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-native-editor-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      return target.startsWith(root + path.sep)
        ? net.fetch(pathToFileURL(target).href)
        : new Response('Forbidden', { status: 403 });
    });
    let window,
      settled = false,
      nativeCalls = 0;
    const service = createTextComposition(await nativeTextTestExecutable()),
      bridge = installTextCompositionBridge({
        ipcMain,
        authorize: (event) => (event.sender === window?.webContents ? window.webContents : null),
        createService: () => ({
          compose(request) {
            nativeCalls++;
            return service.compose(request);
          },
          pdf: service.pdf,
          close: service.close,
        }),
      }),
      timer = setTimeout(() => void finish(1, { error: 'Native editor timeout' }), 120000);
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify({ ...result, nativeCalls }, null, 2));
      bridge.close();
      service.close();
      window?.destroy();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
        () => {},
      );
      app.exit(code);
    }
    ipcMain.handle('ivo-native-editor-test', async (event, action, value) => {
      if (event.sender !== window.webContents) throw Error('Invalid test owner');
      if (action === 'capture') {
        const directory = process.env.IVO_TEST_CAPTURE_DIRECTORY;
        if (!directory) return false;
        if (!path.isAbsolute(directory)) throw Error('Use an absolute test capture directory');
        const name = value ?? 'paragraph-layout';
        if (!/^[a-z-]{1,60}$/.test(name)) throw Error('Use a simple test capture name');
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, name + '.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        return true;
      }
      if (action === 'save')
        return writeFile(path.join(profile, 'archive.json'), JSON.stringify(value));
      if (action === 'load')
        return JSON.parse(await readFile(path.join(profile, 'archive.json'), 'utf8'));
      focusTestWindow(window);
      if (action === 'select') return selectWithMouse(window.webContents, value);
      if (action === 'insert' && typeof value === 'string' && value.length < 20000)
        return window.webContents.insertText(value);
      if (
        action === 'key' &&
        [
          'I',
          'B',
          'U',
          'Left',
          'Right',
          'Up',
          'Down',
          'Home',
          'End',
          'Backspace',
          'Escape',
          'A',
        ].includes(value?.key) &&
        Array.isArray(value.modifiers)
      ) {
        window.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: value.key,
          modifiers: value.modifiers,
        });
        window.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: value.key,
          modifiers: value.modifiers,
        });
        return;
      }
      if (
        action === 'doubleClick' &&
        Array.isArray(value) &&
        value.length === 2 &&
        value.every(Number.isFinite)
      ) {
        for (const clickCount of [1, 2]) {
          window.webContents.sendInputEvent({
            type: 'mouseDown',
            x: Math.round(value[0]),
            y: Math.round(value[1]),
            button: 'left',
            clickCount,
          });
          window.webContents.sendInputEvent({
            type: 'mouseUp',
            x: Math.round(value[0]),
            y: Math.round(value[1]),
            button: 'left',
            clickCount,
          });
        }
        return;
      }
      if (
        action === 'drag' &&
        [value?.from, value?.to].every(
          (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
        )
      ) {
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
        for (let i = 1; i <= 16; i++) {
          await new Promise((r) => setTimeout(r, 8));
          window.webContents.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(from[0] + ((to[0] - from[0]) * i) / 16),
            y: Math.round(from[1] + ((to[1] - from[1]) * i) / 16),
            button: 'left',
            modifiers: ['leftButtonDown'],
          });
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
      throw Error('Unknown test action');
    });
    async function open(phase) {
      window = new BrowserWindow(
        testWindowOptions({
          show: true,
          width: 1400,
          height: 1050,
          webPreferences: {
            preload: path.join(root, 'tests/runtime/native-editor-composition/preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        }),
      );
      window.webContents.on('console-message', (event) => {
        if (!event.message?.startsWith('IVO_NATIVE_EDITOR_RESULT:')) return;
        const result = JSON.parse(event.message.slice('IVO_NATIVE_EDITOR_RESULT:'.length));
        if (result.error) return void finish(1, result);
        if (result.phase === 'edit') {
          window.destroy();
          void open('reopen');
        } else void finish(0, result);
      });
      window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
      await window.loadURL(
        'ivo-native-editor-test://app/tests/runtime/native-editor-composition/fixture.html?phase=' +
          phase,
      );
      focusTestWindow(window);
    }
    await open('edit');
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
