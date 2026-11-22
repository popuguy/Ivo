import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../../src/shared/dom/text-selection.js';

const first = 'Cafe\u0301, Москва — Αθήνα.';
const second = 'İzmir l’acqua, Česko őszi. A\u030A И\u0306 α\u0301. testМосква ΕλληνικάABC.';
const seam = first.length + 1;
const source = first + '\n' + second;
const tick = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function check(value, message) {
  if (!value) throw Error('Threaded mixed-script navigation: ' + message);
}

export async function verifyMixedScriptNavigation(host, bridge, textComposition) {
  const run = (width, html, examine) =>
    runNavigation(host, bridge, textComposition, width, html, examine);
  const paragraph = await run(
    610,
    '<p>' + first + '</p><p>' + second + '</p>',
    verifyParagraphBoundary,
  );
  const softWrap = await run(87, '<p>' + first + ' ' + second + '</p>', verifySoftWrap);
  const blank = await run(610, '<p>Я</p><p><em></em><br></p><p>Ω</p>', verifyBlankParagraph);
  return { ...paragraph, ...softWrap, ...blank };
}
async function runNavigation(host, bridge, textComposition, width, original, examine) {
  const doc = createSceneDocument('Mixed-script keys', { width: 650, height: 240 });
  const frame = (page, w, h, html = '') =>
    insertObject(doc, 'text', page.id, {
      x: 15,
      y: 15,
      w,
      h,
      fontSize: 12,
      leading: 15,
      paragraphAfter: 0,
      textStyle: 'cmu-serif',
      html,
    });
  const a = frame(doc.pages[0], width, 19, original);
  const b = frame(addPage(doc, doc.pages[0].id), 610, 135);
  const flow = startTextFlow(doc, a.id, { automaticPages: false });
  threadFrame(doc, a.id, b.id);
  enableNativeComposition(doc, flow, 'paragraph');
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (value) => value,
    textComposition,
    initialState: { tool: 'text', selection: [a.id] },
    sessionId: 'mixed-script-navigation',
    onCommit: () => {},
    onChange: () => {},
    onNotify: (message) => {
      throw Error(message);
    },
  });
  const input = () => host.querySelector('.canvas-flow-input');
  async function settle() {
    await tick();
    await editor.flush();
    await tick();
  }
  try {
    await settle();
    await editor.command('fit-all');
    await settle();
    const svg = (id) =>
      host.querySelector('[data-flow-frame="' + id + '"] svg[data-composed-text]');
    const glyph = svg(b.id).querySelector('use[data-glyph-offset]').getBoundingClientRect();
    await bridge.select({ from: [glyph.left + 0.5, glyph.top + glyph.height / 2] });
    await settle();
    return await examine({ svg, a, b, editor, input, flow, original, bridge, settle });
  } finally {
    editor.destroy();
  }
}

async function verifyBlankParagraph({ input, bridge }) {
  const blocks = input().querySelectorAll('p'),
    map = textIndexMap(input());
  const at = (block, end = false) => map.boundaries.get(blocks[block]).at(end ? -1 : 0);
  const start = at(2);
  const pt = { index: start, path: [], offset: 0, kind: 'text', affinity: 'forward' };
  check(
    restoreTextSelection(input(), { anchor: pt, focus: pt }),
    'failed to place on third paragraph',
  );
  for (const [key, expected] of [
    ['Left', at(1)],
    ['Left', at(0, true)],
    ['Right', at(1)],
    ['Right', start],
  ]) {
    await bridge.key(key);
    await tick();
    check(
      captureTextSelection(input()).focus.index === expected,
      'extra caret stop at the styled blank paragraph',
    );
  }
  return { mixedScriptBlankParagraph: true };
}

async function verifySoftWrap({ svg, b, editor, input, flow, bridge, settle }) {
  const visible = svg(b.id)?.getAttribute('aria-label')?.trimEnd();
  const text = first + ' ' + second;
  const boundary = text.length - visible?.length;
  check(
    boundary > 0 && boundary < first.length && text.slice(boundary) === visible,
    'expected an unforced page break in the first mixed-script sentence: ' + visible,
  );

  const block = input().querySelector('p');
  const start = textIndexMap(input()).boundaries.get(block)[0];
  const caret = captureTextSelection(input());
  check(
    caret?.focus.index === start + boundary && editor.getState().activeTextId === b.id,
    'the first glyph after the soft wrap failed to hit its source index: ' +
      [caret?.focus.index, start + boundary],
  );
  await bridge.key('Left', ['shift']);
  await tick();
  await bridge.key('Left', ['shift']);
  await tick();
  const range = captureTextSelection(input());
  check(
    range.anchor.index === start + boundary &&
      range.focus.index === start + boundary - 2 &&
      getSelection().toString() === text.slice(boundary - 2, boundary),
    'reverse selection across an unforced page break',
  );
  await bridge.insert('Če');
  await settle();
  const restored = document.createElement('div');
  restored.innerHTML = flow.html;
  check(
    restored.textContent === text.slice(0, boundary - 2) + 'Če' + text.slice(boundary),
    'replacement across an unforced page break lost adjacent source',
  );
  return { mixedScriptSoftWrapEditing: true };
}

async function verifyParagraphBoundary({ svg, a, b, input, original, flow, bridge }) {
  check(
    svg(a.id)?.getAttribute('aria-label')?.trimEnd() === first,
    'unexpected first page break: ' + svg(a.id)?.getAttribute('aria-label'),
  );
  check(
    svg(b.id)?.getAttribute('aria-label')?.trimEnd() === second,
    'unexpected continuation: ' + svg(b.id)?.getAttribute('aria-label'),
  );

  function logical(offset) {
    const blocks = [...input().querySelectorAll('p')],
      map = textIndexMap(input());
    const block = blocks[offset < seam ? 0 : 1];
    check(block, 'missing editable paragraph for offset ' + offset);
    return map.boundaries.get(block)[0] + (offset < seam ? offset : offset - seam);
  }
  function expect(anchor, focus, label) {
    const range = captureTextSelection(input());
    check(
      range && range.anchor.index === logical(anchor) && range.focus.index === logical(focus),
      label +
        ' expected ' +
        [logical(anchor), logical(focus)] +
        ' got ' +
        [range?.anchor.index, range?.focus.index],
    );
  }
  function place(index) {
    const point = {
      index: logical(index),
      path: [],
      offset: 0,
      kind: 'text',
      affinity: 'forward',
    };
    check(restoreTextSelection(input(), { anchor: point, focus: point }), 'could not place caret');
  }
  expect(seam, seam, 'click on the first glyph on page two');
  let count = 0;
  async function command(key, modifiers, anchor, focus, label) {
    await bridge.key(key, modifiers);
    await tick();
    expect(anchor, focus, label);
    count++;
  }
  await command('Left', [], seam - 1, seam - 1, 'one left crosses the paragraph/page boundary');
  await command('Right', ['shift'], seam - 1, seam, 'select the paragraph mark across pages');
  await command('Right', ['shift'], seam - 1, seam + 1, 'extend onto dotted İ');
  await command('Left', ['shift'], seam - 1, seam, 'shrink back to the continuation');
  await command('Left', ['shift'], seam - 1, seam - 1, 'shrink back to the anchor');

  // A character can occupy multiple UTF-16 positions. One arrow must still
  // select the complete accented letter in each supported script.
  for (const cluster of ['e\u0301', 'A\u030A', 'И\u0306', 'α\u0301']) {
    const start = source.indexOf(cluster),
      end = start + cluster.length;
    place(start);
    await command('Right', ['shift'], start, end, 'select ' + cluster);
    check(getSelection().toString() === cluster, 'highlight split ' + cluster);
    await command('Left', [], start, start, 'collapse before ' + cluster);
    await command('Right', [], end, end, 'step over ' + cluster);
    await command('Left', ['shift'], end, start, 'reverse-select ' + cluster);
  }
  for (const word of ['Москва', 'Αθήνα', 'l’acqua', 'Česko', 'testМосква', 'ΕλληνικάABC']) {
    const start = source.indexOf(word),
      end = start + word.length;
    place(start + 1);
    await command('Right', ['alt', 'shift'], start + 1, end, 'extend to the end of ' + word);
    place(end);
    await command('Left', ['alt'], start, start, 'move to the beginning of ' + word);
  }
  for (const [start, end] of [
    [0, first.length],
    [seam, source.length],
  ]) {
    place(start + 5);
    await command('Left', ['meta'], start, start, 'start of the composed line');
    await command('Right', ['meta', 'shift'], start, end, 'select to the end of the composed line');
  }
  place(first.length);
  await command(
    'Right',
    ['meta', 'shift'],
    first.length,
    seam,
    'select the paragraph break from the end of its composed line',
  );

  // Run the editor's normal key handler from every grapheme boundary in both
  // directions. Keep the trusted Electron gestures above as independent proof.
  const edges = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(source)].map(
    (part) => part.index,
  );
  edges.push(source.length);
  let exhaustive = 0;
  for (const [i, start] of edges.entries()) {
    const lineStart = start < seam ? 0 : seam;
    const lineEnd = start < seam ? first.length : source.length;
    const previous = edges[Math.max(0, i - 1)],
      next = edges[Math.min(edges.length - 1, i + 1)];
    for (const extend of [false, true]) {
      const selectedEnd = extend && start === first.length ? seam : lineEnd;
      for (const [key, line, target] of [
        ['ArrowLeft', false, previous],
        ['ArrowRight', false, next],
        ['ArrowLeft', true, lineStart],
        ['ArrowRight', true, selectedEnd],
      ]) {
        place(start);
        const event = new KeyboardEvent('keydown', {
          key,
          metaKey: line,
          shiftKey: extend,
          bubbles: true,
          cancelable: true,
        });
        input().dispatchEvent(event);
        check(event.defaultPrevented, 'editor declined a supported navigation command');
        expect(
          extend ? start : target,
          target,
          'from ' + start + ' ' + key + ' line=' + line + ' extend=' + extend,
        );
        exhaustive++;
      }
    }
  }
  check(flow.html === original, 'navigation rewrote the authored text');
  return { mixedScriptNavigationCommands: count, mixedScriptNavigationCases: exhaustive };
}
