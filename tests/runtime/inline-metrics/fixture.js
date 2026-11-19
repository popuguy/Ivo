import { textClipboardHTML } from '../../../src/features/editor/text/clipboard.js';
import { inheritEmptyParagraphTypography } from '../../../src/rendering/text/insertion.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { formatRange } from '../../../src/rendering/text/format.js';
import {
  captureTextSelection,
  restoreTextSelection,
} from '../../../src/shared/dom/text-selection.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { prepareTextFlowFonts } from '../../../src/rendering/text/flow-layout.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const probe = (html) => {
  const element = document.createElement('div');
  element.className = 'rich-text probe';
  element.innerHTML = html;
  document.body.append(element);
  return element;
};
const selectAll = (element) => {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  return range;
};
try {
  await prepareTextFlowFonts();
  // Older documents can carry the full sequence of overrides from repeated inspector edits.
  const legacyScales = [
    ...Array.from({ length: 19 }, (_, i) => ['autoleading', 119 - i]),
    ...[99, 98, 97, 96, 95, 94, 100, 90, 100, 95, 100].map((n) => ['vscale', n]),
    ['hscale', 90],
    ['hscale', 100],
  ];
  const withLegacyScale = (text) =>
    legacyScales.reduceRight((inner, [key, value]) => {
      const transform = key === 'hscale' ? `scale(${value / 100}, 1)` : `scale(1, ${value / 100})`;
      const style =
        key === 'autoleading'
          ? `--ivo-auto-leading:${value / 100}`
          : `display:inline-block; transform:${transform}`;
      return `<span data-ivo-${key}="${value}" style="${style}">${inner}</span>`;
    }, text);
  const paragraphs = [
    'Heading',
    '1. First item',
    '2. Second item',
    '3. Third item',
    '4. Final item',
  ];
  const clipboard = {
    getData: (type) =>
      type === 'text/html'
        ? paragraphs.map((text) => '<p>' + withLegacyScale(text) + '</p>').join('')
        : '',
  };
  const pasted = probe(cleanHTML(textClipboardHTML(clipboard)));
  for (const [index, paragraph] of [...pasted.querySelectorAll('p')].entries()) {
    assert(
      paragraph.querySelectorAll('[data-ivo-autoleading]').length === 1 &&
        paragraph.querySelector('[data-ivo-autoleading]').dataset.ivoAutoleading === '101',
      'Repeated auto-leading edits left stale wrappers or changed the final leading',
    );
    const first = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, 1);
    assert(
      Math.abs(range.getBoundingClientRect().left - paragraph.getBoundingClientRect().left) < 0.1,
      'Resetting character scale left a false leading indent in pasted rich text',
    );
    assert(paragraph.textContent === paragraphs[index], 'Scale repair changed the pasted text');
  }
  pasted.remove();
  // Empty paragraph attributes win over neighboring runs; IME can use the same live caret.
  const insertion = probe(
    '<p><span data-ivo-font="cmu-serif" data-ivo-size="12" data-ivo-leading="0">Body text.</span></p><p><span data-ivo-font="sans" data-ivo-size="36"><br></span></p><p><br></p>',
  );
  insertion.classList.add('serif');
  const explicit = insertion.querySelectorAll('p')[1],
    rangeAtBlank = document.createRange();
  rangeAtBlank.setStart(explicit.querySelector('span'), 0);
  rangeAtBlank.collapse(true);
  inheritEmptyParagraphTypography(insertion, rangeAtBlank);
  assert(
    explicit.querySelector('span').dataset.ivoFont === 'sans' &&
      explicit.querySelector('span').dataset.ivoSize === '36',
    'Intentional empty paragraph styling was overwritten',
  );
  insertion.remove();
  const source =
      '<p><span data-ivo-size="123" style="font-size:123px"><strong><span data-ivo-size="12" style="font-size:12px"><span data-ivo-leading="0" style="line-height:1.2">Small bold 😀 text</span></span></strong></span></p><p><br></p><p><span data-ivo-size="123" style="font-size:123px"><a href="https://example.com"><span data-ivo-size="12" style="font-size:12px">Linked text</span></a></span></p>',
    raw = probe(source),
    fixed = cleanHTML(source),
    clean = probe(fixed),
    before = raw.querySelector('p').getBoundingClientRect().height,
    after = clean.querySelector('p').getBoundingClientRect().height;
  assert(before > 100 && after < 30, 'Overridden ancestor still inflated the line box');
  assert(
    raw.textContent === clean.textContent &&
      clean.querySelectorAll('p').length === 3 &&
      clean.querySelectorAll('br').length === 1,
    'Repair changed text/paragraphs/blank lines',
  );
  assert(
    clean.querySelector('strong') && clean.querySelector('a').href === 'https://example.com/',
    'Repair changed emphasis or links',
  );
  assert(
    !fixed.includes('123') && cleanHTML(fixed) === fixed,
    'Repair left obsolete metrics or was not idempotent',
  );
  const scoped =
      '<p data-ivo-before="6" data-ivo-after="8"><span data-ivo-size="123"><span data-ivo-size="12" data-ivo-leading="42">Keep explicit spacing</span></span></p>',
    scopedRoot = probe(cleanHTML(scoped));
  assert(
    scopedRoot.querySelector('[data-ivo-leading="42"]') &&
      scopedRoot.querySelector('[data-ivo-before="6"]') &&
      scopedRoot.querySelector('[data-ivo-after="8"]'),
    'Deliberate leading or paragraph spacing was reset',
  );
  const emptyParagraph = cleanHTML('<p><span data-ivo-size="36"></span></p>');
  assert(
    emptyParagraph.includes('data-ivo-size="36"'),
    'An intentionally styled empty paragraph was stripped',
  );
  const relative =
      '<span data-ivo-size="24"><code>A<span data-ivo-size="12">B</span></code></span>',
    originalCode = probe(cleanHTML(relative)),
    roundCode = probe(cleanHTML(cleanHTML(relative)));
  assert(
    getComputedStyle(originalCode.querySelector('code')).fontSize ===
      getComputedStyle(roundCode.querySelector('code')).fontSize &&
      originalCode.innerHTML === roundCode.innerHTML,
    'Relative font scope changed on repeated reads',
  );
  const mixed = probe('<p>Small text</p><p>Large text</p>');
  let range = document.createRange();
  range.selectNodeContents(mixed);
  formatRange(mixed, range, 'fontSize', 123);
  const first = mixed.querySelector('p');
  range.selectNodeContents(first);
  formatRange(mixed, range, 'fontSize', 12);
  assert(
    getComputedStyle(first.querySelector('span')).fontSize === '12px' &&
      first.getBoundingClientRect().height < 30,
    'Partial reformat retained a large ancestor ' +
      first.innerHTML +
      ' height=' +
      first.getBoundingClientRect().height,
  );
  assert(
    getComputedStyle(mixed.querySelectorAll('p')[1].querySelector('span')).fontSize === '123px',
    'Partial reformat changed unselected large text',
  );
  raw.remove();
  clean.remove();
  scopedRoot.remove();
  originalCode.remove();
  roundCode.remove();
  mixed.remove();
  for (const flow of [false, true]) {
    const doc = createSceneDocument('Repeated font change'),
      frame = insertObject(doc, 'text', doc.pages[0].id, {
        x: 48,
        y: 48,
        w: 516,
        h: 696,
        fontSize: 12,
        leading: 0,
        html: '<p>Alpha <strong>bold</strong> 😀 text.</p><p><br></p><p>Second paragraph.</p>',
      });
    if (flow) startTextFlow(doc, frame.id);
    const timeline = createDocumentHistory(),
      commits = [],
      host = document.querySelector('#host'),
      editor = mountCanvasEditor(host, {
        getDocument: () => doc,
        documents: [doc],
        editing: true,
        source: (s) => s,
        onCommit: (before, metadata) => {
          commits.push({ before, label: metadata.label });
          timeline.record(before, doc, metadata);
        },
        onChange() {},
        onUndo() {},
        onRedo() {},
      });
    editor.restoreView({ selection: [frame.id], activeTextId: frame.id, tool: 'text' });
    await tick();
    const element = flow
        ? host.querySelector('.canvas-flow-input')
        : host.querySelector('[data-scene-text="' + frame.id + '"]'),
      text = element.textContent;
    selectAll(element);
    assert(
      host.querySelector('[data-object-prop="leading"]').value === '0',
      'Inspector replaced Auto leading with a computed fixed value',
    );
    for (const size of [123, 12, 250, 12]) {
      const field = host.querySelector('[data-object-prop="fontSize"]');
      field.focus();
      field.value = String(size);
      field.dispatchEvent(new Event('change', { bubbles: true }));
      await tick();
      assert(
        commits.length > 0,
        JSON.stringify({
          flow,
          size,
          state: editor.getState(),
          input: field.outerHTML,
          editable: element.isContentEditable,
        }),
      );
      assert(element.textContent === text, 'Repeated formatting changed characters');
      assert(
        (flow
          ? host.querySelector('.canvas-flow-input')
          : host.querySelector('[data-scene-text="' + frame.id + '"]')) === element,
        'Repeated formatting replaced live editor',
      );
    }
    const html = flow ? doc.textFlows[0].html : frame.html;
    assert(!/data-ivo-size="(?:123|250)"/.test(html), 'Obsolete size survived in canonical source');
    assert(
      element.querySelector('p').getBoundingClientRect().height < 35,
      'Live edit retained tall line boxes',
    );
    assert(
      element.querySelector('strong') && element.querySelectorAll('br').length === 1,
      'Live format lost emphasis/blank paragraph',
    );
    selectAll(element);
    const bookmark = captureTextSelection(element),
      selected = getSelection().toString();
    element.innerHTML = cleanHTML(element.innerHTML);
    assert(
      restoreTextSelection(element, bookmark) && getSelection().toString() === selected,
      'Selection failed after repaired-source reopen',
    );
    assert(
      commits.length === 4,
      'Formatting history count=' +
        commits.length +
        ' flow=' +
        flow +
        ' labels=' +
        commits.map((c) => c.label).join(','),
    );
    for (const direction of ['undo', 'redo'])
      for (let i = 0; i < 4; i++) {
        const result = timeline[direction](doc);
        assert(result, 'Missing formatting ' + direction);
        Object.assign(doc, result.document);
        editor.restoreView(result.view);
        await tick();
        const restored = flow
          ? host.querySelector('.canvas-flow-input')
          : host.querySelector('[data-scene-text="' + frame.id + '"]');
        assert(restored?.textContent === text, 'Formatting history lost source/caret ownership');
      }
    const restored = flow
      ? host.querySelector('.canvas-flow-input')
      : host.querySelector('[data-scene-text="' + frame.id + '"]');
    assert(
      restored.querySelector('p').getBoundingClientRect().height < 35,
      'Redo reintroduced stale line metrics',
    );
    editor.destroy();
    host.innerHTML = '';
  }
  console.log(
    'IVO_METRICS_RESULT:' +
      JSON.stringify({
        ok: true,
        staleSizeLineBoxRepaired: true,
        legacyPastedScaleLeftEdge: true,
        partialSelectionPreservesLargerText: true,
        explicitLeadingAndParagraphSpacingRetained: true,
        linksEmphasisUnicodeBlankParagraphs: true,
        idempotentSource: true,
        liveIndependentAndThreadedFormatting: true,
        selectionAndHistoryRetained: true,
        beforeHeight: before,
        afterHeight: after,
      }),
  );
} catch (error) {
  console.log('IVO_METRICS_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
