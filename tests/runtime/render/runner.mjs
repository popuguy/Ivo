import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const density = Number(process.env.IVO_TEST_SCALE || 2);
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-render-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-render-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-render-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    // Offscreen paint emits submitted compositor frames. capturePage after a RAF can
    // still return the previous frame and cannot establish which new frame was first.
    const window = new BrowserWindow({
      show: false,
      width: 1200 * density,
      height: 850 * density,
      webPreferences: {
        zoomFactor: density,
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setFrameRate(60);
    let settled = false,
      pending = null,
      lastPaint = null;
    const timer = setTimeout(
        () =>
          void finish(1, {
            error: 'Renderer test timeout',
            pending: pending?.name,
            frames: framesSeen,
          }),
        30000,
      ),
      images = new Map(),
      paintStages = [];
    let framesSeen = 0;
    async function finish(code, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(JSON.stringify(result, null, 2));
      window.destroy();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      app.exit(code);
    }
    async function acceptFrame(frame) {
      if (!pending || settled) return;
      const pixels = frame.toBitmap(),
        [r, g, b] = pending.stage;
      if (pixels[2] !== r || pixels[1] !== g || pixels[0] !== b || pixels[3] !== 255) return;
      const capture = pending;
      pending = null;
      const scale = frame.getSize().width / capture.viewportWidth,
        rect = capture.rect;
      const image = frame.crop({
        x: Math.round(rect.x * scale),
        y: Math.round(rect.y * scale),
        width: Math.round(rect.width * scale),
        height: Math.round(rect.height * scale),
      });
      if (capture.zoom) {
        const buffer = image.toBitmap(),
          size = image.getSize();
        let left = Infinity,
          right = -Infinity;
        for (let y = 0; y < Math.min(size.height, Math.ceil(40 * scale)); y++)
          for (let x = 0; x < Math.min(size.width, Math.ceil(120 * scale)); x++) {
            const i = (y * size.width + x) * 4;
            if (
              buffer[i] > 250 &&
              buffer[i + 1] < 5 &&
              buffer[i + 2] > 250 &&
              buffer[i + 3] > 250
            ) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        const width = right - left + 1;
        if (Math.abs(width - 20 * capture.zoom * scale) > 2)
          throw new Error(
            'Submitted zoom frame has wrong marker geometry: ' +
              JSON.stringify({
                name: capture.name,
                width,
                expected: 20 * capture.zoom * scale,
                size,
                scale,
              }),
          );
      }
      // The synthetic magenta geometry marker is above the document content.
      // Keep its separate geometry assertion, but exclude its band (including
      // incremental-damage antialias fringes) from the live/cold ink comparison.
      const ink = /^(live|cold)-/.test(capture.name)
        ? image.crop({
            x: 0,
            y: Math.ceil(28 * scale),
            width: image.getSize().width,
            height: image.getSize().height - Math.ceil(28 * scale),
          })
        : image;
      images.set(capture.name, ink);
      paintStages.push({ name: capture.name, frame: framesSeen });
      const output = process.env.IVO_REVIEW_DIR || path.resolve(root, '../work/crisp-rendering');
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, capture.name + '.png'), image.toPNG());
      await window.webContents.executeJavaScript('window.__renderCaptureDone()');
    }
    window.webContents.on('paint', (_event, _dirty, image) => {
      framesSeen++;
      lastPaint = image;
      void acceptFrame(image).catch((error) => finish(1, { error: error.stack }));
    });
    window.webContents.on('console-message', async (event) => {
      if (event.message?.startsWith('IVO_RENDER_FRAME:')) {
        pending = JSON.parse(event.message.slice('IVO_RENDER_FRAME:'.length));
        if (lastPaint)
          void acceptFrame(lastPaint).catch((error) => finish(1, { error: error.stack }));
        return;
      }
      if (!event.message?.startsWith('IVO_RENDER_RESULT:')) return;
      const result = JSON.parse(event.message.slice('IVO_RENDER_RESULT:'.length));
      if (result.error) return finish(1, result);
      result.gpuFeatures = app.getGPUFeatureStatus();
      result.submittedFrameCapture = {
        paintStages,
        offscreen: true,
        geometryMarkerVerified: true,
        requestedPixelDensity: density,
      };
      function difference(first, second) {
        const a = images.get(first),
          b = images.get(second),
          aa = a.toBitmap(),
          bb = b.toBitmap();
        let changed = 0,
          totalDelta = 0;
        for (let i = 0; i < aa.length; i++) {
          const delta = Math.abs(aa[i] - bb[i]);
          if (delta) changed++;
          totalDelta += delta;
        }
        return {
          size: a.getSize(),
          sameDimensions: JSON.stringify(a.getSize()) === JSON.stringify(b.getSize()),
          changedChannels: changed,
          meanChannelDelta: totalDelta / aa.length,
        };
      }
      result.firstVsSettled = difference('first-frame', 'settled');
      // Resizing a font is allowed to change hinting/layout metrics. Record it as
      // a diagnostic; cold painting of the same authored layout is the authority
      // for sharpness when zoom must preserve character positions and line breaks.
      result.resizedFontDiagnostic = difference('layout-text', 'native-size-text');
      result.liveVsCold = Array.from({ length: 6 }, (_, i) => difference('live-' + i, 'cold-' + i));
      if (result.liveVsCold.some((value) => !value.sameDimensions || value.changedChannels))
        await finish(1, {
          ...result,
          error: 'A live pinch frame differs from independently painted cold content',
        });
      else if (!result.firstVsSettled.sameDimensions || result.firstVsSettled.changedChannels)
        await finish(1, {
          ...result,
          error: 'First submitted zoom frame differs from its settled raster',
        });
      else await finish(0, result);
    });
    window.webContents.on('render-process-gone', (_event, details) => void finish(1, details));
    await window
      .loadURL('ivo-render-test://app/tests/runtime/render/fixture.html')
      .catch((error) => {
        if (!settled) throw error;
      });
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
