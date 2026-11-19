import { applyNamedTextStyles } from '../../../src/rendering/text/styles.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function wordRange(root, word) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const start = walker.currentNode.data.indexOf(word);
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(walker.currentNode, start);
    range.setEnd(walker.currentNode, start + word.length);
    return range;
  }
  throw Error('Missing visible word ' + word);
}

const bounds = (root, word) => wordRange(root, word).getBoundingClientRect();

function verifyScaleBreaks(host) {
  // Compare against the same engine at its original width. Changing glyph
  // height alone must retain each source break, even in a very narrow column.
  const samples = [
    '日本語の文章（横書き）と句読点。次の行です。',
    're\u00admark\u00adable multi\u00addisciplinary',
    'word ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef next',
    'one unbe<span data-ivo-vscale="130">liev</span>able word',
  ];
  function map(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const result = [];
    let row = 0,
      previousTop = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width && previousTop !== null && rect.top - previousTop > 7) row++;
        if (rect.width) previousTop = rect.top;
        result.push(row);
      }
    }
    return result.join(',');
  }
  for (const html of samples) {
    const reference = document.createElement('div');
    reference.className = 'rich-text';
    reference.style.cssText =
      'position:fixed;left:-10000px;top:0;width:68px;font:14px/21px system-ui;overflow-wrap:anywhere';
    reference.innerHTML = html;
    const scaled = reference.cloneNode(true);
    if (!html.includes('<span')) scaled.dataset.ivoVscale = '130';
    host.append(reference, scaled);
    applyNamedTextStyles(scaled, {});
    const original = map(reference),
      actual = map(scaled);
    reference.remove();
    scaled.remove();
    if (original !== actual)
      throw Error(
        'Character scale changed wrapping for ' + html + ': ' + original + ' / ' + actual,
      );
  }
}

export async function verifyCharacterScale(host) {
  const doc = createSceneDocument('Character scale', undefined, 'cmu-serif');
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    w: 410,
    h: 180,
    html: '<p>Mixed width</p><p>Next line</p>',
  });
  const flow = startTextFlow(doc, frame.id);
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    source: (s) => s,
    initialState: { tool: 'select', selection: [frame.id] },
    sessionId: 'character-scale',
    onCommit: () => {},
    onChange: () => {},
    onNotify: (m) => {
      throw Error(m);
    },
  });
  const root = () => host.querySelector('[data-flow-frame="' + frame.id + '"]');
  const field = async (axis, value) => {
    const control = host.querySelector('[data-object-prop="' + axis + 'Scale"]');
    if (!control) throw Error('Missing ' + axis + ' scale control');
    for (let node = control.parentElement; node && node !== host; node = node.parentElement)
      if (node.tagName === 'DETAILS') node.open = true;
    control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    control.focus();
    control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };
  const near = (actual, expected, message) => {
    if (Math.abs(actual - expected) > 1)
      throw Error(message + ': expected ' + expected + ', observed ' + actual);
  };
  try {
    await settle();
    verifyScaleBreaks(host);
    const first = bounds(root(), 'Mixed'),
      second = bounds(root(), 'width'),
      third = bounds(root(), 'Next');
    const frameWidth = root().getBoundingClientRect().width;
    for (const value of [150, 125, 80, 100]) {
      await field('horizontal', value);
      const a = bounds(root(), 'Mixed'),
        b = bounds(root(), 'width');
      near(a.width, (first.width * value) / 100, 'Painted character width at ' + value);
      near(b.left - a.left, ((second.left - first.left) * value) / 100, 'Following word advance');
      near(a.left, first.left, 'Paragraph origin shifted');
      near(root().getBoundingClientRect().width, frameWidth, 'Character scale resized the frame');
    }
    for (const value of [150, 125, 80, 100]) {
      await field('vertical', value);
      const a = bounds(root(), 'Mixed'),
        c = bounds(root(), 'Next');
      near(a.height, (first.height * value) / 100, 'Painted character height at ' + value);
      near(c.top - a.top, third.top - first.top, 'Vertical character scale changed leading');
      near(a.width, first.width, 'Vertical character scale changed advances');
    }
    // Keep the remaining word at its original scale as the selected run
    // crosses through 100%. This also tests restoring a range after a panel click.
    await editor.command('document-text');
    await settle();
    const editable = () => host.querySelector('[data-scene-text][contenteditable="true"]');
    for (const value of [140, 70, 100]) {
      editable().focus({ preventScroll: true });
      const selected = wordRange(editable(), 'Mixed');
      getSelection().setBaseAndExtent(
        selected.startContainer,
        selected.startOffset,
        selected.endContainer,
        selected.endOffset,
      );
      await settle();
      await field('horizontal', value);
      const a = bounds(root(), 'Mixed'),
        b = bounds(root(), 'width');
      near(a.width, (first.width * value) / 100, 'Selected run width at ' + value);
      near(b.width, second.width, 'Scale leaked into neighboring run');
      near(
        b.left - a.left,
        second.left - first.left + first.width * (value / 100 - 1),
        'Adjacent word ignored selected run advance',
      );
    }
    if (flow.html.includes('ivo-scale-paint') || flow.html.includes('transform:'))
      throw Error('Paint-only scale leaked into saved text');
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
}
