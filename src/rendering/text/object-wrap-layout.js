import { textWrapObstacles, textWrapBand } from '../../domain/geometry/text-wrap.js';
import { appendTextFlowPage, trimTextFlowPages } from '../../domain/documents/text-flows.js';
import { firstBaselineOffset } from '../../domain/text/frame-composition.js';
import { createWrapLineMeasurer } from './wrap-lines.js';

export const documentHasObjectWrap = (doc) =>
  [...doc.blocks, ...(doc.publishing?.parents || []).flatMap((parent) => parent.blocks)].some(
    (block) => block.textWrap && block.textWrap.mode !== 'none',
  );

export function frameWrapObstacles(doc, frame) {
  const width = frame.w / (frame.textScale?.x || 1),
    height = frame.h / (frame.textScale?.y || 1);
  return textWrapObstacles(doc, frame).filter(
    ({ bounds, invert }) =>
      invert ||
      (bounds.right > 0 && bounds.left < width && bounds.bottom > 0 && bounds.top < height),
  );
}
export const flowHasObjectWrap = (doc, flow) =>
  flow.frameIds.some((id) => {
    const frame = doc.blocks.find((b) => b.id === id);
    return frame && frameWrapObstacles(doc, frame).length > 0;
  });

function columnSlots(frame) {
  const f = frame.frameOptions || {},
    count = f.columns || 1,
    gap = f.gutter ?? 12,
    sx = frame.textScale?.x || 1,
    sy = frame.textScale?.y || 1,
    width = (frame.w - (f.insetLeft || 0) - (f.insetRight || 0) - (count - 1) * gap) / count / sx,
    height = (frame.h - (f.insetTop || 0) - (f.insetBottom || 0)) / sy;
  if (width < 1 || height < 1) throw Error('Insets and gutters must leave room for wrapped text.');
  return Array.from({ length: count }, (_, index) => ({
    id: frame.id + '-wrap-column-' + index,
    index,
    width,
    height,
    left: ((f.insetLeft || 0) + index * (width * sx + gap)) / sx,
    top: (f.insetTop || 0) / sy,
  }));
}

/** Multiple source fragments can share one baseline around an interior object.
 * Their HTML is derived paint/provenance; the flow remains one canonical input. */
export function layoutWrappedTextFlow(doc, flow, { allowPages = true } = {}) {
  for (const id of flow.frameIds) {
    let frame = doc.blocks.find((b) => b.id === id);
    if (['center', 'bottom'].includes(frame.frameOptions?.verticalAlign))
      throw Error(
        'Object wrapping currently requires Top vertical alignment in every linked frame.',
      );
    while (frame) {
      if (Math.abs((frame.rotation || 0) % 360) > 0.000001)
        throw Error(
          'Wrapped text currently requires unrotated text frames and containing groups; wrapping objects can be rotated.',
        );
      frame = doc.blocks.find((b) => b.id === frame.parentId);
    }
  }
  const measured = createWrapLineMeasurer(doc, flow),
    fragments = new Map();
  let start = 0,
    used = 0,
    rows = 0,
    changed = false;
  try {
    if (measured.total > 200000)
      throw Error('Wrapped text currently supports up to 200,000 source positions per flow.');
    for (let frameIndex = 0; frameIndex < flow.frameIds.length; frameIndex++) {
      const frame = doc.blocks.find((b) => b.id === flow.frameIds[frameIndex]),
        obstacles = frameWrapObstacles(doc, frame),
        parts = [],
        frameStart = start;
      for (const column of columnSlots(frame)) {
        let y = 0,
          first = true;
        while (start < measured.total && y < column.height) {
          if (++rows > 4096) throw Error('Wrapped text exceeded the 4,096-row composition budget.');
          const initial = measured.measure(start, column.width);
          if (initial.empty) {
            start = initial.end;
            break;
          }
          let height = Math.max(initial.advance + initial.before, initial.bottom),
            bandTop = Math.min(0, initial.top),
            planned = [],
            rowBaseline = 0,
            band,
            next = start,
            stable = false;
          if (first && frame.frameOptions?.firstBaseline) {
            const target = firstBaselineOffset(
              frame.frameOptions.firstBaseline,
              (frame.frameOptions.minimumFirstBaseline || 0) / (frame.textScale?.y || 1),
              initial.metrics,
            );
            y += target - initial.baseline;
          } else if (first) y -= Math.min(0, initial.top);
          first = false;
          for (let pass = 0; pass < 8; pass++) {
            band = textWrapBand(obstacles, {
              left: column.left,
              right: column.left + column.width,
              top: column.top + y + bandTop,
              bottom: column.top + y + height,
            });
            if (band.nextColumn || !band.segments.length) break;
            planned = [];
            next = start;
            rowBaseline = 0;
            const intervals =
              initial.direction === 'rtl' ? [...band.segments].reverse() : band.segments;
            for (const interval of intervals) {
              if (interval.right - interval.left < 1 || next >= measured.total) continue;
              const line = measured.measure(next, interval.right - interval.left);
              if (line.empty) {
                next = line.end;
                break;
              }
              // A grapheme wider than the remaining side area must wait for a
              // usable region; clipping it would preserve bytes but lose ink.
              if (!line.fits) continue;
              planned.push({ ...line, left: interval.left, width: interval.right - interval.left });
              rowBaseline = Math.max(rowBaseline, line.baseline);
              next = line.end;
              if (line.hard) break;
            }
            const actual = Math.max(
                ...planned.map(
                  (p) =>
                    rowBaseline +
                    Math.max(p.advance - (p.baseline - p.before), p.bottom - p.baseline),
                ),
                0,
              ),
              actualTop = Math.min(0, ...planned.map((p) => rowBaseline - p.baseline + p.top));
            if (actualTop < bandTop - 0.01) {
              bandTop = actualTop;
              height = Math.max(height, actual);
              continue;
            }
            if (Math.abs(actual - height) < 0.01) {
              stable = true;
              break;
            }
            // Grow conservatively if a later fragment reveals taller type.
            if (actual <= height) {
              height = actual;
              stable = true;
              break;
            }
            height = actual;
          }
          if (band.nextColumn) break;
          if (!band.segments.length || !planned.length) {
            const nextY = band.nextY === null ? column.height : band.nextY - column.top;
            y = Math.max(y + Math.max(1, initial.advance), nextY);
            continue;
          }
          if (!stable) throw Error('Wrapped mixed-font line geometry did not settle.');
          if (y + height > column.height + 0.01) break;
          if (next <= start) throw Error('Wrapped text could not advance.');
          for (const part of planned) {
            const index = parts.length,
              paddingTop = Math.max(0, -part.top),
              top = column.top + y + rowBaseline - part.baseline - paddingTop;
            parts.push({
              ...part,
              id: frame.id + '-wrap-' + index,
              index,
              top,
              height: Math.max(part.bottom, part.advance + part.before) + paddingTop,
              paddingTop,
              column: column.index,
              physicalColumnLeft: column.left,
              row: rows,
              wrap: true,
            });
          }
          start = next;
          y += height + (planned.at(-1)?.after || 0);
          first = false;
        }
        if (start >= measured.total) break;
      }
      if (start > frameStart) used = frameIndex + 1;
      fragments.set(frame.id, {
        start: frameStart,
        end: start,
        wrapped: true,
        columns: parts,
        html: parts
          .map(
            (p) =>
              `<div class="flow-column flow-wrap-segment" data-flow-column="${p.id}" ${p.justify ? 'data-wrap-soft="true"' : ''} style="position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px;padding-top:${p.paddingTop}px;box-sizing:border-box;overflow:hidden;overflow-wrap:anywhere">${p.html}</div>`,
          )
          .join(''),
      });
      if (
        start < measured.total &&
        frameIndex + 1 === flow.frameIds.length &&
        flow.automaticPages &&
        allowPages
      ) {
        if (appendTextFlowPage(doc, flow)) changed = true;
      }
    }
    if (allowPages && trimTextFlowPages(doc, flow, Math.max(1, used))) changed = true;
    return {
      fragments,
      changed,
      status: {
        overset: start < measured.total,
        frames: flow.frameIds.length,
        used,
        characters: measured.total,
        additionalFrames: start < measured.total ? 1 : 0,
        wrapped: true,
        rows,
      },
    };
  } finally {
    measured.destroy();
  }
}
