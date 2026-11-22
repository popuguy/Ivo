import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { buildNativeText } from '../../scripts/build-native-text.mjs';
import { createTextComposition } from '../../desktop/text-composition.mjs';

const mac = { skip: process.platform !== 'darwin' },
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  exec = promisify(execFile),
  close = (actual, expected, label = 'Planned native coordinate') =>
    assert.ok(Math.abs(actual - expected) < 0.001, `${label}: ${actual} versus ${expected}`),
  glyphs = (line) => line.runs.flatMap((run) => run.glyphs),
  defaults = {
    align: 'left',
    paragraphBefore: 0,
    paragraphAfter: 0,
    leftIndent: 0,
    rightIndent: 0,
    firstLineIndent: 0,
  };

async function request(text, settings = []) {
  const bytes = await readFile(new URL('../../public/fonts/cmu-serif/cmunrm.ttf', import.meta.url)),
    sourceHTML = '<p>' + text + '</p>',
    paragraphs = [];
  let start = 0;
  for (const match of text.matchAll(/[^\u2029]*\u2029|[^\u2029]+$/g)) {
    const end = start + match[0].length;
    paragraphs.push({ start, end, ...defaults, ...settings[paragraphs.length] });
    start = end;
  }
  return {
    protocol: 3,
    mode: 'planned-lines-proof',
    id: 'native-planned-lines-fixture',
    sourceHTML,
    sourceDigest: hash(sourceHTML),
    logicalLength: text.length,
    text,
    paragraphs,
    spans: [{ kind: 'text', start: 0, end: text.length, logicalStart: 0, logicalEnd: text.length }],
    runs: [
      {
        start: 0,
        end: text.length,
        font: 'cmu',
        size: 12,
        ligatures: true,
        tracking: 0,
        leading: 16,
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
    frames: [{ id: 'first', width: 300, height: 300 }],
    placements: [{ end: text.length, frame: 0, baseline: 20, left: 0, width: 300 }],
    allowFallback: false,
    includeVectors: true,
  };
}

async function serviceFor(t) {
  const service = createTextComposition(await buildNativeText());
  t.after(() => service.close());
  return service;
}

async function measure(service, req, candidates) {
  const { placements, ...rest } = req;
  return (
    await service.compose({
      ...rest,
      mode: 'measure-lines-proof',
      candidates,
      includeVectors: false,
    })
  ).measurements;
}

test(
  'planned native lines honor measured metrics and unequal columns without repagination',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Alpha\u2029A second paragraph in a wider column.\u2029', [
        { leftIndent: 50, rightIndent: 10, firstLineIndent: 10 },
        { leftIndent: 20, rightIndent: 15, align: 'right', paragraphBefore: 80 },
      ]),
      firstEnd = req.paragraphs[0].end;
    req.frames = [
      { id: 'too-narrow', width: 30, height: 400 },
      { id: 'short', width: 150, height: 30, verticalAlign: 'bottom' },
      { id: 'wide', width: 400, height: 300, verticalAlign: 'center' },
    ];
    const metrics = await measure(service, req, [
      { start: 0, end: firstEnd, offset: 60 },
      { start: firstEnd, end: req.text.length, offset: 20 },
    ]);
    req.placements = [
      { end: firstEnd, frame: 1, baseline: metrics[0].ascent, left: 60, width: 80 },
      { end: req.text.length, frame: 2, baseline: metrics[1].ascent + 9, left: 20, width: 365 },
    ];
    const before = structuredClone(req),
      result = await service.compose(req),
      lines = result.layout.lines;
    assert.deepEqual(req, before, 'Composition changed the authored source or requested plan');
    assert.equal(result.protocol, 3);
    assert.equal(result.layout.coveredLength, req.text.length);
    assert.deepEqual(
      lines.map((line) => line.frame),
      ['short', 'wide'],
    );
    assert.deepEqual(
      lines.map((line) => line.placementIndex),
      [0, 1],
    );
    for (const [i, line] of lines.entries()) {
      close(line.baseline, req.placements[i].baseline, 'Requested baseline');
      close(line.ascent, metrics[i].ascent, 'Exact measured ascent');
      close(line.descent, metrics[i].descent, 'Exact measured descent');
      close(line.visibleWidth, metrics[i].width, 'Exact measured width');
      close(line.availableWidth, req.placements[i].width, 'Requested line area');
      assert.equal(line.paragraphStart, req.paragraphs[i].start);
      assert.equal(line.paragraphEnd, req.paragraphs[i].end);
      close(glyphs(line)[0].position[0], line.originX, 'Aligned glyph origin');
      close(line.carets[0].primary, line.originX, 'Aligned caret origin');
    }
    close(lines[0].originX, 60);
    close(lines[1].originX, 385 - lines[1].visibleWidth, 'Right-aligned planned line');
    const { placements, ...legacy } = req;
    await assert.rejects(
      service.compose({
        ...legacy,
        protocol: 2,
        mode: 'measure-lines-proof',
        candidates: [{ start: 0, end: firstEnd }],
      }),
      /indents/,
    );
  },
);

test(
  'planned fragments share a row while keeping exact source, tab offsets and glyph geometry',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      chunks = ['A\tB ', 'gamma delta\u2029'],
      req = await request(chunks.join(''), [
        { leftIndent: 12, firstLineIndent: 9, rightIndent: 10 },
      ]);
    req.runs[0].size = 11;
    req.placements = [
      { end: chunks[0].length, frame: 0, baseline: 24, left: 21, width: 95 },
      { end: req.text.length, frame: 0, baseline: 24, left: 140, width: 150 },
    ];
    const metrics = await measure(service, req, [
        { start: 0, end: chunks[0].length, offset: 21 },
        { start: chunks[0].length, end: req.text.length, offset: 140 },
      ]),
      result = await service.compose(req),
      lines = result.layout.lines;
    assert.deepEqual(
      lines.map(({ start, end }) => [start, end]),
      [
        [0, chunks[0].length],
        [chunks[0].length, req.text.length],
      ],
    );
    assert.deepEqual(
      lines.map((line) => line.baseline),
      [24, 24],
    );
    assert.deepEqual(
      lines.map((line) => line.originX),
      [21, 140],
    );
    assert.equal(result.layout.coveredLength, req.text.length);
    close(
      lines[0].carets.find((caret) => caret.index === 2).primary,
      36,
      'Frame-relative tab stop',
    );
    for (const [i, line] of lines.entries()) {
      close(line.visibleWidth, metrics[i].width);
      close(glyphs(line)[0].position[0], req.placements[i].left);
      assert.deepEqual(line.sourceRanges, [[line.start, line.end]]);
    }
  },
);

test(
  'future planned columns retain only the actual covered prefix and actual PDF pages',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Visible\u2029Future\u2029'),
      firstEnd = req.paragraphs[0].end;
    req.frames = [{ id: 'actual', width: 200, height: 100 }];
    req.placements = [
      { end: firstEnd, frame: 0, baseline: 20, left: 0, width: 200 },
      // A future column has no physical geometry to validate or retain yet.
      { end: req.text.length, frame: 1, baseline: 1000, left: 500, width: 1000 },
    ];
    const prefix = await service.compose(req),
      prefixPDF = await service.pdf(prefix.token);
    assert.equal(prefix.layout.coveredLength, firstEnd);
    assert.equal(prefix.layout.lines.length, 1);
    assert.deepEqual(prefix.diagnostics, ['overset']);
    assert.equal((await PDFDocument.load(Buffer.from(prefixPDF.data, 'base64'))).getPageCount(), 1);
    assert.equal(prefix.layout.lines[0].end, firstEnd);
    const complete = await service.compose({
      ...req,
      frames: [...req.frames, { id: 'now-actual', width: 1500, height: 1200 }],
    });
    assert.equal(complete.layout.coveredLength, req.text.length);
    assert.equal(
      (
        await PDFDocument.load(Buffer.from((await service.pdf(complete.token)).data, 'base64'))
      ).getPageCount(),
      2,
    );
    assert.deepEqual(
      complete.layout.lines.map((line) => line.frame),
      ['actual', 'now-actual'],
    );
    await assert.rejects(
      service.compose({
        ...req,
        placements: [req.placements[0], { ...req.placements[1], width: -1 }],
      }),
      /geometry/,
    );
    assert.equal(
      (
        await PDFDocument.load(Buffer.from((await service.pdf(prefix.token)).data, 'base64'))
      ).getPageCount(),
      1,
      'A later plan changed a frozen PDF token',
    );
  },
);

test(
  'planned lines reject malformed source, geometry and row order before producing a token',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Alpha beta\u2029Second\u2029'),
      firstEnd = req.paragraphs[0].end;
    req.placements = [
      { end: firstEnd, frame: 0, baseline: 20, left: 0, width: 300 },
      { end: req.text.length, frame: 0, baseline: 40, left: 0, width: 300 },
    ];
    const edge = await service.compose({
      ...req,
      placements: [req.placements[0], { ...req.placements[1], baseline: req.frames[0].height }],
    });
    assert.equal(edge.layout.lines.at(-1).baseline, req.frames[0].height);
    const changes = [
      { placements: undefined },
      { placements: [] },
      { paragraphs: undefined },
      { placements: [req.placements[0]] },
      { placements: [{ ...req.placements[0], end: 0 }, req.placements[1]] },
      { placements: [{ ...req.placements[0], end: firstEnd + 1 }, req.placements[1]] },
      {
        placements: [
          { ...req.placements[0], frame: 1 },
          { ...req.placements[1], frame: 0 },
        ],
      },
      { placements: [req.placements[0], { ...req.placements[1], frame: 128 }] },
      { placements: [req.placements[0], { ...req.placements[1], baseline: 19 }] },
      { placements: [req.placements[0], { ...req.placements[1], baseline: 20 }] },
      {
        placements: [
          req.placements[0],
          { ...req.placements[1], baseline: req.frames[0].height + 0.01 },
        ],
      },
      { placements: [{ ...req.placements[0], left: -1 }, req.placements[1]] },
      { placements: [{ ...req.placements[0], left: 1 }, req.placements[1]] },
      { placements: [{ ...req.placements[0], width: 0 }, req.placements[1]] },
      { placements: [{ ...req.placements[0], width: 3 }, req.placements[1]] },
      { placements: [{ ...req.placements[0], baseline: Number.NaN }, req.placements[1]] },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, firstLineIndent: -1 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, leftIndent: 10 })) },
    ];
    for (const change of changes) await assert.rejects(service.compose({ ...req, ...change }));
    const grapheme = await request('a\u0301b\u2029');
    await assert.rejects(
      service.compose({
        ...grapheme,
        placements: [
          { ...grapheme.placements[0], end: 1 },
          { ...grapheme.placements[0], baseline: 40 },
        ],
      }),
      /boundary/,
    );
    const soft = await request('Alpha\u2028Beta\u2029');
    await assert.rejects(
      service.compose({
        ...soft,
        placements: [
          { ...soft.placements[0], end: 6, width: 100 },
          { ...soft.placements[0], left: 120, width: 180 },
        ],
      }),
      /forced break/,
    );
    const row = await request('Alpha beta gamma\u2029');
    await assert.rejects(
      service.compose({
        ...row,
        placements: [
          { ...row.placements[0], end: 6, width: 150 },
          { ...row.placements[0], left: 149, width: 151 },
        ],
      }),
      /overlap/,
    );
    assert.equal((await service.compose(req)).layout.coveredLength, req.text.length);
  },
);

test(
  'planned lines keep protocol gates separate from legacy explicit and measured policies',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Protocol gates.\u2029');
    for (const protocol of [1, 2]) {
      const { paragraphs, ...base } = req,
        legacy = protocol === 1 ? base : req;
      await assert.rejects(service.compose({ ...legacy, protocol }), /protocol 3/);
      await assert.rejects(
        service.compose({
          ...legacy,
          protocol,
          mode: 'explicit-lines-proof',
          breaks: [req.text.length],
        }),
        /Placements/,
      );
      await assert.rejects(
        service.compose({
          ...legacy,
          protocol,
          mode: 'measure-lines-proof',
          candidates: [{ start: 0, end: req.text.length }],
        }),
        /Placements/,
      );
    }
    const { placements, ...base } = req;
    await assert.rejects(
      service.compose({ ...base, mode: 'greedy-geometry-proof' }),
      /measured or planned/,
    );
    await assert.rejects(
      service.compose({ ...base, mode: 'explicit-lines-proof', breaks: [req.text.length] }),
      /measured or planned/,
    );
    assert.ok((await measure(service, req, [{ start: 0, end: req.text.length }]))[0].width > 0);
    assert.ok(
      (await measure(service, req, [{ start: 0, end: req.text.length, offset: 14400 }]))[0].width >
        0,
    );
    for (const offset of [-1, 14401])
      await assert.rejects(
        measure(service, req, [{ start: 0, end: req.text.length, offset }]),
        /origin/,
      );
  },
);

test(
  'planned native PDF retains aligned source selection and exact planned baselines',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Shifted selectable text.\u2029Second selectable line.', [
        { align: 'right' },
        { align: 'center' },
      ]),
      firstEnd = req.paragraphs[0].end;
    req.frames = [
      { id: 'first', width: 320, height: 200, verticalAlign: 'bottom' },
      { id: 'second', width: 400, height: 240, verticalAlign: 'center' },
    ];
    req.placements = [
      { end: firstEnd, frame: 0, baseline: 31, left: 24, width: 260 },
      { end: req.text.length, frame: 1, baseline: 58, left: 60, width: 300 },
    ];
    const result = await service.compose(req),
      directory = await mkdtemp(path.join(tmpdir(), 'ivo-planned-pdf-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'planned.pdf'),
      reader = path.join(directory, 'read.swift');
    await writeFile(file, Buffer.from((await service.pdf(result.token)).data, 'base64'));
    await writeFile(
      reader,
      `import Foundation
import PDFKit
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
var rows: [[String: Any]] = []
for index in 0..<document.pageCount {
  let page = document.page(at: index)!
  let first = page.selection(for: NSRange(location: 0, length: 1))!.bounds(for: page)
  rows.append(["text": page.string ?? "", "left": first.minX, "top": page.bounds(for: .mediaBox).height - first.maxY])
}
print(String(data: try JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!)
`,
    );
    const { stdout } = await exec(
        '/usr/bin/xcrun',
        ['swift', '-module-cache-path', path.join(directory, 'cache'), reader, file],
        { timeout: 120000 },
      ),
      pages = JSON.parse(stdout);
    assert.equal(pages.length, 2);
    for (const [i, page] of pages.entries()) {
      const line = result.layout.lines[i];
      assert.equal(
        page.text.replaceAll('\n', ''),
        req.text.slice(line.start, line.end).replaceAll('\u2029', ''),
      );
      close(page.left, glyphs(line)[0].position[0], 'Independent selectable PDF origin');
      close(line.baseline, req.placements[i].baseline, 'Frozen planned baseline');
      assert.ok(page.top < line.baseline && page.top > line.baseline - line.ascent - 1);
    }
  },
);

test(
  'incremental editor output is identical to full Core Text across edits and shifted source ranges',
  mac,
  async (t) => {
    const { createInteractiveTextPort, restoreInteractiveLayout } =
      await import('../../src/rendering/text/retained-geometry.js');
    const service = await serviceFor(t),
      messages = [];
    let mismatch = false;
    const port = createInteractiveTextPort({
      async compose(input) {
        messages.push(input);
        const result = await service.compose(input);
        if (mismatch && input.retainedLines?.length) {
          mismatch = false;
          result.layout.lines.find((line) => line.retainedGeometry).width += 1;
        }
        return result;
      },
    });
    let resources;
    async function compare(parts, options = {}) {
      const req = await request(parts.map((s) => s + '\u2029').join(''));
      resources ??= req.resources;
      req.resources = resources;
      // A real flow maps text and its virtual separator independently.
      req.spans = req.paragraphs.flatMap(({ start, end }) => [
        { kind: 'text', start, end: end - 1, logicalStart: start, logicalEnd: end - 1 },
        { kind: 'paragraph', start: end - 1, end, logicalStart: end - 1, logicalEnd: end },
      ]);
      req.placements = req.paragraphs.map(({ end }, i) => ({
        end,
        frame: 0,
        baseline: 18 + 18 * i,
        left: 0,
        width: 300,
      }));
      if (options.left) Object.assign(req.placements.at(-1), { left: 2, width: 298 });
      for (const [i, left] of (options.insets || []).entries()) {
        Object.assign(req.placements[i], { left, width: 300 - left });
      }
      if (options.style) req.runs[0].tracking = 10;
      if (options.protocol) {
        req.protocol = options.protocol;
        req.runs[0].baselineShift = 1;
        req.runs[0].horizontalScale = 103;
        if (req.protocol === 5)
          for (const p of req.paragraphs)
            p.wordSpacing = { minimum: 80, desired: 115, maximum: 133 };
      }
      if (options.greedy) {
        req.mode = 'greedy-geometry-proof';
        delete req.placements;
      }
      const actual = await port.compose(req);
      const expected = await service.compose(req);
      if (options.readLater)
        options.readLater.push(() => assert.deepEqual(actual.layout, expected.layout));
      else assert.deepEqual(actual.layout, expected.layout);
      assert.deepEqual(actual.diagnostics, expected.diagnostics);
      assert.deepEqual(actual.vectors, expected.vectors);
      assert.ok(actual.token);
      return actual;
    }
    const versionA = ['Æther', 'Baker', 'Contour edge', 'Right margin'];
    const versionB = ['Turn', 'Œuvre', 'Contour edge', 'Right margin'];
    const cached = await compare(versionA);
    await compare(versionB, { insets: [0, 0, 12, 14] });
    restoreInteractiveLayout(cached);
    const mergedAt = messages.length;
    await compare([versionA[0], ...versionB.slice(1)], { insets: [0, 0, 12, 0] });
    assert.equal(
      messages.length,
      mergedAt + 1,
      'Every retained outline belongs to its specific native result',
    );
    assert.equal(
      messages[mergedAt].retainedLines.length,
      4,
      'Select matching text and physical fragments from both revisions',
    );
    const paragraphs = ['Office filing', 'A second phrase', 'Shifted caret', 'A second phrase'];
    const original = await compare(paragraphs);
    await compare(['Replacement A', 'Replacement B', 'Replacement C', 'Replacement D']);
    restoreInteractiveLayout(original);
    const restoredAt = messages.length;
    await compare(['x' + paragraphs[0], ...paragraphs.slice(1)]);
    assert.equal(
      messages[restoredAt].retainedLines.length,
      3,
      'Undo restores the source for the next edit',
    );
    // The user can type several distinct characters before scrolling to a
    // later page. Every past snapshot must still map the full source exactly.
    const readLater = [];
    for (const prefix of ['x', 'xy', 'xyz', 'xy', '']) {
      await compare([prefix + paragraphs[0], ...paragraphs.slice(1)], { readLater });
    }
    for (const verify of readLater) verify();
    const start = messages.length;
    const shifted = await compare(['The first paragraph changed', ...paragraphs.slice(1)]);
    assert.ok(messages[start].retainedLines.some((line) => line.start > 0));
    assert.equal(messages[start].resources[0].data, undefined);
    const frozen = await service.pdf(shifted.token);
    assert.equal((await PDFDocument.load(Buffer.from(frozen.data, 'base64'))).getPageCount(), 1);
    await compare(paragraphs);
    await compare([paragraphs[0], 'Edit in the middle', ...paragraphs.slice(2)]);
    await compare([...paragraphs.slice(0, 3), 'Last paragraph edit']);
    const copy = ['Collection', '“Prêt-à-porter” — café', 'Café and cafe\u0301…', 'Fall’s edit'];
    await compare(copy);
    const latinStart = messages.length;
    await compare(['Révision', ...copy.slice(1)]);
    assert.equal(messages[latinStart].retainedLines.length, 3);
    await compare(paragraphs, { left: true });
    await compare(paragraphs, { style: true });
    for (const protocol of [4, 5]) {
      await compare(paragraphs, { protocol });
      const before = messages.length;
      await compare(['Changed width', ...paragraphs.slice(1)], { protocol });
      assert.ok(messages[before].retainedLines?.length);
    }
    await compare(paragraphs, { style: true });
    await compare(paragraphs, { protocol: 4, greedy: true });
    const greedyStart = messages.length;
    await compare(['Alter early text', ...paragraphs.slice(1)], { protocol: 4, greedy: true });
    assert.ok(messages[greedyStart].retainedLines?.length);
    await compare(paragraphs, { style: true });
    mismatch = true;
    await compare(paragraphs, { style: true });
    assert.equal(mismatch, false);
    assert.equal(messages.at(-1).retainedLines, undefined);
  },
);

test(
  'planned overset retains full source with a visible or empty prefix and rejects malformed boundaries',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AB CD\u2029');
    for (const end of [0, 3]) {
      const partial = {
        ...req,
        oversetStart: end,
        placements: end ? [{ ...req.placements[0], end }] : [],
      };
      const result = await service.compose(partial);
      assert.equal(result.layout.textLength, req.text.length);
      assert.equal(result.layout.coveredLength, end);
      assert.equal(result.layout.lines.length, end ? 1 : 0);
    }
    for (const bad of [
      { ...req, oversetStart: 0 },
      { ...req, placements: [] },
      { ...req, placements: [], oversetStart: -1 },
      { ...req, placements: [], oversetStart: req.text.length },
    ])
      await assert.rejects(() => service.compose(bad));
  },
);

test(
  'automatic hyphen ink, exact-fit width and searchable PDF retain the original boundary',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    const req = await request('typesetting');
    const at = 4;
    const candidates = [
      { start: 0, end: at },
      { start: 0, end: req.text.length },
    ];
    const [plain, whole] = await measure(service, req, candidates);
    req.hyphenationPoints = [at, 7];
    const [split, wide] = await measure(service, req, candidates);
    assert.ok(split.width > plain.width);
    close(wide.width, whole.width);
    req.frames = [
      { id: 'first', width: split.width, height: 28 },
      { id: 'second', width: 180, height: 28 },
    ];
    req.placements = req.frames.map((f, i) => ({
      frame: i,
      end: i ? req.text.length : at,
      baseline: 18,
      left: 0,
      width: f.width,
    }));
    const result = await service.compose(req);
    const [first, second] = result.layout.lines;
    const ink = glyphs(first).filter((g) => g.generated);
    assert.equal(ink.length, 1);
    assert.deepEqual([ink[0].index, ink[0].end, ...ink[0].sourceRanges], [at, at]);
    assert.ok(result.vectors.some((v) => v.id === ink[0].vector && v.pathD));
    close(first.visibleWidth, split.width);
    close(first.carets.at(-1).primary, first.visibleWidth);
    assert.equal(second.carets[0].index, first.end);
    assert.equal(
      glyphs(second).some((g) => g.generated),
      false,
    );
    const folder = await mkdtemp(path.join(tmpdir(), 'ivo-auto-hyphen-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const reader = path.join(folder, 'read.swift'),
      file = path.join(folder, 'pages.pdf');
    await writeFile(file, Buffer.from((await service.pdf(result.token)).data, 'base64'));
    await writeFile(
      reader,
      `import Foundation
import PDFKit
let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
for i in 0..<pdf.pageCount { print(pdf.page(at: i)!.string ?? "") }
`,
    );
    const { stdout } = await exec('/usr/bin/xcrun', [
      'swift',
      '-module-cache-path',
      path.join(folder, 'cache'),
      reader,
      file,
    ]);
    assert.deepEqual(stdout.trim().split(/\s+/), ['type', 'setting']);
    req.placements[0].width -= 0.1;
    await assert.rejects(service.compose(req), /exceeds its indented line area/);
  },
);

test(
  'authored tabs align complete fields and resume the frame grid, matching InDesign',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    for (const [alignment, character, content, fieldStart, nextTab] of [
      ['left', undefined, '123.45', 80, 144],
      ['center', undefined, '123.45', 63.332, 108],
      ['right', undefined, '123.45', 46.664, 108],
      ['decimal', '.', '123.45', 62, 108],
      ['decimal', ',', '123,45', 62, 108],
      ['decimal', '.', '12345', 50, 108],
    ]) {
      const req = await request('A\t' + content + '\t2\t3', [
        {
          tabStops: [{ position: 80, alignment, ...(character ? { character } : {}) }],
          leftIndent: 18,
        },
      ]);
      req.protocol = 7;
      req.placements[0].left = 18;
      req.placements[0].width -= 18;
      const metrics = await measure(service, req, [{ start: 0, end: req.text.length, offset: 18 }]);
      const result = await service.compose(req),
        line = result.layout.lines[0];
      const x = (offset) => line.carets.find(({ index }) => index === offset).primary;
      assert.ok(
        Math.abs(x(2) - fieldStart) < 0.03,
        alignment + ': expected ' + fieldStart + ', got ' + x(2),
      );
      close(x(3 + content.length), nextTab, alignment + ' grid after custom stop');
      close(line.visibleWidth, metrics[0].width);
      assert.equal(result.layout.coveredLength, req.text.length);
    }
  },
);

test(
  'exported tabbed fields keep selectable text at the same anchor as the editor',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('A\t123.45', [
        {
          tabStops: [{ position: 80, alignment: 'decimal', character: '.', leader: '.' }],
        },
      ]);
    req.protocol = 7;
    const result = await service.compose(req);
    const dir = await mkdtemp(path.join(tmpdir(), 'ivo-tabbed-pdf-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'tabs.pdf'),
      reader = path.join(dir, 'read.swift');
    await writeFile(
      file,
      Buffer.from((await service.pdf(result.token, { invisible: false })).data, 'base64'),
    );
    await writeFile(
      reader,
      `import PDFKit
let page = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!.page(at: 0)!
let text = (page.string ?? "") as NSString
let field = text.range(of: "123.45")
guard field.location != NSNotFound, let selection = page.selection(for:NSRange(location:field.location+3,length:1)) else { exit(2) }
let scale = 4
let bitmap = CGContext(data:nil, width:300*scale, height:300*scale, bitsPerComponent:8, bytesPerRow:300*scale, space:CGColorSpaceCreateDeviceGray(), bitmapInfo:CGImageAlphaInfo.none.rawValue)!
bitmap.setFillColor(gray:1,alpha:1)
bitmap.fill(CGRect(x:0,y:0,width:300*scale,height:300*scale))
bitmap.scaleBy(x:CGFloat(scale),y:CGFloat(scale))
bitmap.drawPDFPage(page.pageRef!)
let pixels = bitmap.data!.assumingMemoryBound(to:UInt8.self)
var wasInk = false, count = 0
for x in 9*scale..<61*scale {
  let ink = (0..<300*scale).contains { pixels[$0*300*scale+x] < 160 }
  if ink && !wasInk { count += 1 }
  wasInk = ink
}
print(selection.bounds(for: page).minX, count)
`,
    );
    const { stdout } = await exec(
      '/usr/bin/xcrun',
      ['swift', '-module-cache-path', path.join(dir, 'cache'), reader, file],
      { timeout: 120000 },
    );
    const { leaders, carets } = result.layout.lines[0];
    const caret = carets.find(({ index }) => index === 5);
    assert.equal(leaders.length, 15);
    assert.ok(Math.abs(leaders[0].x - 10.0) < 0.03);
    assert.ok(Math.abs(leaders.at(-1).x - 56.71) < 0.03);
    assert.ok(leaders.every((ink) => result.vectors.some(({ id }) => id === ink.vector)));
    const [decimalX, printedDots] = stdout.trim().split(/\s+/).map(Number);
    close(decimalX, caret.primary, 'Selectable PDF decimal anchor');
    assert.equal(printedDots, leaders.length, 'Independent rasterized PDF leader count');
  },
);

test(
  'a field too wide to align starts at the preceding character and a passed stop resumes the ruler',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    for (const [alignment, position, expected] of [
      ['right', 25, 18],
      ['center', 25, 18],
      ['decimal', 25, 18],
      ['right', 10, 36],
    ]) {
      const req = await request('AA\t123.45', [
        {
          tabStops: [
            { position, alignment, ...(alignment === 'decimal' ? { character: '.' } : {}) },
          ],
        },
      ]);
      req.protocol = 7;
      const {
        layout: {
          lines: [line],
        },
      } = await service.compose(req);
      close(
        line.carets.find((c) => c.index === 3).primary,
        expected,
        alignment + ' crowded field at ' + position,
      );
    }
  },
);

test(
  'a two-character leader retains its ruler phase with the shorter field gap of a right tab',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    const req = await request('A\t123.45', [
      { tabStops: [{ position: 80, alignment: 'right', leader: '.-' }] },
    ]);
    req.protocol = 7;
    const result = await service.compose(req);
    const dots = result.layout.lines[0].leaders.toSorted((a, b) => a.x - b.x);
    assert.equal(dots.length, 9);
    assert.ok(Math.abs(dots[0].x - 10.658) < 0.02);
    for (let i = 1; i < dots.length; i++) assert.notEqual(dots[i].vector, dots[i - 1].vector);
    assert.equal(result.layout.lines[0].carets.length, req.text.length + 1);
  },
);

test(
  'inline graphics reserve their exact advance and ascent; above-line artwork reserves height at one caret',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('A\uFFFCB\u2029');
    req.protocol = 9;
    req.runs = [
      { ...req.runs[0], end: 1 },
      { ...req.runs[0], start: 1, end: 2, objectWidth: 45, objectHeight: 30, aboveLine: false },
      { ...req.runs[0], start: 2 },
    ];
    const [inline] = await measure(service, req, [{ start: 0, end: 3 }]);
    const layout = await service.compose({
      ...req,
      placements: [{ end: 4, frame: 0, baseline: 36, left: 0, width: 300 }],
    });
    const x = (index) => layout.layout.lines[0].carets.find((c) => c.index === index).primary;
    close(x(2) - x(1), 45);
    close(inline.ascent, 30);
    req.runs[1].aboveLine = true;
    const [above] = await measure(service, req, [{ start: 0, end: 3 }]);
    close(inline.width - above.width, 45);
    assert.ok(above.ascent >= 40);
  },
);
