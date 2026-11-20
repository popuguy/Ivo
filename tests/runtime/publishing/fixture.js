import { verifyNestedLayers } from './nested-layers.js';
import { verifyLightPalette } from './light-palette.js';
import { verifyTextControls } from './text-controls.js';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  enablePublishing,
  saveTextStyle,
  createParent,
  applyParent,
} from '../../../src/domain/documents/publishing.js';
import {
  layoutDocumentTextFlows,
  prepareTextFlowFonts,
} from '../../../src/rendering/text/flow-layout.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
const assert = (v, m) => {
    if (!v) throw new Error(m);
  },
  tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
try {
  await prepareTextFlowFonts();
  localStorage.removeItem('ivo:workspace-panels:1');
  let doc = createSceneDocument('Composition study'),
    history = createDocumentHistory(),
    editor;
  const page = doc.pages[0],
    frame = insertObject(doc, 'text', page.id, {
      x: 48,
      y: 64,
      w: 420,
      h: 260,
      textStyle: 'cmu-serif',
      textColor: '#344e6b',
      fontSize: 16,
      html: '<p>Precision in proportion.</p><p>Text, geometry and materials work together.</p>',
    });
  enablePublishing(doc);
  const body = saveTextStyle(doc, 'paragraph', {
    name: 'Body',
    attributes: { textStyle: 'cmu-serif', fontSize: 16, leading: 0, autoLeading: 120 },
  });
  frame.html = `<p data-ivo-pstyle="${body.id}">Precision in proportion.</p><p>Text, geometry and materials work together.</p>`;
  const host = document.querySelector('#host');
  await verifyTextControls(host);
  await verifyNestedLayers(host, assert);
  const mount = () =>
    mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing: true,
      sessionId: 'publishing',
      source: (s) => s,
      onCommit: (before, metadata) => history.record(before, doc, metadata),
      onChange: () => {},
      onNotify: (m) => console.warn(m),
      onUndo: () => {
        const r = history.undo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
      onRedo: () => {
        const r = history.redo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
    });
  editor = mount();
  await editor.command('show-panel-properties');
  await tick();
  const pick = () =>
    editor.restoreView({ selection: [frame.id], activePage: page.id, tool: 'select' });
  pick();
  await tick();
  assert(
    host.querySelectorAll('.canvas-resize').length === 8,
    'Eight square frame handles missing',
  );
  assert(
    host.querySelectorAll('.canvas-flow-port').length === 2,
    'Independent area frame needs both ports',
  );
  assert(
    host.querySelector('[aria-label="Open explore more type options"]'),
    'Type-options adornment missing',
  );
  const typeOptionsControl = host.querySelector('[aria-label="Open explore more type options"]');
  for (const type of ['pointerdown', 'pointerup'])
    typeOptionsControl.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, button: 0 }),
    );
  assert(
    editor.getState().selection[0] === frame.id,
    'Frame control pointerdown cleared selection',
  );
  typeOptionsControl.click();
  assert(host.querySelector('.type-options-popover'), 'OpenType popover did not open');
  verifyLightPalette(host, assert);
  const liga = host.querySelector('[data-type-feature="smallCaps"]');
  liga.checked = true;
  liga.dispatchEvent(new Event('change', { bubbles: true }));
  host
    .querySelector('.type-options-popover')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(doc.blocks[0].smallCaps === true, 'OpenType flag not authored');
  host.querySelector('[data-highlight-color="#fff176"]').click();
  assert(
    doc.blocks[0].html.includes('data-ivo-highlight="#fff176"'),
    'Highlight must be a text run, not a frame background',
  );
  host.querySelector('[data-highlight-color="none"]').click();
  assert(
    !doc.blocks[0].html.includes('#fff176'),
    'Removing a highlight left an ancestor painting yellow',
  );
  host.querySelector('[data-highlight-color="#fff176"]').click();
  await editor.command('document-text'); // independent text frame stays selected; text editing via tool below
  await editor.command('tool-select');
  pick();
  const setFrame = (prop, value) => {
    const el = host.querySelector(`[data-frame-prop="${prop}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setFrame('columns', 2);
  setFrame('insetLeft', 12);
  setFrame('insetRight', 12);
  setFrame('gutter', 18);
  assert(doc.blocks[0].frameOptions.columns === 2, 'Columns not stored');
  const rootText = host.querySelector('[data-scene-text]');
  assert(
    getComputedStyle(rootText).fontFamily.includes('CMU Serif'),
    'Named paragraph style not applied',
  );
  const sourceItem = doc.blocks[0];
  sourceItem.paragraphStyle = body.id;
  editor.refreshExternal();
  pick();
  const fontControl = host.querySelector('[data-object-prop="fontSize"]');
  fontControl.value = '19';
  fontControl.dispatchEvent(new Event('change', { bubbles: true }));
  assert(doc.blocks[0].textOverrides.fontSize === 19, 'Named-style direct override lost ownership');
  assert(
    getComputedStyle(host.querySelector('[data-scene-text]')).fontSize === '19px',
    'Definition overwrote a direct frame override',
  );
  const beforeSource = doc.blocks[0].html;
  await editor.command('start-flow');
  await tick();
  editor.finish();
  await tick();
  const flow = doc.textFlows[0];
  assert(
    !host.querySelector('.canvas-type-options') &&
      host.querySelector('.canvas-contextual-bar [data-canvas-command="type-options"]'),
    'Threaded frames need contextual type options without an unthreaded-frame badge',
  );
  assert(flow.html === beforeSource, 'Threading changed source');
  assert(flow.style.textOverrides.fontSize === 19, 'Threading lost direct style ownership');
  const plan = layoutDocumentTextFlows(doc);
  assert(
    (plan.fragments.get(frame.id).html.match(/class="flow-column"/g) || []).length === 2,
    'Threaded frame did not get two derived columns',
  );
  const parsed = new DOMParser().parseFromString(plan.fragments.get(frame.id).html, 'text/html');
  assert(
    parsed.body.textContent ===
      'Precision in proportion.Text, geometry and materials work together.',
    'Column projection lost or duplicated text',
  );
  await editor.command('tool-select');
  pick();
  await tick();
  assert(
    host.querySelector('[aria-label="Contextual point size"]').value === '19',
    'Contextual controls disagree with the authored flow style',
  );
  host.querySelector('[data-highlight-color="#9cddff"]').click();
  assert(flow.html.includes('#9cddff'), 'Whole-flow highlighting not encoded in canonical source');
  validateImport({ schemaVersion: 6, documents: [doc], assets: [] });
  await editor.command('new-layer');
  assert(doc.publishing.layers.length === 2, 'New layer not authored');
  const added = doc.publishing.layers.at(-1);
  host.querySelector(`[data-layer-move="${added.id}"]`).click();
  assert(doc.blocks[0].layerId === added.id, 'Selection did not move to layer');
  host.querySelector(`[data-layer-id="${added.id}"][data-layer-toggle="locked"]`).click();
  assert(!editor.getState().selection.length, 'Locked content remained editable');
  host.querySelector(`[data-layer-id="${added.id}"][data-layer-toggle="locked"]`).click();
  const disclosure = host.querySelector(`[data-layer-disclosure="${added.id}"]`);
  assert(
    disclosure.getAttribute('aria-expanded') === 'false',
    'Layers should initially be collapsed',
  );
  disclosure.click();
  assert(
    host.querySelector(`[data-layer-disclosure="${added.id}"]`).getAttribute('aria-expanded') ===
      'true',
    'Layer disclosure did not expand',
  );
  pick();
  const block = doc.blocks[0],
    objectLock = host.querySelector(`[data-object-toggle="locked"][data-object-id="${block.id}"]`),
    pageNode = host.querySelector('[data-page]');
  objectLock.click();
  assert(
    block.locked && !editor.getState().selection.length && pageNode.isConnected,
    'Locking an object must deselect it while preserving its page',
  );
  const unlock = host.querySelector(`[data-object-toggle="locked"][data-object-id="${block.id}"]`);
  unlock.click();
  assert(
    !block.locked && unlock.isConnected && unlock.getAttribute('aria-label') === 'Lock object',
    'Unlock must update the same control and restore editability',
  );
  pick();
  const beforePanels = JSON.stringify(doc),
    tab = host.querySelector('[data-canvas-panel="layers"]'),
    group = tab.closest('[data-context-group]');
  tab.click();
  const menuButton = group.querySelector('[data-panel-menu]');
  menuButton.click();
  assert(
    menuButton.getAttribute('aria-expanded') === 'true' &&
      host.querySelector('[data-workspace-action="command/layer-options"]'),
    'Layers flyout did not expose Layer Options',
  );
  const menuItem = document.activeElement;
  menuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(
    menuButton.getAttribute('aria-expanded') === 'false' && document.activeElement === menuButton,
    'Closing the panel menu lost keyboard focus',
  );
  menuButton.click();
  menuButton.click();
  assert(
    !host.querySelector('.workspace-panel-menu'),
    'Second click failed to dismiss the panel menu',
  );
  await editor.command('toggle-panel-floating');
  group.querySelector('[data-canvas-command="close-panel-group"]').click();
  assert(group.hidden, 'Close group did not hide panels');
  assert(getComputedStyle(group).display === 'none', 'Closed group remains painted or interactive');
  await editor.command('toggle-properties');
  assert(!group.hidden, 'Closed groups were not recoverable');
  await editor.command('toggle-panel-floating');
  assert(JSON.stringify(doc) === beforePanels, 'Panel close/reopen dirtied source');
  // A reusable parent is shared art; instance positions are derived and parent edits are a single undo command.
  const parentSource = insertObject(doc, 'text', page.id, {
    x: 48,
    y: 20,
    w: 240,
    h: 24,
    html: '<p>Collection 01</p>',
  });
  const oldFrame = doc.blocks.shift();
  const parent = createParent(doc, page.id, 'Collection');
  doc.blocks.unshift(oldFrame);
  doc.blocks = doc.blocks.filter((b) => b.id !== parentSource.id);
  const second = addPage(doc, page.id);
  applyParent(doc, second.id, parent.id);
  editor.refreshExternal();
  await editor.command('tool-select');
  const parentButton = host.querySelector(`[data-parent-edit="${parent.id}"]`);
  const beforeParentSelection = JSON.stringify(doc);
  parentButton.click();
  assert(
    JSON.stringify(doc) === beforeParentSelection && !host.querySelector('.parent-editor-overlay'),
    'Choosing a parent row must not apply it to the current page or enter its editor',
  );
  const transfer = new DataTransfer();
  const drop = (type, target) =>
    target.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  drop('dragstart', parentButton);
  drop('dragover', host.querySelector(`[data-select-page="${page.id}"]`));
  drop('drop', host.querySelector(`[data-select-page="${page.id}"]`));
  assert(page.parentPageId === parent.id, 'Dragging a parent onto a page did not apply it');
  host
    .querySelector('[data-page-parent=""]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
  assert(
    !page.parentPageId && second.parentPageId === parent.id,
    'Option-clicking [None] changed the wrong page',
  );
  host
    .querySelector(`[data-parent-edit="${parent.id}"]`)
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await tick();
  assert(host.querySelector('.parent-editor-overlay'), 'Parent definition editor did not open');
  const parentHost = host.querySelector('.parent-editor-host'),
    parentItem = parentHost.querySelector('[data-object]');
  assert(parentItem, 'Parent art not editable in isolated session');
  const nativeRect = parentItem.getBoundingClientRect();
  parentItem.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 12,
      button: 0,
      buttons: 1,
      clientX: nativeRect.x + 5,
      clientY: nativeRect.y + 5,
    }),
  );
  parentItem.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 12,
      button: 0,
      buttons: 0,
      clientX: nativeRect.x + 5,
      clientY: nativeRect.y + 5,
    }),
  );
  const parentSize = parentHost.querySelector('[data-object-prop="fontSize"]');
  assert(parentSize, 'Parent selection did not expose text controls');
  parentSize.value = '25';
  parentSize.dispatchEvent(new Event('change', { bubbles: true }));
  assert(
    doc.publishing.parents[0].blocks[0].fontSize !== 25,
    'Parent session leaked uncommitted text changes',
  );
  assert(doc.blocks[0].fontSize !== 25, 'Parent control event changed the page-frame owner');
  parentHost.querySelector(`[data-layer-select="${added.id}"]`).click();
  parentHost.querySelector('[data-canvas-command="delete-layer"]').click();
  assert(doc.blocks[0].layerId === added.id, 'Parent layer edit escaped before commit');
  host.querySelector('[data-finish-parent]').click();
  await tick();
  assert(!host.querySelector('.parent-editor-overlay'), 'Parent edit session did not close');
  assert(
    doc.publishing.parents[0].blocks[0].fontSize === 25,
    'Parent definition edit was not committed',
  );
  assert(
    doc.publishing.layers.some((layer) => layer.id === doc.blocks[0].layerId),
    'Parent layer removal stranded artwork outside the isolated canvas',
  );
  validateImport({ schemaVersion: 6, documents: [doc], assets: [] });
  editor.destroy();
  editor = mount();
  pick();
  await tick();
  assert(host.querySelectorAll('.canvas-flow-port').length === 2, 'Ports missing after remount');
  console.log(
    'IVO_PUBLISHING_RESULT:' +
      JSON.stringify({
        ok: true,
        eightHandles: true,
        independentFramePorts: true,
        openType: true,
        runHighlight: true,
        frameColumnsInsets: true,
        flowSourcePreserved: true,
        wholeFlowHighlight: true,
        layers: true,
        locking: true,
        closeReopenViewOnly: true,
        parentEditor: true,
        archiveRoundTrip: true,
      }),
  );
} catch (error) {
  console.log('IVO_PUBLISHING_RESULT:' + JSON.stringify({ error: error.stack }));
}
