import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  prepareBackgroundTest,
  testWindowOptions,
  focusTestWindow,
} from '../helpers/background.mjs';
import { nativeTextTestExecutable } from '../helpers/native-text.mjs';
import { createTextComposition } from '../../../desktop/text-composition.mjs';
import { installTextCompositionBridge } from '../../../desktop/text-composition-bridge.mjs';
import { openVault } from '../../../desktop/vault.mjs';
import { makeFixture } from './document.mjs';
import { wrapSpec } from './layout.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-threaded-wrap-'));
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivo-study', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app
  .whenReady()
  .then(async () => {
    let window,
      bridge,
      code = 1;
    const timeout = setTimeout(() => {
      console.error('Timed out waiting for six-page reflow');
      app.exit(1);
    }, 180000);
    try {
      const directory = process.env.IVO_WRAP_STUDY_DIR;
      if (!directory) await makeFixture(profile);
      const spec = directory
        ? JSON.parse(await readFile(path.join(directory, 'layout.json'), 'utf8'))
        : wrapSpec();
      const vault = await openVault(path.join(directory || profile, 'Ivo vault'));
      const doc = (await vault.loadDocuments())[0],
        assets = await vault.loadAssets();
      protocol.handle('ivo-study', ({ url }) => {
        const target = path.resolve(root, '.' + new URL(url).pathname);
        return target.startsWith(root)
          ? net.fetch(pathToFileURL(target).href)
          : new Response(null, { status: 403 });
      });
      const executable = await nativeTextTestExecutable();
      bridge = installTextCompositionBridge({
        ipcMain,
        authorize: (event) => event.sender === window?.webContents && window.webContents,
        createService: () => createTextComposition(executable),
      });
      window = new BrowserWindow(
        testWindowOptions({
          width: 1200,
          height: 900,
          webPreferences: {
            preload: path.join(root, 'tests/runtime/native-editor-composition/preload.cjs'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        }),
      );
      ipcMain.handle('ivo-native-editor-test', async (event, action, value) => {
        if (event.sender !== window.webContents) throw Error('Wrong window');
        if (action === 'load')
          return { doc, assets, spec, trials: directory ? spec.edits.length : 2 };
        if (action === 'insert' && typeof value === 'string' && value.length < 1000)
          return window.webContents.insertText(value);
        if (action === 'key' && value.key === 'Backspace') {
          for (const type of ['keyDown', 'keyUp'])
            window.webContents.sendInputEvent({ type, keyCode: 'Backspace' });
          return;
        }
        throw Error('Unknown fixture action');
      });
      await window.loadURL('ivo-study://app/tests/runtime/threaded-wrap/fixture.html');
      focusTestWindow(window);
      const report = await window.webContents.executeJavaScript('window.study()', true);
      if (!report?.edits?.length) throw Error('No measured edits');
      if (directory)
        await writeFile(path.join(directory, 'ivo.json'), JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify({
          baseline: report.baseline.map((s) => s.length),
          overset: report.baselineOverset,
          fragmentsPerRow: report.fragmentsPerRow,
          insertMs: report.edits.map((e) => e.ms),
          moveMs: report.move.ms,
        }),
      );
      code = 0;
    } catch (error) {
      console.error(error);
    } finally {
      clearTimeout(timeout);
      bridge?.close();
      window?.destroy();
      await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      app.exit(code);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
