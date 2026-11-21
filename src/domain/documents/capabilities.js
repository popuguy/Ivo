import { attribute } from '../text/html.js';
import { HYPHENATION_ATTRIBUTES } from '../text/hyphenation.js';
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../text/typography.js';

export const CURRENT_ARCHIVE_VERSION = 25;
export const CURRENT_CANVAS_VERSION = 24;
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
  return doc.canvasVersion === 9 || hasAuthoredTextSetting(doc, owns, markup);
}

export function hasMarginGrid(doc) {
  return (
    doc.canvasVersion === 18 ||
    (Array.isArray(doc.pages) && doc.pages.some((page) => page?.topMargin !== undefined)) ||
    doc.publishing?.baselineGrid?.relativeTo === 'margin' ||
    [...(doc.blocks || []), ...(doc.publishing?.parents || []).flatMap((p) => p.blocks || [])].some(
      (b) => b.frameOptions?.baselineGrid?.relativeTo === 'margin',
    )
  );
}

export function hasStylisticSets(doc) {
  const hasSet = (settings) =>
    Object.keys(settings || {}).some((key) => /^stylisticSet(?:[1-9]|1[0-9]|20)$/.test(key));
  return (
    doc.canvasVersion === 21 ||
    hasAuthoredTextSetting(
      doc,
      (settings) => hasSet(settings) || hasSet(settings?.textOverrides),
      (html) => /\bdata-ivo-ss(?:0[1-9]|1[0-9]|20)\s*=/i.test(html || ''),
    )
  );
}

export function hasNextStyle(doc) {
  return (
    doc.canvasVersion === 20 ||
    (doc.publishing?.paragraphStyles || []).some((s) => s?.nextStyle !== undefined)
  );
}

export function hasListNumbering(doc) {
  const counters = (html) =>
    /<(?:ol\b[^>]*?\s(?:start|data-ivo-list-series)|li\b[^>]*?\svalue)\s*=/i.test(html || '');
  return (
    doc.canvasVersion === 19 ||
    hasAuthoredTextSetting(doc, () => false, counters) ||
    (doc.textFlows || []).some((flow) => flow.composition && /<(?:ol|ul)\b/i.test(flow.html || ''))
  );
}

export function hasTabStops(doc) {
  return (
    doc.canvasVersion === 17 ||
    hasAuthoredTextSetting(
      doc,
      (settings) =>
        settings?.tabStops !== undefined || settings?.textOverrides?.tabStops !== undefined,
      (html) => /\bdata-ivo-tabstops\s*=/i.test(html || ''),
    )
  );
}

export function hasFrameGrid(doc) {
  return (
    doc.canvasVersion === 16 ||
    [...(doc.blocks || []), ...(doc.publishing?.parents || []).flatMap((p) => p.blocks || [])].some(
      (b) => b.frameOptions?.baselineGrid !== undefined,
    )
  );
}

export function hasBaselineGrid(doc) {
  return (
    doc.publishing?.baselineGrid !== undefined ||
    hasFrameGrid(doc) ||
    hasAuthoredTextSetting(
      doc,
      (settings) =>
        settings?.baselineAlignment !== undefined ||
        settings?.textOverrides?.baselineAlignment !== undefined,
      (html) => {
        if (!/\bdata-ivo-gridalign\s*=/i.test(html || '')) return false;
        for (const [tag] of html.matchAll(/<[^>]+>/g))
          if (attribute(tag, 'data-ivo-gridalign') !== null) return true;
        return false;
      },
    )
  );
}

export function hasJustification(doc) {
  return (
    doc.canvasVersion === 15 ||
    hasBaselineGrid(doc) ||
    [
      ...(doc.blocks || []),
      ...(doc.publishing?.parents || []).flatMap((parent) => parent.blocks || []),
    ].some(
      ({ frameOptions }) =>
        frameOptions?.verticalAlign === 'justify' ||
        frameOptions?.paragraphSpacingLimit !== undefined,
    ) ||
    hasAuthoredTextSetting(
      doc,
      (settings) =>
        [settings?.wordSpacing, settings?.textOverrides?.wordSpacing].some(
          (value) => typeof value === 'string' && value.includes('|'),
        ),
      (html) => {
        if (!/\bdata-ivo-wordspace\s*=/i.test(html || '')) return false;
        for (const [tag] of html.matchAll(/<[^>]+>/g))
          if (attribute(tag, 'data-ivo-wordspace')?.includes('|')) return true;
        return false;
      },
    )
  );
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
    hasAuthoredTextSetting(doc, owns, (html) =>
      /\bdata-ivo-(?:nextlines|previous)\s*=/i.test(html || ''),
    )
  );
}

export function hasParagraphStarts(doc) {
  return (
    doc.canvasVersion === 11 ||
    hasAuthoredTextSetting(
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
    hasAuthoredTextSetting(
      doc,
      (settings) =>
        settings?.keepBoundaryLines !== undefined ||
        settings?.textOverrides?.keepBoundaryLines !== undefined,
      (html) => /\bdata-ivo-keepedges\s*=/i.test(html || ''),
    )
  );
}

export function hasNoBreak(doc) {
  return (
    doc.canvasVersion === 13 ||
    hasAuthoredTextSetting(
      doc,
      (settings) =>
        settings?.noBreak !== undefined || settings?.textOverrides?.noBreak !== undefined,
      (html) => /\bdata-ivo-nobreak\s*=/i.test(html || ''),
    )
  );
}

const hyphenationMarkup = new RegExp(
  '\\bdata-ivo-(?:' + Object.values(HYPHENATION_ATTRIBUTES).join('|') + ')\\s*=',
  'i',
);
export function hasHyphenationSettings(doc) {
  return (
    doc.canvasVersion === 14 ||
    hasAuthoredTextSetting(
      doc,
      (settings) =>
        Object.keys(HYPHENATION_ATTRIBUTES).some(
          (key) => settings?.[key] !== undefined || settings?.textOverrides?.[key] !== undefined,
        ),
      (html) => hyphenationMarkup.test(html || ''),
    )
  );
}

export function hasNativeTextSettings(doc) {
  return (
    doc.canvasVersion >= 9 ||
    hasStylisticSets(doc) ||
    hasListNumbering(doc) ||
    hasBaselineGrid(doc) ||
    hasTabStops(doc) ||
    hasWordSpacing(doc) ||
    hasExtendedKeeps(doc) ||
    hasParagraphStarts(doc) ||
    hasSplitLineKeeps(doc) ||
    hasNoBreak(doc) ||
    hasHyphenationSettings(doc)
  );
}

function hasAuthoredTextSetting(doc, owns, markup) {
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

const hasPageSections = (doc) =>
  doc.canvasVersion === 24 || doc.pages?.some((p) => p.section !== undefined);
export function archiveVersion(documents, assets = []) {
  if (documents.some(hasPageSections)) return 25;
  if (documents.some((doc) => doc.hyphenationExceptions !== undefined || doc.canvasVersion === 23))
    return 24;
  if (documents.some((doc) => doc.publication !== undefined || doc.canvasVersion === 22)) return 23;
  if (documents.some(hasStylisticSets)) return 22;
  if (documents.some(hasNextStyle)) return 21;
  if (documents.some(hasListNumbering)) return 20;
  if (documents.some(hasMarginGrid)) return 19;
  if (documents.some(hasTabStops)) return 18;
  if (documents.some(hasFrameGrid)) return 17;
  if (documents.some(hasJustification)) return 16;
  if (documents.some(hasHyphenationSettings)) return 15;
  if (documents.some(hasNoBreak)) return 14;
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
  if (hasPageSections(document)) {
    document.canvasVersion = 24;
    return document;
  }
  if (document.hyphenationExceptions !== undefined || document.canvasVersion === 23) {
    document.canvasVersion = 23;
    return document;
  }
  if (document.publication !== undefined || document.canvasVersion === 22) {
    document.canvasVersion = 22;
    return document;
  }
  if (hasStylisticSets(document)) {
    document.canvasVersion = 21;
    return document;
  }
  if (hasNextStyle(document)) {
    document.canvasVersion = 20;
    return document;
  }
  if (hasListNumbering(document)) {
    document.canvasVersion = 19;
    return document;
  }
  if (hasMarginGrid(document)) {
    document.canvasVersion = 18;
    return document;
  }
  if (hasTabStops(document)) {
    document.canvasVersion = 17;
    return document;
  }
  if (hasFrameGrid(document)) {
    document.canvasVersion = 16;
    return document;
  }
  if (hasJustification(document)) {
    document.canvasVersion = 15;
    return document;
  }
  if (hasHyphenationSettings(document)) {
    document.canvasVersion = 14;
    return document;
  }
  if (hasNoBreak(document)) {
    document.canvasVersion = 13;
    return document;
  }
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
