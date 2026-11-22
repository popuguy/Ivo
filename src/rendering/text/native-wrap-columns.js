import { textWrapObstacles } from '../../domain/geometry/text-wrap.js';
import { UnsupportedComposition } from './composition-source.js';

const wrappedLayouts = new WeakMap();

/** Disposable exclusion geometry uses the same unscaled coordinate system as native columns. */
export function nativeWrapColumns(document, columns, session, imageContours) {
  // Typing changes a flow's source independently of the scene that excludes ink.
  // Keep one bounded set per editor. The exact key includes parent art, layer
  // order, masking, stacking, physical columns and every object property.
  const key =
    session &&
    JSON.stringify([
      imageContours?.signature,
      columns,
      document.blocks,
      document.pages,
      document.publishing?.parents,
      document.publishing?.layers,
      document.textWrapPreferences,
    ]);
  const previous = session && wrappedLayouts.get(session);
  if (previous && previous.key === key)
    return columns.map((column, i) => ({ ...column, obstacles: previous.obstacles[i] }));

  const frames = new Map(document.blocks.map((block) => [block.id, block]));
  const result = columns.map((column) => ({
    ...column,
    obstacles: textWrapObstacles(document, frames.get(column.frameId), {
      column,
      imageContours,
    }).filter(
      ({ bounds, invert }) =>
        invert ||
        (bounds.right > 0 &&
          bounds.left < column.width &&
          bounds.bottom > 0 &&
          bounds.top < column.height),
    ),
  }));
  if (session) {
    const obstacles = result.map((column) => column.obstacles);
    let vertices = 0;
    for (const column of obstacles)
      for (const obstacle of column)
        for (const polygon of obstacle.polygons) vertices += polygon.length;
    if (key.length <= 524288 && vertices <= 16384) wrappedLayouts.set(session, { key, obstacles });
    else wrappedLayouts.delete(session);
  }
  return result;
}

/** Character transforms move ink and carets within the composed fragments.
 * Inverse shapes still require the entire glyph band to fit inside the path. */
export function validateNativeWrapping(source, columns) {
  if (!columns.some((column) => column.obstacles?.length)) return;
  if (
    columns.some(
      (column) => column.obstacles?.length && column.grid && column.verticalAlign === 'justify',
    )
  )
    throw new UnsupportedComposition(
      'baseline grids with vertical Justify in a column with wrapping objects',
    );
  if (
    columns.some((column) => column.obstacles?.some((obstacle) => obstacle.invert)) &&
    source.runs.some((run) => (run.baselineShift ?? 0) !== 0 || (run.verticalScale ?? 100) !== 100)
  )
    throw new UnsupportedComposition(
      'shifted or vertically scaled ink inside an inverted wrap contour',
    );
  for (const paragraph of source.paragraphs) {
    if (source.text.slice(paragraph.start, paragraph.end).includes('\t'))
      throw new UnsupportedComposition('native wrapping with tab characters');
  }
}
