import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { captureTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
let session = 0;
const samePosition = (a, b) =>
  a && b && a.anchor.index === b.anchor.index && a.focus.index === b.focus.index;

/** Sequential, disposable boundary regressions; the native bridge supplies only trusted keys/text. */
export async function verifyFlowSelectionBoundaries(host, nativeBridge) {
  const previousFocus = document.activeElement,
    priorStyle = host.getAttribute('style');
  let active = null,
    restoreCapture = null;
  host.style.width = '1360px';
  host.style.height = '1000px';
  function clear() {
    restoreCapture?.();
    restoreCapture = null;
    active?.destroy();
    active = null;
    host.replaceChildren();
  }
  async function isolated(name, run) {
    clear();
    const doc = createSceneDocument('Selection boundaries: ' + name, {
        width: 640,
        height: 520,
      }),
      a = insertObject(doc, 'text', doc.pages[0].id, {
        x: 32,
        y: 32,
        w: 270,
        h: 150,
        paragraphAfter: 0,
        html:
          '<p>Soft first line<br>Soft second line</p><p><br></p>' +
          '<p>Alpha regular marker and target regular marker.</p>' +
          '<p>' +
          'Tail words continue without belonging to a different paragraph. '.repeat(14) +
          '</p>',
      }),
      flow = startTextFlow(doc, a.id, { automaticPages: false }),
      b = insertObject(doc, 'text', doc.pages[0].id, {
        x: 338,
        y: 44,
        w: 270,
        h: 165,
      });
    threadFrame(doc, a.id, b.id);
    const independent = insertObject(doc, 'text', doc.pages[0].id, {
        x: 32,
        y: 300,
        w: 470,
        h: 130,
        paragraphAfter: 0,
        html: '<p>Separate flow content uses its own insertion positions and must never inherit the old flow offsets.</p>',
      }),
      secondFlow = startTextFlow(doc, independent.id, { automaticPages: false });
    let commits = 0;
    const editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (value) => value,
      editing: true,
      sessionId: 'flow-boundaries-' + ++session,
      initialState: { tool: 'text', selection: [a.id] },
      onCommit: () => commits++,
      onChange: () => {},
      onNotify: (message) => {
        throw new Error(message);
      },
      onUndo: () => {},
      onRedo: () => {},
    });
    active = editor;
    await tick();
    await editor.command('fit-all');
    await tick();
    const viewport = host.querySelector('.canvas-viewport'),
      methods = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'],
      descriptors = methods.map((method) => Object.getOwnPropertyDescriptor(viewport, method)),
      captured = new Set();
    viewport.setPointerCapture = (id) => captured.add(id);
    viewport.releasePointerCapture = (id) => captured.delete(id);
    viewport.hasPointerCapture = (id) => captured.has(id);
    restoreCapture = () => {
      for (const [index, method] of methods.entries()) {
        if (descriptors[index]) Object.defineProperty(viewport, method, descriptors[index]);
        else delete viewport[method];
      }
    };
    const initial = JSON.stringify(doc),
      input = () => host.querySelector('.canvas-flow-input'),
      preview = (id) => host.querySelector(`[data-flow-frame="${id}"]`),
      selected = () => captureTextSelection(input());
    let pointerId = 301;
    function send(type, target, position, extra = {}) {
      const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        pointerId,
        button: 0,
        buttons: ['pointerup', 'pointercancel', 'lostpointercapture'].includes(type) ? 0 : 1,
        clientX: position[0],
        clientY: position[1],
        ...extra,
        detail: 0,
      });
      target.dispatchEvent(event);
      if (type === 'pointerdown' && !event.defaultPrevented)
        target.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: position[0],
            clientY: position[1],
            detail: 1,
            ...extra,
          }),
        );
      return event;
    }
    function wordPoint(id, word, offset = 2) {
      const root = preview(id),
        walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const at = node.data.indexOf(word);
        if (at < 0) continue;
        const local = at + Math.min(offset, word.length - 1),
          range = document.createRange();
        range.setStart(node, local);
        range.setEnd(node, local + 1);
        const bounds = range.getBoundingClientRect();
        assert(bounds.width > 0 && bounds.height > 0, 'Fixture word has no geometry: ' + word);
        return {
          target: node.parentElement,
          point: [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
        };
      }
      throw new Error('Fixture word is not in the expected frame: ' + word);
    }
    async function click(hit, detail = 1) {
      pointerId++;
      send('pointerdown', hit.target, hit.point, { detail });
      send('pointerup', viewport, hit.point, { detail });
      await tick();
    }
    const unchanged = () => {
      assert(JSON.stringify(doc) === initial, name + ': selection changed authored data');
      assert(commits === 0, name + ': selection entered document history');
    };
    try {
      await run({
        doc,
        editor,
        a,
        b,
        flow,
        independent,
        secondFlow,
        viewport,
        captured,
        input,
        preview,
        selected,
        send,
        click,
        wordPoint,
        unchanged,
        nextPointer: () => ++pointerId,
        pointerId: () => pointerId,
        commits: () => commits,
      });
    } finally {
      clear();
      await tick();
    }
  }
  try {
    await isolated('triple-click soft breaks', async ({ a, wordPoint, click, unchanged }) => {
      await click(wordPoint(a.id, 'first'), 3);
      const text = window.getSelection().toString();
      assert(
        text.includes('Soft first line') && text.includes('Soft second line'),
        'Triple-click split one authored paragraph at its soft line break',
      );
      assert(!text.includes('Alpha'), 'Triple-click consumed the following authored paragraph');
      unchanged();
    });

    await isolated(
      'blank paragraph interior',
      async ({ a, preview, click, input, selected, unchanged }) => {
        const blank = [...preview(a.id).querySelectorAll('[data-flow-block-start]')].find(
          (node) => !node.textContent && node.querySelector('br'),
        );
        assert(blank, 'Fixture blank paragraph is not visible');
        const box = blank.getBoundingClientRect();
        assert(box.height > 0, 'Fixture blank paragraph has no line geometry');
        await click({ target: blank, point: [box.left + 4, box.top + box.height / 2] });
        const canonicalBlank = [...input().querySelectorAll('p')].find(
            (node) => !node.textContent && node.querySelector('br'),
          ),
          points = textIndexMap(input()).boundaries.get(canonicalBlank),
          range = selected();
        assert(
          points &&
            range &&
            range.anchor.index === range.focus.index &&
            range.focus.index >= points[0] &&
            range.focus.index <= points.at(-1),
          'Clicking a blank paragraph jumped to neighboring text instead of its structural interior',
        );
        unchanged();
      },
    );

    await isolated(
      'release endpoint',
      async ({ a, b, wordPoint, send, nextPointer, viewport, selected, unchanged }) => {
        const start = wordPoint(a.id, 'first'),
          end = wordPoint(b.id, 'continue');
        nextPointer();
        send('pointerdown', start.target, start.point);
        const initial = selected();
        // No pointermove reaches the destination: mouse-up itself must establish the final endpoint.
        send('pointerup', viewport, end.point);
        await tick();
        const result = selected(),
          frameStart = Number(previewStart(host, b.id));
        assert(
          result &&
            initial &&
            result.anchor.index === initial.anchor.index &&
            result.focus.index > result.anchor.index &&
            result.focus.index >= frameStart,
          'Final pointerup coordinates did not extend selection into the later frame',
        );
        unchanged();
      },
    );

    for (const cancellation of ['Escape', 'lostpointercapture']) {
      await isolated(
        'held drag ' + cancellation,
        async ({
          a,
          editor,
          wordPoint,
          send,
          nextPointer,
          pointerId,
          viewport,
          captured,
          input,
          selected,
          unchanged,
        }) => {
          const start = wordPoint(a.id, 'first'),
            bounds = viewport.getBoundingClientRect(),
            outside = [bounds.left + bounds.width / 2, bounds.bottom + 45];
          nextPointer();
          send('pointerdown', start.target, start.point);
          const cameraBeforeScroll = JSON.stringify(editor.getState().camera);
          send('pointermove', viewport, outside);
          await tick();
          await tick();
          assert(
            JSON.stringify(editor.getState().camera) !== cameraBeforeScroll,
            'Fixture did not begin held-drag autoscroll',
          );
          if (cancellation === 'Escape') {
            input().dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            );
          } else {
            captured.delete(pointerId());
            send('lostpointercapture', viewport, outside);
          }
          await tick();
          const stoppedCamera = JSON.stringify(editor.getState().camera),
            stoppedRange = selected();
          assert(!captured.size, cancellation + ' left the synthetic text drag captured');
          send('pointermove', viewport, outside, { buttons: 1 });
          await tick();
          await tick();
          assert(
            JSON.stringify(editor.getState().camera) === stoppedCamera,
            cancellation + ' left text autoscroll running',
          );
          if (cancellation === 'lostpointercapture')
            assert(
              samePosition(selected(), stoppedRange),
              'Lost capture allowed a later pointermove to alter the range',
            );
          else
            assert(editor.getState().tool === 'select', 'Escape did not exit the Type interaction');
          unchanged();
        },
      );
    }

    await isolated(
      'cancel after switching flows',
      async ({
        a,
        independent,
        secondFlow,
        wordPoint,
        click,
        send,
        nextPointer,
        viewport,
        selected,
        input,
        unchanged,
      }) => {
        await click(wordPoint(a.id, 'first'));
        const old = selected(),
          other = wordPoint(independent.id, 'positions');
        nextPointer();
        send('pointerdown', other.target, other.point);
        const switched = selected();
        assert(
          input().dataset.textFlow === secondFlow.id,
          'Fixture did not activate the independent flow',
        );
        assert(!samePosition(old, switched), 'Fixture did not establish different flow offsets');
        send('pointercancel', viewport, other.point);
        await tick();
        assert(
          input().dataset.textFlow === secondFlow.id && samePosition(selected(), switched),
          'Cancel restored offsets from the previous, unrelated flow',
        );
        unchanged();
      },
    );

    await isolated(
      'pending caret marks',
      async ({ a, doc, flow, editor, wordPoint, click, input, preview, commits }) => {
        assert(
          typeof nativeBridge?.type === 'function',
          'Native text bridge needs type(text) for caret inheritance regression',
        );
        await click(wordPoint(a.id, 'Alpha'));
        const before = flow.html;
        await nativeBridge.key('I', ['meta']);
        await tick();
        assert(
          flow.html === before && commits() === 0,
          'Caret-only italic changed existing source',
        );
        await click(wordPoint(a.id, 'target'));
        await nativeBridge.type('Q');
        await tick();
        const walker = document.createTreeWalker(input(), NodeFilter.SHOW_TEXT);
        let node,
          found = false;
        while ((node = walker.nextNode()))
          if (node.data.includes('Q')) {
            found = true;
            assert(
              getComputedStyle(node.parentElement).fontStyle === 'normal',
              'Old caret italic leaked into newly clicked regular run',
            );
          }
        assert(found, 'Trusted text insertion did not reach the new regular caret');
        const plain = document.createElement('div'),
          original = document.createElement('div');
        plain.innerHTML = doc.textFlows.find((f) => f.id === flow.id).html;
        original.innerHTML = before;
        assert(
          plain.textContent.replace('Q', '') === original.textContent &&
            plain.textContent.split('Q').length === 2,
          'Caret move changed text outside the typed character',
        );
        await editor.command('tool-select');
        const visible = document.createTreeWalker(preview(a.id), NodeFilter.SHOW_TEXT);
        let persisted = false;
        while ((node = visible.nextNode()))
          if (node.data.includes('Q')) {
            persisted = true;
            assert(
              getComputedStyle(node.parentElement).fontStyle === 'normal',
              'Deselecting reintroduced old caret italic',
            );
          }
        assert(persisted, 'Typed regular character disappeared from the preview');
      },
    );
    return {
      tripleClickSoftBreak: true,
      blankParagraphCaret: true,
      pointerupEndpoint: true,
      escapeAndLostCapture: true,
      unrelatedFlowCancel: true,
      pendingCaretMarks: true,
    };
  } finally {
    clear();
    if (priorStyle === null) host.removeAttribute('style');
    else host.setAttribute('style', priorStyle);
    if (
      previousFocus?.isConnected &&
      !host.contains(previousFocus) &&
      typeof previousFocus.focus === 'function'
    )
      previousFocus.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && host.contains(document.activeElement))
      document.activeElement.blur();
  }
}
function previewStart(host, frameId) {
  const markers = [
    ...host.querySelector(`[data-flow-frame="${frameId}"]`).querySelectorAll('[data-flow-text]'),
  ];
  assert(markers.length, 'Release fixture later frame has no source provenance');
  return Math.min(...markers.map((node) => Number(node.dataset.flowText)));
}
