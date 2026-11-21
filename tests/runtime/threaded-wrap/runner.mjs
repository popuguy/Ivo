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
import { observeRenderedActions } from '../responsiveness/rendered-pixels.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-threaded-wrap-'));
const qualify = process.env.IVO_WRAP_BUDGET === '1';
function checkBudget(samples, medianLimit, maximumLimit, name) {
  const sorted = samples.map(({ ms }) => ms).sort((a, b) => a - b);
  const middle =
    (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  if (!Number.isFinite(middle) || middle > medianLimit || sorted.at(-1) > maximumLimit)
    throw Error(
      name +
        ' reflow exceeded its release budget: median ' +
        middle.toFixed(1) +
        ' ms, slowest ' +
        sorted.at(-1) +
        ' ms',
    );
}
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
      rendered,
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
          return {
            doc,
            assets,
            spec,
            trials: directory || qualify ? spec.edits.length : 2,
            measurePixels: process.env.IVO_WRAP_PIXELS === '1',
          };
        if (action === 'insert' && typeof value === 'string' && value.length < 1000)
          return window.webContents.insertText(value);
        function sendKey(key) {
          window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
          if (key !== 'Backspace')
            window.webContents.sendInputEvent({
              type: 'char',
              keyCode: key === 'Enter' ? '\r' : key,
            });
          window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
        }
        if (
          action === 'key' &&
          (['Backspace', 'Enter'].includes(value.key) || /^[a-z]$/.test(value.key))
        ) {
          sendKey(value.key);
          return;
        }
        if (
          action === 'capture' &&
          process.env.IVO_WRAP_PIXELS === '1' &&
          /^[kqz]$/.test(value.key)
        ) {
          const [width, height] = window.getContentSize();
          rendered ??= observeRenderedActions(window.webContents, { width, height });
          return rendered.measure(value.region, () => sendKey(value.key), 'First ink after idle');
        }
        throw Error('Unknown fixture action');
      });
      await window.loadURL('ivo-study://app/tests/runtime/threaded-wrap/fixture.html');
      focusTestWindow(window);
      const report = await window.webContents.executeJavaScript('window.study()', true);
      if (!report?.edits?.length) throw Error('No measured edits');
      if (directory)
        await writeFile(path.join(directory, 'ivo.json'), JSON.stringify(report, null, 2));
      if (qualify && process.env.IVO_LATENCY_REPORT_DIR)
        await writeFile(
          path.resolve(process.env.IVO_LATENCY_REPORT_DIR, 'threaded-wrap.json'),
          JSON.stringify(report),
        );
      console.log(
        JSON.stringify({
          baseline: report.baseline.map((s) => s.length),
          overset: report.baselineOverset,
          fragmentsPerRow: report.fragmentsPerRow,
          insertMs: report.edits.map((e) => e.ms),
          characters: report.characters,
          typing: report.typing,
          paragraphBreak: report.paragraphBreak,
          idleInk: report.idleInk,
          moveMs: report.move.ms,
        }),
      );
      if (qualify) {
        // Settled layout for every frame, including the last page. The other
        // release scenarios qualify first visible ink in a foreground window.
        checkBudget(report.edits.slice(1), 95, 160, 'Twelve-frame paste');
        checkBudget(report.characters.slice(1), 25, 60, 'Repeated character');
        checkBudget(report.typing, 45, 85, 'Consecutive unique revisions');
        if (report.idleInk) checkBudget(report.idleInk, 80, 150, 'First visible glyph after idle');
      }
      code = 0;
    } catch (error) {
      console.error(error);
    } finally {
      clearTimeout(timeout);
      rendered?.close();
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
