import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../text/typography.js';

export const CURRENT_ARCHIVE_VERSION = 13;
export const CURRENT_CANVAS_VERSION = 12;
/** Canvas 3 used legacy linked frames and is converted to 4 before validation. */
export function supportedCanvas(version, minimum = 1) {
  return (
    Number.isInteger(version) &&
    version !== 3 &&
    version >= minimum &&
    version <= CURRENT_CANVAS_VERSION
  );
}

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
    supportedCanvas(doc.canvasVersion, 5) ||
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
    supportedCanvas(doc.canvasVersion, 6) ||
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

/** Wrap settings are authored layout authority, including disabled/sticky options. */
export function hasTextWrap(doc) {
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [],
    parents = Array.isArray(doc.publishing?.parents) ? doc.publishing.parents : [],
    layers = Array.isArray(doc.publishing?.layers) ? doc.publishing.layers : [];
  return (
    doc.canvasVersion === 8 ||
    doc.extensions?.ivoTextWrapDefaults !== undefined ||
    doc.textWrapPreferences !== undefined ||
    [
      ...blocks,
      ...parents.flatMap((parent) => (Array.isArray(parent?.blocks) ? parent.blocks : [])),
    ].some(
      (block) => block && (block.textWrap !== undefined || block.ignoreTextWrap !== undefined),
    ) ||
    layers.some((layer) => layer?.ignoreWrap !== undefined)
  );
}

/** A stored policy, including an explicit reset, requires a reader that knows it. */
export function hasWordSpacing(doc) {
  const owns = (settings) =>
      settings?.wordSpacing !== undefined || settings?.textOverrides?.wordSpacing !== undefined,
    markup = (html) => /\bdata-ivo-wordspace\s*=/i.test(html || '');
  return doc.canvasVersion === 9 || hasAuthoredParagraphSetting(doc, owns, markup);
}

export function hasExtendedKeeps(doc) {
  const owns = (value) =>
    value &&
    [value, value.textOverrides].some(
      (settings) =>
        settings?.keepNextLines !== undefined || settings?.keepWithPrevious !== undefined,
    );
  return (
    doc.canvasVersion === 10 ||
    hasAuthoredParagraphSetting(doc, owns, (html) =>
      /\bdata-ivo-(?:nextlines|previous)\s*=/i.test(html || ''),
    )
  );
}

export function hasParagraphStarts(doc) {
  return (
    doc.canvasVersion === 11 ||
    hasAuthoredParagraphSetting(
      doc,
      (settings) =>
        settings?.paragraphStart !== undefined ||
        settings?.textOverrides?.paragraphStart !== undefined,
      (html) => /\bdata-ivo-pstart\s*=/i.test(html || ''),
    )
  );
}

export function hasSplitLineKeeps(doc) {
  return (
    doc.canvasVersion === 12 ||
    hasAuthoredParagraphSetting(
      doc,
      (settings) =>
        settings?.keepBoundaryLines !== undefined ||
        settings?.textOverrides?.keepBoundaryLines !== undefined,
      (html) => /\bdata-ivo-keepedges\s*=/i.test(html || ''),
    )
  );
}

export function hasNativeParagraphSettings(doc) {
  return (
    doc.canvasVersion >= 9 ||
    hasWordSpacing(doc) ||
    hasExtendedKeeps(doc) ||
    hasParagraphStarts(doc) ||
    hasSplitLineKeeps(doc)
  );
}

function hasAuthoredParagraphSetting(doc, owns, markup) {
  return (
    [
      ...(doc.blocks || []),
      ...(doc.publishing?.parents || []).flatMap((parent) => parent.blocks || []),
    ].some((block) => owns(block) || markup(block.html)) ||
    (doc.textFlows || []).some((flow) => owns(flow.style) || markup(flow.html)) ||
    [...(doc.publishing?.paragraphStyles || []), ...(doc.publishing?.characterStyles || [])].some(
      (style) => owns(style.attributes),
    )
  );
}

export function archiveVersion(documents, assets = []) {
  if (documents.some(hasSplitLineKeeps)) return 13;
  if (documents.some(hasParagraphStarts)) return 12;
  if (documents.some(hasExtendedKeeps)) return 11;
  if (documents.some(hasWordSpacing)) return 10;
  if (documents.some(hasTextWrap)) return 9;
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
  if (hasSplitLineKeeps(document)) {
    document.canvasVersion = 12;
    return document;
  }
  if (hasParagraphStarts(document)) {
    document.canvasVersion = 11;
    return document;
  }
  if (hasExtendedKeeps(document)) {
    document.canvasVersion = 10;
    return document;
  }
  if (hasWordSpacing(document)) {
    document.canvasVersion = 9;
    return document;
  }
  if (hasTextWrap(document)) {
    document.canvasVersion = 8;
    return document;
  }
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
