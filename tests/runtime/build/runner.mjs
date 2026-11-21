import { app, BrowserWindow, protocol, net } from 'electron';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { writeFile } from 'node:fs/promises';
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
async function verifyBook(window) {
  const bytes = Uint8Array.from(
    await window.webContents.executeJavaScript(
      "import('/tests/runtime/build/epub-fixture.js').then(m=>m.exportFixture())",
    ),
  );
  const files = unzipSync(bytes);
  assert(
    new DataView(bytes.buffer).getUint16(8, true) === 0 &&
      strFromU8(bytes.slice(30, 38)) === 'mimetype' &&
      strFromU8(files.mimetype) === 'application/epub+zip',
    'First stored EPUB entry',
  );
  const chapter = strFromU8(files['EPUB/chapter-1.xhtml']),
    nav = strFromU8(files['EPUB/nav.xhtml']);
  assert(
    chapter.includes('<em>lining</em>') &&
      chapter.includes('start="3"') &&
      chapter.includes('<ol start="5"><li>Denim</li><li value="8">Silk</li></ol>') &&
      !chapter.includes('data-ivo-list-series') &&
      chapter.includes('<th scope="col">Fiber &amp; finish</th>') &&
      chapter.includes('<td colspan="2">&lt;twill&gt;</td>') &&
      chapter.includes('Orange triangular swatch') &&
      chapter.includes('href="chapter-2.xhtml"'),
    'EPUB chapter semantics',
  );
  assert(
    (chapter.match(/Colour tests/g) || []).length === 1 &&
      !chapter.includes('secret-only') &&
      !files['EPUB/chapter-3.xhtml'],
    'EPUB flow ownership and hidden sources',
  );
  assert(
    nav.includes('#heading-1') &&
      strFromU8(files['EPUB/chapter-2.xhtml']).includes('href="chapter-1.xhtml"'),
    'EPUB navigation and cycle',
  );
  const xml = Object.entries(files)
    .filter(([name]) => /\.(xml|opf|xhtml)$/.test(name))
    .map(([, data]) => strFromU8(data));
  assert(
    await window.webContents.executeJavaScript(
      JSON.stringify(xml) +
        ".every(x=>!new DOMParser().parseFromString(x,'application/xml').querySelector('parsererror'))",
    ),
    'EPUB XML parses',
  );
  const image = Buffer.from(files['EPUB/image-1.png']).toString('base64');
  assert(
    await window.webContents.executeJavaScript(
      `(async()=>{const i=new Image(); i.src='data:image/png;base64,${image}'; await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(2,2,1,1).data[3]===255 && ctx.getImageData(i.width-2,i.height-2,1,1).data[3]===0;})()`,
    ),
    'EPUB image pixels follow the polygon mask',
  );
  const zipBytes = Uint8Array.from(
    await window.webContents.executeJavaScript(
      "import('/tests/runtime/build/merge-book-fixture.js').then(m=>m.verifyMergedBook())",
    ),
  );
  const merged = unzipSync(zipBytes);
  const first = strFromU8(merged['EPUB/chapter-1.xhtml']),
    second = strFromU8(merged['EPUB/chapter-2.xhtml']),
    toc = strFromU8(merged['EPUB/nav.xhtml']);
  assert(
    first.includes('藍') &&
      second.includes('Écru') &&
      strFromU8(merged['EPUB/book.opf']).includes('<dc:title>Swatch card · 1</dc:title>'),
    'Saved book order and owner title',
  );
  assert(
    first.indexOf('Introduction') < first.indexOf('<h2') &&
      !first.includes('excluded swatch text') &&
      /<h2[^>]*><i>藍<\/i>/.test(first),
    'Authored flow order, semantic heading and exclusions',
  );
  assert(
    /heading-1">藍<\/a><ol><li><a[^>]+heading-2">Weave/.test(toc),
    'Nested semantic navigation',
  );
  if (process.env.IVO_MERGED_EPUB_FIXTURE)
    await writeFile(process.env.IVO_MERGED_EPUB_FIXTURE, zipBytes);
  if (process.env.IVO_EPUB_FIXTURE) await writeFile(process.env.IVO_EPUB_FIXTURE, bytes);
}
async function verifyMergeAction(window) {
  const run = (script) => window.webContents.executeJavaScript(script);
  const id = await run(`(async()=>{
    const {createSceneDocument,insertObject}=await import('/dist/src/domain/documents/scene.js');
    const {saveDocument}=await import('/dist/src/storage/store.js');
    const d=createSceneDocument('Merge cards');
    insertObject(d,'text',d.pages[0].id,{html:'<p>Fabric <strong>{{Name}}</strong></p>'});
    await saveDocument(d);
    return d.id;
  })()`);
  const freshURL = new URL(window.webContents.getURL());
  freshURL.searchParams.set('fixture', 'merge');
  freshURL.hash = 'doc=' + encodeURIComponent(id);
  await window.loadURL(freshURL.href);
  await poll(window, "document.querySelector('.workspace-title-input')?.value==='Merge cards'");
  await run("document.querySelector('[data-action=view-options]').click()");
  await poll(window, "!!document.querySelector('[data-navigation-action=data-merge]')");
  await run("document.querySelector('[data-navigation-action=data-merge]').click()");
  await poll(window, "!!document.querySelector('dialog[open] input[type=file]')");
  const choose = async (csv) =>
    run(`(() => {
    const box=document.querySelector('dialog[open] input[type=file]');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(csv)}],'fabric.csv',{type:'text/csv'}));
    box.files=transfer.files;box.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await choose('Name\nÉcru\nBad,record');
  await poll(
    window,
    "document.querySelector('dialog[open] output')?.textContent.includes('Record 2')",
  );
  assert(
    await run("document.querySelector('dialog[open] [type=submit]').disabled"),
    'A malformed batch can be submitted',
  );
  await choose('Name\nÉcru\n藍');
  await poll(window, "document.querySelector('dialog[open] output')?.textContent.includes('Écru')");
  await run("document.querySelector('dialog[open] form').requestSubmit()");
  await poll(window, "document.querySelector('.workspace-title-input')?.value==='Merge cards · 1'");
  freshURL.searchParams.set('fixture', 'reopen');
  await window.loadURL(freshURL.href);
  const docs = await run(
    `import('/dist/src/storage/store.js').then(s=>s.loadDocuments()).then(all=>all.filter(d=>d.title.startsWith('Merge cards')).map(d=>[d.title,d.blocks[0].html]))`,
  );
  const byTitle = new Map(docs);
  assert(
    byTitle.size === 3 &&
      byTitle.get('Merge cards').includes('{{Name}}') &&
      byTitle.get('Merge cards · 1').includes('<strong>Écru</strong>') &&
      byTitle.get('Merge cards · 2').includes('<strong>藍</strong>'),
    'Merged files or original template failed cold reopen',
  );
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
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-action="view-options"]').click();
    `);
    await poll(window, "!!document.querySelector('[data-navigation-action=publication-order]')");
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-navigation-action=publication-order]').click()",
    );
    await poll(
      window,
      "!!document.querySelector('dialog[open] select[aria-label=" +
        JSON.stringify('Book chapters') +
        "]')",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('dialog[open] form').requestSubmit()",
    );
    await poll(window, "!document.querySelector('dialog[open]')");
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-action=view-options]').click()",
    );
    await poll(window, "!!document.querySelector('[data-navigation-action=export-epub]')");
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-navigation-action=export-epub]').click()",
    );
    await poll(
      window,
      "document.querySelector('dialog[open] h2')?.textContent === 'Export reflowable EPUB'",
    );
    await window.webContents.executeJavaScript(`
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (!this.download.endsWith('.epub')) return originalClick.call(this);
        HTMLAnchorElement.prototype.click = originalClick;
        fetch(this.href).then(r=>r.arrayBuffer()).then(b=>globalThis.__downloadedBook = new Uint8Array(b)[0] === 80);
      };
      document.querySelector('dialog[open] form').requestSubmit();
    `);
    await poll(window, 'globalThis.__downloadedBook === true');
    if (url.startsWith('ivo-build-test:')) await verifyMergeAction(window);
    await poll(window, "!!document.querySelector('[data-action=graph]')");
    await window.webContents.executeJavaScript(
      `globalThis.__workerMessages=0;globalThis.__workerErrors=[];const OriginalWorker=Worker;globalThis.Worker=class extends OriginalWorker {constructor(...args){super(...args);this.addEventListener('message',()=>globalThis.__workerMessages++);this.addEventListener('error',event=>globalThis.__workerErrors.push(event.message));}};document.querySelector('[data-action=graph]').click()`,
    );
    if (url.startsWith('ivo-build-test:')) await verifyBook(window);
    await poll(window, 'globalThis.__workerMessages > 0 || globalThis.__workerErrors.length > 0');
    const workerErrors = await window.webContents.executeJavaScript('globalThis.__workerErrors');
    assert(!workerErrors.length, 'Built graph worker failed: ' + JSON.stringify(workerErrors));
    assert(!errors.length, 'Built app console errors: ' + errors.join('\n'));
  } catch (error) {
    throw new Error(error.message + (errors.length ? '\n' + errors.join('\n') : ''), {
      cause: error,
    });
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
