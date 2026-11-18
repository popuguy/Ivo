import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import { buildNativeFonts } from '../../../scripts/build-native-fonts.mjs';
import { createSystemFonts } from '../../../desktop/system-fonts.mjs';
import { openVault } from '../../../desktop/vault.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (process.platform !== 'darwin') {
  console.log(JSON.stringify({ ok: true, skipped: 'Core Text requires Apple platforms' }));
  app.exit(0);
} else {
  const preview = process.argv.includes('--preview');
  const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url))),
    profile = await mkdtemp(path.join(tmpdir(), 'ivo-font-test-'));
  app.setPath('userData', profile);
  app.on('window-all-closed', () => {});
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'ivo-font-test',
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
  app
    .whenReady()
    .then(async () => {
      const fonts = createSystemFonts(await buildNativeFonts()),
        vault = await openVault(path.join(profile, 'Vault'));
      protocol.handle('ivo-font-test', (request) => {
        const target = path.resolve(root, '.' + new URL(request.url).pathname);
        return target.startsWith(root + path.sep)
          ? net.fetch(pathToFileURL(target).href)
          : new Response('Forbidden', { status: 403 });
      });
      ipcMain.handle('ivo-font-test', async (event, method, value) => {
        if (
          event.senderFrame !== event.sender.mainFrame ||
          !event.senderFrame.url.startsWith('ivo-font-test://app/')
        )
          throw new Error('Invalid test request');
        if (method === 'list') return fonts.list();
        if (method === 'read') return fonts.read(value);
        if (['saveAsset', 'saveDocument', 'loadAssets', 'loadDocuments'].includes(method))
          return vault[method](value);
        throw new Error('Unknown test request');
      });
      const window = new BrowserWindow({
        show: preview,
        title: 'Ivo font verification',
        width: 1200,
        height: 850,
        webPreferences: {
          preload: path.join(root, 'tests/runtime/fonts/preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      let settled = false;
      const timer = preview
        ? null
        : setTimeout(() => void finish(1, { error: 'Font integration timed out' }), 60000);
      async function finish(code, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log(JSON.stringify(result, null, 2));
        if (!window.isDestroyed()) window.destroy();
        await rm(profile, { recursive: true, force: true });
        app.exit(code);
      }
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error' && !event.message?.startsWith('IVO_FONTS_RESULT:'))
          console.error(event.message);
        if (event.message?.startsWith('IVO_FONTS_RESULT:')) {
          const result = JSON.parse(event.message.slice('IVO_FONTS_RESULT:'.length));
          void finish(result.error ? 1 : 0, result);
        }
      });
      window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
      window.webContents.on(
        'did-fail-load',
        (_event, code, description) => void finish(1, { error: description, code }),
      );
      if (preview) window.on('closed', () => void finish(0, { previewClosed: true }));
      await window.loadURL(
        'ivo-font-test://app/tests/runtime/fonts/fixture.html' + (preview ? '?preview' : ''),
      );
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
