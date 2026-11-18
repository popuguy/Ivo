import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { prepareTextFlowFonts } from '../../../src/rendering/text/flow-layout.js';
import {
  captureTextSelection,
  restoreTextSelection,
} from '../../../src/shared/dom/text-selection.js';
import { textGeometry, geometryDifference } from '../render/text-geometry.js';

/** Actual editor wheel-pinch sequences must change only the view, including during text editing. */
export async function verifyTextZoom(host) {
  const next = () => new Promise((resolve) => requestAnimationFrame(resolve)),
    assert = (value, message) => {
      if (!value) throw Error(message);
    };
  await prepareTextFlowFonts();
  const doc = createSceneDocument('Pinch typography', { width: 640, height: 720 }),
    separate = insertObject(doc, 'text', doc.pages[0].id, {
      x: 32.125,
      y: 32.375,
      w: 260.375,
      h: 260,
      fontSize: 17.375,
      textStyle: 'cmu-serif',
      html: '<p>Affine office: <em>carefully spaced typography</em> with <strong>mixed emphasis</strong> stays fixed across every zoom level.</p><p style="font-family:Georgia;font-size:13.625px">Another font and fractional frame width.<br>Explicit line breaks remain fixed.</p>',
    }),
    first = insertObject(doc, 'text', doc.pages[0].id, {
      x: 330.25,
      y: 40.125,
      w: 240.625,
      h: 180.375,
      fontSize: 16.375,
      html: '<p>Threaded <em>fashion notes</em> retain their typography and line breaks across linked text boxes and separate pages.</p>'.repeat(
        6,
      ),
    });
  startTextFlow(doc, first.id, { automaticPages: false });
  const page = addPage(doc, doc.pages[0].id),
    second = insertObject(doc, 'text', page.id, { x: 44.125, y: 40.375, w: 310.625, h: 220.375 });
  threadFrame(doc, first.id, second.id);
  let commits = 0;
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => s,
    editing: true,
    initialState: { tool: 'text', selection: [first.id] },
    onCommit: () => commits++,
    onChange() {},
    onNotify: (message) => {
      throw Error(message);
    },
  });
  try {
    await document.fonts.ready;
    await editor.command('document-text');
    await next();
    await next();
    const input = host.querySelector('.canvas-flow-input'),
      viewport = host.querySelector('.canvas-viewport'),
      roots = [
        host.querySelector(`[data-scene-text="${separate.id}"]`),
        ...[first, second].map((frame) => host.querySelector(`[data-flow-frame="${frame.id}"]`)),
        input,
      ];
    assert(
      input?.isContentEditable && roots.every(Boolean),
      'Text pinch fixture did not mount all editors/previews',
    );
    restoreTextSelection(input, {
      anchor: { path: [], kind: 'text', offset: 0, index: 3, affinity: 'forward' },
      focus: { path: [], kind: 'text', offset: 0, index: 3, affinity: 'forward' },
    });
    await next();
    const before = JSON.stringify(doc),
      selection = captureTextSelection(input),
      baselineZoom = editor.getState().camera.zoom,
      baseline = roots.map((root) => textGeometry(root, baselineZoom)),
      html = roots.map((root) => root.innerHTML),
      bounds = viewport.getBoundingClientRect();
    let maximum = 0;
    for (let i = 0; i < 90; i++) {
      const current = editor.getState().camera.zoom,
        target = baselineZoom * Math.exp(Math.sin(i / 12) * 0.8),
        event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -100 * Math.log(target / current),
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        });
      viewport.dispatchEvent(event);
      assert(
        Math.abs(editor.getState().camera.zoom - target) < 1e-10,
        'Pinch acquired a second easing queue',
      );
      await next();
      for (const [j, root] of roots.entries()) {
        const difference = geometryDifference(baseline[j], textGeometry(root, target));
        maximum = Math.max(maximum, difference.maximum);
        assert(
          difference.maximum < 0.002,
          'Actual editor text jittered during pinch: ' +
            JSON.stringify({ frame: j, step: i, target, ...difference }),
        );
        assert(root.innerHTML === html[j], 'Pinch rebuilt text fragments');
      }
      assert(
        host.querySelector('.canvas-flow-input') === input,
        'Pinch replaced the retained editor',
      );
      const after = captureTextSelection(input);
      assert(
        after.anchor.index === selection.anchor.index &&
          after.focus.index === selection.focus.index,
        'Pinch moved the insertion position',
      );
    }
    assert(
      JSON.stringify(doc) === before && commits === 0,
      'Pinch changed authored source/history',
    );
    return {
      frames: roots.length,
      pinchFrames: 90,
      maxDocumentCharacterRectError: maximum,
      mixedFontsAndLinkedFramesStable: true,
      editorAndCaretRetained: true,
      noSourceOrHistoryWrites: true,
    };
  } finally {
    editor.destroy();
  }
}
