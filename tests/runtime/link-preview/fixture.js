import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { documentPreview } from '../../../src/features/links/previews.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait = async (predicate) => {
    const end = Date.now() + 4000;
    while (!predicate()) {
      if (Date.now() > end) throw Error('Timed out waiting for preview');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWsAAAAASUVORK5CYII=';
let editor;
try {
  await document.fonts.ready;
  await wait(() => document.hasFocus());
  const target = createSceneDocument('Fabric <study> & fitting'),
    one = insertObject(target, 'text', target.pages[0].id, {
      html: '<p>Canonical <strong>textFlow</strong> once. [[Other|Readable alias]]</p><p>Second paragraph café 👩🏽‍🔬.</p>',
    }),
    _textFlow = startTextFlow(target, one.id, { automaticPages: false }),
    two = insertObject(target, 'text', target.pages[0].id, { x: 240, html: '' });
  threadFrame(target, one.id, two.id);
  insertObject(target, 'image', target.pages[0].id, {
    src: 'https://example.invalid/must-not-load.png',
  });
  insertObject(target, 'image', target.pages[0].id, {
    src: 'asset:original',
    alt: 'Original swatch',
  });
  const targetBefore = JSON.stringify(target),
    summary = documentPreview(target);
  assert(
    summary.excerpt.match(/Canonical/g).length === 1 &&
      summary.excerpt.includes('Readable alias') &&
      !summary.excerpt.includes('[['),
    'Preview duplicated textFlow text or wiki syntax',
  );
  assert(
    summary.excerpt.includes('👩🏽‍🔬') && summary.excerpt.includes('\n'),
    'Preview lost Unicode/paragraph separation',
  );
  assert(summary.image.src === 'asset:original', 'Preview selected external image');
  assert(JSON.stringify(target) === targetBefore, 'Preview mutated source');
  const doc = createSceneDocument('Links'),
    _frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 60,
      y: 80,
      w: 330,
      h: 120,
      html: `<p>See <a data-doc-id="${target.id}" href="#doc=${target.id}">fabric study</a> and [[Missing]].</p>`,
    }),
    host = document.querySelector('#host'),
    opens = [],
    notices = [];
  let writes = 0,
    commits = 0;
  function mount(editing = false) {
    editor?.destroy();
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc, target],
      editing,
      source: (src) => (src === 'asset:original' ? png : src),
      onCommit: () => commits++,
      onChange: () => {},
      onOpen: (id, options) => opens.push({ id, ...options }),
      onUndo: () => {},
      onRedo: () => {},
      onAsset: async () => writes++,
      onNotify: (message) => notices.push(message),
    });
  }
  mount();
  await tick();
  let link = host.querySelector('a[data-doc-id]');
  const hover = (el) =>
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  hover(link);
  assert(!document.querySelector('.document-preview'), 'Hover opened without its intent delay');
  await wait(() => document.querySelector('.document-preview'));
  let popup = document.querySelector('.document-preview');
  assert(
    popup.textContent.includes(target.title) &&
      popup.textContent.includes('Canonical textFlow once'),
    'Preview did not show target title/source',
  );
  assert(
    popup.querySelector('.document-preview-image').getAttribute('src') === png,
    'Preview did not reuse local original image',
  );
  const r = popup.getBoundingClientRect();
  assert(
    r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    'Preview escaped viewport bounds',
  );
  assert(
    !host.querySelector('.canvas-world .document-preview'),
    'Preview inherited zoom/page clipping',
  );
  assert(
    link.getAttribute('aria-controls') === popup.id,
    'Preview lacks source accessibility relationship',
  );
  if (new URLSearchParams(location.search).has('capture')) {
    await tick();
    console.log('IVO_LINK_PREVIEW_CAPTURE');
    await wait(() => window.ivoPreviewCaptured);
  }
  link.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: popup }));
  popup.dispatchEvent(new PointerEvent('pointerenter'));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert(document.querySelector('.document-preview') === popup, 'Moving into preview dismissed it');
  popup
    .querySelector('[data-preview-open]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  assert(
    opens.at(-1).id === target.id && opens.at(-1).newTab,
    'Preview activation lost modified tab opening',
  );
  assert(
    !document.querySelector('.document-preview') && !link.hasAttribute('aria-controls'),
    'Preview activation left popup/accessibility state',
  );
  link.focus({ preventScroll: true });
  assert(
    document.querySelector('.document-preview'),
    'Keyboard focus did not open preview ' +
      JSON.stringify({
        connected: link.isConnected,
        active: document.activeElement.outerHTML,
        hasFocus: document.hasFocus(),
      }),
  );
  link.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  );
  assert(document.activeElement.matches('[data-preview-open]'), 'Keyboard could not enter preview');
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert(
    !document.querySelector('.document-preview') && document.activeElement === link,
    'Escape did not close and restore source focus',
  );
  const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(ordinary);
  assert(
    opens.at(-1).id === target.id && !opens.at(-1).newTab && ordinary.defaultPrevented,
    'Normal link activation changed',
  );
  hover(link);
  await wait(() => document.querySelector('.document-preview'));
  host
    .querySelector('.canvas-viewport')
    .dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 5 }));
  assert(!document.querySelector('.document-preview'), 'Camera movement left a detached preview');
  const missing = host.querySelector('a.unresolved');
  hover(missing);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert(
    !document.querySelector('.document-preview'),
    'Unresolved link opened a misleading preview',
  );
  hover(link);
  await wait(() => document.querySelector('.document-preview'));
  editor.setBusy(true);
  assert(!document.querySelector('.document-preview'), 'Navigation suspension left popup open');
  editor.setBusy(false);
  link.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
      pointerId: 11,
      button: 0,
      buttons: 1,
    }),
  );
  link.focus();
  link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
  link.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      pointerType: 'touch',
      pointerId: 11,
      button: 0,
      buttons: 0,
    }),
  );
  const touchClick = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(touchClick);
  assert(
    !document.querySelector('.document-preview') && opens.at(-1).id === target.id,
    'Touch tap was intercepted by preview',
  );
  mount(true);
  await tick();
  link = host.querySelector('a[data-doc-id]');
  hover(link);
  link.focus();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert(!document.querySelector('.document-preview'), 'Editing links opened reading preview');
  const sourceBefore = JSON.stringify(doc),
    beforeCommits = commits;
  await editor.addFiles([new File(['%PDF-1.4\n'], 'old.pdf', { type: 'application/pdf' })]);
  assert(
    writes === 0 &&
      commits === beforeCommits &&
      JSON.stringify(doc) === sourceBefore &&
      notices.at(-1).includes('PDF placement has been removed'),
    'Removed PDF import wrote data or source',
  );
  assert(
    !host.querySelector('.canvas-file-input').accept.includes('pdf'),
    'PDF remains in placement picker',
  );
  editor.destroy();
  const legacy = createSceneDocument('Legacy attachment'),
    pdf = insertObject(legacy, 'pdf', legacy.pages[0].id, {
      x: 80,
      y: 80,
      w: 220,
      h: 180,
      src: 'asset:original-pdf',
      alt: 'Original.pdf',
    }),
    asset = {
      id: 'original-pdf',
      name: 'Original.pdf',
      mimeType: 'application/pdf',
      data: 'data:application/pdf;base64,JVBERi0xLjQK',
    };
  validateImport({ schemaVersion: 2, documents: [legacy], assets: [asset] });
  const legacyBefore = JSON.stringify(legacy);
  editor = mountCanvasEditor(host, {
    getDocument: () => legacy,
    documents: [legacy],
    editing: false,
    source: () => asset.data,
    onCommit: () => commits++,
    onChange: () => {},
    onOpen: () => {},
    onUndo: () => {},
    onRedo: () => {},
  });
  await tick();
  assert(!host.querySelector('object,iframe,embed'), 'Canceled nested PDF viewer still exists');
  const original = host.querySelector('a[download]');
  assert(
    original.getAttribute('href') === asset.data && original.download === pdf.alt,
    'Original PDF is not recoverable',
  );
  assert(JSON.stringify(legacy) === legacyBefore, 'Legacy PDF cleanup migrated/deleted source');
  let rejected = false;
  try {
    createPDFSnapshot([legacy], [asset], legacy.id);
  } catch (error) {
    rejected = error.message.includes('legacy PDF');
  }
  assert(rejected, 'Legacy attachment exported as a blank/nested PDF');
  editor.destroy();
  assert(!document.querySelector('.document-preview'), 'Destroy leaked popup');
  assert(JSON.stringify(target) === targetBefore, 'Hovering changed canonical target source');
  console.log(
    'IVO_LINK_PREVIEW_RESULT:' +
      JSON.stringify({
        ok: true,
        readingHover: true,
        keyboardFocusEscape: true,
        modifiedOpening: true,
        touchTapPreserved: true,
        boundedCanonicalExcerpt: true,
        localImageOnly: true,
        unscaledPopover: true,
        sourceUnchanged: true,
        pdfPlacementRemoved: true,
        legacyOriginalRetained: true,
      }),
  );
} catch (error) {
  console.log('IVO_LINK_PREVIEW_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
