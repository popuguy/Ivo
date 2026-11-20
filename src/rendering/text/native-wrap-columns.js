import { textWrapObstacles } from '../../domain/geometry/text-wrap.js';
import { UnsupportedComposition } from './composition-source.js';

/** Disposable exclusion geometry uses the same unscaled coordinate system as native columns. */
export function nativeWrapColumns(document, columns) {
  const frames = new Map(document.blocks.map((block) => [block.id, block]));
  return columns.map((column) => ({
    ...column,
    obstacles: textWrapObstacles(document, frames.get(column.frameId), { column }).filter(
      ({ bounds, invert }) =>
        invert ||
        (bounds.right > 0 &&
          bounds.left < column.width &&
          bounds.bottom > 0 &&
          bounds.top < column.height),
    ),
  }));
}

/** Box and Next Column use the ordinary line band. Character transforms move
 * the ink and carets inside the resulting fragments. */
export function validateNativeWrapping(source, columns) {
  if (!columns.some((column) => column.obstacles?.length)) return;
  if (
    columns.some((column) =>
      column.obstacles?.some(
        (obstacle) => obstacle.mode !== 'bounds' && obstacle.mode !== 'next-column',
      ),
    ) &&
    source.runs.some((run) => (run.baselineShift ?? 0) !== 0 || (run.verticalScale ?? 100) !== 100)
  )
    throw new UnsupportedComposition(
      'shifted or vertically scaled ink with Shape or Jump Object text wrap',
    );
  if (columns.some((column) => column.obstacles?.length && column.verticalAlign !== 'top'))
    throw new UnsupportedComposition('native wrapping with vertically aligned exclusion columns');
  for (const paragraph of source.paragraphs) {
    if (source.text.slice(paragraph.start, paragraph.end).includes('\t'))
      throw new UnsupportedComposition('native wrapping with tab characters');
  }
}
