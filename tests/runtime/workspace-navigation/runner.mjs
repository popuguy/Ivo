import { app, BrowserWindow, protocol, net } from 'electron';
import {
  backgroundTest,
  prepareBackgroundTest,
  testWindowOptions,
  focusTestWindow,
} from '../helpers/background.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-workspace-navigation-'));
app.setPath('userData', profile);
prepareBackgroundTest(app);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-workspace-navigation-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-workspace-navigation-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow(
      testWindowOptions({
        enableLargerThanScreen: true,
        show: true,
        width: 1500,
        height: 850,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      }),
    );
    let settled = false;
    const timer = setTimeout(
      () => void finish(1, { error: 'Workspace navigation timeout' }),
      60000,
    );
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
      if (event.message === 'IVO_WORKSPACE_CAPTURE' && process.env.IVO_REVIEW_DIR) {
        await mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
        await writeFile(
          path.join(process.env.IVO_REVIEW_DIR, 'workspace-navigation.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript('window.ivoWorkspaceCaptured=true');
        return;
      }
      if (event.message === 'IVO_WORKSPACE_COMPACT') {
        window.setContentSize(1024, 768);
        return;
      }
      if (event.message === 'IVO_WORKSPACE_NARROW') {
        window.setSize(600, 850);
        await window.webContents.executeJavaScript('window.ivoWorkspaceNarrow=true');
        return;
      }
      if (event.message === 'IVO_WORKSPACE_WIDE') {
        window.setSize(1500, 850);
        await window.webContents.executeJavaScript('window.ivoWorkspaceWide=true');
        return;
      }
      if (!event.message?.startsWith('IVO_WORKSPACE_NAVIGATION_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_WORKSPACE_NAVIGATION_RESULT:'.length));
      if (result.error) return finish(1, result);
      try {
        await finish(0, result);
      } catch (error) {
        await finish(1, { error: error.stack });
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL(
      'ivo-workspace-navigation-test://app/tests/runtime/workspace-navigation/fixture.html' +
        (process.env.IVO_REVIEW_DIR ? '?capture=1' : ''),
    );
    focusTestWindow(window);
    if (backgroundTest) {
      window.webContents.debugger.attach();
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true,
      });
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
