import { prepareBackgroundTest, testWindowOptions } from '../helpers/background.mjs';
import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectWithMouse } from '../helpers/text-mouse.mjs';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-text-core-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-text-core-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-text-core-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      return target.startsWith(root + path.sep)
        ? net.fetch(pathToFileURL(target).href)
        : new Response('Forbidden', { status: 403 });
    });
    let window,
      settled = false;
    const timer = setTimeout(() => void finish(1, { error: 'Text core timeout' }), 90000);
    async function finish(code, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(value, null, 2));
      window?.destroy();
      try {
        await rm(profile, { recursive: true, force: true, maxRetries: 4 });
      } finally {
        app.exit(code);
      }
    }
    const owned = (event) => {
      if (event.sender !== window.webContents) throw Error('Not the test window');
    };
    ipcMain.handle('ivo-text-core-select', (event, gesture) => {
      owned(event);
      return selectWithMouse(window.webContents, gesture);
    });
    ipcMain.handle('ivo-text-core-drag', async (event, from, to) => {
      owned(event);
      for (const p of [from, to])
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
          throw Error('Invalid test coordinates');
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        x: Math.round(from[0]),
        y: Math.round(from[1]),
        button: 'left',
        clickCount: 1,
      });
      for (let step = 1; step <= 20; step++) {
        await new Promise((r) => setTimeout(r, 8));
        window.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(from[0] + ((to[0] - from[0]) * step) / 20),
          y: Math.round(from[1] + ((to[1] - from[1]) * step) / 20),
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
    });
    ipcMain.handle('ivo-text-core-key', (event, key, modifiers) => {
      owned(event);
      if (
        ![
          'I',
          'B',
          'U',
          ',',
          '.',
          'A',
          'J',
          'K',
          'Left',
          'Right',
          'Up',
          'Down',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          'Backspace',
          'Delete',
          'Enter',
        ].includes(key) ||
        !Array.isArray(modifiers)
      )
        throw Error('Invalid test key');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
      if (key === 'Enter')
        window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
    });
    ipcMain.handle('ivo-text-core-type', (event, text) => {
      owned(event);
      if (typeof text !== 'string' || text.length > 100) throw Error('Invalid fixture text');
      window.webContents.sendInputEvent({ type: 'char', keyCode: text });
    });
    ipcMain.handle('ivo-text-core-ime', async (event, stage) => {
      owned(event);
      const input = window.webContents.debugger;
      if (!input.isAttached()) input.attach();
      if (stage === 'commit') return input.sendCommand('Input.insertText', { text: '日本' });
      const text = { start: 'に', update: 'にほ', cancel: '' }[stage];
      if (typeof text !== 'string') throw Error('Invalid test composition stage');
      await input.sendCommand('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    });
    ipcMain.handle('ivo-text-core-save', async (event, archive) => {
      owned(event);
      await writeFile(path.join(profile, 'archive.json'), JSON.stringify(archive));
    });
    ipcMain.handle('ivo-text-core-load', async (event) => {
      owned(event);
      return JSON.parse(await readFile(path.join(profile, 'archive.json'), 'utf8'));
    });
    async function open(phase) {
      window = new BrowserWindow(
        testWindowOptions({
          show: false,
          width: 1400,
          height: 1100,
          webPreferences: {
            preload: path.join(root, 'tests/runtime/flow-selection/preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        }),
      );
      window.webContents.on('console-message', async (event) => {
        if (!event.message?.startsWith('IVO_TEXT_CORE_RESULT:')) return;
        const result = JSON.parse(event.message.slice('IVO_TEXT_CORE_RESULT:'.length));
        if (result.error) return finish(1, result);
        if (result.phase === 'edit') {
          window.destroy();
          await open('reopen');
        } else void finish(0, result);
      });
      window.webContents.on('render-process-gone', (_e, d) => void finish(1, d));
      await window.loadURL(
        'ivo-text-core-test://app/tests/runtime/flow-selection/fixture.html?phase=' + phase,
      );
      window.webContents.focus();
    }
    await open('edit');
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
