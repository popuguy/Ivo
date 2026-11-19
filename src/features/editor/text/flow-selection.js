import {
  hasNativeColumn,
  hitNativeColumn,
  nativeCaretRect,
  nativeCaretLines,
  nativeSelectionRects,
  nativeRectScreenPoints,
  nativeRectScreenBounds,
} from './native-composition-geometry.js';
import { measureFlowCaretLines } from '../../../rendering/text/flow-geometry.js';
import {
  logicalSelection,
  selectionIntervals,
  caretInterval,
  createTextNavigation,
} from '../../../domain/text/flow-selection.js';
import {
  restoreTextSelection,
  textIndexMap,
  textParagraphRanges,
} from '../../../shared/dom/text-selection.js';
import { projectFlowInput } from '../../../rendering/text/flow-input.js';
import { mergeWrappedCaretRows } from '../../../rendering/text/wrap-caret-lines.js';
const owners = new Map(),
  highlightName = 'ivo-flow-selection';
function publish(owner, ranges) {
  if (ranges.length) owners.set(owner, ranges);
  else owners.delete(owner);
  if (globalThis.CSS?.highlights && globalThis.Highlight) {
    if (owners.size)
      CSS.highlights.set(highlightName, new Highlight(...[...owners.values()].flat()));
    else CSS.highlights.delete(highlightName);
  }
}
const point = (value) => ({
  path: [],
  offset: 0,
  kind: 'text',
  index: value.index,
  affinity: value.affinity,
});
const bookmark = (range) => ({ anchor: point(range.anchor), focus: point(range.focus) });
function logicalText(root) {
  const map = textIndexMap(root),
    length = [...map.boundaries.values()].reduce(
      (length, points) => Math.max(length, points.at(-1) || 0),
      0,
    ),
    chars = Array(length).fill('\n');
  for (const segment of map.segments)
    for (let i = 0; i < segment.node.length; i++) chars[segment.start + i] = segment.node.data[i];
  return chars.join('');
}
/** Preview provenance maps glyph hits back into the single canonical flow. */
const provenanceCache = new WeakMap();
function previewLeaves(root, revision) {
  const cached = provenanceCache.get(root);
  if (revision !== undefined && cached?.revision === revision) return cached.leaves;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    result = [];
  let node;
  while ((node = walker.nextNode())) {
    const marker = node.parentElement.closest('[data-flow-text]');
    if (!marker || !root.contains(marker)) continue;
    const prefix = document.createRange();
    prefix.selectNodeContents(marker);
    prefix.setEnd(node, 0);
    const start = Number(marker.dataset.flowText) + prefix.toString().length;
    if (Number.isFinite(start)) result.push({ node, start, end: start + node.length });
  }
  if (revision !== undefined) provenanceCache.set(root, { revision, leaves: result });
  return result;
}
function previewRange(root, start, end, interval, revision) {
  const leaves = previewLeaves(root, revision),
    first = leaves.find((s) => s.end > start),
    last = leaves.findLast((s) => s.start < end);
  const range = document.createRange();
  if (start <= interval.start) range.setStart(root, 0);
  else if (first) range.setStart(first.node, Math.max(0, start - first.start));
  else return null;
  if (end >= interval.end) range.setEnd(root, root.childNodes.length);
  else if (last) range.setEnd(last.node, Math.min(last.node.length, end - last.start));
  else return null;
  return range;
}
function wrappedCaretBounds(column, point, revision) {
  const leaves = previewLeaves(column.element, revision),
    backward = point.affinity === 'backward',
    leaf =
      (backward
        ? leaves.findLast((s) => s.start < point.index && s.end >= point.index)
        : leaves.find((s) => s.start <= point.index && s.end > point.index)) ||
      (backward ? leaves.at(-1) : leaves[0]);
  if (leaf) {
    const range = document.createRange();
    range.setStart(leaf.node, Math.max(0, Math.min(leaf.node.length, point.index - leaf.start)));
    range.collapse(true);
    const rects = [...range.getClientRects()].filter((r) => r.height > 0),
      rect = backward ? rects.at(-1) : rects[0];
    if (rect) return { x: rect.left, y: rect.top, width: 0, height: rect.height };
  }
  const bounds = column.element.getBoundingClientRect(),
    scaleY = bounds.height / column.height;
  return {
    x: bounds.left,
    y: bounds.top + (column.before || 0) * scaleY,
    width: 0,
    height: Math.max(1, (column.advance || 16) * scaleY),
  };
}
/** Retain one native input/IME owner while selecting and painting across physical frames. */
export function installFlowSelection(
  viewport,
  {
    allowed,
    input,
    flow,
    frames,
    fragment,
    preview,
    activate,
    selection,
    onSelection,
    showRange,
    pan,
    layoutKey = () => flow()?.html,
    onNativeCaret = () => {},
  },
) {
  const controller = new AbortController(),
    owner = {},
    fallback = document.createElement('div');
  fallback.className = 'canvas-flow-range';
  fallback.setAttribute('aria-hidden', 'true');
  viewport.append(fallback);
  const nativeOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  nativeOverlay.classList.add('canvas-native-selection');
  nativeOverlay.setAttribute('aria-hidden', 'true');
  Object.assign(nativeOverlay.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2',
    overflow: 'visible',
  });
  viewport.append(nativeOverlay);
  const listen = (target, name, fn, options = {}) =>
    target.addEventListener(name, fn, { signal: controller.signal, ...options });
  let drag = null,
    pendingMouse = null,
    scrolling = 0,
    lastTime = 0,
    alive = true,
    painted = null,
    paintedNative = false,
    textCache = null,
    geometryCache = null,
    preferredX = null,
    nativeHint = null,
    logicalHint = null,
    nativeAnimation = null;
  function columns({ measureBounds = true } = {}) {
    return (frames() || []).flatMap((frame) => {
      const root = preview(frame.id),
        part = fragment(frame.id);
      if (!root || !part) return [];
      const nodes = [...root.querySelectorAll(':scope > .flow-column')];
      return (part.columns || [part]).map((interval, i) => ({
        ...interval,
        sourceStart: interval.start,
        sourceEnd: interval.end,
        scaleX: frame.textScale?.x || 1,
        frameId: frame.id,
        element: nodes[i] || root,
        bounds: measureBounds ? (nodes[i] || root).getBoundingClientRect() : null,
      }));
    });
  }
  function current() {
    const value = selection();
    if (!value?.anchor || !value?.focus) return null;
    // A projected input can split a text node exactly at a visual line ending.
    // The DOM exposes offsets but cannot encode that caret's upstream affinity.
    // Retain the commanded view point while source/owner/endpoints still match.
    if (
      logicalHint?.root === input() &&
      logicalHint.flowId === flow()?.id &&
      logicalHint.source === flow()?.html &&
      logicalHint.range.anchor.index === value.anchor.index &&
      logicalHint.range.focus.index === value.focus.index
    )
      return logicalHint.range;
    logicalHint = null;
    return logicalSelection(value.anchor, value.focus);
  }
  function navigationState() {
    if (textCache?.source !== flow().html || textCache?.flow !== flow().id) {
      const text = logicalText(input()),
        navigation = createTextNavigation(text, { paragraphs: textParagraphRanges(input()) });
      textCache = { source: flow().html, flow: flow().id, text, navigation, edges: null };
    }
    return textCache;
  }
  function graphemeSet() {
    const state = navigationState();
    return (state.edges ||= new Set(state.navigation.graphemeBoundaries));
  }
  function nativePaint(columnList, range, showing) {
    // Read all screen transforms before replacing the overlay. With no viewBox,
    // one SVG unit is one CSS pixel at every viewport size.
    const inverse = nativeOverlay.getScreenCTM()?.inverse();
    const paths = document.createDocumentFragment();
    let blinkingPath,
      anchor = null,
      anchorInfo;
    function paintPoints(screenPoints, caret = false, empty = false) {
      if (!inverse) return;
      const points = screenPoints.map((point) => point.matrixTransform(inverse));
      if (!points.length) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${points.map((p) => `${p.x},${p.y}`).join('L')}Z`);
      path.setAttribute('fill', caret ? 'none' : 'var(--selection, #4b80ff)');
      path.setAttribute('fill-opacity', '0.25');
      path.setAttribute('stroke', caret ? 'var(--ink, #252525)' : 'var(--selection, #4b80ff)');
      path.setAttribute('stroke-width', caret || empty ? '1' : '0');
      path.dataset.nativeSelection = caret ? 'caret' : 'range';
      paths.append(path);
      if (caret) blinkingPath = path;
    }
    function polygon(column, rect, caret = false) {
      paintPoints(nativeRectScreenPoints(column, rect), caret, !rect.width);
    }
    if (showing)
      for (const part of selectionIntervals(range, columnList)) {
        if (!hasNativeColumn(part)) continue;
        for (const rect of nativeSelectionRects(part, range).rects) polygon(part, rect);
      }
    const column =
      range?.collapsed && allowed() && document.activeElement === input()
        ? caretInterval(range.focus, columnList)
        : null;
    const hint =
        nativeHint?.key === layoutKey() &&
        nativeHint?.index === range?.focus.index &&
        nativeHint?.frameId === column?.frameId
          ? nativeHint
          : null,
      caret = column && hasNativeColumn(column) && nativeCaretRect(column, range.focus, { hint });
    if (caret) {
      polygon(column, caret, true);
      anchor = nativeRectScreenBounds(column, caret);
      anchorInfo = { column, caret };
    } else if (column?.wrap) {
      const rect = wrappedCaretBounds(column, range.focus, layoutKey());
      paintPoints([new DOMPoint(rect.x, rect.y), new DOMPoint(rect.x, rect.y + rect.height)], true);
      anchor = rect;
      anchorInfo = { column, caret: range.focus };
    }
    onNativeCaret(anchor, anchorInfo);
    nativeAnimation?.cancel();
    nativeOverlay.replaceChildren(paths);
    nativeAnimation =
      blinkingPath && !matchMedia('(prefers-reduced-motion: reduce)').matches
        ? blinkingPath.animate(
            [
              { opacity: 1, offset: 0 },
              { opacity: 1, offset: 0.49 },
              { opacity: 0, offset: 0.5 },
              { opacity: 0, offset: 1 },
            ],
            { duration: 1000, iterations: Infinity },
          )
        : null;
  }
  function sync({ force = false } = {}) {
    const root = input(),
      range = root && flow() && current(),
      showing = !!range && !range.collapsed && allowed();
    showRange(showing);
    if (!showing && (!range || !allowed() || document.activeElement !== root)) {
      if (painted) {
        publish(owner, []);
        fallback.replaceChildren();
        nativeAnimation?.cancel();
        nativeAnimation = null;
        nativeOverlay.replaceChildren();
        onNativeCaret(null);
        painted = null;
        paintedNative = false;
      }
      return range;
    }
    const baseKey = [
        layoutKey(),
        showing,
        range?.anchor.index,
        range?.focus.index,
        range?.focus.affinity,
        nativeHint?.lineIndex,
        nativeHint?.side,
        nativeHint?.frameId,
        document.activeElement,
        root,
      ],
      hasNativeData = (frames() || []).some((frame) => {
        const part = fragment(frame.id);
        return part?.native || part?.columns?.some((column) => column.native || column.wrap);
      });
    if (
      !force &&
      !hasNativeData &&
      !paintedNative &&
      globalThis.CSS?.highlights &&
      globalThis.Highlight &&
      painted?.length === baseKey.length &&
      painted.every((v, i) => v === baseKey[i])
    )
      return range;
    const columnList = columns({ measureBounds: false }),
      nativeColumns = columnList.filter((column) => {
        if (!column.native) return false;
        column.screenMatrix = column.element
          .querySelector('svg[data-composed-text]')
          ?.getScreenCTM();
        return !!column.screenMatrix;
      }),
      wrapColumns = columnList.filter((column) => column.wrap);
    const nativeKey = [...nativeColumns, ...wrapColumns].flatMap((column) => {
      if (column.wrap) {
        const r = column.element.getBoundingClientRect();
        return [column.element, r.x, r.y, r.width, r.height];
      }
      const matrix = column.screenMatrix;
      return [
        column.native,
        column.element,
        matrix?.a,
        matrix?.b,
        matrix?.c,
        matrix?.d,
        matrix?.e,
        matrix?.f,
      ];
    });
    const paintKey = [...baseKey, ...nativeKey];
    if (
      !force &&
      globalThis.CSS?.highlights &&
      globalThis.Highlight &&
      painted?.length === paintKey.length &&
      painted.every((v, i) => v === paintKey[i])
    )
      return range;
    painted = paintKey;
    paintedNative = nativeColumns.length > 0 || wrapColumns.length > 0;
    const ranges = showing
      ? selectionIntervals(
          range,
          columnList.filter((column) => !hasNativeColumn(column)),
        )
          .map((part) =>
            previewRange(
              part.element,
              part.start,
              part.end,
              { start: part.sourceStart, end: part.sourceEnd },
              layoutKey(),
            ),
          )
          .filter(Boolean)
      : [];
    publish(owner, ranges);
    fallback.replaceChildren();
    if (ranges.length && !(globalThis.CSS?.highlights && globalThis.Highlight)) {
      const base = viewport.getBoundingClientRect();
      for (const part of ranges)
        for (const rect of part.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const box = document.createElement('div');
          Object.assign(box.style, {
            left: rect.left - base.left + 'px',
            top: rect.top - base.top + 'px',
            width: rect.width + 'px',
            height: rect.height + 'px',
          });
          fallback.append(box);
        }
    }
    if (nativeColumns.length || wrapColumns.length) nativePaint(columnList, range, showing);
    else {
      nativeAnimation?.cancel();
      nativeAnimation = null;
      if (nativeOverlay.childNodes.length) nativeOverlay.replaceChildren();
      onNativeCaret(null);
    }
    return range;
  }
  function hit(x, y, frameId = null) {
    const candidates = columns().filter((part) => !frameId || part.frameId === frameId);
    if (!candidates.length) return null;
    const distance = ({ bounds: r }) =>
      Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    const column = [...candidates].sort((a, b) => distance(a) - distance(b))[0],
      r = column.bounds;
    const px = Math.max(r.left + 0.5, Math.min(r.right - 0.5, x)),
      py = Math.max(r.top + 0.5, Math.min(r.bottom - 0.5, y));
    if (hasNativeColumn(column)) {
      const destination = hitNativeColumn(column, { x, y });
      if (destination) {
        nativeHint = {
          ...destination.nativeCaretHint,
          frameId: destination.frameId,
          index: destination.index,
          key: layoutKey(),
        };
        return destination;
      }
    }
    nativeHint = null;
    // The invisible canonical input must not cover the preview used for provenance hits.
    const pane = input()?.closest('.canvas-input-world'),
      previous = pane?.style.pointerEvents;
    if (pane) pane.style.pointerEvents = 'none';
    const clip = pane?.querySelector('.canvas-flow-clip'),
      oldClip = clip?.style.pointerEvents;
    if (clip) clip.style.pointerEvents = 'none';
    const hidden = column.element.closest('[data-flow-editing]');
    if (hidden) hidden.removeAttribute('data-flow-editing');
    const caret = document.caretRangeFromPoint?.(px, py);
    if (hidden) hidden.dataset.flowEditing = '';
    if (pane) pane.style.pointerEvents = previous;
    if (clip) clip.style.pointerEvents = oldClip;
    let index = y < r.top ? column.start : y > r.bottom ? column.end : null;
    if (index === null && caret && column.element.contains(caret.startContainer)) {
      const leaves = previewLeaves(column.element, layoutKey()),
        leaf = leaves.find((s) => s.node === caret.startContainer);
      if (leaf) index = leaf.start + caret.startOffset;
      else if (caret.startContainer.nodeType === Node.ELEMENT_NODE) {
        const node = caret.startContainer,
          next = node.childNodes[caret.startOffset],
          prior = node.childNodes[caret.startOffset - 1];
        if (next?.nodeType === Node.ELEMENT_NODE && next.hasAttribute('data-flow-break'))
          index = Number(next.dataset.flowBreak);
        else if (prior?.nodeType === Node.ELEMENT_NODE && prior.hasAttribute('data-flow-break'))
          index = Number(prior.dataset.flowBreak) + 1;
        else if (next)
          index =
            leaves.find((part) => next === part.node || next.contains?.(part.node))?.start ?? null;
        else if (prior)
          index =
            leaves.findLast((part) => prior === part.node || prior.contains?.(part.node))?.end ??
            null;
        if (index === null && node.hasAttribute('data-flow-block-start'))
          index = Number(node.dataset.flowBlockStart);
      }
    }
    if (index === null) {
      const leaves = previewLeaves(column.element, layoutKey());
      let closest = null;
      for (const leaf of leaves) {
        const line = document.createRange();
        line.selectNodeContents(leaf.node);
        for (const rect of line.getClientRects()) {
          const d = Math.hypot(
            Math.max(rect.left - px, 0, px - rect.right),
            Math.max(rect.top - py, 0, py - rect.bottom),
          );
          if (!closest || d < closest.distance) closest = { distance: d, leaf, rect };
        }
      }
      index = closest
        ? px < closest.rect.left
          ? closest.leaf.start
          : closest.leaf.end
        : column.start;
    }
    return {
      frameId: column.frameId,
      index: Math.max(column.start, Math.min(column.end, index)),
      affinity: index >= column.end ? 'backward' : 'forward',
    };
  }
  function set(value, focus = true) {
    const root = input();
    if (!root) return;
    const range = logicalSelection(value.anchor, value.focus);
    if (!range.collapsed) projectFlowInput(root, 0);
    restoreTextSelection(root, bookmark(range), { focus });
    logicalHint = { root, flowId: flow()?.id, source: flow()?.html, range };
    onSelection();
    root.scrollTop = root.scrollLeft = 0;
    sync();
  }
  function extend(x, y) {
    if (!drag || !input() || flow()?.id !== drag.flowId) return;
    if (!allowed()) {
      stop(true, false);
      return;
    }
    if (flow().html !== drag.source) {
      stop(false, false);
      return;
    }
    const destination = hit(x, y);
    if (!destination) return;
    const focus = drag.navigation.snap(destination);
    if (drag.unit === 'word' || drag.unit === 'paragraph') {
      const unit =
        drag.unit === 'word' ? drag.navigation.word(focus) : drag.navigation.paragraph(focus);
      set(
        focus.index < drag.initial.start
          ? { anchor: drag.initial.focus, focus: unit.anchor }
          : { anchor: drag.initial.anchor, focus: unit.focus },
      );
    } else set({ anchor: drag.anchor, focus });
  }
  function autoScroll(time) {
    scrolling = 0;
    if (!drag) return;
    if (!allowed()) {
      stop(true, false);
      return;
    }
    const bounds = viewport.getBoundingClientRect(),
      { x, y } = drag.last,
      edge = 28;
    const speed = (v, low, high) =>
      v < low + edge
        ? Math.max(-800, (v - low - edge) * 20)
        : v > high - edge
          ? Math.min(800, (v - high + edge) * 20)
          : 0;
    const dx = speed(x, bounds.left, bounds.right),
      dy = speed(y, bounds.top, bounds.bottom),
      dt = Math.min(0.04, (time - (lastTime || time)) / 1000);
    lastTime = time;
    if (dx || dy) {
      pan(-dx * dt, -dy * dt);
      extend(x, y);
      scrolling = requestAnimationFrame(autoScroll);
    }
  }
  function stop(cancel = false, focus = true) {
    pendingMouse = null;
    if (!drag) return;
    const old = drag;
    drag = null;
    if (cancel) nativeHint = null;
    cancelAnimationFrame(scrolling);
    scrolling = 0;
    lastTime = 0;
    if (viewport.hasPointerCapture?.(old.pointerId)) viewport.releasePointerCapture(old.pointerId);
    if (cancel && allowed() && input() && flow()?.id === old.flowId)
      set(old.before || old.initial, focus);
    onSelection();
    sync();
  }
  function begin(event, id, pointerId, clickCount) {
    const oldFlow = flow()?.id,
      before = current();
    // A preview is visible while a range is selected. Hit it before activating its canonical owner.
    activate(id, event);
    if (!input() || !flow() || !allowed(event)) return;
    const destination = hit(event.clientX, event.clientY, id);
    if (!destination) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const state = navigationState(),
      focus = state.navigation.snap(destination),
      extending = event.shiftKey && before && oldFlow === flow().id,
      initial =
        clickCount >= 3
          ? state.navigation.paragraph(focus)
          : clickCount === 2
            ? state.navigation.word(focus)
            : logicalSelection(extending ? before.anchor : focus, focus);
    drag = {
      pointerId,
      navigation: state.navigation,
      flowId: flow().id,
      source: flow().html,
      anchor: initial.anchor,
      initial,
      before: oldFlow === flow().id ? before : null,
      unit: clickCount >= 3 ? 'paragraph' : clickCount === 2 ? 'word' : 'character',
      start: { x: event.clientX, y: event.clientY },
      last: { x: event.clientX, y: event.clientY },
    };
    viewport.setPointerCapture(pointerId);
    set(initial);
  }
  listen(
    viewport,
    'pointerdown',
    (event) => {
      if (!allowed(event) || event.button !== 0 || event.pointerType === 'touch') return;
      const target = event.target instanceof Element ? event.target : null;
      const text = target?.closest('[data-flow-frame],.canvas-flow-input');
      if (!text) return;
      const id = text.dataset.flowFrame || text.dataset.sceneText;
      if (event.pointerType === 'mouse') {
        // PointerEvent.detail is zero. Leave compatibility mousedown enabled so the
        // OS/browser click count (including its accessibility settings) owns granularity.
        pendingMouse = { id, pointerId: event.pointerId };
        event.stopImmediatePropagation();
      } else begin(event, id, event.pointerId, 1);
    },
    { capture: true },
  );
  listen(
    viewport,
    'mousedown',
    (event) => {
      const pending = pendingMouse;
      pendingMouse = null;
      if (pending && event.button === 0 && allowed(event))
        begin(event, pending.id, pending.pointerId, event.detail);
    },
    { capture: true },
  );
  listen(
    viewport,
    'pointermove',
    (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!event.buttons) {
        stop();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      drag.last = { x: event.clientX, y: event.clientY };
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) >= 2)
        extend(event.clientX, event.clientY);
      if (!scrolling) scrolling = requestAnimationFrame(autoScroll);
    },
    { capture: true },
  );
  listen(
    viewport,
    'pointerup',
    (event) => {
      pendingMouse = null;
      if (drag?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) >= 2)
          extend(event.clientX, event.clientY);
        stop();
      }
    },
    { capture: true },
  );
  listen(viewport, 'pointercancel', () => stop(true), { capture: true });
  listen(
    viewport,
    'pointerdown',
    () => {
      logicalHint = null;
    },
    { capture: true },
  );
  listen(
    viewport,
    'beforeinput',
    () => {
      logicalHint = null;
    },
    { capture: true },
  );
  listen(viewport, 'lostpointercapture', (event) => {
    if (drag?.pointerId === event.pointerId) stop(true, false);
  });
  listen(
    window,
    'keydown',
    (event) => {
      if (event.key === 'Escape') stop(true);
    },
    { capture: true },
  );
  listen(window, 'blur', () => stop(true, false));
  function geometry() {
    const key = layoutKey(),
      columnList = columns({ measureBounds: false }),
      native = columnList.map((column) => (hasNativeColumn(column) ? column.native : null));
    if (
      geometryCache?.key !== key ||
      !geometryCache.native?.every((value, i) => value === native[i]) ||
      geometryCache.native.length !== native.length
    ) {
      let value;
      if (native.every(Boolean) && native.length) value = nativeCaretLines(columnList);
      else if (!native.some(Boolean))
        value = measureFlowCaretLines(columnList, { graphemeBoundaries: graphemeSet() });
      else {
        value = { lines: [], measuredStops: 0, truncated: false, limitations: [] };
        for (const [i, column] of columnList.entries()) {
          const part = native[i]
            ? nativeCaretLines([column])
            : measureFlowCaretLines([column], { graphemeBoundaries: graphemeSet() });
          value.lines.push(...part.lines.map((line) => ({ ...line, columnOrder: i })));
          value.measuredStops += part.measuredStops;
          value.truncated ||= part.truncated;
          value.limitations.push(...part.limitations);
        }
      }
      geometryCache = { key, native, value: mergeWrappedCaretRows(value, columnList) };
    }
    return geometryCache.value;
  }
  listen(
    viewport,
    'keydown',
    (event) => {
      if (
        !allowed() ||
        event.isComposing ||
        !input()?.contains(event.target) ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
      )
        return;
      const range = current();
      if (!range) return;
      const { navigation } = navigationState(),
        mac = /Mac|iPhone|iPad/.test(navigator.platform),
        horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key),
        forward = ['ArrowRight', 'ArrowDown', 'End'].includes(event.key),
        command = mac ? event.metaKey : event.ctrlKey;
      let next;
      nativeHint = null;
      if (
        command &&
        (['ArrowUp', 'ArrowDown'].includes(event.key) || ['Home', 'End'].includes(event.key))
      )
        next = navigation.selection(range, {
          extend: event.shiftKey,
          direction: forward ? 'forward' : 'backward',
          unit: 'flow',
        });
      else if (horizontal && (mac ? event.altKey : event.ctrlKey))
        next = navigation.selection(range, {
          extend: event.shiftKey,
          direction: forward ? 'forward' : 'backward',
          unit: 'word',
        });
      else if (['ArrowUp', 'ArrowDown'].includes(event.key) && event.altKey)
        next = navigation.selection(range, {
          extend: event.shiftKey,
          direction: forward ? 'forward' : 'backward',
          unit: 'paragraph',
        });
      else {
        const measured = geometry();
        if (
          measured.truncated ||
          measured.limitations.some((s) =>
            ['mixed-bidi-affinity', 'rotated-or-sheared-column', 'offset-inline-baseline'].includes(
              s,
            ),
          )
        )
          return;
        if (horizontal && !command)
          next = navigation.selection(range, {
            extend: event.shiftKey,
            direction: forward ? 'forward' : 'backward',
            unit: 'grapheme',
          });
        else {
          const all = measured.lines.flatMap((line, i) =>
              line.stops.map((stop) => ({ ...stop, lineIndex: i })),
            ),
            ownColumn = caretInterval(range.focus, columns({ measureBounds: false })),
            candidates = all.filter(
              (stop) =>
                stop.index === range.focus.index &&
                (!ownColumn || measured.lines[stop.lineIndex].frameId === ownColumn.frameId),
            ),
            at =
              candidates.find((stop) => stop.affinity === range.focus.affinity) ||
              candidates[0] ||
              all.reduce(
                (best, stop) =>
                  !best ||
                  Math.abs(stop.index - range.focus.index) <
                    Math.abs(best.index - range.focus.index)
                    ? stop
                    : best,
                null,
              );
          if (!at) return;
          const line = measured.lines[at.lineIndex];
          let destination;
          if (horizontal || ['Home', 'End'].includes(event.key))
            destination = forward ? line.stops.at(-1) : line.stops[0];
          else {
            preferredX ??=
              (at.x - (line.wrapColumnLeft || 0)) *
              (columns({ measureBounds: false })[line.columnOrder]?.scaleX || 1);
            const target = measured.lines[at.lineIndex + (forward ? 1 : -1)];
            destination =
              target?.stops.reduce(
                (best, stop) =>
                  !best ||
                  Math.abs(
                    (stop.x - (target.wrapColumnLeft || 0)) *
                      (columns({ measureBounds: false })[target.columnOrder]?.scaleX || 1) -
                      preferredX,
                  ) <
                    Math.abs(
                      (best.x - (target.wrapColumnLeft || 0)) *
                        (columns({ measureBounds: false })[target.columnOrder]?.scaleX || 1) -
                        preferredX,
                    )
                    ? stop
                    : best,
                null,
              ) || at;
          }
          if (destination?.nativeCaretHint)
            nativeHint = {
              ...destination.nativeCaretHint,
              frameId:
                destination.frameId ||
                measured.lines[destination.lineIndex ?? at.lineIndex]?.frameId ||
                line.frameId,
              index: destination.index,
              key: layoutKey(),
            };
          next = logicalSelection(event.shiftKey ? range.anchor : destination, destination);
        }
      }
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (horizontal || ['Home', 'End'].includes(event.key)) preferredX = null;
      set(next);
    },
    { capture: true },
  );
  return {
    selection: current,
    sync,
    hit,
    cancel: () => stop(true, false),
    get dragging() {
      return !!drag;
    },
    destroy() {
      if (!alive) return;
      alive = false;
      stop();
      controller.abort();
      publish(owner, []);
      fallback.remove();
      nativeAnimation?.cancel();
      nativeAnimation = null;
      nativeOverlay.remove();
      onNativeCaret(null);
      showRange(false);
    },
  };
}
