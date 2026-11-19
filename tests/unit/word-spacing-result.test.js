import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWordSpacingResult } from '../../src/rendering/text/word-spacing-result.js';

const defaultPolicy = { minimum: 80, desired: 100, maximum: 133 };
function fixture(
  parts = [{ text: '  AA BB  \u2029', align: 'justify-all', policy: defaultPolicy }],
  frameCount = 1,
) {
  const request = {
    protocol: 5,
    text: parts.map((p) => p.text).join(''),
    sourceDigest: 'owned-fixture',
    frames: Array.from({ length: frameCount }, (_, i) => ({ id: 'frame-' + i })),
    paragraphs: [],
    placements: [],
  };
  const plan = [],
    lines = [];
  let start = 0;
  for (const part of parts) {
    const end = start + part.text.length,
      frame = part.frame ?? 0,
      area = part.area ?? 60;
    const paragraph = {
      start,
      end,
      align: part.align || 'left',
      ...(part.policy ? { wordSpacing: { ...part.policy } } : {}),
    };
    request.paragraphs.push(paragraph);
    request.placements.push({ end, frame, baseline: 10, left: 5, width: area });
    let contentEnd = end;
    while (
      contentEnd > start &&
      [10, 13, 0x2028, 0x2029].includes(request.text.charCodeAt(contentEnd - 1))
    )
      contentEnd--;
    let trailing = contentEnd;
    while (trailing > start && request.text.charCodeAt(trailing - 1) === 32) trailing--;
    const visibleSource = request.text.slice(start, trailing),
      gaps = (visibleSource.match(/ /g) || []).length;
    const nominal = gaps * 4,
      natural = visibleSource.length * 6 - gaps * 2;
    const full = paragraph.align.startsWith('justify') && paragraph.align === 'justify-all';
    const desired = natural + nominal * ((part.policy?.desired ?? 100) / 100 - 1);
    const condensed = paragraph.align.startsWith('justify') && !full && desired > area;
    const justified = full || condensed,
      fallback = full && nominal === 0 && natural > 1e-6 && natural < area;
    const target = justified && gaps ? area : desired;
    const percentage = nominal
      ? 100 * (1 + (target - natural) / nominal)
      : (part.policy?.desired ?? 100);
    const visibleWidth = fallback ? area : target;
    const selected = part.policy
      ? {
          start,
          end,
          visibleWidth,
          percentage,
          eligibleGaps: gaps,
          nominalSpaceWidth: nominal,
          justified,
          fallback: fallback ? 'single-word' : null,
        }
      : null;
    plan.push(selected);
    let x = 5;
    const glyphs = [],
      carets = [];
    const collapse = Boolean(part.policy && justified && trailing < contentEnd);
    for (let index = start; index <= end; index++) {
      const collapsed = collapse && index >= trailing;
      carets.push({
        index,
        primary: x,
        secondary: x,
        logicalCandidates: [],
        hitIndex: collapsed ? trailing : index,
        measurement: collapsed
          ? 'native-collapsed-space'
          : part.policy && request.text.slice(start, contentEnd).includes(' ') && !fallback
            ? 'native-word-space'
            : contentEnd === start
              ? 'empty-paragraph-origin'
              : 'native-line',
      });
      if (index >= contentEnd) continue;
      const space = request.text.charCodeAt(index) === 32;
      const advance = space
        ? collapse && index >= trailing
          ? 0
          : (4 * percentage) / 100
        : fallback
          ? visibleWidth / visibleSource.length
          : 6;
      glyphs.push({
        glyph: index + 1,
        index,
        end: index + 1,
        position: [x, 0],
        advance: [advance, 0],
      });
      x += advance;
    }
    const line = {
      start,
      end,
      contentEnd,
      frame: 'frame-' + frame,
      placementIndex: lines.length,
      visibleWidth,
      width: collapse ? visibleWidth : x - 5,
      originX: 5,
      availableWidth: area,
      carets,
      runs: glyphs.length ? [{ rtl: false, glyphs }] : [],
    };
    if (part.policy)
      line.wordSpacing = {
        percentage,
        eligibleGaps: gaps,
        nominalSpaceWidth: nominal,
        justified,
        offPreference:
          percentage < part.policy.minimum - 1e-6 || percentage > part.policy.maximum + 1e-6,
        fallback: fallback ? 'single-word' : null,
        ...(collapse ? { collapsedTrailingStart: trailing } : {}),
      };
    if (frame < frameCount) lines.push(line);
    start = end;
  }
  const result = { protocol: 5, sourceDigest: request.sourceDigest, layout: { lines } };
  return { result, request, plan };
}
const validate = ({ result, request, plan }) => validateWordSpacingResult(result, request, plan);
function rejectChange(base, change) {
  const mutated = structuredClone(base);
  change(mutated);
  assert.throws(() => validate(mutated), /word-spacing result|Word spacing/);
}

test('source-leading/interior spaces, soft preference overflow and actual collapsed glyph/caret edges are validated without mutation', () => {
  const sample = fixture(),
    before = JSON.stringify(sample);
  assert.equal(sample.plan[0].eligibleGaps, 3);
  assert.equal(sample.plan[0].percentage, 300);
  assert.equal(sample.result.layout.lines[0].wordSpacing.collapsedTrailingStart, 7);
  assert.equal(validate(sample), sample.result);
  assert.equal(JSON.stringify(sample), before);
});

test('ordinary/ragged final desired spacing retains trailing advances and condensed final collapses only its source spaces', () => {
  const desired = { minimum: 80, desired: 200, maximum: 300 };
  const ragged = fixture([{ text: 'AA BB  \u2029', align: 'justify', policy: desired }]);
  assert.equal(ragged.result.layout.lines[0].wordSpacing.justified, false);
  assert.equal(ragged.result.layout.lines[0].width, 48);
  assert.equal(ragged.plan[0].visibleWidth, 32);
  validate(ragged);
  const condensed = fixture([
    { text: '  AA BB  \u2029', align: 'justify', policy: desired, area: 40 },
  ]);
  assert.equal(condensed.result.layout.lines[0].wordSpacing.justified, true);
  validate(condensed);
  rejectChange(ragged, ({ result }) => {
    result.layout.lines[0].wordSpacing.collapsedTrailingStart = 5;
  });
  rejectChange(ragged, ({ result }) => {
    result.layout.lines[0].carets[0].measurement = 'native-collapsed-space';
  });
});

test('no-gap native fallback and blank/all-space rows preserve desired percentages and collapse conventions', () => {
  const settings = { minimum: 80, desired: 200, maximum: 300 };
  for (const text of ['WORD  \u2029', '   \u2029', '\u2029']) {
    const sample = fixture([{ text, align: 'justify-all', policy: settings }]);
    validate(sample);
    assert.equal(sample.result.layout.lines[0].wordSpacing.percentage, 200);
    assert.equal(
      sample.result.layout.lines[0].wordSpacing.fallback,
      text.startsWith('WORD') ? 'single-word' : null,
    );
  }
  rejectChange(
    fixture([{ text: 'WORD\u2029', align: 'justify-all', policy: settings }]),
    ({ result }) => {
      result.layout.lines[0].wordSpacing.percentage = 100;
    },
  );
});

test('a soft return remains nonfinal within one authored paragraph', () => {
  const sample = fixture([
    { text: 'AA BB  \u2028', align: 'justify-all', policy: defaultPolicy },
    { text: 'CC DD', align: 'justify', policy: defaultPolicy },
  ]);
  sample.request.paragraphs = [
    { start: 0, end: sample.request.text.length, align: 'justify', wordSpacing: defaultPolicy },
  ];
  validate(sample);
  assert.equal(sample.result.layout.lines[0].wordSpacing.justified, true);
  assert.equal(sample.result.layout.lines[1].wordSpacing.justified, false);
  rejectChange(sample, ({ plan }) => {
    plan[0].justified = false;
  });
});

test('qualified prefix-corrected caret tags apply to visible or trailing spaces, never no-space or fallback paths', () => {
  const settings = { minimum: 80, desired: 200, maximum: 300 };
  const trailingOnly = fixture([{ text: 'WORD  \u2029', align: 'left', policy: settings }]);
  validate(trailingOnly);
  assert.equal(trailingOnly.plan[0].eligibleGaps, 0);
  assert.ok(
    trailingOnly.result.layout.lines[0].carets.every(
      (caret) => caret.measurement === 'native-word-space',
    ),
  );
  rejectChange(trailingOnly, ({ result }) => {
    result.layout.lines[0].carets[0].measurement = 'native-line';
  });
  const noSpace = fixture([{ text: 'WORD\u2029', align: 'left', policy: settings }]);
  validate(noSpace);
  rejectChange(noSpace, ({ result }) => {
    result.layout.lines[0].carets[0].measurement = 'native-word-space';
  });
});

test('unplaceable source keeps its full paragraph map and only the measured prefix is painted', () => {
  const sample = fixture([
    { text: 'One gap here\u2029', policy: defaultPolicy },
    { text: 'Protected characters\u2029', policy: defaultPolicy },
  ]);
  const boundary = sample.request.placements[0].end;
  sample.request.oversetStart = boundary;
  sample.plan.pop();
  sample.request.placements.pop();
  sample.result.layout.lines.pop();
  validate(sample);
  for (const value of [-1, boundary - 1, boundary + 1, sample.request.text.length, null])
    rejectChange(sample, ({ request }) => {
      request.oversetStart = value;
    });
  rejectChange(sample, ({ request }) => {
    delete request.oversetStart;
  });
  sample.request.oversetStart = 0;
  sample.request.placements.length = sample.plan.length = sample.result.layout.lines.length = 0;
  validate(sample);
});

test('future local plan entries and inactive visible paragraphs cannot be confused with actual native metadata', () => {
  const sample = fixture([
    { text: 'AA BB\u2029', align: 'justify-all', policy: defaultPolicy },
    { text: 'TAIL\u2029' },
    { text: 'CC DD', align: 'justify-all', policy: defaultPolicy, frame: 1 },
  ]);
  validate(sample);
  assert.equal(sample.result.layout.lines.length, 2);
  assert.equal(sample.plan.length, 3);
  rejectChange(sample, ({ result }) => {
    result.layout.lines[1].wordSpacing = null;
  });
  rejectChange(sample, ({ result }) => {
    result.layout.lines[1].carets[0].measurement = 'native-collapsed-space';
  });
  rejectChange(sample, ({ plan }) => {
    plan[2] = null;
  });
  rejectChange(sample, ({ plan }) => {
    plan[1] = { ...plan[0] };
  });
  rejectChange(sample, ({ plan }) => {
    plan.pop();
  });
});

test('strict metadata/plan keys, finite counts and preference flags reject forged result payloads', () => {
  const sample = fixture();
  for (const mutation of [
    (r) => {
      r.extra = 1;
    },
    (r) => {
      delete r.offPreference;
    },
    (r) => {
      r.percentage = NaN;
    },
    (r) => {
      r.percentage = -1;
    },
    (r) => {
      r.eligibleGaps = 1.5;
    },
    (r) => {
      r.eligibleGaps = 2;
    },
    (r) => {
      r.nominalSpaceWidth = Infinity;
    },
    (r) => {
      r.nominalSpaceWidth = 0;
    },
    (r) => {
      r.justified = false;
    },
    (r) => {
      r.offPreference = false;
    },
    (r) => {
      r.fallback = 'invented';
    },
    (r) => {
      r.collapsedTrailingStart = 8;
    },
  ])
    rejectChange(sample, ({ result }) => mutation(result.layout.lines[0].wordSpacing));
  for (const mutation of [
    (p) => {
      p.extra = 1;
    },
    (p) => {
      p.start++;
    },
    (p) => {
      p.eligibleGaps++;
    },
    (p) => {
      p.percentage = Infinity;
    },
    (p) => {
      p.visibleWidth = NaN;
    },
  ])
    rejectChange(sample, ({ plan }) => mutation(plan[0]));
});

test('point-scaled percentage/width tolerance accepts harmless precision while rejecting real changes', () => {
  const sample = fixture();
  const precision = structuredClone(sample);
  precision.result.layout.lines[0].wordSpacing.percentage += 0.001;
  precision.result.layout.lines[0].visibleWidth += 0.0001;
  validate(precision);
  rejectChange(sample, ({ result }) => {
    result.layout.lines[0].wordSpacing.percentage += 1;
  });
  rejectChange(sample, ({ result }) => {
    result.layout.lines[0].visibleWidth += 0.01;
  });
  rejectChange(sample, ({ result }) => {
    result.layout.lines[0].wordSpacing.nominalSpaceWidth += 0.01;
  });
  // Soft maxima do not become arbitrary result percentage limits.
  const huge = fixture([
    { text: 'A B', align: 'justify-all', policy: defaultPolicy, area: 100000 },
  ]);
  assert.ok(huge.plan[0].percentage > 1000);
  validate(huge);
});

test('collapsed source spaces must retain zero advances, one shared actual glyph edge and every source caret', () => {
  const sample = fixture();
  for (const mutation of [
    ({ result }) => {
      result.layout.lines[0].runs[0].glyphs[7].advance[0] = 1;
    },
    ({ result }) => {
      result.layout.lines[0].runs[0].glyphs[7].position[0]++;
    },
    ({ result }) => {
      result.layout.lines[0].runs[0].glyphs.splice(7, 1);
    },
    ({ result }) => {
      result.layout.lines[0].runs[0].glyphs[7].end++;
    },
    ({ result }) => {
      result.layout.lines[0].carets = result.layout.lines[0].carets.filter((c) => c.index !== 8);
    },
    ({ result }) => {
      result.layout.lines[0].carets[8].measurement = 'native-line';
    },
    ({ result }) => {
      result.layout.lines[0].carets[8].secondary++;
    },
    ({ result }) => {
      result.layout.lines[0].carets[0].index++;
    },
    ({ result }) => {
      result.layout.lines[0].carets[1].primary = NaN;
    },
    ({ result }) => {
      result.layout.lines[0].runs[0].rtl = true;
    },
  ])
    rejectChange(sample, mutation);
  const logicalDuplicates = structuredClone(sample);
  for (const caret of logicalDuplicates.result.layout.lines[0].carets)
    if (caret.index >= 7) caret.hitIndex = 7;
  validate(logicalDuplicates);
});

test('line/source endpoints, content terminators and owned placement identities must remain exact', () => {
  const sample = fixture();
  for (const mutation of [
    ({ result }) => {
      result.protocol = 4;
    },
    ({ result }) => {
      result.sourceDigest = 'other';
    },
    ({ result }) => {
      result.layout.lines[0].start++;
    },
    ({ result }) => {
      result.layout.lines[0].contentEnd--;
    },
    ({ result }) => {
      result.layout.lines[0].frame = 'other';
    },
    ({ result }) => {
      result.layout.lines[0].placementIndex++;
    },
    ({ request }) => {
      request.paragraphs[0].start++;
    },
    ({ request }) => {
      request.paragraphs[0].end--;
    },
    ({ request, plan }) => {
      request.placements[0].end--;
      plan[0].end--;
    },
  ])
    rejectChange(sample, mutation);
  for (const suffix of ['\r\n', '\u2028', '\u2029'])
    validate(fixture([{ text: 'AA BB  ' + suffix, align: 'justify-all', policy: defaultPolicy }]));
});
