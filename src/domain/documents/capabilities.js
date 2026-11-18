export const CURRENT_ARCHIVE_VERSION = 6;
export const CURRENT_CANVAS_VERSION = 5;
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../text/typography.js';
const oldFields = new Set([
  'textStyle',
  'fontSize',
  'align',
  'leading',
  'tracking',
  'textColor',
  'paragraphBefore',
  'paragraphAfter',
  'bold',
  'italic',
  'underline',
]);
const newFields = Object.keys({ ...CHARACTER_FIELDS, ...PARAGRAPH_FIELDS }).filter(
  (key) => !oldFields.has(key),
);
const newAttrs = new RegExp(
  'data-ivo-(?:' +
    newFields.map((key) => CHARACTER_FIELDS[key] || PARAGRAPH_FIELDS[key]).join('|') +
    ')=',
);
export function hasPublishingFeatures(doc) {
  return (
    !!doc.publishing ||
    doc.canvasVersion === 5 ||
    doc.blocks.some(
      (b) =>
        b.frameOptions ||
        b.layerId ||
        b.hidden !== undefined ||
        b.locked !== undefined ||
        b.opacity !== undefined ||
        b.rotation !== undefined ||
        b.name !== undefined ||
        /^(font-|geist$)/.test(b.textStyle || '') ||
        newFields.some((key) => b[key] !== undefined) ||
        newAttrs.test(b.html || '') ||
        /data-ivo-font\s*=\s*["'](?:geist|font-[a-f0-9]{64})["']/.test(b.html || ''),
    ) ||
    (doc.textFlows || []).some(
      (f) =>
        newAttrs.test(f.html) ||
        /data-ivo-font\s*=\s*["'](?:geist|font-[a-f0-9]{64})["']/.test(f.html) ||
        newFields.some((key) => f.style[key] !== undefined) ||
        /^(font-|geist$)/.test(f.style.textStyle || ''),
    )
  );
}

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

export function archiveVersion(documents, assets = []) {
  if (assets.some((asset) => asset.font || asset.mimeType?.startsWith('font/'))) return 6;
  if (documents.some(hasPublishingFeatures)) return 6;
  return documents.some((doc) => doc.canvasVersion === 4 || doc.textFlows?.length)
    ? 5
    : documents.some((doc) => doc.canvasVersion === 2 || hasAdvancedTypography(doc))
      ? 3
      : documents.some((doc) => doc.canvasVersion === 1)
        ? 2
        : 1;
}

export function markTypographyVersion(document) {
  if (hasPublishingFeatures(document)) {
    document.canvasVersion = 5;
    return document;
  }
  if (document.textFlows?.length) {
    document.canvasVersion = 4;
    return document;
  }
  if (document.canvasVersion === 1 && hasAdvancedTypography(document)) document.canvasVersion = 2;
  return document;
}
