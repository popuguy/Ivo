import { textWrapObstacles } from '../../domain/geometry/text-wrap.js';
import { UnsupportedComposition } from './composition-source.js';
import { hasNondefaultNativeCharacter } from '../../domain/text/native-character-style.js';

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

/** Until row metrics can settle across fragments, reject unsupported edits synchronously. */
export function validateNativeWrapping(source, columns) {
  if (!columns.some((column) => column.obstacles?.length)) return;
  if (source.runs.some(hasNondefaultNativeCharacter))
    throw new UnsupportedComposition('advanced character shaping in native wrapped paragraphs');
  if (columns.some((column) => column.obstacles?.length && column.verticalAlign !== 'top'))
    throw new UnsupportedComposition('native wrapping with vertically aligned exclusion columns');
  for (const paragraph of source.paragraphs) {
    if (source.text.slice(paragraph.start, paragraph.end).includes('\t'))
      throw new UnsupportedComposition('native wrapping with tab characters');
    if (['center', 'justify-center'].includes(paragraph.align))
      throw new UnsupportedComposition(
        'centered native wrapping before its reference policy is qualified',
      );
    const runs = source.runs.filter(
        (run) => run.start < paragraph.end && run.end > paragraph.start,
      ),
      metrics = (run) =>
        JSON.stringify([
          run.font,
          run.size,
          run.leading,
          run.autoLeading,
          run.baselineShift || 0,
          run.verticalScale ?? 100,
        ]);
    if (runs.some((run) => metrics(run) !== metrics(runs[0])))
      throw new UnsupportedComposition(
        'native wrapping with mixed font metrics within a paragraph',
      );
  }
}
