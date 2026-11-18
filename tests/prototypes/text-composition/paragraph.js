import assert from 'node:assert/strict';
import { chooseParagraphBreaks } from '../../../src/domain/text/paragraph-breaks.js';

/** The native backend measures; Ivo chooses; the same backend draws the exact chosen ranges. */
export async function verifyParagraphDecision(request, { measure, compose, rejects }) {
  const opportunities = [
      { index: 0 },
      ...[...request.text.matchAll(/ +/g)].map((match) => ({
        index: match.index + match[0].length,
      })),
      { index: request.text.length },
    ],
    candidates = [];
  for (let a = 0; a < opportunities.length - 1; a++)
    for (let b = a + 1; b < opportunities.length; b++)
      candidates.push({ start: opportunities[a].index, end: opportunities[b].index });
  const measured = await measure({ ...request, mode: 'measure-lines-proof', candidates }),
    measurements = measured.measurements;
  assert.equal(measurements.length, candidates.length, 'Native alternatives were omitted');
  let witness;
  for (let width = 80; width <= 250; width++) {
    const input = {
        start: 0,
        end: request.text.length,
        opportunities,
        measurements,
        lineWidths: Array(32).fill(width),
      },
      greedy = chooseParagraphBreaks({ ...input, mode: 'single-line' }),
      optimal = chooseParagraphBreaks(input);
    if (
      greedy.status === 'fit' &&
      optimal.status === 'fit' &&
      optimal.cost < greedy.cost - 0.000001
    ) {
      witness = { width, greedy, optimal };
      break;
    }
  }
  assert(
    witness,
    'Real native measurements did not exercise a different global paragraph decision',
  );
  const { width, greedy, optimal } = witness,
    ends = (value) => value.lines.map((line) => line.end);
  assert.notDeepEqual(ends(greedy), ends(optimal));
  const native = await compose(
    {
      ...request,
      mode: 'explicit-lines-proof',
      frames: [{ id: 'paragraph', width, height: 500 }],
      breaks: ends(optimal),
    },
    'paragraph-optimal',
  );
  assert.deepEqual(
    native.layout.lines.map((line) => line.end),
    ends(optimal),
    'Native output rewrapped an owned decision',
  );
  assert.equal(native.layout.coveredLength, request.text.length);
  assert(native.layout.lines.every((line) => line.visibleWidth <= width + 0.000001));
  await compose(
    {
      ...request,
      mode: 'explicit-lines-proof',
      frames: [{ id: 'paragraph', width, height: 500 }],
      breaks: ends(greedy),
    },
    'paragraph-greedy',
  );
  await rejects(
    {
      ...request,
      mode: 'measure-lines-proof',
      candidates: [{ start: 0, end: request.text.length + 1 }],
    },
    /Invalid line alternative/,
  );
  await rejects(
    { ...request, mode: 'explicit-lines-proof', breaks: [request.text.length - 1] },
    /cover source/,
  );
  await rejects(
    {
      ...request,
      mode: 'explicit-lines-proof',
      breaks: [request.text.length, request.text.length],
    },
    /line order/,
  );
  await rejects(
    {
      ...request,
      mode: 'explicit-lines-proof',
      breaks: [request.text.length],
      frames: [{ id: 'too-narrow', width: 10, height: 500 }],
    },
    /exceeds frame width/,
  );
  return { policy: optimal.policy, width, measurementCount: measurements.length, greedy, optimal };
}
