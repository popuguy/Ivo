import { CURRENT_ARCHIVE_VERSION } from '../src/domain/documents/capabilities.js';
import { BrowserWindow, ipcMain, net } from 'electron';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateImport } from '../src/domain/documents/schema.js';
import { createPDFSnapshot } from '../src/features/export/pdf-plan.js';
import { embedComposedTextLayers } from './composed-pdf.mjs';
import { resolveCompositionPDFLayers } from './composition-pdf-layers.mjs';
const jobs = new Map();
export const pdfRendererOwner = (event) => {
  const job = jobs.get(event.sender.id);
  if (!job || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== job.url)
    throw new Error('Invalid PDF renderer request.');
  return job;
};
ipcMain.handle('ivo:pdf-snapshot', (event) => pdfRendererOwner(event).snapshot);
ipcMain.handle('ivo:pdf-ready', (event, result) => {
  const job = pdfRendererOwner(event);
  if (result?.error) job.reject(new Error(String(result.error).slice(0, 1000)));
  else job.resolve(result?.manifest);
  return true;
});

/** Print browser-shaped text and paths, then normalize physical sizes and rebuild semantic links. */
export async function finalizePDF(bytes, manifest, { composedLayers = [] } = {}) {
  const pdf = await PDFDocument.load(bytes),
    pages = pdf.getPages();
  if (pages.length !== manifest.pages.length)
    throw new Error('PDF pagination did not match the document.');
  for (const [index, page] of pages.entries()) {
    const expected = manifest.pages[index],
      { width, height } = page.getSize();
    if (Math.abs(width - expected.width) > 1 || Math.abs(height - expected.height) > 1)
      throw new Error('PDF page size did not match the document.');
    // Chromium rounds named-page dimensions to device units. Preserve authored fractional point sizes.
    page.setMediaBox(0, 0, expected.width, expected.height);
    page.setCropBox(0, 0, expected.width, expected.height);
    // Content Y origin was the rounded paper height; translate that small difference before resizing.
    if (Math.abs(height - expected.height) > 1e-6)
      page.translateContent(0, expected.height - height);
    page.node.set(PDFName.of('Annots'), pdf.context.obj([]));
  }
  for (const link of manifest.links) {
    const page = pages[link.pageIndex],
      box = manifest.pages[link.pageIndex],
      r = link.rect;
    const annotation = {
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [r.x, box.height - r.y - r.h, r.x + r.w, box.height - r.y],
      Border: [0, 0, 0],
      F: 4,
    };
    if (link.target.url) {
      if (!/^https?:\/\//.test(link.target.url)) continue;
      annotation.A = { S: 'URI', URI: PDFString.of(link.target.url) };
    } else {
      const target = pages[link.target.pageIndex];
      if (!target) throw new Error('PDF link has no destination.');
      annotation.Dest = [target.ref, 'XYZ', 0, manifest.pages[link.target.pageIndex].height, null];
    }
    page.node.addAnnot(pdf.context.register(pdf.context.obj(annotation)));
  }
  if (composedLayers.length) {
    const composed = await embedComposedTextLayers(pdf, composedLayers);
    manifest.nativeTextEncoding = composed.textEncoding;
    if (composed.textEncoding.some((encoding) => !encoding.supported))
      manifest.warnings.push(
        'Some native text retains its original PDF encoding. Copying or searching ligatures may differ between PDF readers.',
      );
  }
  pdf.setTitle(manifest.title);
  pdf.setCreator('Ivo');
  pdf.setProducer('Ivo');
  return pdf.save();
}
export async function renderPDF(
  snapshot,
  { project, timeout = 60000, onRendered, compositionPDF } = {},
) {
  if (snapshot?.format !== 'ivo-pdf-1') throw new Error('Invalid PDF snapshot.');
  const archive = validateImport({
    schemaVersion: CURRENT_ARCHIVE_VERSION,
    documents: snapshot.documents,
    assets: snapshot.assets,
  });
  if (
    archive.documents.some((doc) => !doc.canvasVersion) ||
    archive.documents.reduce((sum, doc) => sum + doc.pages.length, 0) > 256
  )
    throw new Error('Invalid PDF page snapshot.');
  const frozen = createPDFSnapshot(archive.documents, archive.assets, archive.documents[0]?.id, {
    includeLinked: true,
  });
  frozen.createdAt = String(snapshot.createdAt || frozen.createdAt);
  const pdfOrigin = 'https://ivo-pdf.invalid',
    url = pdfOrigin + '/pdf.html',
    webRoot = path.resolve(project, 'dist');
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1000,
    webPreferences: {
      preload: path.join(project, 'desktop/pdf-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'ivo-pdf-' + crypto.randomUUID(),
    },
  });
  const session = window.webContents.session;
  await session.protocol.handle('https', async (request) => {
    const parsed = new URL(request.url),
      pathname = decodeURIComponent(parsed.pathname),
      target = path.resolve(webRoot, '.' + pathname);
    if (
      parsed.origin !== pdfOrigin ||
      !target.startsWith(webRoot + path.sep) ||
      pathname.split('/').some((part) => part.startsWith('.'))
    )
      return new Response('Forbidden', { status: 403 });
    const result = await net.fetch(pathToFileURL(target).href),
      headers = new Headers(result.headers);
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; frame-src 'none'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    );
    return new Response(result.body, { status: result.status, headers });
  });
  session.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) =>
    callback({ cancel: !details.url.startsWith(pdfOrigin + '/') }),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== url) event.preventDefault();
  });
  let timer;
  const ready = new Promise((resolve, reject) => {
    jobs.set(window.webContents.id, { url, snapshot: frozen, resolve, reject });
    timer = setTimeout(() => reject(new Error('PDF export timed out.')), timeout);
    window.webContents.once('render-process-gone', () =>
      reject(new Error('The PDF renderer stopped.')),
    );
  });
  // Attach a rejection handler immediately: a failed load can occur before awaiting ready.
  ready.catch(() => {});
  try {
    await window.loadURL(url);
    const manifest = await ready;
    await onRendered?.(window, manifest);
    const composedLayers = await resolveCompositionPDFLayers(
      manifest,
      compositionPDF ? (token) => compositionPDF(window.webContents, token) : undefined,
    );
    const bytes = await window.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      scale: 1,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      generateTaggedPDF: true,
    });
    return { bytes: await finalizePDF(bytes, manifest, { composedLayers }), manifest };
  } finally {
    clearTimeout(timer);
    jobs.delete(window.webContents.id);
    window.destroy();
    session.protocol.unhandle('https');
    await session.clearStorageData();
  }
}
