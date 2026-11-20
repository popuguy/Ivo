import { wordSpacingSettings, wordSpacingValue } from '../../domain/text/word-spacing.js';

const fields = [
  'percentage',
  'offPreference',
  'eligibleGaps',
  'nominalSpaceWidth',
  'justified',
  'fallback',
];
const planFields = [
  'start',
  'end',
  'visibleWidth',
  'percentage',
  'eligibleGaps',
  'nominalSpaceWidth',
  'justified',
  'fallback',
];
const own = (object, key) => Object.hasOwn(object, key);
const object = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const pointTolerance = (width) => Math.max(0.001, Math.abs(width) * 5e-7);
const nominalTolerance = (width) => Math.max(0.0001, Math.abs(width) * 2e-7);
function fail(detail) {
  throw Error('Native word-spacing result ' + detail + '.');
}
function exactFields(value, required, optional = []) {
  return (
    object(value) &&
    required.every((key) => own(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function sourceShape(text, start, end) {
  let contentEnd = end;
  while (contentEnd > start && [10, 13, 0x2028, 0x2029].includes(text.charCodeAt(contentEnd - 1)))
    contentEnd--;
  let trailingStart = contentEnd;
  while (trailingStart > start && [32, 0x202f].includes(text.charCodeAt(trailingStart - 1)))
    trailingStart--;
  const flexible = (index) => text.charCodeAt(index) === 32 || text.charCodeAt(index) === 0xa0;
  let hangingStart = trailingStart;
  while (
    hangingStart > start &&
    (flexible(hangingStart - 1) || text.charCodeAt(hangingStart - 1) === 0x202f)
  )
    hangingStart--;
  let eligibleGaps = 0;
  for (let index = start; index < hangingStart; index++) if (flexible(index)) eligibleGaps++;
  return { contentEnd, trailingStart, hangingStart, eligibleGaps };
}
function validMetadata(value) {
  return (
    nonnegative(value.percentage) &&
    integer(value.eligibleGaps) &&
    value.eligibleGaps <= 10000 &&
    nonnegative(value.nominalSpaceWidth) &&
    (value.eligibleGaps === 0) === (value.nominalSpaceWidth === 0) &&
    typeof value.justified === 'boolean' &&
    [null, 'single-word'].includes(value.fallback)
  );
}
function validatePlan(request, plan) {
  if (
    !Array.isArray(request.placements) ||
    !Array.isArray(request.frames) ||
    !request.frames.length ||
    request.frames.length > 128 ||
    !Array.isArray(request.paragraphs) ||
    !request.paragraphs.length ||
    !Array.isArray(plan) ||
    plan.length !== request.placements.length ||
    plan.length > 4096
  )
    fail('does not have its owned placement plan');
  let paragraphEnd = 0;
  const paragraphs = request.paragraphs.map((paragraph) => {
    if (
      !object(paragraph) ||
      paragraph.start !== paragraphEnd ||
      !integer(paragraph.end) ||
      paragraph.end <= paragraphEnd ||
      paragraph.end > request.text.length
    )
      fail('has invalid source paragraph boundaries');
    paragraphEnd = paragraph.end;
    const policy = own(paragraph, 'wordSpacing')
      ? wordSpacingSettings(wordSpacingValue(paragraph.wordSpacing))
      : null;
    return { ...paragraph, policy };
  });
  if (paragraphEnd !== request.text.length) fail('has incomplete source paragraphs');
  const entries = [];
  let start = 0,
    paragraphIndex = 0,
    previousFrame = 0;
  for (let index = 0; index < plan.length; index++) {
    const placement = request.placements[index],
      selected = plan[index];
    if (
      !object(placement) ||
      !integer(placement.frame) ||
      placement.frame < previousFrame ||
      placement.frame >= 128 ||
      !integer(placement.end) ||
      placement.end <= start ||
      placement.end > request.text.length ||
      !Number.isFinite(placement.width) ||
      placement.width < 1
    )
      fail('has invalid placement boundaries');
    while (paragraphs[paragraphIndex]?.end <= start) paragraphIndex++;
    const paragraph = paragraphs[paragraphIndex];
    if (!paragraph || placement.end > paragraph.end) fail('crosses an authored paragraph');
    const shape = sourceShape(request.text, start, placement.end);
    if (paragraph.policy) {
      if (
        !exactFields(selected, planFields) ||
        selected.start !== start ||
        selected.end !== placement.end ||
        !nonnegative(selected.visibleWidth) ||
        !validMetadata(selected) ||
        selected.eligibleGaps !== shape.eligibleGaps
      )
        fail('does not match its measured source plan');
      const full =
        (paragraph.align || 'left').startsWith('justify') &&
        (placement.end < paragraph.end || paragraph.align === 'justify-all');
      if (
        (full && !selected.justified) ||
        (!(paragraph.align || 'left').startsWith('justify') && selected.justified) ||
        (!full &&
          selected.justified &&
          (selected.eligibleGaps === 0 ||
            selected.percentage > paragraph.policy.desired + 0.000001)) ||
        (selected.fallback !== null &&
          (!full || selected.eligibleGaps !== 0 || selected.visibleWidth <= 0))
      )
        fail('has an inconsistent measured adjustment regime');
      if (
        selected.eligibleGaps === 0 &&
        Math.abs(selected.percentage - paragraph.policy.desired) > 0.000001
      )
        fail('changed the no-gap source percentage');
    } else if (selected !== null) fail('has a spacing plan for an inactive paragraph');
    entries.push({ placement, selected, paragraph, shape, start, end: placement.end });
    previousFrame = placement.frame;
    start = placement.end;
  }
  const boundary = own(request, 'oversetStart') ? request.oversetStart : request.text.length;
  if (
    !integer(boundary) ||
    (own(request, 'oversetStart') && boundary >= request.text.length) ||
    start !== boundary
  )
    fail('has an incomplete owned source plan');
  return entries;
}

/** Validate the disposable native proof before it can settle into a result cache.
 * The measured plan is local only; it must never become native request metadata. */
export function validateWordSpacingResult(result, request, plan) {
  if (
    !request ||
    request.protocol !== 5 ||
    typeof request.text !== 'string' ||
    result?.protocol !== 5 ||
    result.sourceDigest !== request.sourceDigest ||
    !Array.isArray(result.layout?.lines)
  )
    fail('does not match its protocol or source');
  const entries = validatePlan(request, plan),
    visible = entries.filter(({ placement }) => placement.frame < request.frames.length);
  if (visible.length !== result.layout.lines.length) fail('lost visible planned lines');
  let caretCount = 0,
    glyphCount = 0;
  for (let index = 0; index < visible.length; index++) {
    const { placement, selected, paragraph, shape, start, end } = visible[index],
      line = result.layout.lines[index];
    if (
      !object(line) ||
      line.start !== start ||
      line.end !== end ||
      line.placementIndex !== index ||
      line.frame !== request.frames[placement.frame]?.id
    )
      fail('lost a planned source interval');
    if (!paragraph.policy) {
      if (own(line, 'wordSpacing')) fail('contains metadata for an inactive paragraph');
      if (
        line.carets?.some((caret) =>
          ['native-collapsed-space', 'native-word-space'].includes(caret.measurement),
        )
      )
        fail('collapsed an inactive source paragraph');
      continue;
    }
    const actual = line.wordSpacing;
    if (
      !exactFields(actual, fields, ['collapsedTrailingStart']) ||
      !validMetadata(actual) ||
      typeof actual.offPreference !== 'boolean' ||
      actual.eligibleGaps !== shape.eligibleGaps ||
      actual.eligibleGaps !== selected.eligibleGaps ||
      actual.justified !== selected.justified ||
      actual.fallback !== selected.fallback ||
      Math.abs(actual.nominalSpaceWidth - selected.nominalSpaceWidth) >
        nominalTolerance(selected.nominalSpaceWidth)
    )
      fail('has invalid or unexpected spacing metadata');
    const tolerance = pointTolerance(selected.visibleWidth);
    if (
      !nonnegative(line.visibleWidth) ||
      Math.abs(line.visibleWidth - selected.visibleWidth) > tolerance ||
      !nonnegative(line.width) ||
      line.width + tolerance < line.visibleWidth ||
      line.contentEnd !== shape.contentEnd ||
      !Number.isFinite(line.originX) ||
      !Number.isFinite(line.availableWidth) ||
      Math.abs(line.availableWidth - placement.width) > 0.000001
    )
      fail('changed its measured visible width or source endpoint');
    const percentError = Math.abs(actual.percentage - selected.percentage);
    if (
      selected.nominalSpaceWidth
        ? (percentError * selected.nominalSpaceWidth) / 100 > tolerance
        : percentError > 0.000001
    )
      fail('changed its measured word-space percentage');
    const outside =
      actual.percentage < paragraph.policy.minimum - 0.000001 ||
      actual.percentage > paragraph.policy.maximum + 0.000001;
    if (actual.offPreference !== outside) fail('misreported its authored preference bounds');
    const collapse = actual.justified && shape.trailingStart < shape.contentEnd;
    if (
      collapse
        ? actual.collapsedTrailingStart !== shape.trailingStart
        : own(actual, 'collapsedTrailingStart')
    )
      fail('changed its trailing-space collapse boundary');
    if (
      !Array.isArray(line.carets) ||
      !Array.isArray(line.runs) ||
      line.runs.some((run) => !object(run) || run.rtl !== false || !Array.isArray(run.glyphs))
    )
      fail('does not have qualified left-to-right geometry');
    const carets = new Map(),
      adjustedCaret =
        (shape.eligibleGaps > 0 || shape.hangingStart < shape.contentEnd) &&
        actual.fallback !== 'single-word',
      ordinaryMeasurement = adjustedCaret
        ? 'native-word-space'
        : shape.contentEnd === start
          ? 'empty-paragraph-origin'
          : 'native-line';
    let previous = start - 1;
    for (const caret of line.carets) {
      if (
        ++caretCount > 110000 ||
        !object(caret) ||
        !integer(caret.index) ||
        caret.index <= previous ||
        caret.index < start ||
        caret.index > end ||
        !Number.isFinite(caret.primary) ||
        !Number.isFinite(caret.secondary) ||
        ![
          'native-line',
          'native-word-space',
          'empty-paragraph-origin',
          'native-collapsed-space',
        ].includes(caret.measurement)
      )
        fail('has invalid source caret geometry');
      previous = caret.index;
      carets.set(caret.index, caret);
      if (
        (!collapse || caret.index < shape.trailingStart) &&
        caret.measurement !== ordinaryMeasurement
      )
        fail('does not retain its qualified word-space caret measurement');
    }
    if (!carets.has(start) || !carets.has(end)) fail('lost its endpoint carets');
    const positions = new Map(),
      hanging = new Map();
    let edge = null;
    for (const run of line.runs)
      for (const glyph of run.glyphs) {
        if (++glyphCount > 100000) fail('exceeds the glyph geometry budget');
        if (
          !object(glyph) ||
          !integer(glyph.index) ||
          !integer(glyph.end) ||
          glyph.index < start ||
          (glyph.generated === true
            ? glyph.index !== end || glyph.end !== end || !request.hyphenationPoints?.includes(end)
            : glyph.end <= glyph.index) ||
          glyph.end > shape.contentEnd ||
          !Array.isArray(glyph.position) ||
          glyph.position.length !== 2 ||
          !glyph.position.every(Number.isFinite) ||
          !Array.isArray(glyph.advance) ||
          glyph.advance.length !== 2 ||
          !glyph.advance.every(Number.isFinite)
        )
          fail('has invalid native glyph geometry');
        if (!collapse) continue;
        if (glyph.index >= shape.hangingStart && glyph.index < shape.trailingStart) {
          if (
            glyph.end !== glyph.index + 1 ||
            hanging.has(glyph.index) ||
            glyph.advance[0] < 0 ||
            Math.abs(glyph.advance[1]) > 0.000001 ||
            (request.text.charCodeAt(glyph.index) !== 0xa0 && Math.abs(glyph.advance[0]) > 0.000001)
          )
            fail('has an invalid hanging source-space advance');
          hanging.set(glyph.index, glyph.advance[0]);
        }
        if (glyph.index < shape.trailingStart || glyph.index >= shape.contentEnd) continue;
        if (
          !integer(glyph.index) ||
          glyph.end !== glyph.index + 1 ||
          !Array.isArray(glyph.position) ||
          glyph.position.length !== 2 ||
          !glyph.position.every(Number.isFinite) ||
          !Array.isArray(glyph.advance) ||
          glyph.advance.length !== 2 ||
          !glyph.advance.every(Number.isFinite) ||
          glyph.advance.some((value) => Math.abs(value) > 0.000001) ||
          (edge !== null && Math.abs(glyph.position[0] - edge) > 0.00001)
        )
          fail('does not retain zero-advance trailing glyphs');
        edge = glyph.position[0];
        positions.set(glyph.index, true);
      }
    if (!collapse) continue;
    let expectedWidth = line.visibleWidth;
    for (const advance of hanging.values()) expectedWidth += advance;
    if (
      edge === null ||
      hanging.size !== shape.trailingStart - shape.hangingStart ||
      positions.size !== shape.contentEnd - shape.trailingStart ||
      Math.abs(edge - line.originX - expectedWidth) > tolerance ||
      Math.abs(line.width - expectedWidth) > tolerance
    )
      fail('lost the actual collapsed trailing-space edge');
    for (let source = shape.trailingStart; source <= shape.contentEnd; source++)
      if (!carets.has(source)) fail('lost a collapsed source-space caret');
    for (const caret of line.carets)
      if (
        caret.index >= shape.trailingStart &&
        (caret.measurement !== 'native-collapsed-space' ||
          Math.abs(caret.primary - edge) > 0.00001 ||
          Math.abs(caret.secondary - edge) > 0.00001)
      )
        fail('does not match the retained collapsed glyph edge');
    // The one physical edge has several logical source positions. CoreText's
    // hitIndex chooses its own one; it is not a per-logical-index round trip.
  }
  return result;
}
