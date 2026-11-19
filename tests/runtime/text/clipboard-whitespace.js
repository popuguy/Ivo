import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { applyNamedTextStyles } from '../../../src/rendering/text/styles.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export async function verifyClipboardWhitespace() {
  for (const text of [' Alpha', '  Alpha ', '\t Alpha', '\n Alpha', ' ', '  ']) {
    const root = document.createElement('div');
    root.innerHTML = cleanHTML(text);
    assert(
      root.textContent === text,
      'Fragment sanitization changed literal whitespace: ' +
        JSON.stringify({ text, actual: root.textContent }),
    );
  }
  const untrusted = cleanHTML(
    '<!doctype html><html><head><title>Not document text</title><base href="https://example.com/"><meta charset="utf-8"><link rel="stylesheet" href="https://example.com/x"><style>body{display:none}</style></head><body> <em onclick="bad()">Safe</em><script>bad()</script><img src="https://example.com/x"></body></html>',
  );
  assert(
    untrusted === ' <em>Safe</em>',
    'Fragment sanitizer admitted document metadata, resources or executable markup: ' + untrusted,
  );
  const projected = document.createElement('div');
  projected.innerHTML = '\n  <p> <em>Alpha</em></p>\n  <p>Ordinary text</p>\n';
  applyNamedTextStyles(projected, createSceneDocument());
  assert(
    !projected.style.whiteSpace && projected.querySelector('p').style.whiteSpace === 'pre-wrap',
    'Whitespace projection turned HTML indentation into document lines',
  );
  projected.querySelector('p').textContent = 'Alpha';
  applyNamedTextStyles(projected, createSceneDocument());
  assert(
    !projected.querySelector('p').style.whiteSpace,
    'Removed whitespace retained stale projection CSS',
  );
  for (const linked of [false, true]) {
    let doc = createSceneDocument('Clipboard whitespace');
    const frame = insertObject(doc, 'text', doc.pages[0].id, {
      html: '<p><em>Alpha bravo</em></p>',
      x: 40,
      y: 40,
      w: 300,
      h: 200,
    });
    if (linked) startTextFlow(doc, frame.id, { automaticPages: false });
    const history = createDocumentHistory(),
      host = document.createElement('div');
    host.style.cssText = 'width:1100px;height:700px';
    document.body.append(host);
    let editor;
    const step = (direction) => {
      const result = history[direction](doc);
      if (result) {
        doc = result.document;
        editor.restoreView(result.view);
      }
    };
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (s) => s,
      editing: true,
      initialState: { selection: [frame.id], tool: 'text' },
      onChange: () => {},
      onNotify: (m) => {
        throw Error(m);
      },
      onCommit: (before, meta) => history.record(before, doc, meta),
      onUndo: () => step('undo'),
      onRedo: () => step('redo'),
    });
    const html = () => (linked ? doc.textFlows[0].html : doc.blocks[0].html);
    const enter = async () => {
      await editor.command('document-text');
      await tick();
      const input = host.querySelector('[data-scene-text][contenteditable="true"]');
      assert(input, 'Clipboard fixture did not enter its text frame');
      input.focus();
      return input;
    };
    try {
      const initial = html();
      const sourceInput = await enter();
      const sourceLeaf = sourceInput.querySelector('em').firstChild;
      window.getSelection().setBaseAndExtent(sourceLeaf, 5, sourceLeaf, sourceLeaf.length);
      if (linked) {
        const copied = new DataTransfer();
        sourceInput.dispatchEvent(
          new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: copied }),
        );
        assert(copied.getData('text/plain') === ' bravo', 'Copy trimmed a selected leading space');
        const copyRoot = document.createElement('div');
        copyRoot.innerHTML = copied.getData('text/html');
        assert(copyRoot.textContent === ' bravo', 'Rich copy trimmed a selected leading space');
      }
      for (const payload of [
        { plain: ' bravo', expected: ' bravo' },
        { plain: '  bravo  ', expected: '  bravo  ' },
        { plain: ' ', expected: ' ' },
        { plain: '  first\n second', expected: '  first\n second' },
        { plain: ' first\r\n second', expected: ' first\n second' },
        { plain: '\t bravo', expected: '\t bravo' },
        { rich: ' <em>bravo</em>', plain: ' bravo', expected: ' bravo', italic: true },
        { rich: '<p> <em>bravo</em></p>', plain: ' bravo', expected: ' bravo', italic: true },
        { rich: '<span> </span><em>bravo</em>', plain: ' bravo', expected: ' bravo', italic: true },
      ]) {
        const input = await enter(),
          selection = window.getSelection(),
          range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', payload.plain);
        if (payload.rich) transfer.setData('text/html', payload.rich);
        input.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
        );
        await tick();
        await editor.flush();
        await tick();
        const saved = document.createElement('div');
        saved.innerHTML = html();
        const actual = saved.innerHTML.replace(/<br\s*\/?\s*>/gi, '\n');
        saved.innerHTML = actual;
        assert(
          saved.textContent === payload.expected,
          'Paste lost whitespace: ' +
            JSON.stringify({ linked, payload, html: html(), text: saved.textContent }),
        );
        // Test canonical, newly mounted HTML, not the temporary clipboard CSS.
        const paint = document.createElement('div');
        paint.style.cssText = 'width:300px;white-space:normal;position:relative';
        paint.innerHTML = html();
        applyNamedTextStyles(paint, doc);
        document.body.append(paint);
        const firstLeaf = document.createTreeWalker(paint, NodeFilter.SHOW_TEXT).nextNode();
        const space = document.createRange();
        space.setStart(firstLeaf, 0);
        space.setEnd(firstLeaf, 1);
        const spaceWidth = space.getBoundingClientRect().width;
        paint.remove();
        assert(
          spaceWidth > 0,
          'Saved leading space became invisible after mounting without paste-only styling: ' +
            JSON.stringify({ linked, payload, html: html(), first: firstLeaf?.data }),
        );
        assert(
          !html().includes('data-ivo-clipboard-whitespace') && !html().includes('white-space'),
          'Temporary clipboard/layout CSS entered canonical source',
        );
        if (payload.italic)
          assert(
            saved.querySelector('em,i,[data-ivo-italic="true"]')?.textContent === 'bravo',
            'Rich paste lost italic formatting',
          );
        const archive = {
          schemaVersion: archiveVersion([doc]),
          documents: [structuredClone(doc)],
          assets: [],
        };
        const reopened = validateImport(JSON.parse(JSON.stringify(archive))).documents[0];
        assert(
          (linked ? reopened.textFlows[0].html : reopened.blocks[0].html) === html(),
          'Archive reopen changed pasted source',
        );
        const pasted = html();
        await editor.command('undo');
        await tick();
        assert(html() === initial, 'Paste did not undo as one source transaction');
        await editor.command('redo');
        await tick();
        assert(html() === pasted, 'Paste redo changed whitespace');
        await editor.command('undo');
        await tick();
      }
      const input = await enter(),
        leaf = input.querySelector('em').firstChild;
      window.getSelection().setBaseAndExtent(leaf, 5, leaf, 5);
      const transfer = new DataTransfer();
      transfer.setData('text/html', ' <strong>new</strong>');
      input.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
      await tick();
      await editor.flush();
      await tick();
      const middle = document.createElement('div');
      middle.innerHTML = html();
      assert(
        middle.textContent.replaceAll('\u00a0', ' ') === 'Alpha new bravo' &&
          middle.querySelector('strong,b')?.textContent === 'new',
        'Mid-paragraph rich paste changed spacing, order or emphasis: ' + html(),
      );
      await editor.command('undo');
      await tick();
      assert(html() === initial, 'Mid-paragraph paste did not undo atomically');
    } finally {
      editor.destroy();
      host.remove();
    }
  }
}
