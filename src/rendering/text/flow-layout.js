import {
  annotatedSource,
  lift,
  globalIndex,
  copyRange,
  displayHTML,
  blockTags,
} from './flow-source.js';
import { composeFrameText, measureFrameText } from './frame-composition.js';
import {
  documentHasObjectWrap,
  flowHasObjectWrap,
  layoutWrappedTextFlow,
} from './object-wrap-layout.js';
import { effectiveTextStyle } from '../../domain/documents/publishing.js';
import { applyFrameTypography } from './format.js';
import { appendTextFlowPage, trimTextFlowPages } from '../../domain/documents/text-flows.js';
import { applyNamedTextStyles } from './styles.js';
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
function splitColumns(probe, width, total, start) {
  const base = probe.getBoundingClientRect(),
    visualWidth = base.width,
    cuts = new Map([[0, { node: probe, offset: 0, index: start }]]);
  let last = 0,
    verticalOverset = false;
  const column = (rect) => Math.max(0, Math.floor((rect.left - base.left + 0.01) / visualWidth));
  const range = document.createRange();
  const leaves = [];
  for (const element of probe.querySelectorAll('[data-flow-text],br')) {
    if (!element.hasAttribute('data-flow-text')) leaves.push(element);
    else {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) leaves.push(node);
    }
  }
  for (const node of leaves) {
    range.selectNodeContents(node);
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
export function layoutDocumentTextFlows(
  doc,
  { allowPages = true, objectWrap = true, imageContours } = {},
) {
  // The native compositor may own every flow. A remaining frameOptions on
  // those objects must not trigger a second projection of the entire scene.
  if (!doc.textFlows?.length) return { fragments: new Map(), status: new Map(), changed: false };
  if (objectWrap && documentHasObjectWrap(doc)) {
    const wrapped = (doc.textFlows || []).filter(
      (flow) => !flow.composition && flowHasObjectWrap(doc, flow, imageContours),
    );
    if (wrapped.length) {
      const ids = new Set(wrapped.map((flow) => flow.id)),
        projection = {
          ...doc,
          textFlows: (doc.textFlows || []).filter((flow) => !ids.has(flow.id)),
        },
        result = layoutDocumentTextFlows(projection, { allowPages, objectWrap: false });
      doc.pages = projection.pages;
      doc.blocks = projection.blocks;
      for (const flow of wrapped) {
        const plan = layoutWrappedTextFlow(doc, flow, { allowPages, imageContours });
        for (const [id, fragment] of plan.fragments) result.fragments.set(id, fragment);
        result.status.set(flow.id, plan.status);
        result.changed ||= plan.changed;
      }
      return result;
    }
  }
  // Each threaded source has one layout authority. Native flows stay in the
  // scene for page ownership checks, but never enter browser line composition.
  if (doc.textFlows?.some((flow) => flow.composition)) {
    const projection = { ...doc, textFlows: doc.textFlows.filter((flow) => !flow.composition) };
    const result = layoutDocumentTextFlows(projection, { allowPages, objectWrap, imageContours });
    doc.pages = projection.pages;
    doc.blocks = projection.blocks;
    return result;
  }
  if (doc.blocks.some((b) => b.textFlowId && b.frameOptions))
    return layoutFrameColumns(doc, { allowPages });
  const fragments = new Map(),
    status = new Map();
  let changed = false;
  for (const textFlow of doc.textFlows || []) {
    const source = annotatedSource(textFlow.html);
    let remaining = source.html,
      start = 0,
      index = 0,
      used = 0,
      overset = false,
      additionalFrames = 0;
    while (index < textFlow.frameIds.length) {
      const frame = doc.blocks.find((b) => b.id === textFlow.frameIds[index]),
        size = metrics(frame);
      let group = 1;
      while (!frame.compositionOptions && index + group < textFlow.frameIds.length) {
        const nextFrame = doc.blocks.find((b) => b.id === textFlow.frameIds[index + group]);
        if (nextFrame.compositionOptions) break;
        const next = metrics(nextFrame);
        if (Math.abs(next.w - size.w) > 0.001 || Math.abs(next.h - size.h) > 0.001) break;
        group++;
      }
      const probe = document.createElement('div');
      probe.className = 'rich-text canvas-text flow-layout-probe';
      probe.dataset.flowRoot = 'true';
      probe.innerHTML = remaining;
      document.body.append(probe);
      applyFrameTypography(probe, effectiveTextStyle(doc, textFlow.style));
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
      applyNamedTextStyles(probe, doc);
      if (frame.compositionOptions) {
        probe.classList.add('flow-fragment');
        for (const node of probe.querySelectorAll('[data-flow-origin]')) {
          const origin = source.origins.get(node.dataset.flowOrigin);
          if (origin && origin.before < start && blockTags.has(node.tagName))
            node.dataset.flowContinuation = 'true';
        }
        if (frame.compositionOptions.firstBaseline) {
          const firstLine = composeFrameText(
            probe,
            { ...frame.compositionOptions, verticalAlign: 'top' },
            size.h,
          );
          probe.style.height = Math.max(1, size.h - firstLine.baselineShift) + 'px';
        }
      }
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
      if (index + group === textFlow.frameIds.length && !columns.verticalOverset)
        additionalFrames = Math.max(0, columns.count - group);
      const count = Math.min(group, columns.count);
      for (let i = 0; i < count; i++) {
        const a = columns.cuts.get(i),
          b = columns.cuts.get(i + 1),
          range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        const html = displayHTML(copyRange(range, a), source.origins, a.index, b.index);
        fragments.set(textFlow.frameIds[index + i], {
          html,
          start: a.index,
          end: b.index,
          ...(frame.compositionOptions
            ? {
                composition: composeFrameText(
                  probe,
                  frame.compositionOptions,
                  size.h,
                  measureFrameText(probe, { html, width: size.w }),
                ),
              }
            : {}),
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
      additionalFrames,
    });
  }
  return { fragments, status, changed };
}

/** Project each physical frame into disposable equal-width column slots. Source stays singular. */
function layoutFrameColumns(doc, { allowPages }) {
  let changed = false;
  for (let attempt = 0; attempt < 129; attempt++) {
    const projection = structuredClone(doc),
      slots = new Map();
    projection.blocks = [];
    for (const frame of doc.blocks) {
      if (!frame.textFlowId) {
        projection.blocks.push(structuredClone(frame));
        continue;
      }
      const f = frame.frameOptions || {},
        sx = frame.textScale?.x || 1,
        sy = frame.textScale?.y || 1,
        count = f.columns || 1,
        gutter = f.gutter ?? 12;
      const width =
          (frame.w - (f.insetLeft || 0) - (f.insetRight || 0) - (count - 1) * gutter) / count,
        height = frame.h - (f.insetTop || 0) - (f.insetBottom || 0);
      if (width < 1 || height < 1) throw new Error('Frame insets and gutters leave no text area.');
      const values = [];
      for (let i = 0; i < count; i++) {
        const slot = {
          ...structuredClone(frame),
          id: frame.id + '-column-' + i,
          w: width,
          h: height,
        };
        delete slot.frameOptions;
        if (f.firstBaseline || ['center', 'bottom'].includes(f.verticalAlign))
          slot.compositionOptions = {
            firstBaseline: f.firstBaseline,
            minimumFirstBaseline: (f.minimumFirstBaseline || 0) / sy,
            verticalAlign: f.verticalAlign || 'top',
          };
        values.push({
          id: slot.id,
          left: ((f.insetLeft || 0) + i * (width + gutter)) / sx,
          top: (f.insetTop || 0) / sy,
          width: width / sx,
          height: height / sy,
        });
        projection.blocks.push(slot);
      }
      slots.set(frame.id, values);
    }
    for (const flow of projection.textFlows || []) {
      flow.frameIds = flow.frameIds.flatMap((id) => slots.get(id).map((s) => s.id));
      flow.automaticPages = false;
      flow.deleteEmptyPages = false;
      flow.autoPages = [];
    }
    // Real frame geometry already determined which flows intersect artwork.
    // Synthetic column slots only divide the remaining, unobstructed source.
    const result = layoutDocumentTextFlows(projection, { allowPages: false, objectWrap: false });
    let added = false;
    for (const flow of doc.textFlows || []) {
      const extra = result.status.get(flow.id)?.additionalFrames || 0;
      if (extra && flow.automaticPages && allowPages) {
        const last = doc.blocks.find((b) => b.id === flow.frameIds.at(-1)),
          needed = Math.ceil(extra / (last.frameOptions?.columns || 1));
        for (let i = 0; i < needed; i++) {
          if (!appendTextFlowPage(doc, flow)) break;
          changed = true;
          added = true;
        }
      }
    }
    if (added) continue;
    const fragments = new Map(),
      status = new Map();
    for (const flow of doc.textFlows || []) {
      let used = 0;
      for (const [index, id] of flow.frameIds.entries()) {
        const parts = slots.get(id).map((slot) => {
          const fragment = result.fragments.get(slot.id),
            composition = fragment.composition;
          return {
            ...slot,
            ...fragment,
            top: slot.top + (composition?.top || 0),
            height: composition?.height || slot.height,
          };
        });
        if (parts.some((p) => p.end > p.start)) used = index + 1;
        fragments.set(id, {
          start: parts[0].start,
          end: parts.at(-1).end,
          columns: parts.map((part, index) => ({ ...part, index })),
          html: parts
            .map(
              (p) =>
                `<div class="flow-column" data-flow-column="${p.id}" style="position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px;overflow:hidden">${p.html}</div>`,
            )
            .join(''),
        });
      }
      if (allowPages && trimTextFlowPages(doc, flow, Math.max(1, used))) changed = true;
      status.set(flow.id, { ...result.status.get(flow.id), frames: flow.frameIds.length, used });
    }
    return { fragments, status, changed };
  }
  throw new Error('Text continuation exceeded the page limit.');
}
