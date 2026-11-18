export const CURRENT_ARCHIVE_VERSION = 8;
export const CURRENT_CANVAS_VERSION = 7;
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
    [5, 6, 7].includes(doc.canvasVersion) ||
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

/** First-baseline policies require an explicit format gate; older readers reject archive 7. */
export function hasFrameComposition(doc) {
  return (
    [6, 7].includes(doc.canvasVersion) ||
    [...doc.blocks, ...(doc.publishing?.parents || []).flatMap((p) => p.blocks)].some(
      (b) =>
        b.frameOptions?.firstBaseline !== undefined ||
        b.frameOptions?.minimumFirstBaseline !== undefined,
    )
  );
}

/** Native line decisions are authored opt-in data, not a read-time migration. */
export function hasNativeTextComposition(doc) {
  return (
    doc.canvasVersion === 7 || (doc.textFlows || []).some((flow) => flow.composition !== undefined)
  );
}

export function archiveVersion(documents, assets = []) {
  if (documents.some(hasNativeTextComposition)) return 8;
  if (documents.some(hasFrameComposition)) return 7;
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
  if (hasNativeTextComposition(document)) {
    document.canvasVersion = 7;
    return document;
  }
  if (hasFrameComposition(document)) {
    document.canvasVersion = 6;
    return document;
  }
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
