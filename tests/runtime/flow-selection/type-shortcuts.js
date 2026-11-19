import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { captureTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';

const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function assert(value, message) {
  if (!value) throw Error(message);
}

export async function verifyTypeShortcuts(host, bridge) {
  const doc = createSceneDocument('Type size', undefined, 'cmu-serif');
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>One</p><p><span data-ivo-leading="14.4">Two</span></p><p><br></p><p><span data-ivo-size="18">Large</span></p>',
  });
  const original = startTextFlow(doc, frame.id).html;
  const commits = [];
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (s) => s,
    sessionId: 'type-size',
    initialState: { tool: 'select', selection: [frame.id] },
    onCommit: (before) => commits.push(before),
    onChange: () => {},
    onNotify: (message) => {
      throw Error(message);
    },
  });
  const source = () => doc.textFlows[0].html;
  const root = () => host.querySelector('[data-scene-text][contenteditable="true"]');
  const leaf = (word) => textIndexMap(root()).segments.find((s) => s.node.data.includes(word)).node;
  const select = async (word, offset, endWord = word, end = offset) => {
    root().focus({ preventScroll: true });
    getSelection().setBaseAndExtent(leaf(word), offset, leaf(endWord), end);
    await tick();
  };
  const key = async (key, extra = []) => {
    await bridge.key(key, [/Mac/.test(navigator.platform) ? 'meta' : 'control', 'shift', ...extra]);
    await tick();
  };
  try {
    await editor.command('document-text');
    await tick();
    const [first, second] = root().querySelectorAll('p');
    assert(
      getComputedStyle(first).fontSize === '12px' &&
        Math.abs(parseFloat(getComputedStyle(first).lineHeight) - 14.4) < 0.01 &&
        getComputedStyle(first).marginBottom === '0px' &&
        Math.abs(second.offsetTop - first.offsetTop - 14.4) < 1,
      'New document line or paragraph spacing changed',
    );
    await select('Large', 5, 'Two', 0);
    const before = captureTextSelection(root());
    await key('.');
    const after = captureTextSelection(root());
    assert(
      before.anchor.index === after.anchor.index && before.focus.index === after.focus.index,
      'Resize lost backward selection',
    );
    assert(
      root().querySelectorAll('p')[2].getAttribute('data-ivo-size') === '14',
      'Empty paragraph missed the size change',
    );
    assert(
      source().includes('data-ivo-size="14"') &&
        source().includes('data-ivo-size="20"') &&
        commits.length === 1 &&
        commits[0].textFlows[0].html === original,
      'Mixed selection did not grow in one undo step: ' + source(),
    );
    await key(',', ['alt']);
    assert(
      source().includes('data-ivo-size="4"') && source().includes('data-ivo-size="10"'),
      'Large step collapsed mixed sizes: ' + source(),
    );
    await select('One', 1);
    const unchanged = source();
    await key('.');
    await key('.');
    assert(source() === unchanged, 'Caret formatting changed preexisting text');
    await bridge.type('X');
    await tick();
    assert(
      leaf('X').parentElement.closest('[data-ivo-size="16"]'),
      'Typed character lost pending 16 pt size: ' + source(),
    );
    await select('Two', 0, 'Two', 3);
    await key('A', ['alt']);
    assert(
      leaf('Two').parentElement.closest('[data-ivo-leading="0"]') &&
        Math.abs(parseFloat(getComputedStyle(leaf('Two').parentElement).lineHeight) - 4.8) < 0.01,
      'Auto leading did not replace fixed leading on the selection: ' + source(),
    );
    await key('K');
    assert(leaf('Two').parentElement.closest('[data-ivo-caps="true"]'), 'All Caps failed');
    await key('J');
    assert(
      leaf('Two').parentElement.closest('[data-ivo-align="justify"]'),
      'Justify shortcut failed',
    );
    await editor.command('tool-select');
    editor.restoreView({ selection: [frame.id], activePage: doc.pages[0].id, tool: 'select' });
    await tick();
    host.querySelector('.canvas-viewport').focus();
    await key('.');
    assert(
      doc.textFlows[0].style.fontSize === 14 && source().includes('data-ivo-size="12"'),
      'Selected frame lost relative point sizes: ' + source(),
    );
    await editor.command('show-panel-properties');
    const field = host.querySelector('[data-object-prop="fontSize"]');
    field.focus();
    assert(document.activeElement === field, 'The Properties field must own the shortcut');
    const prev = source();
    await key(',');
    assert(source() === prev, 'Inspector field routed to canvas text');
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
}
