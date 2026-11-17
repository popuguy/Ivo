import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-link-preview-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-link-preview-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-link-preview-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: true,
      width: 1200,
      height: 850,
      webPreferences: {
        preload: path.join(root, 'desktop/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    const timer = setTimeout(
      () => void finish(1, { error: 'Link preview component timeout' }),
      40000,
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
      if (event.message === 'IVO_LINK_PREVIEW_CAPTURE' && process.env.IVO_REVIEW_DIR) {
        await mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
        const capture = await window.webContents.capturePage();
        await writeFile(
          path.join(process.env.IVO_REVIEW_DIR, 'reading-preview.png'),
          capture.toPNG(),
        );
        await window.webContents.executeJavaScript('window.ivoPreviewCaptured=true');
        return;
      }
      if (!event.message?.startsWith('IVO_LINK_PREVIEW_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_LINK_PREVIEW_RESULT:'.length));
      if (result.error) return finish(1, result);
      try {
        result.zoomFactors = [];
        for (const scale of [1, 1.5, 2]) {
          window.webContents.setZoomFactor(scale);
          const actual = await window.webContents.executeJavaScript(
            'window.ivoNative.zoomFactor()',
          );
          if (Math.abs(actual - scale) > 1e-9) throw new Error('Zoom bridge mismatch');
          result.zoomFactors.push(actual);
        }
        await finish(0, result);
      } catch (error) {
        await finish(1, { error: error.stack });
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL(
      'ivo-link-preview-test://app/tests/runtime/link-preview/fixture.html' +
        (process.env.IVO_REVIEW_DIR ? '?capture=1' : ''),
    );
    window.focus();
    window.webContents.focus();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
