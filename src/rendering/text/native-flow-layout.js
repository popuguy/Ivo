import { hasAuthoredBreakCharacters } from '../../domain/text/paragraph-breaks.js';
import { compositionSource, UnsupportedComposition } from './composition-source.js';
import { composedSVG } from './composed-svg.js';
import { createParagraphComposer, validateParagraphSource } from './paragraph-composition.js';
import { fontVariantAsset, regularFace } from '../../domain/text/font-catalog.js';
import { shippedTextFontURL, SHIPPED_TEXT_FONT_METADATA } from './font-resources.js';
import {
  nativeCharacterStyle,
  nativeCharacterFeatureAdmission,
} from '../../domain/text/native-character-style.js';
import { inspectFont } from '../../domain/text/fonts.js';
import { TEXT_DEFAULTS } from '../../domain/text/typography.js';
import { effectiveTextStyle } from '../../domain/documents/publishing.js';
import { appendTextFlowPage, trimTextFlowPages } from '../../domain/documents/text-flows.js';
import { escapeHTML } from '../../shared/html/sanitize.js';
import { documentHasObjectWrap } from './object-wrap-layout.js';
import { nativeWrapColumns, validateNativeWrapping } from './native-wrap-columns.js';
import { PARAGRAPH_LAYOUT_FIELDS, paragraphLineArea } from '../../domain/text/paragraph-layout.js';
import {
  DEFAULT_WORD_SPACING,
  wordSpacingValue,
  wordSpacingSettings,
  wordSpacingSourceError,
} from '../../domain/text/word-spacing.js';
import { validateWordSpacingResult } from './word-spacing-result.js';
import {
  PARAGRAPH_KEEP_FIELDS,
  normalizeParagraphKeeps,
} from '../../domain/text/paragraph-keep-policy.js';

const sessions = new WeakMap(),
  requestSessions = new WeakMap(),
  paragraphSessions = new WeakMap(),
  shipped = new Map(),
  assetResources = new WeakMap(),
  resourceMetadata = new WeakMap(),
  MAX_COLUMNS = 128;
const sha = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

// Conservative cost for LRU eviction. Serializing thousands of glyph/caret
// records here would perform a second full transport on the input thread.
function geometrySize(result) {
  let bytes = 2048;
  for (const vector of result.vectors || [])
    bytes += 128 + 2 * (vector.id.length + vector.pathD.length);
  for (const line of result.layout.lines) {
    bytes += 1024 + (line.carets?.length || 0) * 384;
    for (const run of line.runs || []) {
      bytes += 512;
      for (const glyph of run.glyphs) bytes += 512 + 64 * (glyph.sourceRanges?.length || 0);
    }
  }
  return bytes;
}
/** A small per-port LRU survives immutable document snapshots without retaining font bytes. */
function composeRequest(compose, request, wordSpacingPlan) {
  let cache = requestSessions.get(compose);
  if (!cache) requestSessions.set(compose, (cache = { entries: new Map(), bytes: 0 }));
  const key = JSON.stringify({
      ...request,
      resources: request.resources.map(({ data: _data, ...identity }) => identity),
    }),
    prior = cache.entries.get(key);
  if (prior) {
    cache.entries.delete(key);
    cache.entries.set(key, prior);
    return prior.promise;
  }
  const entry = { cost: key.length * 2, promise: null };
  cache.entries.set(key, entry);
  cache.bytes += entry.cost;
  const trim = () => {
    while (cache.entries.size > 16 || cache.bytes > 16000000) {
      const oldest = cache.entries.entries().next().value;
      if (!oldest) break;
      cache.entries.delete(oldest[0]);
      cache.bytes -= oldest[1].cost;
    }
  };
  trim();
  entry.promise = Promise.resolve()
    .then(() => compose(request))
    .then((result) => {
      validateResult(result, request);
      if (request.protocol === 5) validateWordSpacingResult(result, request, wordSpacingPlan);
      if (cache.entries.get(key) === entry) {
        const cost = geometrySize(result);
        entry.cost += cost;
        cache.bytes += cost;
        trim();
      }
      return result;
    })
    .catch((error) => {
      if (cache.entries.get(key) === entry) {
        cache.entries.delete(key);
        cache.bytes -= entry.cost;
      }
      throw error;
    });
  return entry.promise;
}
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
async function resource(bytes, id, expectedDigest, expectedPostscript) {
  const digest = await sha(bytes),
    metadata = inspectFont(bytes);
  if (
    (expectedDigest && digest !== expectedDigest) ||
    (expectedPostscript && metadata.postscript !== expectedPostscript)
  )
    throw Error('The vault font bytes do not match their immutable identity.');
  const value = { id, digest, postscript: metadata.postscript, data: base64(bytes) };
  resourceMetadata.set(value, {
    digest,
    postscript: metadata.postscript,
    features: metadata.features,
  });
  return value;
}
function shippedResource(variant) {
  if (!shipped.has(variant)) {
    const pending = (async () => {
      const response = await fetch(shippedTextFontURL('cmu-' + variant));
      if (!response.ok) throw Error('The bundled CMU Serif font could not be loaded.');
      return resource(new Uint8Array(await response.arrayBuffer()), 'cmu-' + variant);
    })();
    shipped.set(variant, pending);
    pending.catch(() => {
      if (shipped.get(variant) === pending) shipped.delete(variant);
    });
  }
  return shipped.get(variant);
}
function assetResource(asset) {
  const prior = assetResources.get(asset);
  if (prior?.data === asset.data) return prior.promise;
  const promise = (async () => {
    if (
      !/^font-[a-f0-9]{64}$/.test(asset.id) ||
      typeof asset.data !== 'string' ||
      !/^data:font\/(?:ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(asset.data)
    )
      throw Error('The selected font has no portable vault bytes.');
    const bytes = Uint8Array.from(atob(asset.data.slice(asset.data.indexOf(',') + 1)), (c) =>
      c.charCodeAt(0),
    );
    return resource(bytes, asset.id, asset.id.slice(5), asset.font.postscript);
  })();
  assetResources.set(asset, { data: asset.data, promise });
  promise.then(
    (value) => {
      const entry = assetResources.get(asset);
      if (entry?.promise === promise) entry.metadata = resourceMetadata.get(value);
    },
    () => {},
  );
  promise.catch(() => {
    if (assetResources.get(asset)?.promise === promise) assetResources.delete(asset);
  });
  return promise;
}
function fontResolver(assets) {
  const fonts = assets.filter((a) => a.font && a.mimeType?.startsWith('font/')),
    selected = new Map();
  const fontFor = (style) => {
    if (style.textStyle === 'cmu-serif') {
      const variant = style.bold
          ? style.italic
            ? 'bold-italic'
            : 'bold'
          : style.italic
            ? 'italic'
            : 'regular',
        id = 'cmu-' + variant;
      selected.set(id, () => shippedResource(variant));
      return id;
    }
    const legacy = { serif: 'Georgia', sans: 'Helvetica Neue', display: 'Helvetica Neue' },
      familyName = legacy[style.textStyle],
      family = fonts.filter((a) => a.font.family === familyName),
      alias =
        fonts.find((a) => a.id === style.textStyle) ||
        (familyName &&
          regularFace(
            family.map((a) => ({
              ...a,
              family: a.font.family,
              postscript: a.font.postscript,
              weight: a.font.weight,
              italic: a.font.italic,
            })),
            familyName,
          )),
      candidates = alias ? fonts.filter((a) => a.font.family === alias.font.family) : [],
      asset = fontVariantAsset(alias, candidates, style);
    // Variable default coordinates must never silently stand in for requested bold.
    if (!asset || (asset.font.axes?.length && (style.bold || style.fontVariations !== 'normal')))
      throw new UnsupportedComposition('the exact portable selected font face');
    selected.set(asset.id, () => assetResource(asset));
    return asset.id;
  };
  const featureLabels = {
    dlig: 'discretionary ligatures',
    smcp: 'small capitals',
    onum: 'oldstyle figures',
    tnum: 'tabular figures',
    zero: 'slashed zero',
    frac: 'fractions',
    ordn: 'ordinals',
    salt: 'stylistic alternates',
  };
  return {
    fontFor,
    resources: () => Promise.all([...selected.values()].map((load) => load())),
    validateFeatures(source, { resources = [], deferUnavailable = false } = {}) {
      const verified = new Map(resources.map((value) => [value.id, resourceMetadata.get(value)]));
      for (const run of source.runs) {
        const asset = fonts.find((value) => value.id === run.font),
          expected =
            SHIPPED_TEXT_FONT_METADATA[run.font] ||
            (asset && { digest: asset.id.slice(5), postscript: asset.font.postscript }),
          metadata =
            verified.get(run.font) ||
            SHIPPED_TEXT_FONT_METADATA[run.font] ||
            (assetResources.get(asset)?.data === asset?.data
              ? assetResources.get(asset)?.metadata
              : null) ||
            (asset && { ...asset.font, digest: asset.id.slice(5) }),
          admission = nativeCharacterFeatureAdmission(run, metadata, expected);
        if (
          admission.status === 'available' ||
          (deferUnavailable && admission.status === 'unavailable')
        )
          continue;
        if (admission.status === 'missing')
          throw Error(
            (asset?.font.family || 'This CMU Serif face') +
              ' does not include ' +
              admission.missing.map((tag) => featureLabels[tag] || tag).join(', ') +
              '.',
          );
        throw Error(
          'Font feature information is unavailable. Reimport this font to use these options.',
        );
      }
    },
  };
}

/** Unscaled, inset column slots; physical frame geometry and authored source remain unchanged. */
export function nativeFlowColumns(doc, flow) {
  const result = [];
  const pageNumbers = new Map(doc.pages.map((page, index) => [page.id, index + 1]));
  for (const frameId of flow.frameIds) {
    const frame = doc.blocks.find((b) => b.id === frameId);
    if (!frame || frame.textFlowId !== flow.id)
      throw Error('The native text flow has a missing frame.');
    const f = frame.frameOptions || {},
      sx = frame.textScale?.x ?? 1,
      sy = frame.textScale?.y ?? 1,
      count = f.columns ?? 1,
      gutter = f.gutter ?? 12,
      width =
        (frame.w - (f.insetLeft || 0) - (f.insetRight || 0) - (count - 1) * gutter) / count / sx,
      height = (frame.h - (f.insetTop || 0) - (f.insetBottom || 0)) / sy;
    if (
      ![sx, sy, width, height].every((n) => Number.isFinite(n) && n > 0) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 20 ||
      width < 1 ||
      height < 1 ||
      width > 14400 ||
      height > 14400
    )
      throw Error('Frame insets, columns or text scaling leave an invalid native text area.');
    if (f.verticalAlign && !['top', 'center', 'bottom'].includes(f.verticalAlign))
      throw new UnsupportedComposition('justified vertical frame alignment');
    for (let i = 0; i < count; i++) {
      const id = frame.id + '-column-' + i;
      if (id.length > 120) throw Error('The native text column identity exceeds its bounds.');
      result.push({
        id,
        frameId,
        pageId: frame.pageId,
        pageNumber: pageNumbers.get(frame.pageId),
        textScale: frame.textScale || { x: 1, y: 1 },
        index: i,
        left: ((f.insetLeft || 0) + i * (width * sx + gutter)) / sx,
        top: (f.insetTop || 0) / sy,
        width,
        height,
        ...(f.firstBaseline ? { firstBaseline: f.firstBaseline } : {}),
        minimumFirstBaseline: (f.minimumFirstBaseline || 0) / sy,
        verticalAlign: f.verticalAlign || 'top',
      });
    }
  }
  if (!result.length || result.length > MAX_COLUMNS)
    throw new UnsupportedComposition('more than 128 native text columns');
  return result;
}
const transportFrames = (columns) =>
  columns.map(({ id, width, height, firstBaseline, minimumFirstBaseline, verticalAlign }) => ({
    id,
    width,
    height,
    ...(firstBaseline ? { firstBaseline } : {}),
    minimumFirstBaseline,
    verticalAlign,
  }));
function compositionColumns(doc, flow) {
  const columns = nativeFlowColumns(doc, flow);
  return documentHasObjectWrap(doc) ? nativeWrapColumns(doc, columns) : columns;
}

/** Canonical boundary before a native character, including virtual marks only once. */
export function nativeSourceBoundary(source, index) {
  if (index === source.text.length) return source.logicalLength;
  let found = Infinity;
  for (const span of source.spans) {
    if (span.start <= index && span.end >= index) {
      const point =
        span.end === span.start
          ? span.logicalStart
          : span.end - span.start === span.logicalEnd - span.logicalStart
            ? span.logicalStart + index - span.start
            : index === span.end
              ? span.logicalEnd
              : span.logicalStart;
      found = Math.min(found, point);
    }
  }
  if (!Number.isFinite(found)) throw Error('Native layout lost a canonical source boundary.');
  return found;
}
async function decideParagraph(request, columns, compose, mode, paragraphKeeps, noBreakRanges) {
  let composer = paragraphSessions.get(compose);
  if (!composer) {
    // Measurements have their own validated paragraph cache. Keeping raw batch
    // responses in the full-result cache would duplicate memory and poison a
    // same-source retry after a malformed batch.
    composer = createParagraphComposer(compose);
    paragraphSessions.set(compose, composer);
  }
  return composer.compose(request, columns, { mode, paragraphKeeps, noBreakRanges });
}

const flowKeeps = (source) =>
  source.paragraphs.map((paragraph) =>
    Object.fromEntries(PARAGRAPH_KEEP_FIELDS.map((key) => [key, paragraph[key]])),
  );
const hasKeeps = (source) =>
  source.paragraphs.some(
    (paragraph) =>
      paragraph.keepTogether ||
      paragraph.keepBoundaryLines ||
      paragraph.keepWithNext ||
      paragraph.keepWithPrevious ||
      (paragraph.paragraphStart && paragraph.paragraphStart !== 'anywhere'),
  );
function validateResult(result, request) {
  if (
    result?.protocol !== request.protocol ||
    result?.sourceDigest !== request.sourceDigest ||
    !Array.isArray(result.layout?.lines) ||
    !Number.isSafeInteger(result.layout.coveredLength) ||
    result.layout.coveredLength < 0 ||
    result.layout.coveredLength > request.text.length ||
    result.layout.textLength !== request.text.length
  )
    throw Error('The native text result does not match its source.');
  const frames = new Map(request.frames.map((f) => [f.id, f]));
  const automaticEnds = new Set(request.hyphenationPoints || []);
  let end = 0;
  for (const [lineIndex, line] of result.layout.lines.entries()) {
    if (
      !frames.has(line.frame) ||
      line.start !== end ||
      !Number.isSafeInteger(line.end) ||
      line.end <= end ||
      line.end > request.text.length
    )
      throw Error('Native text lines lost their ordered source or frame identity.');
    if (automaticEnds.size) {
      const generated = line.runs.flatMap((run) => run.glyphs.filter((glyph) => glyph.generated));
      if (
        generated.length !== (automaticEnds.has(line.end) ? 1 : 0) ||
        generated.some(
          (glyph) =>
            glyph.index !== line.end ||
            glyph.end !== line.end ||
            !Array.isArray(glyph.sourceRanges) ||
            glyph.sourceRanges.length !== 0 ||
            !(glyph.advance[0] > 0) ||
            !glyph.vector,
        )
      )
        throw Error('Generated hyphen ink does not match its source boundary.');
    }
    if (request.protocol >= 4) {
      const validInk = (value) =>
        [value.inkAscent, value.inkDescent].every(
          (n) => Number.isFinite(n) && Math.abs(n) <= 1000000,
        ) && value.inkAscent + value.inkDescent >= 0;
      if (
        !validInk(line) ||
        !Array.isArray(line.runs) ||
        line.runs.some(
          (run) =>
            !validInk(run) ||
            !Number.isFinite(run.baselineShift) ||
            Math.abs(run.baselineShift) > 2000 ||
            ![run.horizontalScale, run.verticalScale].every(
              (n) => Number.isFinite(n) && n >= 10 && n <= 1000,
            ),
        )
      )
        throw Error('Native character ink geometry is incomplete or invalid.');
    }
    if (request.protocol >= 2) {
      const paragraph = request.paragraphs.find((p) => p.start <= line.start && p.end > line.start),
        placement = request.placements?.[line.placementIndex],
        area =
          placement ||
          paragraphLineArea(
            paragraph,
            frames.get(line.frame).width,
            line.start === paragraph.start,
          );
      if (
        !Number.isFinite(line.originX) ||
        Math.abs(line.originX) > 100000 ||
        line.paragraphStart !== paragraph.start ||
        line.paragraphEnd !== paragraph.end ||
        line.end > paragraph.end ||
        !Number.isFinite(line.availableWidth) ||
        Math.abs(line.availableWidth - area.width) > 0.000001
      )
        throw Error('Native paragraph geometry disagrees with its authored layout.');
      if (
        request.placements &&
        (line.placementIndex !== lineIndex ||
          !placement ||
          placement.end !== line.end ||
          request.frames[placement.frame]?.id !== line.frame ||
          Math.abs(placement.baseline - line.baseline) > 0.000001)
      )
        throw Error('Native text did not retain the owned frame placement plan.');
    }
    end = line.end;
  }
  if (end !== result.layout.coveredLength)
    throw Error('Native text coverage disagrees with its lines.');
  if (request.placements) {
    const visible = request.placements.filter((line) => line.frame < request.frames.length);
    if (visible.length !== result.layout.lines.length || end !== (visible.at(-1)?.end ?? 0))
      throw Error('Native text did not retain the complete visible frame placement plan.');
  }
}
function fragmentsFor(source, result, columns, flow, fragments, prefix) {
  let nativeEnd = 0,
    logicalEnd = 0,
    used = 0;
  for (const [frameIndex, id] of flow.frameIds.entries()) {
    const parts = columns
      .filter((c) => c.frameId === id)
      .map((column) => {
        const lines = result.layout.lines.filter((line) => line.frame === column.id),
          start = logicalEnd,
          nativeStart = nativeEnd,
          paint = {};
        if (lines.length) nativeEnd = lines.at(-1).end;
        logicalEnd = nativeSourceBoundary(source, nativeEnd);
        return {
          ...column,
          start,
          end: logicalEnd,
          paint,
          html: composedSVG(result, column, {
            paint,
            text: source.text,
            styles: source.runs,
            links: source.links,
            label: source.text.slice(nativeStart, nativeEnd) || 'Empty text frame',
            idPrefix: prefix + '-' + frameIndex + '-' + column.index,
          }),
          native: { lines, spans: source.spans, text: source.text },
        };
      });
    if (parts.some((p) => p.native.lines.length)) used = frameIndex + 1;
    fragments.set(id, {
      native: true,
      start: parts[0].start,
      end: parts.at(-1).end,
      columns: parts,
      html: parts
        .map(
          (p) =>
            `<div class="flow-column" data-flow-column="${escapeHTML(p.id)}" style="position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px;overflow:hidden">${p.html}</div>`,
        )
        .join(''),
    });
  }
  return used;
}
function semanticKey(doc, allowPages) {
  return JSON.stringify([
    allowPages,
    doc.textFlows,
    doc.blocks
      .filter((b) => b.textFlowId)
      .map((b) => [b.id, b.textFlowId, b.pageId, b.w, b.h, b.textScale, b.frameOptions]),
    doc.pages,
    doc.publishing?.paragraphStyles,
    doc.publishing?.characterStyles,
    documentHasObjectWrap(doc)
      ? [doc.blocks, doc.publishing?.parents, doc.publishing?.layers, doc.textWrapPreferences]
      : null,
  ]);
}
const assetSignature = (assets) =>
  assets.filter((a) => a.font).flatMap((a) => [a.id, a.data, JSON.stringify(a.font)]);
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

function selectParagraphPlan(required, source) {
  if (!required && !hasAuthoredBreakCharacters(source.text)) return false;
  try {
    validateParagraphSource(source.text, source.noBreakRanges, source.hyphenationPoints);
    return true;
  } catch (error) {
    // Keep the existing native single-line route when an incidental pasted
    // character would otherwise exceed the bounded paragraph search.
    if (required || !(error instanceof UnsupportedComposition)) throw error;
    return false;
  }
}

function projectNativeFlow(doc, flow, fonts, { deferUnavailable = false } = {}) {
  const root = document.createElement('div');
  root.innerHTML = flow.html;
  const effective = effectiveTextStyle(doc, flow.style),
    settings = Object.fromEntries(
      Object.keys(TEXT_DEFAULTS)
        .filter((key) => effective[key] !== undefined)
        .map((key) => [key, effective[key]]),
    );
  const source = compositionSource(root, {
    id: flow.id,
    doc,
    settings,
    fontFor: fonts.fontFor,
    authoredHTML: flow.html,
  });
  const columns = compositionColumns(doc, flow),
    wrapped = columns.some((column) => column.obstacles?.length),
    required =
      flow.composition?.composer === 'paragraph' ||
      wrapped ||
      source.paragraphs.some((p) => p.hyphenate) ||
      hasKeeps(source) ||
      source.noBreakRanges?.length ||
      source.protocol === 5,
    limit = required ? 10000 : 100000;
  if (
    source.text.length > limit ||
    source.spans.length > 30000 ||
    source.runs.length > 10000 ||
    source.paragraphs.length > 10000 ||
    new Set(source.runs.map((run) => run.font)).size > 16
  )
    throw new UnsupportedComposition("text beyond this preview composer's source/font budget");
  const planned = selectParagraphPlan(required, source);
  normalizeParagraphKeeps(flowKeeps(source), source.paragraphs.length);
  if (source.runs.some((run) => !['metrics', 'none'].includes(run.kerning)))
    throw new UnsupportedComposition('optical kerning');
  for (const paragraph of source.paragraphs) {
    const content = source.text.slice(paragraph.start, paragraph.end);
    const specialJustification =
      planned &&
      !paragraph.wordSpacing &&
      paragraph.align?.startsWith('justify') &&
      /[\u00a0\u202f]/u.test(content) &&
      !wrapped &&
      !wordSpacingSourceError(content) &&
      !source.runs.some(
        (run) => run.start < paragraph.end && run.end > paragraph.start && run.tracking < 0,
      );
    // A disposable projection gives default justified hard spaces the same
    // spacing authority as an authored policy without adding a document mark.
    if (specialJustification) {
      paragraph.wordSpacing = wordSpacingValue(DEFAULT_WORD_SPACING);
      source.protocol = 5;
    }
    if (wordSpacingSettings(paragraph.wordSpacing)) {
      if (wrapped) throw new UnsupportedComposition('word spacing with wrapped fragments');
      const issue = wordSpacingSourceError(source.text.slice(paragraph.start, paragraph.end));
      if (issue) throw new UnsupportedComposition(issue);
      if (
        source.runs.some(
          (run) => run.start < paragraph.end && run.end > paragraph.start && run.tracking < 0,
        )
      )
        throw new UnsupportedComposition('word spacing with negative tracking');
    }
    const fits = (column) => {
      try {
        paragraphLineArea(paragraph, column.width, true);
        paragraphLineArea(paragraph, column.width);
        return true;
      } catch {
        return false;
      }
    };
    if (planned) {
      if (!columns.some(fits)) throw Error('Paragraph indents leave no valid frame width.');
    } else
      for (const column of columns) {
        paragraphLineArea(paragraph, column.width, true);
        paragraphLineArea(paragraph, column.width);
      }
    if (
      source.text.slice(paragraph.start, paragraph.end).includes('\t') &&
      !['left', 'start'].includes(paragraph.align)
    )
      throw new UnsupportedComposition('tabs combined with non-left paragraph alignment');
  }
  validateNativeWrapping(source, columns);
  fonts.validateFeatures(source, { deferUnavailable });
  return { source, columns, wrapped, planned };
}

/** Synchronous source/exact-face gate; no font bytes, fetches or native requests. */
export function validateNativeFlowSource(doc, flow, assets = []) {
  return projectNativeFlow(doc, flow, fontResolver(assets)).source;
}

/**
 * Exact native composition for explicitly opted-in flows. The injected byte-only
 * port is the sole native dependency; source and existing authored objects stay owned by doc.
 * Only helper-owned continuation pages/frames are appended or trimmed, after all flows succeed.
 */
export async function composeNativeTextFlows(
  doc,
  { compose, allowPages = true, assets = [] } = {},
) {
  if (typeof compose !== 'function') throw Error('A native text composition port is required.');
  const key = semanticKey(doc, allowPages),
    signature = assetSignature(assets),
    prior = sessions.get(doc);
  if (prior?.key === key && prior.compose === compose && same(prior.assets, signature))
    return {
      fragments: new Map(prior.fragments),
      status: new Map(prior.status),
      compositions: prior.compositions,
      changed: false,
    };
  const projection = {
      ...doc,
      pages: [...doc.pages],
      blocks: [...doc.blocks],
      textFlows: (doc.textFlows || []).map((flow) => ({
        ...flow,
        frameIds: [...flow.frameIds],
        autoPages: [...(flow.autoPages || [])],
      })),
    },
    fragments = new Map(),
    status = new Map(),
    byFlow = new Map(),
    queue = projection.textFlows.filter((flow) => flow.composition);
  let changed = false,
    passes = 0;
  for (let i = 0; i < queue.length; i++) {
    const flow = queue[i];
    if (
      flow.composition.version !== 1 ||
      !['paragraph', 'single-line'].includes(flow.composition.composer)
    )
      throw new UnsupportedComposition('the selected composition version or composer');
    const fonts = fontResolver(assets),
      {
        source,
        columns: initial,
        wrapped,
        planned,
      } = projectNativeFlow(projection, flow, fonts, { deferUnavailable: true });
    const resources = await fonts.resources();
    fonts.validateFeatures(source, { resources });
    // Whitelist transport fields. Editorial paragraph/link metadata stays in the renderer.
    const request = {
        protocol: source.protocol >= 4 ? source.protocol : planned ? 3 : source.protocol,
        id: source.id,
        sourceHTML: source.sourceHTML,
        sourceDigest: await sha(new TextEncoder().encode(source.sourceHTML)),
        logicalLength: source.logicalLength,
        text: source.text,
        spans: source.spans,
        ...(source.hyphenationPoints ? { hyphenationPoints: source.hyphenationPoints } : {}),
        runs: source.runs.map(
          ({
            start,
            end,
            font,
            size,
            leading,
            autoLeading,
            tracking,
            kerning,
            ligatures,
            textColor,
            ...character
          }) => ({
            start,
            end,
            font,
            size,
            leading,
            autoLeading,
            tracking,
            kerning,
            ligatures,
            textColor,
            ...nativeCharacterStyle(character),
          }),
        ),
        paragraphs: source.paragraphs.map(({ start, end, ...metadata }) => ({
          start,
          end,
          ...Object.fromEntries(PARAGRAPH_LAYOUT_FIELDS.map((key) => [key, metadata[key]])),
          ...(wordSpacingSettings(metadata.wordSpacing)
            ? { wordSpacing: wordSpacingSettings(metadata.wordSpacing) }
            : {}),
        })),
        resources,
        allowFallback: false,
        includeVectors: true,
      },
      decision = planned
        ? await decideParagraph(
            { ...request, frames: transportFrames(initial) },
            initial,
            compose,
            flow.composition.composer,
            flowKeeps(source),
            source.noBreakRanges,
          )
        : null;
    let result, columns;
    for (let attempt = 0; attempt <= 128; attempt++) {
      columns = compositionColumns(projection, flow);
      const input = {
        ...request,
        frames: transportFrames(columns),
        mode: decision?.placements
          ? 'planned-lines-proof'
          : decision
            ? 'explicit-lines-proof'
            : 'greedy-geometry-proof',
        ...(decision?.placements
          ? {
              placements: decision.placements,
              ...(decision.oversetStart === undefined
                ? {}
                : { oversetStart: decision.oversetStart }),
            }
          : decision
            ? { breaks: decision.breaks }
            : {}),
      };
      result = await composeRequest(compose, input, decision?.wordSpacingPlan);
      validateResult(result, input);
      if (result.layout.coveredLength === source.text.length || !allowPages || !flow.automaticPages)
        break;
      if (
        decision?.oversetStart !== undefined &&
        !decision.placements.some((line) => line.frame >= columns.length)
      )
        break;
      if (
        attempt === 128 ||
        columns.length +
          (projection.blocks.find((b) => b.id === flow.frameIds.at(-1)).frameOptions?.columns ||
            1) >
          MAX_COLUMNS
      )
        break;
      // A frame that cannot place even one source line cannot be repaired by cloning itself.
      if (!(
        decision?.placements.some((line) => line.frame >= columns.length) ||
        result.layout.lines.some((line) => line.frame === columns.at(-1).id)
      ))
        break;
      if (!appendTextFlowPage(projection, flow)) break;
      changed = true;
    }
    // Outline IDs already include immutable face/size/transform identity.
    const prefix = 'ivo-' + (await sha(new TextEncoder().encode(flow.id))).slice(0, 24),
      used = fragmentsFor(source, result, columns, flow, fragments, prefix),
      overset = result.layout.coveredLength < source.text.length;
    if (allowPages && trimTextFlowPages(projection, flow, Math.max(1, used))) {
      changed = true;
      for (const id of [...fragments.keys()])
        if (!projection.blocks.some((b) => b.id === id)) fragments.delete(id);
    }
    status.set(flow.id, {
      overset,
      frames: flow.frameIds.length,
      used,
      characters: source.logicalLength,
      additionalFrames: overset ? 1 : 0,
      composer: flow.composition.composer,
      policy: decision?.policy || 'native-single-line',
      ...(wrapped ? { wrapped: true } : {}),
      ...(decision ? { paragraphWork: decision.work } : {}),
      ...(decision?.wordSpacingDiagnostics?.length
        ? {
            wordSpacingDiagnostics: decision.wordSpacingDiagnostics.map((diagnostic) => ({
              ...diagnostic,
              future: diagnostic.frame >= columns.length,
            })),
          }
        : {}),
      ...(decision?.keepViolations?.length
        ? {
            keepViolations: decision.keepViolations.map((violation) => ({
              ...violation,
              future: violation.frame >= columns.length,
            })),
          }
        : {}),
      token: result.token,
      diagnostics: result.diagnostics || [],
    });
    byFlow.set(flow, {
      token: result.token,
      result,
      source,
      frames: columns.filter((c) => flow.frameIds.includes(c.frameId)),
    });
    // A different thread can insert or remove pages before one already fitted.
    // Refit only sections whose physical frames changed parity before publishing.
    if (changed && i + 1 === queue.length) {
      const pageNumbers = new Map(projection.pages.map((page, n) => [page.id, n + 1]));
      for (const [thread, placement] of byFlow) {
        if (
          placement.source.paragraphs.some(
            (p) => p.paragraphStart === 'odd' || p.paragraphStart === 'even',
          ) &&
          placement.frames.some((c) => c.pageNumber % 2 !== pageNumbers.get(c.pageId) % 2)
        )
          queue.push(thread);
      }
      if (++passes > MAX_COLUMNS)
        throw new UnsupportedComposition(
          'interdependent page starts exceeded the pagination limit',
        );
    }
  }
  const compositions = [...byFlow.values()];
  if (changed) {
    doc.pages = projection.pages;
    doc.blocks = projection.blocks;
    for (const flow of projection.textFlows) {
      const authored = doc.textFlows.find((f) => f.id === flow.id);
      if (authored.composition) {
        authored.frameIds = flow.frameIds;
        authored.autoPages = flow.autoPages;
      }
    }
  }
  sessions.set(doc, {
    key: semanticKey(doc, allowPages),
    assets: signature,
    compose,
    fragments,
    status,
    compositions,
  });
  return { fragments, status, compositions, changed };
}
