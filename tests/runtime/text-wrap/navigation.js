import {
  captureTextSelection,
  restoreTextSelection,
  textIndexMap,
} from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Read the actual painted caret location using source provenance, independently
 * of the editor's merged navigation-line representation. */
function paintedCaret(preview, index, length = 0) {
  for (const marker of preview.querySelectorAll('[data-flow-text]')) {
    const start = Number(marker.dataset.flowText),
      end = start + marker.textContent.length;
    if (index < start || index > end) continue;
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    let node,
      offset = index - start;
    while ((node = walker.nextNode())) {
      if (offset > node.length) {
        offset -= node.length;
        continue;
      }
      const range = document.createRange();
      range.setStart(node, offset);
      if (length) range.setEnd(node, Math.min(node.length, offset + length));
      else range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height) return rect;
    }
  }
  throw Error('Painted wrap source caret not found: ' + index);
}
const rectValue = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
function inputCharacter(input, index) {
  const part = textIndexMap(input).segments.find((s) => index >= s.start && index < s.end);
  if (!part) return null;
  const range = document.createRange();
  range.setStart(part.node, index - part.start);
  range.setEnd(part.node, index - part.start + 1);
  return { char: range.toString(), rect: rectValue(range.getBoundingClientRect()) };
}
function textStyle(element) {
  const css = getComputedStyle(element);
  return Object.fromEntries(
    [
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'lineHeight',
      'whiteSpace',
      'letterSpacing',
      'textAlign',
      'textIndent',
    ].map((key) => [key, css[key]]),
  );
}
function caret(input, index) {
  input.focus();
  assert(
    restoreTextSelection(input, {
      anchor: { path: [], kind: 'text', offset: 0, index, affinity: 'forward' },
      focus: { path: [], kind: 'text', offset: 0, index, affinity: 'forward' },
    }),
    'Could not restore wrapped insertion point',
  );
  document.dispatchEvent(new Event('selectionchange'));
}
export async function verifyWrappedNavigation({ host, getDocument, layout, frameId, input }) {
  const parts = layout.fragments.get(frameId).columns.filter((part) => part.wrap && part.html),
    left = parts.find(
      (part) =>
        part.top > 80 &&
        part.top < 180 &&
        parts.some((other) => other.left > part.left && Math.abs(other.top - part.top) < 0.01),
    ),
    right = parts.find((part) => part.left > left?.left && Math.abs(part.top - left?.top) < 0.01),
    nextLeft = parts
      .filter((part) => part.top > left?.top + 0.01)
      .sort((a, b) => a.top - b.top || a.left - b.left)[0],
    preview = () => host.querySelector(`[data-flow-frame="${frameId}"]`);
  assert(left && right && nextLeft, 'Navigation fixture lacks consecutive interior-wrapped rows');
  const before = JSON.stringify(getDocument()),
    start = left.start + 2;
  caret(input, start);
  await tick();
  const initialRect = paintedCaret(preview(), start);
  await window.wrapTest.key('Down');
  await tick();
  const down = captureTextSelection(input)?.focus;
  assert(
    down && down.index >= nextLeft.start && down.index <= nextLeft.end,
    'Down moved across the wrap gap instead of to the next visual row: ' +
      JSON.stringify({ start, down, left, right, nextLeft }),
  );
  const downRect = paintedCaret(preview(), down.index);
  assert(
    downRect.top > initialRect.top + 1 && Math.abs(downRect.left - initialRect.left) <= 10,
    'Down failed to retain approximate physical-column X: ' +
      JSON.stringify({
        initial: { x: initialRect.left, y: initialRect.top },
        down: { x: downRect.left, y: downRect.top },
      }),
  );
  await window.wrapTest.key('Up');
  await tick();
  assert(
    captureTextSelection(input)?.focus.index === start,
    'Up did not return to the original wrapped-row insertion point',
  );
  // A trusted pointer drag crosses the actual object gap on the page. The
  // canonical selection must remain contiguous without including object UI.
  caret(input, start);
  await tick();
  const from = paintedCaret(preview(), start),
    target = right.start + 3,
    to = paintedCaret(preview(), target);
  await window.wrapTest.select({
    from: [from.left + 0.3, from.top + from.height / 2],
    to: [to.left + 0.3, to.top + to.height / 2],
  });
  await tick();
  const dragged = captureTextSelection(input);
  assert(
    dragged &&
      Math.abs(dragged.anchor.index - start) <= 1 &&
      Math.abs(dragged.focus.index - target) <= 1,
    'Pointer selection across the wrap gap lost source correspondence: ' +
      JSON.stringify({ dragged, start, target }),
  );
  assert(
    window.getSelection().toString().length > 10,
    'Pointer drag did not select text on both sides',
  );
  caret(input, start);
  await tick();
  const lineEdge = (end, extend = false) => {
    const mac = /Mac/.test(navigator.platform);
    const modifiers = mac ? ['meta'] : [];
    if (extend) modifiers.push('shift');
    return window.wrapTest.key(mac ? (end ? 'Right' : 'Left') : end ? 'End' : 'Home', modifiers);
  };
  await lineEdge(false);
  await tick();
  assert(
    captureTextSelection(input)?.focus.index === left.start,
    'Line-start command did not reach the whole wrapped row start',
  );
  await lineEdge(true);
  await tick();
  assert(
    captureTextSelection(input)?.focus.index === right.end,
    'Line-end command stopped at the left fragment instead of the whole wrapped row end: ' +
      JSON.stringify({ actual: captureTextSelection(input), expected: right.end }),
  );
  const retainedCaret = window.getSelection().getRangeAt(0).getBoundingClientRect(),
    previewEnd = paintedCaret(preview(), right.end),
    paintedCursor = host.querySelector('.canvas-native-selection [data-native-selection="caret"]'),
    paintedCursorRect = paintedCursor?.getBoundingClientRect(),
    previewPart = preview().querySelector(`[data-flow-column="${right.id}"]`),
    visibleInput = input.cloneNode(true);
  assert(
    getComputedStyle(input).opacity === '0' &&
      getComputedStyle(preview()).opacity === '1' &&
      getComputedStyle(preview()).visibility === 'visible',
    'Wrapped editing did not retain preview ink with an invisible canonical input',
  );
  for (const hidden of visibleInput.querySelectorAll(
    '[data-flow-input-hidden],[data-flow-input-prefix]',
  ))
    hidden.remove();
  let inkIndex = right.end - 1;
  while (inkIndex > right.start && /\s/.test(inputCharacter(input, inkIndex)?.char || ' '))
    inkIndex--;
  const endPlacement = {
    retained: rectValue(retainedCaret),
    preview: rectValue(previewEnd),
    paintedCursor: paintedCursorRect && rectValue(paintedCursorRect),
    index: right.end,
    input: {
      style: input.style.cssText,
      projectedStart: input.dataset.projectedStart,
      rect: rectValue(input.getBoundingClientRect()),
      css: textStyle(input),
      paragraphCSS: textStyle(input.querySelector('p') || input),
      visibleText: visibleInput.textContent.slice(0, 180),
    },
    clip: {
      style: input.closest('.canvas-flow-clip')?.style.cssText,
      rect: rectValue((input.closest('.canvas-flow-clip') || input).getBoundingClientRect()),
    },
    part: {
      start: right.start,
      end: right.end,
      left: right.left,
      top: right.top,
      width: right.width,
      height: right.height,
      text: previewPart.textContent,
      css: textStyle(previewPart.querySelector('p') || previewPart),
    },
    lastInk: {
      index: inkIndex,
      input: inputCharacter(input, inkIndex),
      preview: rectValue(paintedCaret(preview(), inkIndex, 1)),
    },
    firstInk: {
      input: inputCharacter(input, right.start),
      preview: rectValue(paintedCaret(previewPart, right.start, 1)),
    },
  };
  await lineEdge(false, true);
  await tick();
  const extended = captureTextSelection(input);
  assert(
    Math.min(extended.anchor.index, extended.focus.index) === left.start &&
      Math.max(extended.anchor.index, extended.focus.index) === right.end,
    'Shift Home did not select both sides of one visual wrapped row: ' +
      JSON.stringify({ extended, start: left.start, end: right.end, endPlacement }),
  );
  assert(
    retainedCaret.height > 0 &&
      Math.abs(retainedCaret.left - previewEnd.left) < 2 &&
      Math.abs(retainedCaret.top - previewEnd.top) < 2,
    'End retained-input caret is not on the painted wrapped-row endpoint: ' +
      JSON.stringify({ ...endPlacement, extended }),
  );
  assert(
    paintedCursorRect &&
      Math.abs(paintedCursorRect.left - previewEnd.left) < 2 &&
      Math.abs(paintedCursorRect.top - previewEnd.top) < 2 &&
      Math.abs(paintedCursorRect.height - previewEnd.height) < 2,
    'Visible wrapped caret does not match the independent preview endpoint: ' +
      JSON.stringify(endPlacement),
  );
  assert(
    JSON.stringify(getDocument()) === before,
    'Wrapped keyboard/pointer navigation authored document changes',
  );
}
