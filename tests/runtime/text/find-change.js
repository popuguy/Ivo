import { verifyEditorialSearch } from './editorial-search.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import {
  findTextSources,
  findTextMatches,
  changeTextMatches,
  decodeFindField,
  findSelection,
} from '../../../src/features/editor/text/find-change.js';
import { captureTextSelection } from '../../../src/shared/dom/text-selection.js';

function assert(value, message) {
  if (!value) throw new Error('Find/Change: ' + message);
}

function verifyParagraphSearch() {
  const html =
    '<p data-ivo-align="left"><em>red linen</em></p><p data-ivo-align="right"><a data-doc-id="ref">blue silk</a></p><p><br></p><p>tabs\there ^p</p>';
  const lookup = (needle) => findTextMatches([{ id: 'x', html }], { needle });
  const cross = lookup('linen^pblue');
  assert(
    cross.length === 1 &&
      lookup('^p').length === 3 &&
      lookup('^t').length === 1 &&
      lookup('^^p').length === 1,
    'literal return, empty paragraph, tab, and caret codes',
  );
  const root = document.createElement('div');
  root.innerHTML = changeTextMatches(html, cross, decodeFindField('wool^pnavy'));
  assert(
    root.children[0].textContent === 'red wool' && root.children[1].textContent === 'navy silk',
    'replaces across two paragraph styles',
  );
  assert(
    root.children[0].dataset.ivoAlign === 'left' &&
      root.children[1].dataset.ivoAlign === 'right' &&
      root.children[1].querySelector('a[data-doc-id="ref"]'),
    'preserves both paragraph styles and link',
  );
  root.innerHTML = changeTextMatches(html, cross, ' and ');
  assert(
    root.children[0].textContent === 'red  and  silk' &&
      root.children[0].dataset.ivoAlign === 'left',
    'joining retains first paragraph',
  );
  root.innerHTML = changeTextMatches(html, lookup('^p'), '');
  assert(
    root.children.length === 1 && root.textContent === 'red linenblue silktabs\there ^p',
    'Change All joins consecutive empty paragraphs in the original match set',
  );
  const many = Array.from({ length: 500 }, (_, i) => '<p>line ' + i + '</p>').join('');
  const marks = findTextMatches([{ id: 'many', html: many }], { needle: '^p' });
  root.innerHTML = changeTextMatches(many, marks, ' ');
  assert(
    root.children.length === 1 && root.textContent.endsWith('line 498 line 499'),
    'bulk joining keeps every line in a long note',
  );
  assert(
    findSelection(html, cross[0].start, cross[0].end).text === 'linen^pblue',
    'selected paragraph return is encoded in the search field',
  );
}
export async function verifyFindChange() {
  verifyParagraphSearch();
  await verifyEditorialSearch();
  const doc = createSceneDocument('Editorial search'),
    page = doc.pages[0].id;
  const one = insertObject(doc, 'text', page, {
    x: 10,
    y: 15,
    w: 100,
    h: 60,
    html: '<p><strong>Na</strong><em>vy</em> Navy NAVY navyish</p>',
  });
  const flow = insertObject(doc, 'text', page, {
    x: 10,
    y: 90,
    w: 100,
    h: 40,
    html: '<p>A <a data-doc-id="reference">navy</a> coat</p>',
  });
  const tail = insertObject(doc, 'text', page, { x: 120, y: 90, w: 100, h: 40, html: '' });
  const thread = threadFrame(doc, flow.id, tail.id);
  const locked = insertObject(doc, 'text', page, { html: '<p>navy</p>' });
  const hidden = insertObject(doc, 'text', page, { html: '<p>NAVY</p>' });
  locked.locked = true;
  hidden.hidden = true;
  const ranges = (id) => (id === flow.id ? { start: 0, end: 5 } : { start: 5, end: 13 });
  const query = { needle: 'navy', wholeWord: true, caseSensitive: false };
  const sources = () => findTextSources(doc, ranges);
  assert(
    findTextMatches(sources(), query).length === 4,
    'reads a threaded source once across the frame boundary',
  );
  assert(
    findTextMatches(sources(), { ...query, caseSensitive: true }).length === 1,
    'case sensitive exact word',
  );
  assert(
    findTextMatches(sources(), { needle: '.*' }).length === 0,
    'punctuation searched literally',
  );
  tail.locked = true;
  assert(
    findTextMatches(sources(), query).length === 3,
    'locked continuation protects a match crossing the boundary',
  );
  tail.locked = false;
  const before = JSON.stringify(doc),
    undo = [],
    host = document.createElement('div');
  host.style.cssText = 'width:900px;height:620px;display:flex;position:relative';
  document.body.append(host);
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (value) => value,
    editing: true,
    onChange() {},
    onCommit(snapshot, metadata) {
      undo.push({ snapshot, metadata });
    },
    onUndo() {
      Object.assign(doc, undo.pop().snapshot);
    },
    onRedo() {},
  });
  const key = (target, value, modifiers = {}) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...modifiers }),
    );
  try {
    const viewport = host.querySelector('.canvas-viewport');
    key(viewport, 'f', { metaKey: true });
    let panel = host.querySelector('.canvas-find-change');
    assert(panel, 'Command-F opens the active editor panel');
    for (const width of [900, 315]) {
      host.style.width = width + 'px';
      const bounds = panel.getBoundingClientRect();
      assert(
        panel.scrollWidth <= panel.clientWidth + 1,
        'Find/Change clips horizontally at ' + width,
      );
      for (const control of panel.querySelectorAll('button, input, select, output')) {
        if (!control.getClientRects().length) continue;
        const r = control.getBoundingClientRect();
        assert(
          r.left >= bounds.left && r.right <= bounds.right,
          'Off-panel control: ' + control.name,
        );
      }
    }
    host.style.width = '900px';
    const input = (name, value) => {
      const el = panel.elements.namedItem(name);
      if (el.type === 'checkbox') el.checked = value;
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const click = (action) => panel.querySelector('[data-find-action="' + action + '"]').click();
    input('needle', 'navy');
    input('word', true);
    input('replacement', 'Blue');
    click('next');
    assert(panel.querySelector('output').value === '1 of 4', 'Find Next counts document hits');
    assert(window.getSelection().toString() === 'Navy', 'found styled text is selected');
    assert(undo.length === 0, 'finding commits no edits');
    assert(
      document.activeElement.dataset.findAction === 'next',
      'Enter remains in Find Next instead of replacing the selected match',
    );
    input('direction', 'backward');
    click('next');
    assert(
      panel.querySelector('output').value === '4 of 4',
      'backward search wraps into the preceding source',
    );
    input('direction', 'forward');
    click('next');
    assert(
      panel.querySelector('output').value === '1 of 4',
      'forward search wraps back to first match',
    );
    click('all');
    assert(
      undo.length === 1 && undo[0].metadata.label === 'Change All',
      'one Change All history entry',
    );
    assert(
      one.html.includes('<strong>Bl</strong><em>ue</em> Blue Blue navyish'),
      'retains formatting across runs',
    );
    assert(
      thread.html.includes('data-doc-id="reference"') && thread.html.includes('>Blue</a> coat'),
      'changes canonical flow source and preserves the document link',
    );
    assert(
      locked.html.includes('navy') && hidden.html.includes('NAVY'),
      'leaves locked and hidden objects intact',
    );
    click('done');
    await editor.command('undo');
    assert(JSON.stringify(doc) === before, 'one undo restores the whole document');
    await editor.command('document-text');
    const surface = host.querySelector('.canvas-flow-input');
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.data.includes('navy')) node = walker.nextNode();
    assert(node, 'thread editing surface contains logical text');
    const from = node.data.indexOf('navy');
    window.getSelection().setBaseAndExtent(node, from, node, from + 4);
    await editor.command('find-change');
    panel = host.querySelector('.canvas-find-change');
    assert(panel.elements.namedItem('needle').value === 'navy', 'uses selected text');
    input('scope', 'selection');
    input('replacement', 'tailoring');
    click('next');
    const selected = captureTextSelection(surface);
    assert(
      selected.focus.index - selected.anchor.index === 4,
      'find projects native selection to the flow',
    );
    click('change-find');
    assert(
      panel.querySelector('output').value === 'No matches found.',
      'changed selection cannot escape its flow',
    );
    assert(
      doc.textFlows[0].html.includes('>tailoring</a> coat'),
      'selection-scoped replacement succeeds',
    );
    input('needle', 'tailoring');
    input('replacement', 'warm^pcoat');
    click('all');
    input('needle', '^p');
    input('replacement', '^t');
    click('all');
    assert(
      doc.textFlows[0].html.includes('warm') &&
        doc.textFlows[0].html.includes('\t') &&
        !doc.textFlows[0].html.includes('</p><p>'),
      'bounded selection follows an inserted paragraph, then a tab',
    );
    input('needle', 'coat');
    click('next');
    assert(
      panel.querySelector('output').value === '1 of 1',
      'the identical word outside the original scope remains excluded after resizing',
    );
    key(panel.elements.namedItem('needle'), 'Escape');
    assert(!host.querySelector('.canvas-find-change'), 'Escape dismisses the panel');
  } finally {
    editor.destroy();
    host.remove();
  }
}
