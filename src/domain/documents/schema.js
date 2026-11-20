import { baselineGridSettings } from '../text/baseline-grid.js';
import { HYPHENATION_DEFAULTS } from '../text/hyphenation.js';
import { migrateArchive } from './migrations.js';
import { BLOCK_TYPES, ID_PATTERN, LIMITS } from './constants.js';
import { attribute, decodeEntities } from '../text/html.js';
import {
  archiveVersion,
  markTypographyVersion,
  hasPublishingFeatures,
  hasFrameComposition,
  hasNativeTextComposition,
  hasTextWrap,
  hasWordSpacing,
  hasJustification,
  hasExtendedKeeps,
  hasParagraphStarts,
  hasSplitLineKeeps,
  hasNoBreak,
  hasHyphenationSettings,
  CURRENT_ARCHIVE_VERSION,
  supportedCanvas,
} from './capabilities.js';
import {
  normalizeTextWrap,
  normalizeTextWrapDefaults,
  normalizeTextWrapPreferences,
  activeTextWrapPages,
} from './text-wrap.js';
import {
  CHARACTER_FIELDS,
  PARAGRAPH_FIELDS,
  validTextAttribute,
  fontFamilyFor,
  TEXT_ATTRIBUTE_NAMES,
  ALIGNMENTS,
} from '../text/typography.js';
import { resolvedTextStyle } from './publishing.js';
import { inspectFont } from '../text/fonts.js';
import { textWrapObjectPath } from '../geometry/wrap-contour.js';
import { referencedFonts } from '../text/font-references.js';
const _own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function fail(message) {
  throw new TypeError(`Invalid Ivo archive: ${message}`);
}

function record(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(`${label} must be an object`);
  for (const key of Object.keys(value))
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${label} has an unsafe key`);
  return value;
}

function string(value, label, max = 8192, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max)
    fail(`${label} must be a string of at most ${max} characters`);
  return value;
}

function number(value, label, min, max, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(`${label} must be a number between ${min} and ${max}`);
  return value;
}

function revision(value, label) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
  return value;
}

function enumeration(value, label, values, fallback) {
  if (value === undefined) return fallback;
  if (!values.includes(value)) fail(`${label} has an unsupported value`);
  return value;
}

function stringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    fail(`${label} must contain at most 100 strings`);
  return [
    ...new Set(
      value.map((item, index) => string(item, `${label}[${index}]`, 512).trim()).filter(Boolean),
    ),
  ];
}

function timestamp(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value)))
    fail(`${label} must be a timestamp`);
  return new Date(value).toISOString();
}

function position(value, label) {
  if (value === undefined) return { x: 50, y: 50 };
  if (typeof value === 'string') {
    const match = value.match(/^\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/);
    if (!match) fail(`${label} must contain two percentages`);
    return {
      x: number(Number(match[1]), label, 0, 100),
      y: number(Number(match[2]), label, 0, 100),
    };
  }
  record(value, label);
  return {
    x: number(value.x, `${label}.x`, 0, 100, 50),
    y: number(value.y, `${label}.y`, 0, 100, 50),
  };
}

function textScale(value, label) {
  if (value === undefined) return { x: 1, y: 1 };
  record(value, label);
  return {
    x: number(value.x, `${label}.x`, 0.01, 100, 1),
    y: number(value.y, `${label}.y`, 0.01, 100, 1),
  };
}

function extensions(value, label, depth = 0, budget = { count: 0 }) {
  if (depth > 8 || ++budget.count > 2000) fail(`${label} exceeds extension complexity limits`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return string(value, label, 100_000);
  if (typeof value === 'number')
    return number(value, label, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (Array.isArray(value))
    return value.map((item, index) => extensions(item, `${label}[${index}]`, depth + 1, budget));
  record(value, label);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      extensions(item, `${label}.${key}`, depth + 1, budget),
    ]),
  );
}

function checkUrl(value, label, { link = false } = {}) {
  const url = decodeEntities(value).trim();
  if (!url) return;
  // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
  if (/[\u0000-\u001f\u007f]/.test(url)) fail(`${label} contains URL control characters`);
  const scheme = url.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (!scheme) {
    if (url.includes('\\') || url.startsWith('//')) fail(`${label} has an unsafe relative URL`);
    return;
  }
  if (scheme === 'asset') {
    if (!ID_PATTERN.test(url.slice(6))) fail(`${label} has an invalid asset ID`);
    return;
  }
  if (['https', 'http'].includes(scheme) || (link && ['mailto', 'tel'].includes(scheme))) return;
  if (
    scheme === 'data' &&
    /^data:(?:image\/(?:png|jpeg|webp|gif|avif)|application\/pdf);base64,[A-Za-z0-9+/]*={0,2}$/i.test(
      url,
    )
  ) {
    if (url.length > (LIMITS.assetBytes * 4) / 3 + 100)
      fail(`${label} exceeds the asset size limit`);
    return;
  }
  fail(`${label} uses a disallowed URL scheme`);
}

function checkHtml(html, label, assetIds) {
  if (/<\s*\/?\s*(?:script|iframe|object|embed|form|meta|link|style|svg|math)\b/i.test(html))
    fail(`${label} contains active HTML`);
  if (/\s+on[a-z]+\s*=/i.test(html) || /\s+srcdoc\s*=/i.test(html))
    fail(`${label} contains an event handler`);
  if (/\s+srcset\s*=/i.test(html)) fail(`${label} contains an unsupported srcset`);
  for (const tag of html.matchAll(/<[^>]*>/g)) {
    for (const key of ['href', 'src', 'poster', 'action', 'formaction', 'xlink:href']) {
      const value = attribute(tag[0], key);
      if (value !== null) {
        checkUrl(value, `${label}.${key}`, { link: key === 'href' });
        if (/^asset:/i.test(value.trim()) && !assetIds.has(value.trim().slice(6)))
          fail(`${label}.${key} refers to a missing asset`);
      }
    }
    for (const name of TEXT_ATTRIBUTE_NAMES) {
      const raw = attribute(tag[0], 'data-ivo-' + name);
      if (raw !== null && validTextAttribute(name, raw) === null)
        fail(`${label} has an invalid ${name} attribute`);
    }
    const style = attribute(tag[0], 'style');
    if (style && /url\s*\(|expression\s*\(|@import/i.test(decodeEntities(style)))
      fail(`${label} contains active CSS`);
  }
}

function typography(input, out, label) {
  if (input.textOverrides !== undefined) {
    const overrides = record(input.textOverrides, label + '.textOverrides');
    if (overrides.textOverrides || overrides.paragraphStyle || overrides.characterStyle)
      fail(`${label} has invalid style overrides`);
    const normalized = {};
    typography(overrides, normalized, label);
    if (Object.keys(overrides).some((k) => !Object.hasOwn(normalized, k)))
      fail(`${label} has unknown style overrides`);
    out.textOverrides = normalized;
  }

  for (const [key, attr] of Object.entries({ ...CHARACTER_FIELDS, ...PARAGRAPH_FIELDS })) {
    if (input[key] === undefined) continue;
    const valid = validTextAttribute(attr, String(input[key]));
    if (valid === null) fail(`${label}.${key} has an invalid typography value`);
    if (
      Object.hasOwn(HYPHENATION_DEFAULTS, key) &&
      typeof input[key] !== typeof HYPHENATION_DEFAULTS[key]
    )
      fail(`${label}.${key} has an invalid type`);
    if (key === 'keepNextLines' && !Number.isInteger(input[key]))
      fail(`${label}.${key} must be an integer`);
    if (
      ['keepWithPrevious', 'keepBoundaryLines', 'noBreak'].includes(key) &&
      typeof input[key] !== 'boolean'
    )
      fail(`${label}.${key} must be boolean`);
    out[key] =
      typeof input[key] === 'number'
        ? Number(valid)
        : typeof input[key] === 'boolean'
          ? valid === 'true'
          : valid;
  }
}

export function validateImport(payload) {
  return validateArchive(payload, false);
}

function validateArchive(payload, parentTemplate) {
  record(payload, 'archive');
  payload = migrateArchive(payload);
  if (
    !Number.isSafeInteger(payload.schemaVersion) ||
    payload.schemaVersion < 1 ||
    payload.schemaVersion > CURRENT_ARCHIVE_VERSION
  )
    fail('unsupported schema version');
  if (!Array.isArray(payload.documents) || payload.documents.length > LIMITS.documents)
    fail(`documents must contain at most ${LIMITS.documents} entries`);
  if (
    payload.assets !== undefined &&
    (!Array.isArray(payload.assets) || payload.assets.length > LIMITS.assets)
  )
    fail(`assets must contain at most ${LIMITS.assets} entries`);
  const usedIds = new Set();
  const id = (value, label) => {
    if (typeof value !== 'string' || !ID_PATTERN.test(value))
      fail(`${label} is not a valid stable ID`);
    if (usedIds.has(value)) fail(`duplicate ID ${value}`);
    usedIds.add(value);
    return value;
  };
  let totalAssetBytes = 0;
  const assets = (payload.assets ?? []).map((asset, index) => {
    const label = `assets[${index}]`;
    record(asset, label);
    const assetId = id(asset.id, `${label}.id`);
    const data = string(asset.data, `${label}.data`, Math.ceil((LIMITS.assetBytes * 4) / 3) + 100);
    const match = data.match(
      /^data:(image\/(?:jpeg|png|webp|gif|avif)|application\/pdf|font\/(?:ttf|otf));base64,([A-Za-z0-9+/]*={0,2})$/i,
    );
    if (!match || !match[2] || match[2].length % 4 !== 0)
      fail(`${label}.data must be supported base64 image or PDF data`);
    const bytes =
      (match[2].length * 3) / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    totalAssetBytes += bytes;
    if (bytes > LIMITS.assetBytes || totalAssetBytes > LIMITS.totalAssetBytes)
      fail('asset byte limits exceeded');
    const mimeType = string(
      asset.mimeType,
      `${label}.mimeType`,
      100,
      match[1].toLowerCase(),
    ).toLowerCase();
    if (mimeType !== match[1].toLowerCase()) fail(`${label}.mimeType does not match its data`);
    const font = match[1].startsWith('font/')
      ? inspectFont(Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)))
      : null;
    if (font && (payload.schemaVersion < 6 || font.mimeType !== mimeType))
      fail(`${label} requires schema 6 and matching font bytes`);
    return {
      ...(font ? { font } : {}),
      id: assetId,
      data,
      name: string(asset.name, `${label}.name`, 1024, 'Untitled asset'),
      mimeType,
    };
  });
  const assetIds = new Set(assets.map((asset) => asset.id));
  const now = new Date().toISOString();
  let totalBlocks = 0;
  let totalHtml = 0;
  const documents = payload.documents.map((doc, docIndex) => {
    const label = `documents[${docIndex}]`;
    record(doc, label);
    const documentId = id(doc.id, `${label}.id`);
    const paged = doc.canvasVersion !== undefined;
    if (paged && (!supportedCanvas(doc.canvasVersion) || payload.schemaVersion < 2))
      fail(
        `${label} requires page-scene archive schema 2 or later with a supported canvas version`,
      );
    if (paged && doc.canvasVersion === 4 && payload.schemaVersion < 5)
      fail(`${label} requires text flow archive schema 5`);
    if ((doc.publishing || supportedCanvas(doc.canvasVersion, 5)) && payload.schemaVersion < 6)
      fail(`${label} requires publishing archive schema 6`);
    if (doc.publishing && !supportedCanvas(doc.canvasVersion, 5))
      fail(`${label} requires publishing canvas version 5`);
    if (paged && doc.canvasVersion === 6 && payload.schemaVersion < 7)
      fail(`${label} requires frame-composition archive schema 7`);
    if (paged && doc.canvasVersion === 7 && payload.schemaVersion < 8)
      fail(`${label} requires native-text-composition archive schema 8`);
    if (
      hasJustification(doc) &&
      (!supportedCanvas(doc.canvasVersion, 15) || payload.schemaVersion < 16)
    )
      fail('Advanced justification and baseline grid settings require canvas 15 and archive 16');
    if (
      hasHyphenationSettings(doc) &&
      (!supportedCanvas(doc.canvasVersion, 14) || payload.schemaVersion < 15)
    )
      fail('Paragraph hyphenation settings require canvas 14 and archive 15');
    if (hasNoBreak(doc) && (!supportedCanvas(doc.canvasVersion, 13) || payload.schemaVersion < 14))
      fail(`${label} requires No Break archive 14 / canvas 13`);
    if (
      hasSplitLineKeeps(doc) &&
      (!supportedCanvas(doc.canvasVersion, 12) || payload.schemaVersion < 13)
    )
      fail(`${label} requires split paragraph archive 13 / canvas 12`);
    if (
      hasParagraphStarts(doc) &&
      (!supportedCanvas(doc.canvasVersion, 11) || payload.schemaVersion < 12)
    )
      fail(`${label} requires paragraph start archive 12 / canvas 11`);
    if (
      hasExtendedKeeps(doc) &&
      (!supportedCanvas(doc.canvasVersion, 10) || payload.schemaVersion < 11)
    )
      fail(`${label} requires paragraph keep archive 11 / canvas 10`);
    if (
      hasWordSpacing(doc) &&
      (!supportedCanvas(doc.canvasVersion, 9) || payload.schemaVersion < 10)
    )
      fail(`${label} word spacing requires archive 10 / canvas 9`);
    if (paged && doc.canvasVersion === 8 && payload.schemaVersion < 9)
      fail(`${label} requires text-wrap archive schema 9`);
    if (hasTextWrap(doc) && (!supportedCanvas(doc.canvasVersion, 8) || payload.schemaVersion < 9))
      fail(`${label} text wrap requires archive 9 / canvas 8`);
    if (paged && doc.canvasVersion === 2 && payload.schemaVersion < 3)
      fail(`${label} requires typography archive schema 3`);
    if (!paged && doc.pages !== undefined) fail(`${label}.pages requires a canvas version`);
    let pages;
    if (paged) {
      if (!Array.isArray(doc.pages) || !doc.pages.length || doc.pages.length > 128)
        fail(`${label}.pages must contain 1 to 128 pages`);
      pages = doc.pages.map((page, index) => {
        const key = `${label}.pages[${index}]`;
        record(page, key);
        return {
          id: id(page.id, `${key}.id`),
          name: string(page.name, `${key}.name`, 180, `Page ${index + 1}`),
          width: number(page.width, `${key}.width`, 72, 14400),
          height: number(page.height, `${key}.height`, 72, 14400),
        };
      });
    }
    const pageIds = new Set((pages || []).map((page) => page.id));
    const layout = doc.layout === undefined ? {} : record(doc.layout, `${label}.layout`);
    if (layout.columns !== undefined && layout.columns !== 12)
      fail(`${label}.layout.columns must be 12`);
    const rows = number(layout.rows, `${label}.layout.rows`, 20, 100, 38);
    if (!Number.isInteger(rows)) fail(`${label}.layout.rows must be an integer`);
    if (
      !Array.isArray(doc.blocks) ||
      doc.blocks.length > LIMITS.blocksPerDocument ||
      (totalBlocks += doc.blocks.length) > LIMITS.blocks
    )
      fail(`${label}.blocks exceeds block limits`);
    const blocks = doc.blocks.map((block, blockIndex) => {
      const key = `${label}.blocks[${blockIndex}]`;
      record(block, key);
      const blockId = id(block.id, `${key}.id`);
      if (!BLOCK_TYPES.has(block.type) || (!paged && block.type === 'polygon'))
        fail(`${key}.type is unsupported`);
      const x = number(block.x, `${key}.x`, paged ? -100000 : 0, paged ? 100000 : 12, 0);
      const y = number(block.y, `${key}.y`, paged ? -100000 : 0, paged ? 100000 : 100, 0);
      const w = number(block.w, `${key}.w`, paged ? 0.01 : 0.1, paged ? 100000 : 12, 6);
      const h = number(block.h, `${key}.h`, paged ? 0.01 : 0.1, paged ? 100000 : 100, 5);
      if (!paged && (x + w > 12 + 1e-8 || y + h > rows + 1e-8))
        fail(`${key} exceeds its document layout`);
      const html = string(block.html, `${key}.html`, LIMITS.html);
      totalHtml += html.length;
      if (totalHtml > 20_000_000) fail('total HTML exceeds 20 million characters');
      checkHtml(html, `${key}.html`, assetIds);
      const src = string(block.src, `${key}.src`, Math.ceil((LIMITS.assetBytes * 4) / 3) + 100)
        .trim()
        .replace(/^asset:/i, 'asset:');
      checkUrl(src, `${key}.src`);
      if (src.startsWith('asset:') && !assetIds.has(src.slice(6)))
        fail(`${key}.src refers to a missing asset`);
      if (/^data:/i.test(src)) {
        totalAssetBytes += (src.length * 3) / 4;
        if (totalAssetBytes > LIMITS.totalAssetBytes) fail('asset byte limits exceeded');
      }
      const normalized = {
        id: blockId,
        type: block.type,
        x,
        y,
        w,
        h,
        html,
        src,
        caption: string(block.caption, `${key}.caption`),
        alt: string(block.alt, `${key}.alt`),
        fit: enumeration(block.fit, `${key}.fit`, ['cover', 'contain'], 'cover'),
        textStyle: enumeration(
          block.textStyle,
          `${key}.textStyle`,
          fontFamilyFor(block.textStyle)
            ? [block.textStyle]
            : ['serif', 'sans', 'cmu-serif', 'display'],
          'serif',
        ),
        fontSize: number(block.fontSize, `${key}.fontSize`, paged ? 1 : 10, paged ? 2000 : 120, 16),
        align: enumeration(block.align, `${key}.align`, ALIGNMENTS, 'left'),
        crop: position(block.crop, `${key}.crop`),
        objectPosition: position(block.objectPosition ?? block.crop, `${key}.objectPosition`),
      };
      if (['text', 'quote'].includes(block.type)) {
        typography(block, normalized, key);
        normalized.textKind = enumeration(
          block.textKind,
          `${key}.textKind`,
          ['area', 'point'],
          'area',
        );
        normalized.textScale = textScale(block.textScale, `${key}.textScale`);
        for (const [name, min, max] of [
          ['leading', 0, 4000],
          ['tracking', -1000, 10000],
          ['paragraphBefore', 0, 2000],
          ['paragraphAfter', 0, 2000],
        ])
          if (block[name] !== undefined)
            normalized[name] = number(block[name], `${key}.${name}`, min, max);
        if (block.textColor !== undefined) {
          if (!/^#[0-9a-f]{6}$/i.test(block.textColor))
            fail(`${key}.textColor must be a hex color`);
          normalized.textColor = block.textColor.toLowerCase();
        }
      }
      if (paged) {
        if (!pageIds.has(block.pageId)) fail(`${key}.pageId is unknown`);
        normalized.pageId = block.pageId;
        if (supportedCanvas(doc.canvasVersion, 5)) {
          if (block.layerId !== undefined)
            normalized.layerId = string(block.layerId, `${key}.layerId`, 120);
          if (block.parentOriginId !== undefined)
            normalized.parentOriginId = string(block.parentOriginId, `${key}.parentOriginId`, 120);
          if (block.name !== undefined) normalized.name = string(block.name, `${key}.name`, 180);
          for (const flag of ['hidden', 'locked'])
            if (block[flag] !== undefined) {
              if (typeof block[flag] !== 'boolean') fail(`${key}.${flag} must be boolean`);
              normalized[flag] = block[flag];
            }
          if (block.opacity !== undefined)
            normalized.opacity = number(block.opacity, `${key}.opacity`, 0, 100);
          if (block.rotation !== undefined)
            normalized.rotation = number(block.rotation, `${key}.rotation`, -36000, 36000);
          if (block.textWrap !== undefined) {
            try {
              normalized.textWrap = normalizeTextWrap(record(block.textWrap, `${key}.textWrap`));
            } catch (error) {
              fail(`${key}.textWrap: ${error.message}`);
            }
          }
          if (block.ignoreTextWrap !== undefined) {
            if (
              !['text', 'quote'].includes(block.type) ||
              typeof block.ignoreTextWrap !== 'boolean'
            )
              fail(`${key}.ignoreTextWrap requires a text frame and a boolean`);
            normalized.ignoreTextWrap = block.ignoreTextWrap;
          }
          if (block.frameOptions !== undefined) {
            const f = record(block.frameOptions, `${key}.frameOptions`);
            normalized.frameOptions = {};
            for (const [name, min, max, fallback] of [
              ['columns', 1, 40, 1],
              ['gutter', 0, 2000, 12],
              ['insetTop', 0, 2000, 0],
              ['insetRight', 0, 2000, 0],
              ['insetBottom', 0, 2000, 0],
              ['insetLeft', 0, 2000, 0],
              ['corner', 0, 2000, 0],
            ])
              normalized.frameOptions[name] = number(
                f[name],
                `${key}.frameOptions.${name}`,
                min,
                max,
                fallback,
              );
            if (!Number.isInteger(normalized.frameOptions.columns))
              fail(`${key} requires a whole column count`);
            normalized.frameOptions.verticalAlign = enumeration(
              f.verticalAlign,
              key,
              ['top', 'center', 'bottom', 'justify'],
              'top',
            );
            if (f.paragraphSpacingLimit !== undefined)
              normalized.frameOptions.paragraphSpacingLimit = number(
                f.paragraphSpacingLimit,
                key,
                0,
                2000,
                0,
              );
            if (normalized.frameOptions.verticalAlign === 'justify' && !block.textFlowId)
              fail(`${key} vertical Justify requires a native text flow`);
            if (f.firstBaseline !== undefined || f.minimumFirstBaseline !== undefined) {
              if (!supportedCanvas(doc.canvasVersion, 6) || payload.schemaVersion < 7)
                fail(`${key} first-baseline policies require archive 7 / canvas 6`);
              normalized.frameOptions.firstBaseline = enumeration(
                f.firstBaseline,
                key,
                ['ascent', 'cap-height', 'x-height', 'leading', 'fixed'],
                'ascent',
              );
              normalized.frameOptions.minimumFirstBaseline = number(
                f.minimumFirstBaseline,
                key,
                0,
                2000,
                0,
              );
            }
            normalized.frameOptions.fill = string(f.fill, key, 7, 'none');
            normalized.frameOptions.stroke = string(f.stroke, key, 7, 'none');
            for (const name of ['fill', 'stroke'])
              if (!/^(?:none|#[0-9a-f]{6})$/i.test(normalized.frameOptions[name]))
                fail(`${key} has invalid frame paint`);
            normalized.frameOptions.strokeWidth = number(f.strokeWidth, key, 0, 100, 0);
          }
        } else if (
          block.layerId !== undefined ||
          block.frameOptions !== undefined ||
          block.hidden !== undefined ||
          block.locked !== undefined
        )
          fail(`${key} requires publishing canvas version 5`);
        if (block.textFlowId !== undefined) {
          if (
            !supportedCanvas(doc.canvasVersion, 4) ||
            typeof block.textFlowId !== 'string' ||
            !ID_PATTERN.test(block.textFlowId) ||
            !['text', 'quote'].includes(block.type) ||
            html
          )
            fail(`${key} has an invalid text flow reference or duplicate source`);
          normalized.textFlowId = block.textFlowId;
        }
        if (block.parentId !== undefined) {
          if (typeof block.parentId !== 'string' || !ID_PATTERN.test(block.parentId))
            fail(`${key}.parentId is invalid`);
          normalized.parentId = block.parentId;
        }
        if (block.type === 'polygon') {
          if (!Array.isArray(block.points) || block.points.length < 3 || block.points.length > 256)
            fail(`${key}.points requires 3 to 256 vertices`);
          normalized.points = block.points.map((point, index) => {
            const item = `${key}.points[${index}]`;
            record(point, item);
            return {
              id: id(point.id, `${item}.id`),
              x: number(point.x, `${item}.x`, 0, 1),
              y: number(point.y, `${item}.y`, 0, 1),
            };
          });
          const color = (value, name, fallback) => {
            value = value ?? fallback;
            if (value !== 'none' && !/^#[0-9a-f]{6}$/i.test(value))
              fail(`${key}.${name} must be a hex color or none`);
            return value;
          };
          normalized.fill = color(block.fill, 'fill', '#e6e8eb');
          normalized.stroke = color(block.stroke, 'stroke', '#626872');
          normalized.strokeWidth = number(block.strokeWidth, `${key}.strokeWidth`, 0, 100, 1);
          if (block.clip !== undefined && typeof block.clip !== 'boolean')
            fail(`${key}.clip must be boolean`);
          normalized.clip = !!block.clip;
        }
      }
      if (normalized.textWrap) {
        try {
          textWrapObjectPath(normalized, normalized.textWrap);
        } catch (error) {
          fail(`${key}.textWrap: ${error.message}`);
        }
      }
      if (block.extensions !== undefined)
        normalized.extensions = extensions(block.extensions, `${key}.extensions`);
      return normalized;
    });
    const normalized = {
      id: documentId,
      title: string(doc.title, `${label}.title`, 1024, 'Untitled'),
      kicker: string(doc.kicker, `${label}.kicker`, 512),
      subtitle: string(doc.subtitle, `${label}.subtitle`),
      tags: stringList(doc.tags, `${label}.tags`),
      aliases: stringList(doc.aliases, `${label}.aliases`),
      blocks,
      createdAt: timestamp(doc.createdAt, `${label}.createdAt`, now),
      updatedAt: timestamp(doc.updatedAt, `${label}.updatedAt`, now),
      layout: { columns: 12, rows },
      version: revision(doc.version, `${label}.version`),
      template: string(doc.template, `${label}.template`, 100, 'blank'),
    };
    if (doc.textWrapPreferences !== undefined) {
      try {
        normalized.textWrapPreferences = normalizeTextWrapPreferences(
          record(doc.textWrapPreferences, `${label}.textWrapPreferences`),
        );
      } catch (error) {
        fail(`${label}.textWrapPreferences: ${error.message}`);
      }
    }
    if (doc.publishing !== undefined) {
      const p = record(doc.publishing, `${label}.publishing`);
      if (p.version !== 1) fail(`${label} has an unsupported publishing version`);
      if (!Array.isArray(p.layers) || !p.layers.length || p.layers.length > 128)
        fail(`${label} requires 1 to 128 layers`);
      const layers = p.layers.map((layer, i) => {
        record(layer, label);
        if (
          typeof layer.visible !== 'boolean' ||
          typeof layer.locked !== 'boolean' ||
          !/^#[0-9a-f]{6}$/i.test(layer.color)
        )
          fail(`${label} has invalid layer flags or color`);
        if (layer.ignoreWrap !== undefined && typeof layer.ignoreWrap !== 'boolean')
          fail(`${label} layer.ignoreWrap must be boolean`);
        return {
          id: id(layer.id, `${label}.layers[${i}]`),
          name: string(layer.name, label, 120),
          color: layer.color,
          visible: layer.visible,
          locked: layer.locked,
          ...(layer.ignoreWrap !== undefined ? { ignoreWrap: layer.ignoreWrap } : {}),
        };
      });
      const layerIds = new Set(layers.map((l) => l.id));
      if (blocks.some((b) => b.layerId && !layerIds.has(b.layerId)))
        fail(`${label} refers to an unknown layer`);
      const styleList = (kind) => {
        const values = p[kind];
        if (!Array.isArray(values) || values.length > 256)
          fail(`${label} has invalid style definitions`);
        return values.map((value) => {
          record(value, label);
          const attributes = {};
          typography(record(value.attributes, label), attributes, label);
          if (
            Object.keys(value.attributes).some((k) => !Object.hasOwn(attributes, k)) ||
            attributes.characterStyle ||
            attributes.paragraphStyle
          )
            fail(`${label} has invalid style attributes`);
          return {
            id: id(value.id, label),
            name: string(value.name, label, 120),
            basedOn: value.basedOn === null ? null : string(value.basedOn, label, 120),
            attributes,
          };
        });
      };
      normalized.publishing = {
        version: 1,
        layers,
        ...(p.baselineGrid === undefined
          ? {}
          : { baselineGrid: baselineGridSettings(p.baselineGrid) }),
        paragraphStyles: styleList('paragraphStyles'),
        characterStyles: styleList('characterStyles'),
        parents: [],
      };
      for (const kind of ['paragraph', 'character'])
        for (const style of normalized.publishing[kind + 'Styles'])
          resolvedTextStyle(normalized, kind, style.id);
      if (!Array.isArray(p.parents) || p.parents.length > 26)
        fail(`${label} has invalid parent definitions`);
      normalized.publishing.parents = p.parents.map((parent) => {
        record(parent, label);
        const parentId = id(parent.id, label),
          width = number(parent.width, label, 72, 14400),
          height = number(parent.height, label, 72, 14400);
        if (
          !Array.isArray(parent.blocks) ||
          parent.blocks.length > 1000 ||
          parent.blocks.some((b) => b.textFlowId)
        )
          fail(`${label} has invalid parent objects`);
        totalBlocks += parent.blocks.length;
        if (
          totalBlocks > LIMITS.blocks ||
          blocks.length + p.parents.reduce((n, v) => n + v.blocks.length, 0) >
            LIMITS.blocksPerDocument
        )
          fail(`${label} exceeds the combined page and parent object limit`);
        totalHtml += parent.blocks.reduce((n, b) => n + (b.html || '').length, 0);
        if (totalHtml > 20000000) fail('total HTML exceeds 20 million characters');
        const parentDoc = validateArchive(
          {
            schemaVersion: payload.schemaVersion,
            assets,
            documents: [
              {
                id: parentId,
                canvasVersion: doc.canvasVersion,
                publishing: { ...normalized.publishing, parents: [] },
                pages: [{ id: parentId + '-page', width, height }],
                blocks: parent.blocks.map((b) => ({ ...b, pageId: parentId + '-page' })),
              },
            ],
          },
          true,
        ).documents[0];
        const result = parentDoc.blocks.map((b) => {
          id(b.id, label);
          for (const v of b.points || []) id(v.id, label);
          if (b.layerId && !layerIds.has(b.layerId)) fail(`${label} has unknown parent layer`);
          const { pageId, ...rest } = b;
          return rest;
        });
        return {
          id: parentId,
          name: string(parent.name, label, 120),
          prefix: string(parent.prefix, label, 8),
          width,
          height,
          blocks: result,
        };
      });
      for (let i = 0; i < pages.length; i++)
        if (doc.pages[i].parentPageId !== undefined) {
          const parent = normalized.publishing.parents.find(
            (p) => p.id === doc.pages[i].parentPageId,
          );
          if (!parent) fail(`${label} has an unknown page parent`);
          pages[i].parentPageId = parent.id;
          if (doc.pages[i].parentOverrides !== undefined) {
            if (
              !Array.isArray(doc.pages[i].parentOverrides) ||
              doc.pages[i].parentOverrides.length > 1000
            )
              fail(`${label} has invalid parent overrides`);
            const overrides = [
              ...new Set(doc.pages[i].parentOverrides.map((value) => string(value, label, 120))),
            ];
            if (overrides.some((id) => !parent.blocks.some((b) => b.id === id)))
              fail(`${label} has invalid parent overrides`);
            pages[i].parentOverrides = overrides;
          }
        }
    }
    if (paged) {
      normalized.canvasVersion = doc.canvasVersion;
      normalized.pages = pages;
      markTypographyVersion(normalized);
      const objects = new Map(blocks.map((object) => [object.id, object]));
      for (const object of blocks) {
        let node = object,
          visited = new Set([object.id]);
        while (node.parentId) {
          const parent = objects.get(node.parentId);
          if (
            !parent ||
            parent.pageId !== object.pageId ||
            parent.type !== 'polygon' ||
            !parent.clip
          )
            fail(`${label} contains an invalid clipping parent`);
          if (visited.has(parent.id) || visited.size > 16)
            fail(`${label} contains a cyclic or too-deep clipping tree`);
          visited.add(parent.id);
          node = parent;
        }
      }
      if (doc.legacyLayout !== undefined) {
        const old = record(doc.legacyLayout, `${label}.legacyLayout`);
        normalized.legacyLayout = {
          columns: 12,
          rows: number(old.rows, `${label}.legacyLayout.rows`, 20, 100),
          referenceWidth: number(
            old.referenceWidth,
            `${label}.legacyLayout.referenceWidth`,
            72,
            14400,
          ),
        };
      }
    }
    if (doc.textFlows !== undefined) {
      if (
        !supportedCanvas(doc.canvasVersion, 4) ||
        payload.schemaVersion < 5 ||
        !Array.isArray(doc.textFlows) ||
        doc.textFlows.length > 1000
      )
        fail(`${label} has unsupported text flows`);
      const frameOwners = new Set(),
        generatedOwners = new Set(),
        objects = new Map(blocks.map((block) => [block.id, block]));
      normalized.textFlows = doc.textFlows.map((textFlow, index) => {
        const key = `${label}.textFlows[${index}]`;
        record(textFlow, key);
        let composition;
        if (textFlow.composition !== undefined) {
          if (payload.schemaVersion < 8 || !supportedCanvas(doc.canvasVersion, 7))
            fail(`${key} native composition requires archive 8 / canvas 7`);
          const value = record(textFlow.composition, `${key}.composition`);
          if (
            value.version !== 1 ||
            Object.keys(value).some((field) => !['version', 'composer'].includes(field))
          )
            fail(`${key} has an unsupported native composition version or field`);
          composition = {
            version: 1,
            composer: enumeration(value.composer, `${key}.composition.composer`, [
              'paragraph',
              'single-line',
            ]),
          };
          if (!composition.composer) fail(`${key} requires an explicit composer`);
        }
        const textFlowId = id(textFlow.id, `${key}.id`),
          html = string(textFlow.html, `${key}.html`, LIMITS.html);
        totalHtml += html.length;
        if (totalHtml > 20_000_000) fail('total HTML exceeds 20 million characters');
        checkHtml(html, `${key}.html`, assetIds);
        if (
          !Array.isArray(textFlow.frameIds) ||
          !textFlow.frameIds.length ||
          textFlow.frameIds.length > 1000
        )
          fail(`${key} requires text frames`);
        const frameIds = textFlow.frameIds.map((frameId) => {
          const frame = objects.get(frameId);
          if (
            !frame ||
            frame.textFlowId !== textFlowId ||
            frameOwners.has(frameId) ||
            frame.textKind !== 'area'
          )
            fail(`${key} has invalid, duplicate or shared frames`);
          if (frame.frameOptions?.verticalAlign === 'justify' && !composition)
            fail(`${key} vertical Justify requires a native text flow`);
          frameOwners.add(frameId);
          return frameId;
        });
        const input = record(textFlow.style, `${key}.style`),
          style = {
            textStyle: enumeration(
              input.textStyle,
              `${key}.textStyle`,
              fontFamilyFor(input.textStyle)
                ? [input.textStyle]
                : ['serif', 'sans', 'cmu-serif', 'display'],
              'serif',
            ),
            fontSize: number(input.fontSize, `${key}.fontSize`, 1, 2000, 16),
            align: enumeration(input.align, `${key}.align`, ALIGNMENTS, 'left'),
          };
        for (const [name, min, max] of [
          ['leading', 0, 4000],
          ['tracking', -1000, 10000],
          ['paragraphBefore', 0, 2000],
          ['paragraphAfter', 0, 2000],
        ])
          if (input[name] !== undefined)
            style[name] = number(input[name], `${key}.${name}`, min, max);
        typography(input, style, key);
        if (input.textColor !== undefined) {
          if (!/^#[0-9a-f]{6}$/i.test(input.textColor)) fail(`${key} has invalid color`);
          style.textColor = input.textColor;
        }
        if (
          typeof textFlow.automaticPages !== 'boolean' ||
          typeof textFlow.deleteEmptyPages !== 'boolean'
        )
          fail(`${key} requires explicit page policies`);
        if (!Array.isArray(textFlow.autoPages) || textFlow.autoPages.length > 128)
          fail(`${key} has invalid generated pages`);
        const ownedPages = new Set();
        const autoPages = textFlow.autoPages.map((value) => {
          record(value, key);
          if (
            !pageIds.has(value.pageId) ||
            ownedPages.has(value.pageId) ||
            generatedOwners.has(value.pageId) ||
            !frameIds.includes(value.frameId) ||
            objects.get(value.frameId).pageId !== value.pageId
          )
            fail(`${key} has invalid generated-page ownership`);
          ownedPages.add(value.pageId);
          generatedOwners.add(value.pageId);
          return { pageId: value.pageId, frameId: value.frameId };
        });
        return {
          id: textFlowId,
          html,
          frameIds,
          style,
          automaticPages: textFlow.automaticPages,
          deleteEmptyPages: textFlow.deleteEmptyPages,
          autoPages,
          ...(composition ? { composition } : {}),
        };
      });
      for (const frame of blocks)
        if (frame.textFlowId && !frameOwners.has(frame.id))
          fail(`${label} contains an orphan text frame`);
    } else if (blocks.some((frame) => frame.textFlowId))
      fail(`${label} requires canonical document text sources`);
    for (const holder of [...blocks, ...(normalized.textFlows || []).map((f) => f.style)])
      for (const kind of ['paragraph', 'character'])
        if (holder[kind + 'Style']) resolvedTextStyle(normalized, kind, holder[kind + 'Style']);
    for (const font of referencedFonts(normalized))
      if (!assets.some((a) => a.id === font && a.font))
        fail(`${label} refers to a missing vault font`);
    for (const source of [...blocks, ...(normalized.textFlows || [])])
      for (const tag of (source.html || '').matchAll(/<[^>]+>/g))
        for (const [attr, kind] of [
          ['pstyle', 'paragraph'],
          ['cstyle', 'character'],
        ]) {
          const styleId = attribute(tag[0], 'data-ivo-' + attr);
          if (styleId && styleId !== 'none') resolvedTextStyle(normalized, kind, styleId);
        }
    if (
      hasPublishingFeatures(doc) &&
      (payload.schemaVersion < 6 || !supportedCanvas(doc.canvasVersion, 5))
    )
      fail(`${label} requires archive 6 / canvas 5 for publishing features`);
    if (
      hasFrameComposition(doc) &&
      (payload.schemaVersion < 7 || !supportedCanvas(doc.canvasVersion, 6))
    )
      fail(`${label} requires archive 7 / canvas 6 for frame composition`);
    if (
      hasNativeTextComposition(doc) &&
      (payload.schemaVersion < 8 || !supportedCanvas(doc.canvasVersion, 7))
    )
      fail(`${label} requires archive 8 / canvas 7 for native text composition`);
    if (doc.extensions !== undefined)
      normalized.extensions = extensions(doc.extensions, `${label}.extensions`);
    if (normalized.extensions?.ivoTextWrapDefaults !== undefined) {
      try {
        normalized.extensions.ivoTextWrapDefaults = normalizeTextWrapDefaults(
          normalized.extensions.ivoTextWrapDefaults,
        );
      } catch (error) {
        fail(`${label}.extensions.ivoTextWrapDefaults: ${error.message}`);
      }
    }
    if (!parentTemplate && hasTextWrap(normalized)) {
      const wrappedPages = activeTextWrapPages(normalized);
      if (
        normalized.blocks.some(
          (block) =>
            wrappedPages.has(block.pageId) &&
            ['text', 'quote'].includes(block.type) &&
            block.textKind !== 'point' &&
            !block.textFlowId,
        )
      )
        fail(`${label} active text-wrap pages require canonical text flows for area frames`);
    }
    return normalized;
  });
  return {
    schemaVersion: Math.max(payload.schemaVersion, archiveVersion(documents)),
    documents,
    assets,
  };
}
