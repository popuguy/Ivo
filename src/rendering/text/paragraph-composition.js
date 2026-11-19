import { chooseParagraphBreaks } from '../../domain/text/paragraph-breaks.js';
import { UnsupportedComposition } from './composition-source.js';

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
    allowFallback: request.allowFallback,
    text: paragraph.text,
    runs,
    resources: request.resources
      .filter((resource) => fonts.has(resource.id))
      .map(({ data: _data, ...identity }) => identity)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/**
 * Per-backend bounded LRU of paragraph-local measurements, never saved content.
 * Missing alternatives are batched using the real whole-source request. We do
 * not manufacture paragraph-only source digests or rebuild a typesetter per paragraph.
 */
export function createParagraphComposer(measure) {
  const cache = new Map();
  let bytes = 0;
  const remember = (key, measurements) => {
    if (cache.has(key)) {
      bytes -= cache.get(key).bytes;
      cache.delete(key);
    }
    const entry = {
      measurements,
      decisions: new Map(),
      bytes: key.length * 2 + measurements.length * 48,
    };
    cache.set(key, entry);
    bytes += entry.bytes;
    while (cache.size > CACHE_ENTRIES || bytes > CACHE_BYTES) {
      const [oldest, value] = cache.entries().next().value;
      cache.delete(oldest);
      bytes -= value.bytes;
    }
    return entry;
  };
  return {
    async compose(request, columns) {
      const width = columns[0]?.width;
      if (
        !Number.isFinite(width) ||
        width < 0.001 ||
        width > 100000 ||
        columns.some(
          (column) => !Number.isFinite(column.width) || Math.abs(column.width - width) > 0.000001,
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
      for (const paragraph of paragraphs) {
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
          group.measurements.push({ ...candidate, width: measurement.width });
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
      const breaks = [];
      let states = 0,
        candidates = 0,
        policy;
      for (const paragraph of paragraphs) {
        if (states >= MAX_STATES || candidates >= MAX_DECISIONS)
          throw new UnsupportedComposition('paragraph fitting (flow decision budget)');
        const entry = paragraph.entry;
        let chosen = entry.decisions.get(width);
        if (chosen) work.reusedDecisions++;
        else {
          const result = chooseParagraphBreaks({
            start: 0,
            end: paragraph.text.length,
            opportunities: paragraph.opportunities,
            measurements: entry.measurements.filter((line) => line.width <= width),
            lineWidths: Array(
              Math.min(MAX_LINES - breaks.length, paragraph.opportunities.length - 1),
            ).fill(width),
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
          entry.decisions.set(width, chosen);
          if (entry.decisions.size > 4) entry.decisions.delete(entry.decisions.keys().next().value);
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
