export const CURRENT_ARCHIVE_VERSION = 5;
export const CURRENT_CANVAS_VERSION = 4;
export function hasAdvancedTypography(document) {
  return document.blocks.some(
    (block) =>
      ['leading', 'tracking', 'textColor', 'paragraphBefore', 'paragraphAfter'].some(
        (key) => block[key] !== undefined,
      ) ||
      /\bdata-ivo-(?:font|size|leading|tracking|color|bold|italic|underline|align|before|after)=/i.test(
        block.html || '',
      ),
  );
}

export function archiveVersion(documents) {
  return documents.some(
    (doc) => doc.canvasVersion === CURRENT_CANVAS_VERSION || doc.textFlows?.length,
  )
    ? CURRENT_ARCHIVE_VERSION
    : documents.some((doc) => doc.canvasVersion === 2 || hasAdvancedTypography(doc))
      ? 3
      : documents.some((doc) => doc.canvasVersion === 1)
        ? 2
        : 1;
}

export function markTypographyVersion(document) {
  if (document.textFlows?.length) {
    document.canvasVersion = CURRENT_CANVAS_VERSION;
    return document;
  }
  if (document.canvasVersion === 1 && hasAdvancedTypography(document)) document.canvasVersion = 2;
  return document;
}
