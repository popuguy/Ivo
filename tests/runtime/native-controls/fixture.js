import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { captureTextSelection } from '../../../src/shared/dom/text-selection.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  report = (value) => console.log('IVO_CONTROLS_RESULT:' + JSON.stringify(value));
window.addEventListener('error', (event) => report({ error: event.error?.stack || event.message }));
window.addEventListener('unhandledrejection', (event) =>
  report({ error: event.reason?.stack || String(event.reason) }),
);
try {
  await document.fonts.ready;
  let doc = createSceneDocument('Native controls'),
    editor;
  const history = createDocumentHistory(),
    host = document.querySelector('#host'),
    notices = [];
  const a = insertObject(doc, 'polygon', doc.pages[0].id, { x: 20, y: 20, w: 30, h: 30 }),
    b = insertObject(doc, 'polygon', doc.pages[0].id, { x: 70, y: 20, w: 30, h: 30 }),
    c = insertObject(doc, 'polygon', doc.pages[0].id, { x: 120, y: 20, w: 30, h: 30 }),
    text = insertObject(doc, 'text', doc.pages[0].id, {
      x: 30,
      y: 100,
      w: 300,
      h: 180,
      textStyle: 'cmu-serif',
      fontSize: 16,
      html: '<p><em>A</em></p>',
    });
  startTextFlow(doc, text.id, { automaticPages: false });
  addPage(doc, doc.pages[0].id);
  editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    initialState: { selection: [b.id], camera: { x: 0, y: 0, zoom: 1 } },
    onNotify: (m) => notices.push(m),
    onChange: () => {},
    onCommit: (before, meta) => history.record(before, doc, meta),
    onUndo: () => step('undo'),
    onRedo: () => step('redo'),
  });
  function step(direction) {
    const next = history[direction](doc);
    if (next) {
      doc = next.document;
      editor.restoreView(next.view);
    }
  }
  const viewport = host.querySelector('.canvas-viewport'),
    modifier = /Mac/.test(navigator.platform) ? 'meta' : 'control';
  viewport.focus();
  await tick();
  await window.controlsTest.key(']', [modifier]);
  await tick();
  assert(
    doc.blocks.map((x) => x.id).join() === [a.id, c.id, b.id, text.id].join(),
    'Command ] did not move one sibling forward',
  );
  await window.controlsTest.key('[', [modifier, 'shift']);
  await tick();
  assert(doc.blocks[0].id === b.id, 'Command Shift [ did not send selection to back');
  await editor.command('undo');
  await tick();
  assert(doc.blocks[2].id === b.id, 'Undo did not restore stacking');
  await editor.command('redo');
  await tick();
  assert(doc.blocks[0].id === b.id, 'Redo did not restore stacking');
  const source = JSON.stringify(doc),
    beforeViews = history.size;
  host.querySelector('[data-canvas-command="tool-text"]').focus();
  await window.controlsTest.key('Tab');
  await tick();
  assert(
    host.querySelector('.scene-editor').classList.contains('tools-hidden'),
    'Tab navigated toolbar focus instead of hiding panels',
  );
  await window.controlsTest.key('Tab');
  await tick();
  assert(
    !host.querySelector('.scene-editor').classList.contains('tools-hidden'),
    'Tab failed to restore panels',
  );
  await window.controlsTest.key('Tab', ['shift']);
  await tick();
  assert(
    host.querySelector('.scene-editor').classList.contains('panels-hidden') &&
      getComputedStyle(host.querySelector('.canvas-tools')).display !== 'none',
    'Shift Tab did not retain tools',
  );
  await window.controlsTest.key('Tab', ['shift']);
  await tick();
  const snap = editor.getState().snap;
  await window.controlsTest.key('U', [modifier]);
  await tick();
  assert(editor.getState().snap !== snap, 'Command U did not toggle Smart Guides');
  assert(!host.querySelector('[data-canvas-snap]'), 'Obsolete Snap checkbox remains');
  const footer = host.querySelector('.canvas-status');
  assert(
    footer.children.length === 2 && footer.offsetHeight === 22,
    'Status bar is not a narrow page/zoom strip',
  );
  await editor.command('show-panel-properties');
  const fields = [...host.querySelectorAll('.canvas-properties input')].filter(
    (field) => !field.disabled && field.getClientRects().length,
  );
  assert(fields.length > 1, 'Properties fields are missing');
  fields[0].focus();
  await window.controlsTest.key('Tab');
  await tick();
  assert(
    document.activeElement === fields[1],
    'Tab did not move within the native-like property field group',
  );
  viewport.focus();
  await editor.command('next-page');
  await tick();
  assert(editor.getState().activePage === doc.pages[1].id, 'Page navigation failed');
  await editor.command('previous-page');
  await tick();
  assert(
    JSON.stringify(doc) === source && history.size === beforeViews,
    'View controls modified saved content/history',
  );
  const root = host.querySelector(`[data-object="${text.id}"]`),
    r = root.getBoundingClientRect();
  root.dispatchEvent(
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      detail: 2,
      clientX: r.x + 10,
      clientY: r.y + 10,
    }),
  );
  await tick();
  await editor.command('document-text');
  await tick();
  const input = host.querySelector('.canvas-flow-input');
  input.focus();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const beforeTab = doc.textFlows[0].html;
  await window.controlsTest.key('Tab');
  await tick();
  await editor.flush();
  await tick();
  assert(doc.textFlows[0].html.includes('\t'), 'Tab did not insert literal source text');
  assert(
    document.activeElement === input && captureTextSelection(input),
    'Tab left the text input',
  );
  await window.controlsTest.insert('B');
  await tick();
  await editor.flush();
  await tick();
  assert(input.textContent.includes('\tB'), 'Typing after Tab lost source order');
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  let leaf;
  while ((leaf = walker.nextNode())) if (leaf.data.includes('B')) break;
  assert(
    leaf && getComputedStyle(leaf.parentElement).fontStyle === 'italic',
    'Tab reset insertion formatting',
  );
  assert(cleanHTML(input.innerHTML) === doc.textFlows[0].html, 'Tab projection leaked into source');
  const bRange = document.createRange();
  bRange.setStart(leaf, leaf.data.indexOf('B'));
  bRange.setEnd(leaf, leaf.data.indexOf('B') + 1);
  const bLeft = bRange.getBoundingClientRect().left;
  const aWalker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  let aLeaf;
  while ((aLeaf = aWalker.nextNode())) if (aLeaf.data.includes('A')) break;
  const aRange = document.createRange();
  aRange.setStart(aLeaf, aLeaf.data.indexOf('A'));
  aRange.setEnd(aLeaf, aLeaf.data.indexOf('A') + 1);
  assert(
    Math.abs((bLeft - aRange.getBoundingClientRect().left) / editor.getState().camera.zoom - 36) <
      0.1,
    'Browser tab paint does not reach the native half-inch stop',
  );
  const beforeRightTab = doc.textFlows[0].html;
  await window.controlsTest.key('Tab', ['shift']);
  await tick();
  assert(
    doc.textFlows[0].html === beforeRightTab && document.activeElement === input,
    'Unavailable right-indent tab moved focus or modified source',
  );
  assert(notices.pop()?.includes('Right-indent tabs'), 'Unavailable right-indent tab was silent');
  assert(
    !host.querySelector('.scene-editor').classList.contains('panels-hidden'),
    'Text Tab hid panels',
  );
  assert(getComputedStyle(footer).userSelect === 'none', 'UI labels remain selectable');
  assert(getComputedStyle(input).userSelect === 'text', 'Author text lost selection');
  await editor.command('next-page');
  await tick();
  assert(
    !input.isContentEditable &&
      editor.getState().activePage === doc.pages[1].id &&
      doc.textFlows[0].html === beforeRightTab,
    'Page navigation retained an off-page editable owner or changed text',
  );
  await editor.command('previous-page');
  await tick();
  await editor.command('undo');
  await tick();
  assert(doc.textFlows[0].html === beforeTab, 'Undo failed to remove the tab/typing transaction');
  await editor.command('tool-select');
  viewport.focus();
  await tick();
  assert(
    editor.textCommandTarget(),
    'Selected text frame lost its native formatting target: ' + JSON.stringify(editor.getState()),
  );
  assert(!notices.length, 'Unexpected notices: ' + notices.join(';'));
  editor.destroy();
  report({
    ok: true,
    arrangeShortcuts: true,
    arrangeUndoRedo: true,
    contextualTab: true,
    literalTextTab: true,
    tabFormatting: true,
    viewOnlyControls: true,
    smartGuides: true,
    narrowStatus: true,
    pageNavigation: true,
  });
} catch (error) {
  report({ error: error.stack || String(error) });
}
