import { cleanHTML } from '../../shared/html/sanitize.js';
import { applyFrameTypography } from './format.js';
import { textIndexMap, textIndexAt } from '../../shared/dom/text-selection.js';
import { appendTextFlowPage, trimTextFlowPages } from '../../domain/documents/text-flows.js';
let fontReady;
export function prepareTextFlowFonts() {
  return (fontReady ||= Promise.all(
    [
      '400 16px "CMU Serif"',
      '700 16px "CMU Serif"',
      'italic 400 16px "CMU Serif"',
      'italic 700 16px "CMU Serif"',
    ].map((font) => document.fonts.load(font)),
  ).then(() => document.fonts.ready));
}
const blockTags = new Set(['P', 'DIV', 'LI', 'OL', 'UL', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);
function annotatedSource(html) {
  const root = document.createElement('div');
  root.innerHTML = cleanHTML(html);
  const map = textIndexMap(root),
    origins = new Map();
  let serial = 0;
  for (const element of root.querySelectorAll('*')) {
    const id = String(serial++);
    element.dataset.flowOrigin = id;
    element.dataset.flowBefore = textIndexAt(
      map,
      element.parentNode,
      [...element.parentNode.childNodes].indexOf(element),
    );
    origins.set(id, {
      tag: element.tagName,
      before: Number(element.dataset.flowBefore),
      listIndex:
        element.tagName === 'LI'
          ? [...element.parentNode.children].filter((n) => n.tagName === 'LI').indexOf(element)
          : 0,
      listStart: element.tagName === 'OL' ? element.start || 1 : 1,
    });
  }
  for (const segment of map.segments) {
    const span = document.createElement('span');
    span.dataset.flowText = segment.start;
    span.dataset.flowBefore = segment.start;
    segment.node.replaceWith(span);
    span.append(segment.node);
  }
  return { html: root.innerHTML, origins, total: textIndexAt(map, root, root.childNodes.length) };
}
function lift(node, offset) {
  if (offset) return { node, offset };
  while (
    node.parentNode &&
    node.parentNode.dataset?.flowRoot !== 'true' &&
    node === node.parentNode.firstChild
  )
    node = node.parentNode;
  return { node: node.parentNode, offset: [...node.parentNode.childNodes].indexOf(node) };
}
function globalIndex(point, total) {
  if (point.node.nodeType === Node.TEXT_NODE)
    return Number(point.node.parentElement.dataset.flowText) + point.offset;
  const next = point.node.childNodes[point.offset];
  return next
    ? Number(next.dataset?.flowBefore ?? next.parentElement?.dataset.flowText ?? total)
    : total;
}
function copyRange(range, start) {
  let fragment = range.cloneContents();
  let context = range.commonAncestorContainer;
  if (context.nodeType === Node.TEXT_NODE) context = context.parentElement;
  while (context && context.dataset?.flowRoot !== 'true') {
    const wrapper = context.cloneNode(false);
    wrapper.append(fragment);
    const outer = document.createDocumentFragment();
    outer.append(wrapper);
    fragment = outer;
    context = context.parentElement;
  }
  if (start.node.nodeType === Node.TEXT_NODE) {
    const marker = start.node.parentElement.dataset.flowText,
      first = fragment.querySelector(`[data-flow-text="${marker}"]`);
    if (first) {
      first.dataset.flowText = Number(marker) + start.offset;
      first.dataset.flowBefore = first.dataset.flowText;
    }
  }
  return fragment;
}
function displayHTML(fragment, origins, start, _end) {
  for (const list of fragment.querySelectorAll('ol')) {
    const first = list.querySelector('li'),
      source = first && origins.get(first.dataset.flowOrigin),
      original = origins.get(list.dataset.flowOrigin);
    if (source) list.start = (original?.listStart || 1) + source.listIndex;
  }
  for (const element of fragment.querySelectorAll('[data-flow-origin]')) {
    const source = origins.get(element.dataset.flowOrigin);
    if (source && source.before < start && blockTags.has(element.tagName)) {
      element.dataset.flowContinuation = 'true';
      if (element.tagName === 'LI') element.style.listStyleType = 'none';
    }
    delete element.dataset.flowOrigin;
    delete element.dataset.flowBefore;
  }
  // Derived text origins let a preview click locate the same caret in the canonical TextFlow Editor.
  for (const span of fragment.querySelectorAll('[data-flow-text]')) delete span.dataset.flowBefore;
  const host = document.createElement('div');
  host.append(fragment);
  return host.innerHTML;
}
function splitColumns(probe, width, total, start) {
  const base = probe.getBoundingClientRect(),
    visualWidth = base.width,
    cuts = new Map([[0, { node: probe, offset: 0, index: start }]]);
  let last = 0,
    verticalOverset = false;
  const column = (rect) => Math.max(0, Math.floor((rect.left - base.left + 0.01) / visualWidth));
  const range = document.createRange();
  for (const element of probe.querySelectorAll('[data-flow-text],br')) {
    const node = element.hasAttribute('data-flow-text') ? element.firstChild : element;
    if (!node) continue;
    range.selectNodeContents(element);
    if (node.nodeType !== Node.TEXT_NODE) range.selectNode(node);
    const rects = [...range.getClientRects()].filter((r) => r.height > 0);
    if (rects.some((r) => r.bottom > base.bottom + 0.75 || r.top < base.top - 0.75))
      verticalOverset = true;
    const columns = [...new Set(rects.map(column))].sort((a, b) => a - b);
    for (const col of columns) {
      last = Math.max(last, col);
      if (cuts.has(col)) continue;
      let point;
      if (node.nodeType === Node.TEXT_NODE) {
        const starts = [
          ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(node.data),
        ].map((value) => value.index);
        let lo = 0,
          hi = starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          range.setStart(node, starts[mid]);
          range.setEnd(node, starts[mid] + ([...node.data.slice(starts[mid])][0]?.length || 1));
          const rect = range.getClientRects()[0];
          if (rect && column(rect) >= col) hi = mid;
          else lo = mid + 1;
        }
        point = lift(node, starts[lo] || 0);
      } else point = lift(node, 0);
      point.index = globalIndex(point, total);
      cuts.set(col, point);
    }
  }
  const end = { node: probe, offset: probe.childNodes.length, index: total };
  cuts.set(last + 1, end);
  for (let i = last; i >= 0; i--) if (!cuts.has(i)) cuts.set(i, cuts.get(i + 1));
  return { cuts, count: last + 1, end, verticalOverset };
}
const metrics = (frame) => ({
  w: frame.w / (frame.textScale?.x || 1),
  h: frame.h / (frame.textScale?.y || 1),
});
/** Native browser column composition with derived fragments; canonical textFlow source is never split or rewritten. */
export function layoutDocumentTextFlows(doc, { allowPages = true } = {}) {
  const fragments = new Map(),
    status = new Map();
  let changed = false;
  for (const textFlow of doc.textFlows || []) {
    const source = annotatedSource(textFlow.html);
    let remaining = source.html,
      start = 0,
      index = 0,
      used = 0,
      overset = false;
    while (index < textFlow.frameIds.length) {
      const frame = doc.blocks.find((b) => b.id === textFlow.frameIds[index]),
        size = metrics(frame);
      let group = 1;
      while (index + group < textFlow.frameIds.length) {
        const next = metrics(doc.blocks.find((b) => b.id === textFlow.frameIds[index + group]));
        if (Math.abs(next.w - size.w) > 0.001 || Math.abs(next.h - size.h) > 0.001) break;
        group++;
      }
      const probe = document.createElement('div');
      probe.className = 'rich-text canvas-text flow-layout-probe';
      probe.dataset.flowRoot = 'true';
      probe.innerHTML = remaining;
      document.body.append(probe);
      applyFrameTypography(probe, textFlow.style);
      Object.assign(probe.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        visibility: 'hidden',
        width: size.w + 'px',
        height: size.h + 'px',
        maxHeight: 'none',
        minHeight: '0',
        overflow: 'visible',
        transform: 'none',
        columnWidth: size.w + 'px',
        columnGap: '0px',
        columnFill: 'auto',
        columnCount: 'auto',
        whiteSpace: 'normal',
      });
      const columns = splitColumns(probe, size.w, source.total, start);
      overset ||= columns.verticalOverset;
      if (
        index + group === textFlow.frameIds.length &&
        textFlow.automaticPages &&
        allowPages &&
        !columns.verticalOverset
      )
        while (group < columns.count) {
          if (!appendTextFlowPage(doc, textFlow)) {
            overset = true;
            break;
          }
          group++;
          changed = true;
        }
      const count = Math.min(group, columns.count);
      for (let i = 0; i < count; i++) {
        const a = columns.cuts.get(i),
          b = columns.cuts.get(i + 1),
          range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        fragments.set(textFlow.frameIds[index + i], {
          html: displayHTML(copyRange(range, a), source.origins, a.index, b.index),
          start: a.index,
          end: b.index,
        });
        used = index + i + 1;
      }
      if (group >= columns.count) {
        remaining = '';
        index += group;
        probe.remove();
        break;
      }
      const cut = columns.cuts.get(group),
        range = document.createRange();
      range.setStart(cut.node, cut.offset);
      range.setEnd(probe, probe.childNodes.length);
      const host = document.createElement('div');
      host.append(copyRange(range, cut));
      remaining = host.innerHTML;
      start = cut.index;
      index += group;
      probe.remove();
    }
    overset ||= !!remaining;
    if (allowPages && trimTextFlowPages(doc, textFlow, Math.max(1, used))) changed = true;
    for (const id of textFlow.frameIds)
      if (!fragments.has(id))
        fragments.set(id, { html: '', start: source.total, end: source.total });
    status.set(textFlow.id, {
      overset,
      frames: textFlow.frameIds.length,
      used,
      characters: source.total,
    });
  }
  return { fragments, status, changed };
}
