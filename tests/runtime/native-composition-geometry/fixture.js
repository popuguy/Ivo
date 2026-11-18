import { compositionSource } from '../../../src/rendering/text/composition-source.js';
import { composedSVG } from '../../../src/rendering/text/composed-svg.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { applyFrameTypography } from '../../../src/rendering/text/format.js';
import { createSceneDocument } from '../../../src/domain/documents/scene.js';
import {
  captureTextSelection,
  restoreTextSelection,
} from '../../../src/shared/dom/text-selection.js';
import { createNativeInputAnchor } from '../../../src/features/editor/text/native-input-anchor.js';
import { installFlowSelection } from '../../../src/features/editor/text/flow-selection.js';
import { applyPageCamera } from '../../../src/rendering/page-camera.js';
import {
  hitNativeColumn,
  nativeCaretRect,
  nativeRectScreenBounds,
  nativeCaretLines,
} from '../../../src/features/editor/text/native-composition-geometry.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
try {
  await document.fonts.ready;
  const input = document.querySelector('#input'),
    viewport = document.querySelector('#viewport'),
    camera = document.querySelector('#camera'),
    framesRoot = document.querySelector('#frames'),
    doc = createSceneDocument('Native input proof'),
    frames = [
      { id: 'first', width: 200, height: 90 },
      { id: 'second', width: 300, height: 250 },
    ],
    flow = {
      id: 'native-input-proof',
      html: '<p>Office affine. One shared text flow has exact native carets across separate frames, even when the browser wraps it differently.</p><p><br></p><p><em>Italic heading.</em> More regular text follows on the second frame.</p>',
    };
  input.innerHTML = flow.html;
  applyFrameTypography(input, { textStyle: 'cmu-serif', fontSize: 16 });
  const originalInput = input,
    originalSize = [input.style.width, input.style.height],
    original = flow.html;
  let result,
    source,
    parts = new Map(),
    currentFrame = 'first',
    sourceWrites = 0,
    reports = [],
    composing = false;
  const anchor = createNativeInputAnchor(input, { isComposing: () => composing });
  function makeSource() {
    const root = document.createElement('div');
    root.innerHTML = flow.html;
    return compositionSource(root, {
      id: flow.id,
      doc,
      settings: { textStyle: 'cmu-serif', fontSize: 16 },
      fontFor: (style) =>
        style.bold
          ? style.italic
            ? 'cmu-bold-italic'
            : 'cmu-bold'
          : style.italic
            ? 'cmu-italic'
            : 'cmu-regular',
    });
  }
  async function recompose() {
    source = makeSource();
    result = await window.nativeInputTest.compose(source);
    assert(!result.diagnostics.includes('overset'), 'Proof source did not fit native frames');
    let previous = 0;
    parts = new Map();
    framesRoot.replaceChildren();
    for (const [i, frame] of frames.entries()) {
      const lines = result.layout.lines.filter((line) => line.frame === frame.id),
        last = lines.at(-1),
        end =
          i === frames.length - 1
            ? source.logicalLength
            : last.carets.findLast((caret) => caret.index === last.end).logicalCandidates[0];
      const element = document.createElement('div');
      element.dataset.flowFrame = frame.id;
      element.className = 'flow-column';
      element.style.cssText = `position:absolute;left:${i * 350}px;top:${i * 140}px;width:${frame.width}px;height:${frame.height}px;background:white`;
      element.innerHTML = composedSVG(result, frame, {
        text: source.text,
        styles: source.runs,
        idPrefix: 'proof' + i,
      });
      framesRoot.append(element);
      parts.set(frame.id, {
        start: previous,
        end,
        native: { lines, spans: source.spans, text: source.text },
        element,
      });
      previous = end;
    }
  }
  await recompose();
  const controller = installFlowSelection(viewport, {
    allowed: () => !composing,
    input: () => input,
    flow: () => flow,
    frames: () => frames,
    fragment: (id) => parts.get(id),
    preview: (id) => parts.get(id)?.element,
    activate: (id) => {
      currentFrame = id;
    },
    selection: () => captureTextSelection(input),
    onSelection: () => {},
    showRange: () => {},
    pan: () => {},
    layoutKey: () => result?.token,
    onNativeCaret: (rect) => {
      const report = rect ? anchor.update(rect) : (anchor.reset(), null);
      if (report?.applied) reports.push(report);
    },
  });
  input.addEventListener('input', () => {
    flow.html = cleanHTML(input.innerHTML);
    sourceWrites++;
  });
  const column = (id) => ({
      ...parts.get(id),
      frameId: id,
      sourceStart: parts.get(id).start,
      sourceEnd: parts.get(id).end,
    }),
    position = (id, caret) => {
      const rect = nativeCaretRect(column(id), caret),
        screen = nativeRectScreenBounds(column(id), rect);
      return [screen.x, screen.y + screen.height / 2];
    };
  const measured = nativeCaretLines(frames.map((f) => column(f.id))),
    first = measured.lines[0].stops.find((stop) => stop.index > 2),
    last = measured.lines.findLast((line) => line.frameId === 'second').stops.at(-2),
    from = position('first', first),
    to = position('second', last);
  await window.nativeInputTest.drag(from, to);
  await tick();
  const range = captureTextSelection(input);
  assert(
    range && range.focus.index > range.anchor.index && currentFrame === 'first',
    'Native SVG drag lost canonical flow ownership',
  );
  assert(
    viewport.querySelectorAll('[data-native-selection="range"]').length > 2,
    'Native selection did not paint across visual lines/frames',
  );
  assert(
    flow.html === original && sourceWrites === 0 && input === originalInput,
    'Native pointer selection wrote source or replaced its input',
  );

  const caret = measured.lines
    .find((line) => line.frameId === 'second')
    .stops.find((stop) => stop.index > parts.get('second').start + 3);
  restoreTextSelection(input, {
    anchor: { path: [], offset: 0, kind: 'text', index: caret.index, affinity: caret.affinity },
    focus: { path: [], offset: 0, kind: 'text', index: caret.index, affinity: caret.affinity },
  });
  controller.sync();
  await tick();
  assert(
    reports.length &&
      reports.at(-1).residual &&
      Math.abs(reports.at(-1).residual.x) < 0.1 &&
      Math.abs(reports.at(-1).residual.bottom) < 0.1,
    'Canonical input caret failed native bottom-left anchoring',
  );
  assert(
    viewport.querySelector('[data-native-selection="caret"]'),
    'Native collapsed caret was not presented',
  );
  const sourceBeforeTyping = input.textContent,
    focusBefore = captureTextSelection(input).focus.index;
  await window.nativeInputTest.insert('Z');
  await tick();
  assert(
    sourceWrites === 1 &&
      input.textContent.length === sourceBeforeTyping.length + 1 &&
      captureTextSelection(input).focus.index === focusBefore + 1,
    'Real native insertText did not edit the retained canonical source',
  );
  assert(
    input === originalInput &&
      input.style.width === originalSize[0] &&
      input.style.height === originalSize[1],
    'Native anchoring changed input identity or frame dimensions',
  );
  await recompose();
  controller.sync();
  await tick();
  assert(
    reports.at(-1).residual &&
      Math.abs(reports.at(-1).residual.x) < 0.1 &&
      Math.abs(reports.at(-1).residual.bottom) < 0.1,
    'Input did not reanchor after native recomposition',
  );
  applyPageCamera(camera, { x: 80, y: 50, zoom: 1.8 });
  controller.sync();
  await tick();
  assert(
    Math.abs(reports.at(-1).residual.x) < 0.15 && Math.abs(reports.at(-1).residual.bottom) < 0.15,
    'Camera transform broke native IME query anchoring',
  );
  const translate = input.style.translate,
    lastTarget = reports.at(-1).target;
  composing = true;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'x' }));
  const deferred = anchor.update({ ...lastTarget, x: lastTarget.x + 20 });
  assert(
    deferred.deferred && input.style.translate === translate,
    'Anchor moved input DOM during composition',
  );
  composing = false;
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }));
  await Promise.resolve();
  assert(input.style.translate !== translate, 'Composition-end anchor was not applied');
  const nativeHit = hitNativeColumn(column('second'), { x: to[0], y: to[1] });
  assert(
    nativeHit && Number.isSafeInteger(nativeHit.index),
    'Native screen CTM hit mapping failed',
  );
  const heightError = Math.max(...reports.map((r) => Math.abs(r.residual.height)));
  controller.destroy();
  anchor.destroy();
  assert(input.style.translate === '', 'Destroy left an input translation behind');
  console.log(
    'IVO_NATIVE_INPUT_RESULT:' +
      JSON.stringify({
        ok: true,
        actualNativeComposition: true,
        vectorPresentation: true,
        nativeCrossFrameHitAndPaint: true,
        canonicalOwnerRetained: true,
        actualNativeInsertText: true,
        caretQueryBottomAligned: true,
        cameraStable: true,
        compositionGuard: true,
        maxCaretHeightDifference: heightError,
        physicalImeCandidateWindow: 'not-observed',
        bidiIme: 'not-validated',
      }),
  );
} catch (error) {
  console.log('IVO_NATIVE_INPUT_RESULT:' + JSON.stringify({ error: error.stack }));
}
