import { app, BrowserWindow, ipcMain } from 'electron';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildNativeText } from '../../../scripts/build-native-text.mjs';
import { createTextComposition } from '../../../desktop/text-composition.mjs';
import { installTextCompositionBridge } from '../../../desktop/text-composition-bridge.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url)),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-native-bridge-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let bridge;
const windows = [],
  owners = new Map();
app.whenReady().then(async () => {
  const deadline = setTimeout(() => {
    console.error('Native bridge fixture timed out.');
    app.exit(1);
  }, 60000);
  try {
    console.log('bridge:ready');
    const executable = await buildNativeText();
    bridge = installTextCompositionBridge({
      ipcMain,
      createService: () => createTextComposition(executable),
      authorize(event) {
        const owner = owners.get(event.sender.id);
        if (
          !owner ||
          event.sender !== owner.window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== owner.url
        )
          throw Error('Invalid native fixture owner.');
        return owner;
      },
    });
    for (const preload of ['preload.cjs', 'pdf-preload.cjs']) {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(root, 'desktop', preload),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          partition: 'native-bridge-' + crypto.randomUUID(),
        },
      });
      const url = pathToFileURL(
        path.join(root, 'tests/runtime/text-composition-bridge/fixture.html'),
      ).href;
      windows.push(window);
      owners.set(window.webContents.id, { window, url });
      await window.loadURL(url);
      console.log('bridge:loaded:' + preload);
      assert.equal(
        await window.webContents.executeJavaScript(
          "typeof ivoTextComposition.compose + ':' + typeof ivoTextComposition.pdf",
        ),
        'function:function',
      );
      if (preload === 'preload.cjs')
        assert.equal(
          await window.webContents.executeJavaScript('typeof ivoNative.textComposition.compose'),
          'function',
        );
    }
    const font = await readFile(path.join(root, 'public/fonts/cmu-serif/cmunrm.ttf')),
      hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const text = 'Native bridge affinity',
      sourceHTML = '<p>' + text + '</p>';
    const request = {
      protocol: 1,
      mode: 'greedy-geometry-proof',
      id: 'bridge-runtime',
      text,
      sourceHTML,
      sourceDigest: hash(sourceHTML),
      logicalLength: text.length,
      spans: [
        { kind: 'text', start: 0, end: text.length, logicalStart: 0, logicalEnd: text.length },
      ],
      runs: [{ start: 0, end: text.length, font: 'cmu', size: 12, ligatures: true, tracking: 0 }],
      resources: [
        {
          id: 'cmu',
          digest: hash(font),
          postscript: 'CMUSerif-Roman',
          data: font.toString('base64'),
        },
      ],
      frames: [{ id: 'frame', width: 200, height: 80 }],
      includeVectors: true,
      allowFallback: false,
    };
    const [regular, pdfWindow] = windows;
    console.log('bridge:composing');
    const result = await regular.webContents.executeJavaScript(
      'ivoNative.textComposition.compose(' + JSON.stringify(request) + ')',
    );
    assert.equal(result.layout.coveredLength, text.length);
    assert(result.vectors.length > 5);
    const rejected = await pdfWindow.webContents.executeJavaScript(
      'ivoTextComposition.pdf(' +
        JSON.stringify(result.token) +
        ').then(() => "allowed",error => error.message)',
    );
    assert.match(rejected, /this window/);
    const pdfResult = await pdfWindow.webContents.executeJavaScript(
      'ivoTextComposition.compose(' + JSON.stringify(request) + ')',
    );
    assert.equal(pdfResult.token, result.token);
    const pdf = await bridge.readPDF(pdfWindow.webContents, pdfResult.token);
    const document = await PDFDocument.load(Buffer.from(pdf.data, 'base64'));
    assert.deepEqual(
      document.getPages().map((page) => [page.getWidth(), page.getHeight()]),
      [[200, 80]],
    );
    const invalid = await regular.webContents.executeJavaScript(
      'ivoTextComposition.compose(' +
        JSON.stringify({ ...request, outputPath: '/not-an-output.pdf' }) +
        ').then(() => "allowed",error => error.message)',
    );
    assert.match(invalid, /byte-only/);
    console.log(
      JSON.stringify({
        ok: true,
        actualNativeWorker: true,
        regularAndPDFPreloads: true,
        ownedTokens: true,
        noPaths: true,
        exactNativePDF: true,
      }),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    bridge?.close();
    await Promise.resolve();
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await rm(profile, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
