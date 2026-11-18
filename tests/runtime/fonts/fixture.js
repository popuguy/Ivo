import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createInstalledFontLibrary } from '../../../src/features/editor/assets/installed-fonts.js';
import { prepareVaultFonts } from '../../../src/rendering/text/fonts.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { systemFontId } from '../../../src/domain/text/font-catalog.js';
const assert = (v, m) => {
    if (!v) throw new Error(m);
  },
  tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
try {
  let doc = createSceneDocument('Portable type'),
    editor;
  const first = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: 360,
      h: 250,
      html: '<p>Fonts travel with the document.</p>',
    }),
    second = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 340,
      w: 360,
      h: 100,
      html: '<p>Other frame.</p>',
    }),
    assets = new Map(),
    errors = [],
    timeline = createDocumentHistory();
  let writes = 0,
    rejectWrite = false,
    holdWrite = false,
    releaseWrite,
    writeHeld = false;
  const library = createInstalledFontLibrary({
    native: {
      list: () => globalThis.ivoFontTest.list(),
      read: (p) => globalThis.ivoFontTest.read(p),
    },
    assets: () => [...assets.values()],
    persist: async (asset) => {
      if (rejectWrite) throw new Error('Synthetic disk failure');
      if (holdWrite) {
        writeHeld = true;
        await new Promise((r) => (releaseWrite = r));
      }
      await globalThis.ivoFontTest.saveAsset(asset);
      assets.set(asset.id, asset);
      writes++;
      await prepareVaultFonts([...assets.values()]);
    },
  });
  await library.load();
  assert(library.rows.length > 20, 'Installed catalog is missing');
  const host = document.querySelector('#host');
  const mount = () =>
    mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing: true,
      sessionId: 'font-integration',
      source: (s) => s,
      fonts: () => [...assets.values()],
      systemFonts: () => library.rows,
      resolveFont: (v) => library.resolve(v),
      ensureFontVariant: (...args) => library.ensureVariant(...args),
      onCommit: (before, meta) => timeline.record(before, doc, meta),
      onChange: () => {},
      onNotify: (m) => errors.push(m),
      onUndo: () => {
        const r = timeline.undo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
      onRedo: () => {
        const r = timeline.redo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
    });
  editor = mount();
  const pick = (id) =>
    editor.restoreView({ selection: [id], activePage: doc.pages[0].id, tool: 'select' });
  pick(first.id);
  await tick();
  assert(
    first.textStyle === 'cmu-serif' &&
      host.querySelector('[data-object-prop="textStyle"]').value === 'cmu-serif',
    'CMU Serif is not the new-text default',
  );
  assert(
    host.querySelectorAll('[data-object-prop="textStyle"] option').length >= library.rows.length,
    'Picker did not expose available fonts',
  );
  if (new URLSearchParams(location.search).has('preview')) await new Promise(() => {});
  const choose = async (value) => {
    const field = host.querySelector('[data-object-prop="textStyle"]');
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
    await editor.flush();
    await tick();
  };
  await choose('cmu-serif');
  assert(writes === 0, 'Shipped face was copied into the vault');
  await editor.command('document-text');
  const root = host.querySelector(`[data-scene-text="${first.id}"]`),
    text = document.createTreeWalker(root.querySelector('p'), NodeFilter.SHOW_TEXT).nextNode();
  root.focus();
  getSelection().setBaseAndExtent(text, 0, text, 5);
  document.dispatchEvent(new Event('selectionchange'));
  await choose(systemFontId('ArialMT'));
  const imported = [...assets.values()].find((a) => a.font.postscript === 'ArialMT');
  assert(imported && writes === 1, 'Selecting a system font did not persist its bytes');
  assert(
    doc.blocks[0].html.includes(imported.id) && getSelection().toString() === 'Fonts',
    'Imported face lost source identity or the selected word',
  );
  assert(
    getComputedStyle(root.querySelector(`[data-ivo-font="${imported.id}"]`)).fontFamily.includes(
      imported.id,
    ),
    'Live text is not using the portable font',
  );
  await editor.command('undo');
  assert(!doc.blocks[0].html.includes(imported.id), 'Font choice did not undo atomically');
  await editor.command('redo');
  assert(doc.blocks[0].html.includes(imported.id), 'Font choice did not redo');
  await editor.command('tool-select');
  pick(first.id);
  await choose(systemFontId('ArialMT'));
  assert(writes === 1, 'Repeated face use duplicated immutable bytes');
  await editor.command('bold');
  await editor.flush();
  assert(
    [...assets.values()].some((a) => a.font.family === 'Arial' && a.font.weight >= 600),
    'Bold companion was not included',
  );
  await globalThis.ivoFontTest.saveDocument(doc);
  const savedAssets = await globalThis.ivoFontTest.loadAssets(),
    savedDocs = await globalThis.ivoFontTest.loadDocuments();
  validateImport({ schemaVersion: 6, documents: savedDocs, assets: savedAssets });
  assert(
    savedAssets.some((a) => a.id === imported.id && a.data === imported.data),
    'Vault reopen changed or omitted original font bytes',
  );
  const before = JSON.stringify(doc);
  rejectWrite = true;
  await choose(systemFontId('Georgia'));
  assert(
    JSON.stringify(doc) === before && errors.includes('Synthetic disk failure'),
    'Failed font persistence still changed the document',
  );
  rejectWrite = false;
  holdWrite = true;
  const field = host.querySelector('[data-object-prop="textStyle"]');
  field.value = systemFontId('HelveticaNeue');
  field.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 120 && !writeHeld; i++) await tick();
  assert(writeHeld && editor.pending, 'Font save was not included in pending work');
  pick(second.id);
  releaseWrite();
  await editor.flush();
  assert(JSON.stringify(doc) === before, 'A delayed font choice affected a different selection');
  holdWrite = false;
  editor.destroy();
  host.innerHTML = '';
  doc = savedDocs[0];
  assets.clear();
  for (const a of savedAssets) assets.set(a.id, a);
  await prepareVaultFonts(savedAssets);
  editor = mount();
  pick(first.id);
  await tick();
  assert(
    host.querySelector(`[data-ivo-font="${imported.id}"]`) ||
      doc.blocks[0].textStyle === imported.id,
    'Reopened document lost the saved font reference',
  );
  editor.destroy();
  const legacy = createSceneDocument('Legacy typography');
  insertObject(legacy, 'text', legacy.pages[0].id, {
    textStyle: 'serif',
    html: '<p>Older <strong>Georgia</strong> typography.</p>',
  });
  const originalLegacy = JSON.stringify(legacy);
  await library.prepareDocument(legacy);
  assert(JSON.stringify(legacy) === originalLegacy, 'Font packaging restyled an existing document');
  const packagedFamily = [...assets.values()].filter((a) => a.font.family === 'Georgia');
  assert(packagedFamily.length === 4, 'Legacy font family did not package its companion faces');
  assert(
    [...document.fonts].some((face) => face.family === 'Georgia'),
    'Portable legacy family was not registered for existing source names',
  );
  const share = createPDFSnapshot([legacy], assets, legacy.id);
  assert(
    share.assets.filter((a) => a.font?.family === 'Georgia').length === 4,
    'Sharing omitted portable legacy font bytes',
  );
  assert(JSON.stringify(legacy) === originalLegacy, 'Sharing changed existing font references');
  console.log(
    'IVO_FONTS_RESULT:' +
      JSON.stringify({
        ok: true,
        availableFaces: library.rows.length,
        cmuDefault: true,
        saveBeforeReference: true,
        companionFace: true,
        immutableDeduplication: true,
        selectedWordAndUndo: true,
        collectionFont: true,
        failedSavePreservesSource: true,
        delayedSelectionGuard: true,
        vaultRoundTrip: true,
        legacyTypographyPreserved: true,
        portableLegacyPdf: true,
      }),
  );
} catch (error) {
  console.log('IVO_FONTS_RESULT:' + JSON.stringify({ error: error.stack }));
}
