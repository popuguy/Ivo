import { listMarkers, paintListNumbers } from '../../../src/shared/dom/list-numbering.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { textIndexMap } from '../../../src/shared/dom/text-selection.js';

const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const assert = (value, message) => {
  if (!value) throw Error(message);
};

export async function verifyDocumentOperations(host, bridge) {
  let doc = createSceneDocument('Text operations');
  const item = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>Plain <em>blue</em></p><p>Second <strong>tail</strong></p>',
    x: 30,
    y: 30,
    w: 350,
    h: 160,
  });
  const original = item.html,
    history = createDocumentHistory();
  const source = () => doc.blocks.find((b) => b.id === item.id).html;
  const root = () => host.querySelector('[data-scene-text][contenteditable="true"]');
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    initialState: { tool: 'text', selection: [item.id] },
    sessionId: 'document-operations',
    onCommit: (before, meta) => history.record(before, doc, meta),
    onChange: () => {},
    onUndo: () => restore('undo'),
    onRedo: () => restore('redo'),
    onNotify: (message) => {
      throw Error(message);
    },
  });
  function restore(command) {
    const record = history[command](doc);
    if (record) {
      doc = record.document;
      editor.restoreView(record.view);
    }
  }
  const events = [];
  const watch = (e) =>
    events.push({ type: e.inputType, owned: e.defaultPrevented, trusted: e.isTrusted });
  host.addEventListener('beforeinput', watch);
  function leaf(text) {
    const found = textIndexMap(root()).segments.find((s) => s.node.data.includes(text));
    assert(found, 'Missing test run ' + text + ' in ' + source());
    return found.node;
  }
  async function caret(node, offset, other = node, end = offset) {
    root().focus({ preventScroll: true });
    getSelection().setBaseAndExtent(node, offset, other, end);
    await tick();
  }
  async function action(run, type, trusted = true) {
    events.length = 0;
    await run();
    await tick();
    assert(
      events.some((e) => e.type === type && e.owned && e.trusted === trusted),
      type + ' was not applied by Ivo: ' + JSON.stringify(events),
    );
  }
  try {
    await editor.command('document-text');
    await tick();
    if (/Mac/.test(navigator.platform)) {
      await caret(leaf('blue'), 2);
      await bridge.key('Left', ['meta']);
      await tick();
      const lineStart = getSelection().getRangeAt(0).cloneRange();
      lineStart.setEnd(leaf('blue'), 4);
      assert(
        lineStart.toString() === 'Plain blue',
        'Command–Left stopped at a word instead of the beginning of the line',
      );
      await bridge.key('Right', ['meta', 'shift']);
      await tick();
      assert(
        getSelection().toString() === 'Plain blue',
        'Command–Shift–Right missed the end of the standalone line',
      );
      await caret(leaf('Second'), 0);
      await bridge.key('Delete', ['meta']);
      await tick();
      assert(
        source() === '<p>Plain <em>blue</em></p><p><strong>tail</strong></p>',
        'Forward word deletion lost following styled text: ' + source(),
      );
      await editor.command('undo');
      await tick();
      assert(source() === original, 'Undo of forward word deletion changed other styles');
      await caret(leaf('Second'), 3);
      await bridge.key('End', ['shift']);
      await tick();
      assert(
        getSelection().getRangeAt(0).toString() === 'ond tail',
        'Shift–Fn–Right did not select to end',
      );
    }
    await caret(leaf('Second'), 3, leaf('blue'), 2);
    await action(() => bridge.type('X'), 'insertText');
    assert(
      source() === '<p>Plain <em>blX</em>ond <strong>tail</strong></p>',
      'Reverse replacement changed formatting: ' + source(),
    );
    await editor.command('undo');
    await tick();
    assert(
      source() === original &&
        getSelection().anchorNode.data === 'Second ' &&
        getSelection().focusNode.data === 'blue',
      'Undo did not restore reversed selection',
    );
    await editor.command('redo');
    await tick();
    await caret(leaf('blX'), 3);
    await action(() => bridge.key('Enter'), 'insertParagraph');
    assert(root().querySelectorAll('p').length === 2, 'Split did not create a paragraph');
    await action(() => bridge.key('Enter', ['shift']), 'insertLineBreak');
    assert(
      root().querySelectorAll('p')[1].querySelector('br'),
      'Shift Return lost the authored soft break',
    );
    await action(() => bridge.key('Backspace'), 'deleteContentBackward');
    await action(() => bridge.key('Backspace'), 'deleteContentBackward');
    assert(
      root().querySelectorAll('p').length === 1 && root().textContent === 'Plain blXond tail',
      'Backspace did not restore joined text',
    );
    await caret(leaf('tail'), 4);
    await action(() => bridge.key('Enter'), 'insertParagraph');
    await action(() => bridge.type('Q'), 'insertText');
    assert(
      root().lastElementChild.querySelector('strong')?.textContent === 'Q',
      'Enter at the end lost the explicit bold insertion style: ' + source(),
    );
    await caret(leaf('tail'), 4);
    await action(() => bridge.key('Delete'), 'deleteContentForward');
    assert(
      root().querySelectorAll('p').length === 1 && root().textContent.endsWith('tailQ'),
      'Forward delete failed to join paragraphs',
    );
    // Autocorrection can replace an OS-specified range distinct from the caret.
    const target = leaf('tail');
    await caret(target, 0);
    await action(
      () =>
        root().dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertReplacementText',
            data: 'hem',
            targetRanges: [
              new StaticRange({
                startContainer: target,
                startOffset: 1,
                endContainer: target,
                endOffset: 4,
              }),
            ],
          }),
        ),
      'insertReplacementText',
      false,
    );
    assert(root().textContent.endsWith('themQ'), 'Replacement ignored the supplied target range');
    const beforeIME = source();
    const marked = leaf('them');
    await caret(marked, 4, marked, 1);
    const historyBefore = history.size;
    events.length = 0;
    await bridge.ime('start');
    await bridge.ime('update');
    assert(
      source() === beforeIME && root().textContent.includes('にほ'),
      'Marked text reached the authored document before commit',
    );
    await bridge.ime('cancel');
    await tick();
    assert(source() === beforeIME, 'Canceling marked text changed the document: ' + source());
    assert(
      history.size === historyBefore &&
        getSelection().toString() === 'hem' &&
        getSelection().anchorOffset > getSelection().focusOffset,
      'Cancellation lost history or selection direction',
    );
    await caret(leaf('them'), 4);
    await bridge.ime('start');
    await bridge.ime('update');
    await bridge.ime('commit');
    await tick();
    assert(
      root().textContent.endsWith('them日本Q') &&
        events.some((e) => e.trusted && e.type === 'insertCompositionText' && !e.owned),
      'Platform composition was interrupted or committed twice: ' + source(),
    );
    await editor.command('undo');
    await tick();
    assert(source() === beforeIME, 'Undo did not restore the source before composition');
    const lastRun = leaf('Q');
    const ink = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const previousLine = ink(lastRun);
    await caret(lastRun, lastRun.length);
    await action(() => bridge.key('Enter', ['shift']), 'insertLineBreak');
    await action(() => bridge.type('Z'), 'insertText');
    assert(
      root().querySelectorAll('p').length === 1 &&
        root().querySelectorAll('br').length === 1 &&
        root().textContent.endsWith('QZ') &&
        ink(leaf('Z')).top > previousLine.top + previousLine.height / 2,
      'Typing after a terminal soft return did not paint on the next line: ' + source(),
    );
  } finally {
    host.removeEventListener('beforeinput', watch);
    editor.destroy();
    host.replaceChildren();
  }
}

export async function verifyListOperations(host, bridge) {
  const doc = createSceneDocument('List editing');
  const list = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<ol><li><em>red blue</em></li><li>tail</li></ol>',
    x: 20,
    y: 20,
    w: 350,
    h: 180,
  });
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    initialState: { tool: 'text', selection: [list.id] },
    sessionId: 'list-operations',
    onCommit: () => {},
    onChange: () => {},
  });
  const root = () => host.querySelector('[data-scene-text][contenteditable="true"]');
  const owned = [];
  const watch = (e) => owned.push(e.defaultPrevented);
  host.addEventListener('beforeinput', watch);
  try {
    await editor.command('document-text');
    await tick();
    const em = root().querySelector('em').firstChild;
    getSelection().collapse(em, 4);
    await bridge.key('Enter');
    await tick();
    assert(
      root().querySelectorAll('ol > li').length === 3 &&
        root().querySelectorAll('li em')[1]?.textContent === 'blue',
      'List split lost numbering or emphasis: ' + list.html,
    );
    await bridge.type('Z');
    await tick();
    assert(
      root().querySelectorAll('li em')[1]?.textContent === 'Zblue',
      'Typing lost list styling',
    );
    await bridge.key('Backspace');
    await tick();
    await bridge.key('Backspace');
    await tick();
    assert(
      root().querySelectorAll('li').length === 2 &&
        root().querySelector('li').textContent === 'red blue',
      'Sibling list join failed',
    );
    const tail = root().querySelector('li:last-child').firstChild;
    getSelection().collapse(tail, tail.length);
    await bridge.key('Enter');
    await tick();
    await bridge.key('Enter');
    await tick();
    await bridge.type('X');
    await tick();
    assert(
      root().lastElementChild.tagName === 'P' &&
        root().lastElementChild.textContent === 'X' &&
        root().querySelectorAll('li').length === 2,
      'Empty item did not exit the list: ' + list.html,
    );
    assert(
      owned.length >= 7 && owned.every(Boolean),
      'List edits escaped document operation ownership',
    );
    const item = (caption) =>
      [...root().querySelectorAll('li')].find((el) => el.textContent === caption);
    const choose = async (node, offset = 0) => {
      root().focus();
      getSelection().collapse(node, offset);
      await tick();
    };
    await choose(root().lastElementChild.firstChild);
    await editor.command('apply-numbering');
    await tick();
    const third = item('X');
    assert(third, 'List command did not apply in the browser');
    await choose(third.firstChild);
    await editor.command('increase-list-level');
    await tick();
    assert(
      root().querySelector('li > ol > li')?.textContent === 'X',
      'Browser did not nest the item',
    );
    const owner = root().querySelector('li > ol').parentElement;
    await choose(owner.firstChild, 1);
    const count = owned.length;
    await bridge.key('Enter');
    await tick();
    assert(owned.length === count + 1 && owned.at(-1), 'Browser handled the parent split');
    assert(
      root().querySelector('li > ol > li')?.textContent === 'X',
      'Splitting a parent erased its nested list',
    );
    const imported = document.createElement('div');
    imported.innerHTML = cleanHTML('<ol start="7"><li>A</li><li value="12">B</li><li>C</li></ol>');
    assert(
      [...imported.querySelectorAll('li')]
        .map((li) => listMarkers(imported).get(li).number)
        .join() === '7,12,13',
      'Imported HTML list start/restart lost',
    );
    imported.innerHTML =
      '<ol data-ivo-list-series="default"><li>A</li><li>B</li></ol><p>Interruption</p><ol data-ivo-list-series="default"><li>C</li></ol>';
    const markup = imported.innerHTML;
    paintListNumbers(imported);
    assert(
      imported.lastElementChild.start === 3 && cleanHTML(imported.innerHTML) === markup,
      'Browser list continuity leaked a generated start into the archive',
    );
  } finally {
    host.removeEventListener('beforeinput', watch);
    editor.destroy();
    host.replaceChildren();
  }
}
