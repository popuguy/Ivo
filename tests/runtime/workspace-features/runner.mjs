import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-workspace-features-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-workspace-features-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-workspace-features-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const window = new BrowserWindow({
      show: true,
      width: 1500,
      height: 850,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let settled = false;
    const timer = setTimeout(() => void finish(1, { error: 'Workspace features timeout' }), 60000);
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
      if (process.env.IVO_WORKSPACE_DEBUG)
        console.log(event.message, event.sourceId || '', event.lineNumber || '');
      if (event.message?.startsWith('IVO_WORKSPACE_CHROME:')) {
        const request = JSON.parse(event.message.slice('IVO_WORKSPACE_CHROME:'.length));
        if (request.type === 'hover')
          window.webContents.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(request.x),
            y: Math.round(request.y),
          });
        else if (request.type === 'click' || request.type === 'drag') {
          const from = request.from || request;
          window.webContents.sendInputEvent({
            type: 'mouseDown',
            x: Math.round(from.x),
            y: Math.round(from.y),
            button: 'left',
            clickCount: 1,
          });
          if (request.to)
            window.webContents.sendInputEvent({
              type: 'mouseMove',
              x: Math.round(request.to.x),
              y: Math.round(request.to.y),
              modifiers: ['leftButtonDown'],
            });
          const to = request.to || from;
          window.webContents.sendInputEvent({
            type: 'mouseUp',
            x: Math.round(to.x),
            y: Math.round(to.y),
            button: 'left',
            clickCount: 1,
          });
        } else if (request.type === 'zoom') window.webContents.setZoomFactor(request.zoom);
        await window.webContents.executeJavaScript(`window.ivoWorkspaceChromeAck=${request.id}`);
        return;
      }
      if (event.message === 'IVO_WORKSPACE_FEATURES_CAPTURE' && process.env.IVO_REVIEW_DIR) {
        await mkdir(process.env.IVO_REVIEW_DIR, { recursive: true });
        await writeFile(
          path.join(process.env.IVO_REVIEW_DIR, 'workspace-features.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript('window.ivoWorkspaceFeaturesCaptured=true');
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
      if (!event.message?.startsWith('IVO_WORKSPACE_FEATURES_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_WORKSPACE_FEATURES_RESULT:'.length));
      if (result.error) return finish(1, result);
      try {
        await finish(0, result);
      } catch (error) {
        await finish(1, { error: error.stack });
      }
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window.loadURL(
      'ivo-workspace-features-test://app/tests/runtime/workspace-features/fixture.html' +
        (process.env.IVO_REVIEW_DIR ? '?capture=1' : ''),
    );
    window.focus();
    window.webContents.focus();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
