import {
  prepareBackgroundTest,
  testWindowOptions,
  focusTestWindow,
} from '../helpers/background.mjs';
import assert from 'node:assert/strict';
import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-shell-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivo-shell-test', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-shell-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow(
      testWindowOptions({
        show: true,
        width: 1500,
        height: 900,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      }),
    );
    let settled = false;
    const timer = setTimeout(() => void finish(1, { error: 'Shell application timeout' }), 90000);
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (process.env.IVO_REVIEW_DIR) {
        await mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
        await writeFile(
          path.join(process.env.IVO_REVIEW_DIR, 'shell-final.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
      }
      console.log(JSON.stringify(result, null, 2));
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    window.webContents.on('console-message', async (event) => {
      if (event.message.startsWith('IVO_TAB_SEAM:')) {
        try {
          const { x, y, samples, inactive } = JSON.parse(
            event.message.slice('IVO_TAB_SEAM:'.length),
          );
          const width = Math.max(...samples, inactive) - x + 1;
          const strip = await window.webContents.capturePage({ x, y: y - 2, width, height: 3 });
          const bitmap = strip.toBitmap({ scaleFactor: 1 });
          const stride = strip.getSize(1).width;
          const rgb = (column, row) => bitmap.readUIntLE(4 * (row * stride + column - x), 3);
          for (const column of samples)
            assert.equal(rgb(column, 1), rgb(column, 2), 'Visible rule beneath selected tab');
          assert.notEqual(rgb(inactive, 1), rgb(inactive, 0), 'Missing divider under inactive tab');
          await window.webContents.executeJavaScript('window.ivoTabSeamChecked=true');
        } catch (error) {
          await finish(1, { error: error.message });
        }
        return;
      }
      if (event.message === 'IVO_SHELL_CAPTURE' && process.env.IVO_REVIEW_DIR) {
        await mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
        await writeFile(
          path.join(process.env.IVO_REVIEW_DIR, 'shell-workspace.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript('window.ivoShellCaptured=true');
        return;
      }
      if (!event.message?.startsWith('IVO_SHELL_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_SHELL_RESULT:'.length));
      void finish(result.error ? 1 : 0, result);
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL(
      'ivo-shell-test://app/tests/runtime/shell/fixture.html' +
        (process.argv.includes('--tab-seam')
          ? '?tab-seam=1'
          : process.env.IVO_REVIEW_DIR
            ? '?capture=1'
            : ''),
    );
    focusTestWindow(window);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
