import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildNativeText } from '../../scripts/build-native-text.mjs';
import { createTextComposition } from '../../desktop/text-composition.mjs';

const mac = { skip: process.platform !== 'darwin' },
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  exec = promisify(execFile),
  close = (actual, expected, label = 'Native word-space coordinate') =>
    assert.ok(Math.abs(actual - expected) < 0.001, `${label}: ${actual} versus ${expected}`),
  glyphs = (line) => line.runs.flatMap((run) => run.glyphs);

async function request(
  text,
  { align = 'left', policy = { minimum: 80, desired: 100, maximum: 133 }, ...style } = {},
) {
  const bytes = await readFile(new URL('../../public/fonts/cmu-serif/cmunrm.ttf', import.meta.url)),
    sourceHTML = '<p>' + text + '</p>';
  return {
    protocol: 5,
    mode: 'planned-lines-proof',
    id: 'native-word-spacing-fixture',
    sourceHTML,
    sourceDigest: hash(sourceHTML),
    logicalLength: text.length,
    text,
    paragraphs: [
      {
        start: 0,
        end: text.length,
        align,
        paragraphBefore: 0,
        paragraphAfter: 0,
        leftIndent: 0,
        rightIndent: 0,
        firstLineIndent: 0,
        ...(policy ? { wordSpacing: policy } : {}),
      },
    ],
    spans: [{ kind: 'text', start: 0, end: text.length, logicalStart: 0, logicalEnd: text.length }],
    runs: [
      {
        start: 0,
        end: text.length,
        font: 'cmu',
        size: 16,
        ligatures: true,
        tracking: 0,
        leading: 24,
        ...style,
      },
    ],
    resources: [
      {
        id: 'cmu',
        digest: hash(bytes),
        postscript: 'CMUSerif-Roman',
        data: bytes.toString('base64'),
      },
    ],
    frames: [{ id: 'first', width: 500, height: 150 }],
    placements: [{ end: text.length, frame: 0, baseline: 40, left: 10, width: 490 }],
    allowFallback: false,
    includeVectors: true,
  };
}
async function serviceFor(t) {
  const service = createTextComposition(await buildNativeText());
  t.after(() => service.close());
  return service;
}
async function measure(
  service,
  req,
  candidates = [{ start: 0, end: req.text.length, offset: 10 }],
) {
  const { placements, ...base } = req;
  return (
    await service.compose({
      ...base,
      mode: 'measure-lines-proof',
      candidates,
      includeVectors: false,
    })
  ).measurements;
}
function nonspaces(req, line) {
  return glyphs(line).filter((glyph) => !/^\s+$/u.test(req.text.slice(glyph.index, glyph.end)));
}

test(
  'flexible and fixed nonbreaking spaces keep their source and use the face’s ordinary advance',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    const text = 'AA\u00a0BB\u202fCC DD\u2029';
    const policy = { minimum: 50, desired: 200, maximum: 250 };
    const req = await request(text, { policy });
    const draw = async (input) => (await service.compose(input)).layout.lines[0];
    const gap = (line, index) => glyphs(line).find((g) => g.index === index).advance[0];
    const natural = await draw(await request(text.replace(/[\u00a0\u202f]/g, ' ')));
    const ragged = await draw(req);
    for (const index of [2, 5, 8]) close(gap(ragged, index), gap(natural, 2) * 2);
    req.placements[0].width = ragged.visibleWidth + 20;
    req.paragraphs[0].align = 'justify-all';
    const justified = await draw(req);
    close(gap(justified, 2), gap(ragged, 2) + 10);
    close(gap(justified, 8), gap(justified, 2));
    close(gap(justified, 5), gap(ragged, 5));
    assert.equal(justified.wordSpacing.eligibleGaps, 2);
    assert.equal(req.text, text);
    const trailing = await request('AA BB\u00a0\u2029', { align: 'justify-all', policy });
    const hung = await draw(trailing);
    close(gap(hung, 5), gap(hung, 2));
    assert.equal(hung.wordSpacing.collapsedTrailingStart, undefined);
    const pair = await request('AA\u202fBB\u2029', { align: 'justify-all', policy });
    const compact = await draw({ ...pair, paragraphs: [{ ...pair.paragraphs[0], align: 'left' }] });
    pair.placements[0].width = compact.visibleWidth + 20;
    const spread = await draw(pair);
    for (const glyph of glyphs(compact)) {
      close(gap(spread, glyph.index), glyph.advance[0] + (glyph.index === 4 ? 0 : 5));
    }
  },
);

// Compare real drawn/native glyph advances, rather than reconstructing the
// implementation's font-space slope or accepting capacities on their own.
test(
  'explicit native word spacing measures and realizes exact affine capacities without changing source or shaping',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AV office alpha beta\u2029', { tracking: 100 }),
      before = structuredClone(req),
      [measured] = await measure(service, req),
      natural = (await service.compose(req)).layout.lines[0];
    const nominal = glyphs(natural)
      .filter((g) => req.text.slice(g.index, g.end) === ' ')
      .reduce((total, g) => total + g.advance[0] - 1.6, 0);
    close(measured.width, natural.visibleWidth);
    close(measured.wordSpacing.nominalSpaceWidth, nominal);
    assert.equal(measured.wordSpacing.eligibleGaps, 3);
    for (const [key, percent] of [
      ['minimumWidth', 80],
      ['desiredWidth', 100],
      ['maximumWidth', 133],
    ]) {
      const changed = structuredClone(req);
      changed.paragraphs[0].wordSpacing = {
        minimum: Math.min(80, percent),
        desired: percent,
        maximum: Math.max(133, percent),
      };
      const result = await service.compose(changed),
        line = result.layout.lines[0];
      close(line.visibleWidth, measured.wordSpacing[key]);
      close(line.visibleWidth, natural.visibleWidth + nominal * (percent / 100 - 1));
      close(line.baseline, natural.baseline);
      for (const field of ['ascent', 'descent', 'leading', 'advance', 'inkAscent', 'inkDescent'])
        close(line[field], natural[field], field);
      assert.deepEqual(
        nonspaces(changed, line).map(({ glyph, index, end, vector }) => [
          glyph,
          index,
          end,
          vector,
        ]),
        nonspaces(req, natural).map(({ glyph, index, end, vector }) => [glyph, index, end, vector]),
      );
      close(line.wordSpacing.percentage, percent);
      assert.equal(line.wordSpacing.justified, false);
      assert.equal(line.wordSpacing.fallback, null);
    }
    assert.deepEqual(req, before);
    const warm = await service.compose(req);
    assert.deepEqual(warm.layout.lines[0], natural);
  },
);

test(
  'mixed native character scaling, positive tracking, shifts and OpenType preserve struts and real word-space geometry',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('alpha office 0123 beta\u2029');
    req.runs = [
      { ...req.runs[0], end: 6, features: { smcp: true }, baselineShift: 6 },
      {
        ...req.runs[0],
        start: 6,
        end: 13,
        size: 20,
        horizontalScale: 150,
        verticalScale: 125,
        tracking: 100,
      },
      {
        ...req.runs[0],
        start: 13,
        size: 12,
        horizontalScale: 80,
        baselineShift: -6,
        features: { onum: true },
      },
    ];
    const before = structuredClone(req),
      natural = (await service.compose(req)).layout.lines[0],
      [metric] = await measure(service, req),
      changed = structuredClone(req);
    changed.paragraphs[0].wordSpacing = { minimum: 80, desired: 200, maximum: 250 };
    const line = (await service.compose(changed)).layout.lines[0],
      [newMetric] = await measure(service, changed);
    let nominal = 0;
    for (const glyph of glyphs(natural))
      if (req.text.slice(glyph.index, glyph.end) === ' ') {
        const style = req.runs.find((run) => run.start <= glyph.index && run.end > glyph.index);
        nominal +=
          glyph.advance[0] -
          (((style.tracking * style.size) / 1000) * (style.horizontalScale || 100)) / 100;
      }
    close(metric.wordSpacing.nominalSpaceWidth, nominal);
    close(line.visibleWidth - natural.visibleWidth, nominal);
    for (const field of [
      'ascent',
      'descent',
      'leading',
      'advance',
      'capHeight',
      'xHeight',
      'inkAscent',
      'inkDescent',
    ])
      close(newMetric[field], metric[field], field);
    assert.deepEqual(
      nonspaces(changed, line).map(({ glyph, index, end, vector, position }) => [
        glyph,
        index,
        end,
        vector,
        position[1],
      ]),
      nonspaces(req, natural).map(({ glyph, index, end, vector, position }) => [
        glyph,
        index,
        end,
        vector,
        position[1],
      ]),
    );
    close(line.carets.at(-1).primary, line.originX + line.visibleWidth);
    const originalGlyphs = glyphs(natural),
      actualGlyphs = glyphs(line),
      ligature = actualGlyphs.find((glyph) => req.text.slice(glyph.index, glyph.end) === 'ffi');
    assert(ligature, 'Mixed native fixture has no real ffi source cluster');
    for (const caret of line.carets) {
      const owner = actualGlyphs.find(
        (glyph) => glyph.index <= caret.index && glyph.end > caret.index,
      );
      if (!owner || /^\s+$/u.test(req.text.slice(owner.index, owner.end))) continue;
      const previous = originalGlyphs.find(
          (glyph) => glyph.index === owner.index && glyph.end === owner.end,
        ),
        originalCaret = natural.carets.find((part) => part.index === caret.index);
      nearTranslation(
        caret.primary - originalCaret.primary,
        owner.position[0] - previous.position[0],
      );
      nearTranslation(
        caret.secondary - originalCaret.secondary,
        owner.position[0] - previous.position[0],
      );
    }
    assert.deepEqual(req, before);
  },
);

function nearTranslation(actual, expected) {
  close(
    actual,
    expected,
    'Native caret retains original tracking/ligature offset within translated glyph',
  );
}

test(
  'ordinary source-space and word-start carets use full drawn advances including leading, repeated and ragged trailing spaces',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    for (const [align, text] of [
      ['left', '  AA BB  \u2029'],
      ['left', 'AA  BB CC\u2029'],
      ['left', 'office  \u2029'],
      ['left', '   \u2029'],
      ['justify-all', '  AA BB CC  \u2029'],
    ]) {
      const req = await request(text, {
          align,
          policy: { minimum: 80, desired: 200, maximum: 250 },
        }),
        line = (await service.compose(req)).layout.lines[0],
        actual = glyphs(line);
      for (const glyph of actual) {
        const left = line.carets.find((caret) => caret.index === glyph.index);
        if (req.text.slice(glyph.index, glyph.end) === ' ') {
          const right = line.carets.find((caret) => caret.index === glyph.end);
          close(left.primary, glyph.position[0], 'Native source-space leading edge');
          close(
            right.primary,
            glyph.position[0] + glyph.advance[0],
            'Native source-space complete advance',
          );
          close(right.primary - left.primary, glyph.advance[0], 'Complete selectable native space');
        } else close(left.primary, glyph.position[0], 'Native word/glyph source start');
        assert.equal(
          left.measurement,
          glyph.index >= line.wordSpacing.collapsedTrailingStart
            ? 'native-collapsed-space'
            : 'native-word-space',
        );
      }
      const last = actual.at(-1),
        edge = last.position[0] + last.advance[0];
      close(
        line.carets.at(-1).primary,
        edge,
        'Native original-source end including ragged trailing spaces',
      );
      close(line.carets.at(-1).secondary, edge);
    }
  },
);

test(
  'justification uses soft preferences while ordinary ragged rows fit desired and final justified rows respect minimum',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AA BB CC\u2029'),
      [metric] = await measure(service, req),
      nominal = metric.wordSpacing.nominalSpaceWidth,
      condensedWidth = metric.width - nominal * 0.6;
    const full = structuredClone(req);
    full.paragraphs[0].align = 'justify-all';
    full.placements[0].width = 300;
    const expanded = (await service.compose(full)).layout.lines[0];
    close(expanded.visibleWidth, 300);
    assert.ok(expanded.wordSpacing.percentage > 133);
    assert.equal(expanded.wordSpacing.offPreference, true);
    assert.equal(expanded.wordSpacing.justified, true);
    full.placements[0].width = condensedWidth;
    const compressed = (await service.compose(full)).layout.lines[0];
    close(compressed.visibleWidth, condensedWidth);
    close(compressed.wordSpacing.percentage, 40);
    assert.equal(compressed.wordSpacing.offPreference, true);
    full.placements[0].width = metric.width - nominal - 0.01;
    await assert.rejects(service.compose(full), /physical floor|word.space|line area/i);
    const last = structuredClone(req);
    last.paragraphs[0].align = 'justify';
    last.placements[0].width = condensedWidth;
    await assert.rejects(service.compose(last), /minimum|word.space|line area/i);
    last.paragraphs[0].wordSpacing.minimum = 0;
    const final = (await service.compose(last)).layout.lines[0];
    close(final.visibleWidth, condensedWidth);
    close(final.wordSpacing.percentage, 40);
    assert.equal(final.wordSpacing.justified, true);
    last.paragraphs[0].align = 'left';
    await assert.rejects(service.compose(last), /line area|word.space/i);
    last.placements[0].width = 490;
    last.paragraphs[0].wordSpacing = { minimum: 0, desired: 200, maximum: 250 };
    const ragged = (await service.compose(last)).layout.lines[0];
    close(ragged.visibleWidth, metric.width + nominal);
    assert.equal(ragged.wordSpacing.justified, false);
  },
);

test(
  'soft returns justify but paragraph-final rows retain desired word spacing and source terminal caret identity',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      text = 'AA BB\u2028CC DD\u2029',
      req = await request(text, {
        align: 'justify',
        policy: { minimum: 80, desired: 200, maximum: 250 },
      });
    req.placements = [
      { end: 6, frame: 0, baseline: 40, left: 10, width: 300 },
      { end: text.length, frame: 0, baseline: 64, left: 10, width: 300 },
    ];
    const before = structuredClone(req),
      result = await service.compose(req),
      [first, last] = result.layout.lines,
      metrics = await measure(service, req, [
        { start: 0, end: 6 },
        { start: 6, end: text.length },
      ]);
    close(first.visibleWidth, 300);
    close(last.visibleWidth, metrics[1].wordSpacing.desiredWidth);
    assert.equal(first.wordSpacing.justified, true);
    assert.equal(last.wordSpacing.justified, false);
    for (const line of result.layout.lines) {
      assert.equal(line.carets.at(-1).index, line.end);
      close(
        line.carets.at(-1).primary,
        line.carets.find((caret) => caret.index === line.contentEnd).primary,
      );
    }
    assert.equal(result.layout.coveredLength, text.length);
    assert.deepEqual(req, before);
  },
);

test(
  'leading spaces participate and justified trailing source spaces use their measured zero-advance native run edge',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    for (const text of ['  AA BB  \u2029', 'office  \u2029', '   \u2029', '\u2029']) {
      const req = await request(text, {
          align: 'justify-all',
          policy: { minimum: 80, desired: 200, maximum: 250 },
          horizontalScale: 150,
          verticalScale: 125,
          baselineShift: 4,
        }),
        result = await service.compose(req),
        line = result.layout.lines[0],
        expectedStart = text.replace(/\u2029$/u, '').replace(/ +$/u, '').length,
        actual = glyphs(line).filter((g) => g.index >= expectedStart),
        blank = text.trim().length === 0;
      if (text.startsWith('  AA')) assert.equal(line.wordSpacing.eligibleGaps, 3);
      assert.equal(line.wordSpacing.justified, true);
      assert.equal(line.wordSpacing.fallback, text.startsWith('office') ? 'single-word' : null);
      if (text.startsWith('office')) close(line.wordSpacing.percentage, 200);
      close(line.visibleWidth, blank ? 0 : 490);
      if (actual.length) {
        const edge = actual[0].position[0];
        for (const glyph of actual) {
          close(glyph.position[0], edge);
          close(glyph.advance[0], 0);
        }
        for (const caret of line.carets.filter((c) => c.index >= expectedStart)) {
          close(caret.primary, edge);
          close(caret.secondary, edge);
          assert.equal(caret.measurement, 'native-collapsed-space');
        }
      } else assert.equal(line.carets[0].measurement, 'empty-paragraph-origin');
    }
    const ragged = await request('  AA BB  \u2029', {
        policy: { minimum: 80, desired: 200, maximum: 250 },
      }),
      line = (await service.compose(ragged)).layout.lines[0],
      spaces = glyphs(line).filter((g) => ragged.text.slice(g.index, g.end) === ' ');
    assert.equal(spaces.length, 5);
    for (const glyph of spaces) assert.ok(glyph.advance[0] > 0);
    assert.equal(line.wordSpacing.collapsedTrailingStart, undefined);
    for (const [align, flush] of [
      ['center', 0.5],
      ['right', 1],
    ]) {
      const aligned = structuredClone(ragged);
      aligned.paragraphs[0].align = align;
      const actual = (await service.compose(aligned)).layout.lines[0];
      close(
        actual.originX,
        10 + (490 - actual.visibleWidth) * flush,
        'Native trailing-aware flush',
      );
    }
    const condensed = await request('  AA BB CC  \u2029', {
        align: 'justify',
        policy: { minimum: 0, desired: 100, maximum: 133 },
      }),
      [metrics] = await measure(service, condensed);
    condensed.placements[0].width = metrics.width - metrics.wordSpacing.nominalSpaceWidth * 0.6;
    const final = (await service.compose(condensed)).layout.lines[0],
      trailing = glyphs(final).filter((glyph) => glyph.index >= 10);
    close(final.wordSpacing.percentage, 40);
    assert.equal(final.wordSpacing.justified, true);
    for (const glyph of trailing) close(glyph.advance[0], 0);
    for (const caret of final.carets.filter((caret) => caret.index >= 10))
      close(caret.primary, trailing[0].position[0], 'Condensed final native trailing edge');
  },
);

test(
  'normal-policy paragraphs preserve protocol4 geometry and legacy protocols reject explicit word policies',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Legacy office text\u2029', {
        policy: null,
        horizontalScale: 150,
        baselineShift: 4,
        features: { onum: true },
      }),
      current = await service.compose(req),
      legacy = await service.compose({ ...req, protocol: 4 });
    assert.deepEqual(current.layout, legacy.layout);
    assert.deepEqual(current.vectors, legacy.vectors);
    assert.equal((await measure(service, req))[0].wordSpacing, undefined);
    const active = await request('AA BB\u2029');
    for (const protocol of [2, 3, 4]) {
      const { placements, ...base } = active;
      await assert.rejects(
        service.compose({
          ...base,
          protocol,
          mode: 'measure-lines-proof',
          candidates: [{ start: 0, end: active.text.length }],
        }),
        /protocol 5/i,
      );
    }
    const { placements, ...base } = active;
    await assert.rejects(
      service.compose({ ...base, mode: 'greedy-geometry-proof' }),
      /protocol 5|measured|planned/i,
    );
    for (const wordSpacing of [
      null,
      {},
      { minimum: -1, desired: 100, maximum: 133 },
      { minimum: 80, desired: 79, maximum: 133 },
      { minimum: 80, desired: 100, maximum: 1001 },
    ]) {
      const changed = structuredClone(active);
      changed.paragraphs[0].wordSpacing = wordSpacing;
      await assert.rejects(service.compose(changed));
    }
    for (const text of [
      'AA\tBB\u2029',
      'AA\u2009BB\u2029',
      'AA\u202eBB\u2029',
      'AA\u061cBB\u2029',
      '\u0627\u0628 AA\u2029',
      '\u05d0\u05d1 AA\u2029',
    ])
      await assert.rejects(
        service.compose(await request(text)),
        /space|tracking|left.to.right|qualified/i,
      );
    await assert.rejects(
      service.compose(await request('AA BB\u2029', { tracking: -1 })),
      /tracking|qualified/i,
    );
    // Explicit word-spacing qualification must not become a general source ban.
    const unicode = await request('A\u0301 \u03a9 \u0416\u2029', { policy: null });
    assert.equal(
      (await service.compose({ ...unicode, protocol: 4 })).layout.coveredLength,
      unicode.text.length,
    );
  },
);

test(
  'native word-spaced PDF retains actual selectable glyph origins and immutable retained plans',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AB CD EF\u2029', {
        align: 'justify-all',
        horizontalScale: 150,
        verticalScale: 125,
        baselineShift: 4,
      }),
      before = structuredClone(req),
      result = await service.compose(req),
      line = result.layout.lines[0],
      directory = await mkdtemp(path.join(tmpdir(), 'ivo-word-space-pdf-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'word-spacing.pdf'),
      reader = path.join(directory, 'read.swift');
    await writeFile(
      file,
      Buffer.from((await service.pdf(result.token, { invisible: false })).data, 'base64'),
    );
    await writeFile(
      reader,
      `import Foundation
import PDFKit
let page = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!.page(at: 0)!
let text = page.string ?? ""
let rows = ["AB", "CD", "EF"].map { word -> [String: Any] in
 let range = (text as NSString).range(of: word)
 let box = page.selection(for: NSRange(location: range.location, length: 1))!.bounds(for: page)
 return ["word": word, "left": box.minX]
}
print(String(data: try JSONSerialization.data(withJSONObject: ["text": text, "rows": rows]), encoding: .utf8)!)
`,
    );
    const { stdout } = await exec(
        '/usr/bin/xcrun',
        ['swift', '-module-cache-path', path.join(directory, 'cache'), reader, file],
        { timeout: 120000 },
      ),
      independent = JSON.parse(stdout);
    assert.equal(independent.text.replace(/\s+/gu, ' ').trim(), 'AB CD EF');
    for (const row of independent.rows)
      close(
        row.left,
        glyphs(line).find((g) => g.index === req.text.indexOf(row.word)).position[0],
        'Independent PDF native glyph origin',
      );
    assert.deepEqual(req, before);
    assert.deepEqual((await service.compose(req)).layout, result.layout);
  },
);
