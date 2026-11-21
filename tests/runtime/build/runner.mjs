import { app, BrowserWindow, protocol, net } from 'electron';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  profile = await mkdtemp(path.join(tmpdir(), 'ivo-build-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => {
  console.error('Build runtime exceeded 60 seconds');
  app.exit(1);
}, 60000);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ivo-build-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true },
  },
]);
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
async function poll(window, expression) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out: ' + expression);
}
async function inspect(url) {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 850,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const errors = [];
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  try {
    await window.loadURL(url);
    await poll(
      window,
      "!!document.querySelector('[data-action=new]') && !document.querySelector('.loading,.startup-error')",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-action=new]').click()",
    );
    await poll(window, "!!document.querySelector('.scene-editor')");
    assert(
      await window.webContents.executeJavaScript(
        "!!document.querySelector('.canvas-flow-input') && !document.querySelector('.canvas-document-text') && !/story/i.test(document.querySelector('.scene-editor').textContent)",
      ),
      'Obsolete product terminology in built editor',
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.canvas-viewport').dispatchEvent(new KeyboardEvent('keydown',{key:'f',metaKey:true,ctrlKey:true,bubbles:true,cancelable:true}));
    `);
    await poll(window, "!!document.querySelector('.canvas-find-change')");
    await window.webContents.executeJavaScript(`
      const panel = document.querySelector('.canvas-find-change');
      panel.querySelector('[data-find-mode="grep"]').click();
      const needle = panel.elements.namedItem('needle');
      needle.value = 'unmatched[0-9]+fixture';
      needle.dispatchEvent(new Event('input',{bubbles:true}));
      panel.querySelector('[data-find-action="next"]').click();
    `);
    await poll(
      window,
      "document.querySelector('.canvas-find-change output').value === 'No matches found.'",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-find-action=done]').click()",
    );
    await window.webContents.executeJavaScript(
      `globalThis.__workerMessages=0;globalThis.__workerErrors=[];const OriginalWorker=Worker;globalThis.Worker=class extends OriginalWorker {constructor(...args){super(...args);this.addEventListener('message',()=>globalThis.__workerMessages++);this.addEventListener('error',event=>globalThis.__workerErrors.push(event.message));}};document.querySelector('[data-action=graph]').click()`,
    );
    await poll(window, 'globalThis.__workerMessages > 0 || globalThis.__workerErrors.length > 0');
    const workerErrors = await window.webContents.executeJavaScript('globalThis.__workerErrors');
    assert(!workerErrors.length, 'Built graph worker failed: ' + JSON.stringify(workerErrors));
    assert(!errors.length, 'Built app console errors: ' + errors.join('\n'));
  } finally {
    window.destroy();
  }
}
app
  .whenReady()
  .then(async () => {
    protocol.handle('ivo-build-test', (request) => {
      const target = path.resolve(root, '.' + new URL(request.url).pathname);
      if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const sw = await readFile(path.join(root, 'dist/sw.js'), 'utf8');
    const shell = JSON.parse(
      sw.match(/const SHELL=(\[[^;]+\]);/)?.[1] || sw.match(/const SHELL = (\[[\s\S]+?\]);/)?.[1],
    );
    const hash = createHash('sha256');
    for (const file of shell.filter((file) => file !== './').map((file) => file.slice(2))) {
      assert(!file.startsWith('tests/'), 'Offline cache includes test data');
      hash.update(file);
      hash.update(await readFile(path.join(root, 'dist', file)));
    }
    assert(
      sw.includes(hash.digest('hex').slice(0, 16)),
      'Offline cache digest does not describe shipped assets',
    );
    await inspect('ivo-build-test://app/dist/index.html');
    await inspect(pathToFileURL(path.join(root, 'dist/Ivo.html')).href);
    console.log(
      JSON.stringify(
        {
          ok: true,
          staticAndStandaloneBoot: true,
          canonicalDocumentCreation: true,
          realModuleAndInlineWorkers: true,
          offlineFilesAndDigest: true,
        },
        null,
        2,
      ),
    );
    await rm(profile, { recursive: true, force: true });
    clearTimeout(watchdog);
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error.stack);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    clearTimeout(watchdog);
    app.exit(1);
  });
