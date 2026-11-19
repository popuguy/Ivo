import { chooseParagraphBreaks } from '../../domain/text/paragraph-breaks.js';
import { UnsupportedComposition } from './composition-source.js';
import { paragraphLayout, paragraphLineArea } from '../../domain/text/paragraph-layout.js';
import { paragraphFlowSteps } from '../../domain/text/paragraph-flow.js';

const MAX_POINTS = 1024,
  MAX_ALTERNATIVES = 100000,
  MAX_SOURCE = 10000,
  MAX_LINES = 2048,
  MAX_STATES = 100000,
  MAX_DECISIONS = 1000000,
  BATCH_SIZE = 4096,
  CACHE_ENTRIES = 64,
  CACHE_BYTES = 8000000;

function opportunities(text) {
  const points = [{ index: 0 }];
  for (const match of text.matchAll(/[ \t]+|\r\n|[\n\r\u2028\u2029]/g))
    points.push({
      index: match.index + match[0].length,
      mandatory: /[\n\r\u2028\u2029]/.test(match[0]),
    });
  if (points.at(-1).index !== text.length) points.push({ index: text.length });
  points.at(-1).mandatory = true;
  return points;
}

/** Admission limits apply to the entire flow, including cached paragraphs. */
export function validateParagraphSource(text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_SOURCE)
    throw new UnsupportedComposition('paragraph composition beyond its bounded source budget');
  const paragraphs = [];
  let start = 0,
    pointCount = 1,
    alternativeCount = 0;
  for (const match of text.matchAll(/[^\u2029]*\u2029|[^\u2029]+$/g)) {
    const content = match[0],
      points = opportunities(content);
    pointCount += points.length - 1;
    if (pointCount > MAX_POINTS)
      throw new UnsupportedComposition('paragraph composition beyond its bounded source budget');
    let starts = 1;
    for (const point of points.slice(1)) {
      alternativeCount += starts;
      if (alternativeCount > MAX_ALTERNATIVES)
        throw new UnsupportedComposition(
          'paragraph composition beyond its bounded alternative budget',
        );
      starts = point.mandatory ? 1 : starts + 1;
    }
    paragraphs.push({ start, text: content, opportunities: points });
    start += content.length;
  }
  return paragraphs;
}

function candidatesFor(points) {
  const candidates = [];
  for (let a = 0; a < points.length - 1; a++)
    for (let b = a + 1; b < points.length; b++) {
      candidates.push({ start: points[a].index, end: points[b].index });
      if (points[b].mandatory) break;
    }
  return candidates;
}

function paragraphIdentity(request, paragraph) {
  const end = paragraph.start + paragraph.text.length,
    runs = request.runs
      .filter((run) => run.end > paragraph.start && run.start < end)
      .map((run) => ({
        ...run,
        start: Math.max(run.start, paragraph.start) - paragraph.start,
        end: Math.min(run.end, end) - paragraph.start,
      })),
    fonts = new Set(runs.map((run) => run.font));
  // Neither source offsets, editorial markup nor frame width affect shaping.
  // Exact face identity and every transported shaping attribute do.
  return JSON.stringify({
    protocol: request.protocol,
    frameMetrics: request.protocol >= 3,
    allowFallback: request.allowFallback,
    text: paragraph.text,
    ...(paragraph.text.includes('\t')
      ? { tabOrigins: [paragraph.layout.leftIndent, paragraph.layout.firstLineIndent] }
      : {}),
    runs,
    resources: request.resources
      .filter((resource) => fonts.has(resource.id))
      .map(({ data: _data, ...identity }) => identity)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

const frameShape = (column) => ({
  width: column.width,
  height: column.height,
  firstBaseline: column.firstBaseline || 'ascent',
  minimumFirstBaseline: column.minimumFirstBaseline || 0,
  verticalAlign: column.verticalAlign || 'top',
});

async function fitFrameParagraphs(paragraphs, actualColumns, work, rememberDecision) {
  const columns = actualColumns.map(frameShape);
  while (columns.length < 128) columns.push({ ...columns.at(-1) });
  const columnKey = JSON.stringify(actualColumns.map(frameShape)),
    lines = [];
  let cursor = { frame: 0, baseline: null },
    previousAfter = 0,
    states = 0,
    candidates = 0,
    policy;
  for (const paragraph of paragraphs) {
    const key = 'flow:' + JSON.stringify([columnKey, paragraph.layout, cursor, previousAfter]),
      entry = paragraph.entry;
    let chosen = entry.decisions.get(key);
    if (chosen) work.reusedDecisions++;
    else {
      const steps = paragraphFlowSteps({
        start: 0,
        end: paragraph.text.length,
        opportunities: paragraph.opportunities,
        measurements: entry.measurements,
        columns,
        layout: paragraph.layout,
        cursor,
        previousAfter,
        maxStates: MAX_STATES - states,
        maxCandidates: MAX_DECISIONS - candidates,
      });
      let step = steps.next();
      while (!step.done) {
        // Pure fitting yields bounded work so camera/input tasks can run.
        await new Promise((resolve) => setTimeout(resolve, 0));
        step = steps.next();
      }
      chosen = step.value;
      if (chosen.status !== 'fit')
        throw new UnsupportedComposition('paragraph frame fitting (' + chosen.reason + ')');
      rememberDecision(entry, key, chosen);
    }
    states += chosen.states;
    candidates += chosen.candidates;
    if (
      states > MAX_STATES ||
      candidates > MAX_DECISIONS ||
      lines.length + chosen.lines.length > MAX_LINES
    )
      throw new UnsupportedComposition('paragraph fitting (flow decision budget)');
    lines.push(
      ...chosen.lines.map((line) => ({
        ...line,
        start: line.start + paragraph.start,
        end: line.end + paragraph.start,
      })),
    );
    cursor = chosen.cursor;
    previousAfter = paragraph.layout.paragraphAfter;
    policy = chosen.policy;
  }
  // Vertical alignment changes final presentation, never break decisions.
  for (const [index, column] of columns.entries()) {
    const own = lines.filter((line) => line.frame === index);
    if (!own.length) continue;
    const last = own.at(-1),
      remaining = Math.max(0, column.height - last.baseline - last.descent),
      offset =
        column.verticalAlign === 'bottom'
          ? remaining
          : column.verticalAlign === 'center'
            ? remaining / 2
            : 0;
    if (offset) for (const line of own) line.baseline += offset;
  }
  return {
    breaks: lines.map((line) => line.end),
    placements: lines.map(({ end, frame, baseline, left, width }) => ({
      end,
      frame,
      baseline,
      left,
      width,
    })),
    policy,
    work: { ...work, states, candidates },
  };
}

/**
 * Per-backend bounded LRU of paragraph-local measurements, never saved content.
 * Missing alternatives are batched using the real whole-source request. We do
 * not manufacture paragraph-only source digests or rebuild a typesetter per paragraph.
 */
export function createParagraphComposer(measure) {
  const cache = new Map();
  let bytes = 0;
  const trim = () => {
    while (cache.size > CACHE_ENTRIES || bytes > CACHE_BYTES) {
      const [oldest, value] = cache.entries().next().value;
      cache.delete(oldest);
      bytes -= value.bytes;
    }
  };
  const rememberDecision = (entry, key, value) => {
    const retained = cache.get(entry.key) === entry,
      prior = entry.decisions.get(key),
      cost = key.length * 2 + JSON.stringify(value).length * 2;
    if (prior) {
      entry.bytes -= prior.cacheBytes;
      if (retained) bytes -= prior.cacheBytes;
    }
    entry.decisions.delete(key);
    entry.decisions.set(key, { ...value, cacheBytes: cost });
    entry.bytes += cost;
    if (retained) bytes += cost;
    while (entry.decisions.size > 4) {
      const [oldest, removed] = entry.decisions.entries().next().value;
      entry.decisions.delete(oldest);
      entry.bytes -= removed.cacheBytes;
      if (retained) bytes -= removed.cacheBytes;
    }
    trim();
  };
  const remember = (key, measurements) => {
    if (cache.has(key)) {
      bytes -= cache.get(key).bytes;
      cache.delete(key);
    }
    const entry = {
      key,
      measurements,
      decisions: new Map(),
      bytes:
        key.length * 2 + measurements.length * (measurements[0]?.ascent === undefined ? 48 : 112),
    };
    cache.set(key, entry);
    bytes += entry.bytes;
    trim();
    return entry;
  };
  return {
    async compose(request, columns) {
      const width = columns[0]?.width,
        frameFlow = request.protocol >= 3;
      if (
        !Number.isFinite(width) ||
        columns.length > 128 ||
        width < 0.001 ||
        width > 100000 ||
        columns.some(
          (column) =>
            !Number.isFinite(column.width) ||
            column.width < 1 ||
            (frameFlow
              ? !Number.isFinite(column.height) || column.height < 1
              : Math.abs(column.width - width) > 0.000001),
        )
      )
        throw new UnsupportedComposition('paragraph composition across unequal column widths');
      const paragraphs = validateParagraphSource(request.text),
        missing = new Map(),
        work = {
          paragraphs: paragraphs.length,
          reusedParagraphs: 0,
          measuredParagraphs: 0,
          deduplicatedParagraphs: 0,
          measuredCandidates: 0,
          backendCalls: 0,
          reusedDecisions: 0,
        };
      if (request.protocol >= 2 && request.paragraphs?.length !== paragraphs.length)
        throw Error('Native paragraph metadata does not cover its source.');
      for (const [index, paragraph] of paragraphs.entries()) {
        const authored = request.paragraphs?.[index];
        if (
          request.protocol >= 2 &&
          (authored.start !== paragraph.start ||
            authored.end !== paragraph.start + paragraph.text.length)
        )
          throw Error('Native paragraph metadata does not match its source.');
        paragraph.layout = paragraphLayout(authored);
        if (
          frameFlow &&
          !columns.some((column) => {
            try {
              paragraphLineArea(paragraph.layout, column.width, true);
              paragraphLineArea(paragraph.layout, column.width);
              return true;
            } catch {
              return false;
            }
          })
        )
          throw new UnsupportedComposition('paragraph indents outside all available frames');
        if (!frameFlow) {
          paragraph.firstWidth = paragraphLineArea(paragraph.layout, width, true).width;
          paragraph.restWidth = paragraphLineArea(paragraph.layout, width).width;
        }
        const key = paragraphIdentity(request, paragraph),
          prior = cache.get(key);
        if (prior) {
          cache.delete(key);
          cache.set(key, prior);
          paragraph.entry = prior;
          work.reusedParagraphs++;
        } else if (missing.has(key)) {
          missing.get(key).paragraphs.push(paragraph);
          work.deduplicatedParagraphs++;
        } else {
          missing.set(key, {
            key,
            paragraphs: [paragraph],
            candidates: candidatesFor(paragraph.opportunities),
            measurements: [],
          });
          work.measuredParagraphs++;
        }
      }
      const pending = [];
      for (const group of missing.values())
        for (const candidate of group.candidates) pending.push({ group, candidate });
      for (let start = 0; start < pending.length; start += BATCH_SIZE) {
        const batch = pending.slice(start, start + BATCH_SIZE),
          candidates = batch.map(({ group, candidate }) => ({
            start: candidate.start + group.paragraphs[0].start,
            end: candidate.end + group.paragraphs[0].start,
            ...(request.protocol >= 2 && group.paragraphs[0].text.includes('\t')
              ? {
                  offset:
                    group.paragraphs[0].layout.leftIndent +
                    (candidate.start === 0 ? group.paragraphs[0].layout.firstLineIndent : 0),
                }
              : {}),
          })),
          result = await measure({
            ...request,
            mode: 'measure-lines-proof',
            includeVectors: false,
            candidates,
          });
        if (
          result?.sourceDigest !== request.sourceDigest ||
          !Array.isArray(result.measurements) ||
          result.measurements.length !== batch.length
        )
          throw Error('Native paragraph measurements are incomplete or belong to another source.');
        for (let index = 0; index < batch.length; index++) {
          const measurement = result.measurements[index],
            expected = candidates[index],
            { group, candidate } = batch[index];
          if (
            measurement?.start !== expected.start ||
            measurement.end !== expected.end ||
            !Number.isFinite(measurement.width) ||
            measurement.width < 0 ||
            measurement.width > 1000000
          )
            throw Error('Native paragraph measurement does not match its requested alternative.');
          const metrics = {};
          if (frameFlow) {
            for (const key of ['ascent', 'descent', 'advance', 'capHeight', 'xHeight', 'leading']) {
              if (
                !Number.isFinite(measurement[key]) ||
                measurement[key] < 0 ||
                measurement[key] > 100000 ||
                (key === 'advance' && measurement[key] === 0)
              )
                throw Error('Native paragraph measurement lacks valid line metrics.');
              metrics[key] = measurement[key];
            }
          }
          group.measurements.push({ ...candidate, width: measurement.width, ...metrics });
        }
        work.backendCalls++;
        work.measuredCandidates += batch.length;
      }
      // Publish only complete, validated batches. A failed request cannot leave
      // partial entries that would turn a later retry into a false cache hit.
      for (const group of missing.values()) {
        const entry = remember(group.key, group.measurements);
        for (const paragraph of group.paragraphs) paragraph.entry = entry;
      }
      if (frameFlow) {
        const result = await fitFrameParagraphs(paragraphs, columns, work, rememberDecision);
        return { ...result, work: { ...result.work, cacheEntries: cache.size, cacheBytes: bytes } };
      }
      const breaks = [];
      let states = 0,
        candidates = 0,
        policy;
      for (const paragraph of paragraphs) {
        if (states >= MAX_STATES || candidates >= MAX_DECISIONS)
          throw new UnsupportedComposition('paragraph fitting (flow decision budget)');
        const entry = paragraph.entry;
        const decisionKey = JSON.stringify([paragraph.firstWidth, paragraph.restWidth]);
        let chosen = entry.decisions.get(decisionKey);
        if (chosen) work.reusedDecisions++;
        else {
          const result = chooseParagraphBreaks({
            start: 0,
            end: paragraph.text.length,
            opportunities: paragraph.opportunities,
            measurements: entry.measurements.filter(
              (line) => line.width <= Math.max(paragraph.firstWidth, paragraph.restWidth),
            ),
            lineWidths: Array.from(
              { length: Math.min(MAX_LINES - breaks.length, paragraph.opportunities.length - 1) },
              (_, index) => (index === 0 ? paragraph.firstWidth : paragraph.restWidth),
            ),
            maxStates: MAX_STATES - states,
            maxCandidates: MAX_DECISIONS - candidates,
          });
          if (result.status !== 'fit')
            throw new UnsupportedComposition('paragraph fitting (' + result.reason + ')');
          chosen = {
            breaks: result.lines.map((line) => line.end),
            states: result.states,
            candidates: result.candidates,
            policy: result.policy,
          };
          // Four exact widths per paragraph; decisions retain only source ends.
          // Their storage is bounded separately (64 * 4 * 1023 ends at most).
          rememberDecision(entry, decisionKey, chosen);
        }
        states += chosen.states;
        candidates += chosen.candidates;
        if (states > MAX_STATES || candidates > MAX_DECISIONS)
          throw new UnsupportedComposition('paragraph fitting (flow decision budget)');
        policy = chosen.policy;
        breaks.push(...chosen.breaks.map((end) => end + paragraph.start));
      }
      return { breaks, policy, work: { ...work, cacheEntries: cache.size, cacheBytes: bytes } };
    },
  };
}
