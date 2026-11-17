import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { isTemplate } from '../../../src/domain/documents/copy.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = async (predicate) => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await frame();
  }
  throw new Error('Template application timeout');
};
try {
  const source = createSceneDocument('Source layout'),
    first = source.pages[0];
  source.id = 'template-source';
  source.aliases = ['Original alias'];
  Object.assign(addPage(source, first.id), { width: 800.25, height: 500 });
  const mask = insertObject(source, 'polygon', first.id, { x: 40.5, y: 55.25, w: 200, h: 150 }),
    _text = insertObject(source, 'text', first.id, {
      parentId: mask.id,
      x: 12,
      y: 14,
      fontSize: 20,
      textStyle: 'cmu-serif',
      html: `<p><strong>Retained type</strong> <a data-doc-id="${source.id}">Self</a></p>`,
    });
  const documents = new Map([[source.id, structuredClone(source)]]),
    meta = new Map([['initialized', true]]);
  let nativeCommand;
  globalThis.ivoNative = {
    platform: 'macos',
    zoomFactor: () => 1,
    onCommand: (callback) => (nativeCommand = callback),
    onPrepareClose: () => {},
    updateHistory: () => {},
    store: {
      loadDocuments: async () => structuredClone([...documents.values()]),
      loadAssets: async () => [],
      loadAsset: async () => null,
      saveAsset: async () => {},
      saveDocument: async (doc) => {
        validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
        documents.set(doc.id, structuredClone(doc));
      },
      getMeta: async (id) => (meta.has(id) ? { id, value: structuredClone(meta.get(id)) } : null),
      putMeta: async (id, value) => meta.set(id, structuredClone(value)),
      saveImport: async () => {},
    },
  };
  const original = JSON.stringify(documents.get(source.id));
  await import('../../../src/app/main.js');
  await wait(() => document.querySelector('.canvas-world'));
  const originalWorld = document.querySelector('.canvas-world');
  document.querySelector('[data-action="options"]').click();
  await wait(() => document.querySelector('[data-action="save-template"]'));
  document.querySelector('[data-action="save-template"]').click();
  await wait(() => document.querySelector('[name="name"]'));
  document.querySelector('[name="name"]').value = 'Reusable fitting';
  document.querySelector('#dialog button[type="submit"]').click();
  await wait(() => documents.size === 2 && !document.querySelector('#dialog').open);
  const template = [...documents.values()].find(isTemplate);
  assert(template && template.pages[1].width === 800.25, 'Template did not preserve mixed pages');
  assert(
    document.querySelector('.canvas-world') === originalWorld,
    'Saving template replaced live editor',
  );
  assert(JSON.stringify(documents.get(source.id)) === original, 'Saving template mutated source');
  await nativeCommand('new-layout');
  await wait(() => document.querySelector('[name="template"]'));
  const choice = document.querySelector('[name="template"]');
  choice.value = template.id;
  choice.dispatchEvent(new Event('change', { bubbles: true }));
  assert(
    document.querySelector('[name="width"]').disabled,
    'Template sizes remained editable and misleading',
  );
  document.querySelector('[name="title"]').value = 'Fitting 01';
  document.querySelector('#dialog button[type="submit"]').click();
  await wait(
    () =>
      documents.size === 3 &&
      document.title === 'Fitting 01 — Ivo' &&
      !document.querySelector('#dialog').open,
  );
  const created = [...documents.values()].find((doc) => doc.title === 'Fitting 01');
  assert(
    created && !isTemplate(created) && created.blocks.length === 2 && created.pages.length === 2,
    'Instantiation failed',
  );
  assert(
    created.blocks[1].parentId === created.blocks[0].id &&
      created.blocks[1].textStyle === 'cmu-serif',
    'Template lost mask/type structure',
  );
  assert(
    created.blocks[1].html.includes(`data-doc-id="${created.id}"`),
    'Self link did not target instance',
  );
  assert(
    JSON.stringify(documents.get(source.id)) === original,
    'Instantiation changed original source',
  );
  assert(
    document.querySelectorAll('.canvas-page').length === 2,
    'Instance did not render its pages',
  );
  console.log(
    'IVO_TEMPLATE_RESULT:' +
      JSON.stringify({
        ok: true,
        sourceUnchanged: true,
        liveEditorRetained: true,
        mixedPages: true,
        clippingHierarchy: true,
        typography: true,
        ownedIdsRemapped: true,
        selfLinksRemapped: true,
      }),
  );
} catch (error) {
  console.log('IVO_TEMPLATE_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
