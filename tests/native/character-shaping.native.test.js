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
  close = (actual, expected, label = 'Native character coordinate') =>
    assert.ok(Math.abs(actual - expected) < 0.001, `${label}: ${actual} versus ${expected}`),
  glyphs = (line) => line.runs.flatMap((run) => run.glyphs),
  glyphIDs = (result) =>
    result.layout.lines.flatMap((line) => glyphs(line).map((glyph) => glyph.glyph));

async function request(text, { font = 'cmu', ...style } = {}) {
  const bytes = await readFile(
      new URL(
        font === 'cmu'
          ? '../../public/fonts/cmu-serif/cmunrm.ttf'
          : '../../public/fonts/geist/Geist-Variable.ttf',
        import.meta.url,
      ),
    ),
    sourceHTML = '<p>' + text + '</p>';
  return {
    protocol: 4,
    mode: 'planned-lines-proof',
    id: 'native-character-fixture',
    sourceHTML,
    sourceDigest: hash(sourceHTML),
    logicalLength: text.length,
    text,
    paragraphs: [
      {
        start: 0,
        end: text.length,
        align: 'left',
        paragraphBefore: 0,
        paragraphAfter: 0,
        leftIndent: 0,
        rightIndent: 0,
        firstLineIndent: 0,
      },
    ],
    spans: [{ kind: 'text', start: 0, end: text.length, logicalStart: 0, logicalEnd: text.length }],
    runs: [
      {
        start: 0,
        end: text.length,
        font,
        size: 12,
        ligatures: true,
        tracking: 0,
        leading: 16,
        ...style,
      },
    ],
    resources: [
      {
        id: font,
        digest: hash(bytes),
        postscript: font === 'cmu' ? 'CMUSerif-Roman' : 'Geist-Regular',
        data: bytes.toString('base64'),
      },
    ],
    frames: [{ id: 'first', width: 500, height: 100 }],
    placements: [{ end: text.length, frame: 0, baseline: 20, left: 10, width: 490 }],
    allowFallback: false,
    includeVectors: true,
  };
}

async function serviceFor(t) {
  const service = createTextComposition(await buildNativeText());
  t.after(() => service.close());
  return service;
}

async function measure(service, req) {
  const { placements, ...base } = req;
  return (
    await service.compose({
      ...base,
      mode: 'measure-lines-proof',
      candidates: [{ start: 0, end: req.text.length, offset: 10 }],
      includeVectors: false,
    })
  ).measurements[0];
}

test(
  'protocol4 defaults preserve protocol3 shaped source, glyphs, carets and layout struts',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Unchanged default source.\u2029'),
      before = structuredClone(req),
      current = await service.compose(req),
      legacy = await service.compose({ ...req, protocol: 3 });
    assert.equal(current.protocol, 4);
    assert.deepEqual(req, before);
    assert.equal(current.layout.coveredLength, req.text.length);
    assert.deepEqual(current.vectors, legacy.vectors);
    for (const [i, line] of current.layout.lines.entries()) {
      const previous = legacy.layout.lines[i];
      for (const field of [
        'start',
        'end',
        'baseline',
        'ascent',
        'descent',
        'leading',
        'visibleWidth',
        'originX',
        'availableWidth',
      ])
        close(line[field], previous[field], field);
      assert.deepEqual(line.carets, previous.carets);
      assert.deepEqual(glyphs(line), glyphs(previous));
      close(line.inkAscent, line.ascent);
      close(line.inkDescent, line.descent);
    }
  },
);

test(
  'character scale and baseline shift retain untransformed measured layout struts',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      base = await request('ABC xyz\u2029'),
      natural = await measure(service, base),
      control = (await service.compose(base)).layout.lines[0];
    for (const style of [
      { horizontalScale: 150 },
      { verticalScale: 150 },
      { baselineShift: 4 },
      { baselineShift: -4 },
      { verticalScale: 150, baselineShift: 4 },
    ]) {
      const req = await request(base.text, style),
        before = structuredClone(req),
        metrics = await measure(service, req),
        result = await service.compose(req),
        line = result.layout.lines[0],
        h = (style.horizontalScale || 100) / 100,
        v = (style.verticalScale || 100) / 100,
        shift = style.baselineShift || 0;
      assert.deepEqual(req, before);
      for (const field of ['ascent', 'descent', 'leading', 'advance', 'capHeight', 'xHeight'])
        close(metrics[field], natural[field], 'Untransformed ' + field);
      close(metrics.width, natural.width * h, 'Transformed measured width');
      close(metrics.inkAscent, natural.ascent * v + shift);
      close(metrics.inkDescent, natural.descent * v - shift);
      close(line.ascent, natural.ascent);
      close(line.descent, natural.descent);
      close(line.baseline, 20);
      close(line.inkAscent, metrics.inkAscent);
      close(line.inkDescent, metrics.inkDescent);
      const actual = glyphs(line),
        original = glyphs(control);
      assert.equal(actual.length, original.length);
      for (const [i, glyph] of actual.entries()) {
        close(glyph.position[0], 10 + (original[i].position[0] - 10) * h, 'Matrix-mapped glyph x');
        close(glyph.position[1], shift, 'Baseline-mapped glyph y');
        close(glyph.advance[0], original[i].advance[0] * h, 'Already-scaled glyph advance');
      }
    }
  },
);

test(
  'horizontal character scale multiplies authored tracking and leaves native caret coordinates positioned',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      base = await request('ABC xyz\u2029', { tracking: 100 }),
      scaled = await request(base.text, { tracking: 100, horizontalScale: 150 }),
      control = (await service.compose(base)).layout.lines[0],
      line = (await service.compose(scaled)).layout.lines[0];
    for (const [i, glyph] of glyphs(line).entries())
      close(
        glyph.position[0] - 10,
        (glyphs(control)[i].position[0] - 10) * 1.5,
        'Scaled tracking origin',
      );
    for (const [i, caret] of line.carets.entries()) {
      close(caret.primary - 10, (control.carets[i].primary - 10) * 1.5, 'Native primary caret');
      close(
        caret.secondary - 10,
        (control.carets[i].secondary - 10) * 1.5,
        'Native secondary caret',
      );
    }
  },
);

test(
  'small scaled runs retain signed shifted ink boxes and a line unions both extremes',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      natural = await measure(service, await request('AA\u2029')),
      height = (natural.ascent + natural.descent) * 0.1;
    for (const shift of [-40, 40]) {
      const req = await request('AA\u2029', { verticalScale: 10, baselineShift: shift }),
        metrics = await measure(service, req),
        line = (await service.compose(req)).layout.lines[0];
      close(metrics.inkAscent, natural.ascent * 0.1 + shift);
      close(metrics.inkDescent, natural.descent * 0.1 - shift);
      close(metrics.inkAscent + metrics.inkDescent, height, 'Shifted line font box height');
      close(line.inkAscent, metrics.inkAscent);
      close(line.inkDescent, metrics.inkDescent);
      close(line.runs[0].inkAscent, metrics.inkAscent);
      close(line.runs[0].inkDescent, metrics.inkDescent);
      assert.ok(
        shift < 0 ? line.inkAscent < 0 : line.inkDescent < 0,
        'Ink must not be clamped back to the unshifted baseline',
      );
    }
    const mixed = await request('AA\u2029', { verticalScale: 10 });
    mixed.runs = [
      { ...mixed.runs[0], end: 1, baselineShift: 40 },
      { ...mixed.runs[0], start: 1, baselineShift: -40 },
    ];
    const line = (await service.compose(mixed)).layout.lines[0];
    close(line.inkAscent, Math.max(...line.runs.map((run) => run.inkAscent)));
    close(line.inkDescent, Math.max(...line.runs.map((run) => run.inkDescent)));
    close(line.inkAscent + line.inkDescent, height + 80, 'Mixed shifted run box union');
    close(line.ascent, natural.ascent, 'Unchanged union strut');
    close(line.descent, natural.descent, 'Unchanged union descent');
  },
);

test(
  'variable font instances use independent outlines, advances, and cached identities',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AAAB\u2029', { font: 'geist' }),
      weights = [330.5, 700, 330.5];
    req.runs = [
      ...weights.map((weight, i) => ({
        ...req.runs[0],
        start: i,
        end: i + 1,
        variations: { wght: weight },
      })),
      { ...req.runs[0], start: 3 },
    ];
    const result = await service.compose(req),
      [light, bold, again] = glyphs(result.layout.lines[0]),
      paths = new Map(result.vectors.map((vector) => [vector.id, vector.pathD]));
    assert.equal(light.glyph, bold.glyph);
    assert.notEqual(paths.get(light.vector), paths.get(bold.vector));
    assert.ok(bold.advance[0] > light.advance[0]);
    assert.equal(again.vector, light.vector);
    assert.equal(again.advance[0], light.advance[0]);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual((await service.compose(req)).vectors, result.vectors);
    for (const patch of [{ wght: 901 }, { xxxx: 42 }]) {
      const bad = await request('A\u2029', { font: 'geist', variations: patch });
      await assert.rejects(service.compose(bad), /axis|coordinate/i);
    }
    await assert.rejects(
      service.compose(await request('A\u2029', { variations: { wght: 700 } })),
      /axis|coordinate/i,
    );
  },
);

test(
  'scaled glyph paths have separate cache identities and preserve mixed-run source positions',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AA\u2029');
    req.runs = [
      { ...req.runs[0], end: 1 },
      { ...req.runs[0], start: 1, horizontalScale: 150, verticalScale: 125, baselineShift: 3 },
    ];
    const first = await service.compose(req),
      line = first.layout.lines[0],
      [a, b] = glyphs(line),
      paths = new Map(first.vectors.map((vector) => [vector.id, vector.pathD]));
    assert.equal(a.glyph, b.glyph);
    assert.notEqual(a.vector, b.vector);
    const extent = (source, axis) => {
      const numbers = source.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number),
        values = numbers.filter((_, i) => i % 2 === axis);
      return Math.max(...values) - Math.min(...values);
    };
    close(
      extent(paths.get(b.vector), 0),
      extent(paths.get(a.vector), 0) * 1.5,
      'Scaled path width',
    );
    close(
      extent(paths.get(b.vector), 1),
      extent(paths.get(a.vector), 1) * 1.25,
      'Scaled path height',
    );
    close(b.position[0], a.position[0] + a.advance[0], 'Mixed transform source continuation');
    close(b.position[1], 3);
    assert.deepEqual(
      line.runs.map(({ start, end }) => [start, end]),
      [
        [0, 1],
        [1, 2],
      ],
    );
    const again = await service.compose(req);
    assert.deepEqual(again.layout, first.layout);
    assert.deepEqual(again.vectors, first.vectors);
  },
);

test(
  'scaled tracked text aligns its final caret to the requested visual line area',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    for (const [align, flush] of [
      ['center', 0.5],
      ['right', 1],
    ]) {
      const req = await request('ABC xyz\u2029', { horizontalScale: 150, tracking: 100 });
      req.paragraphs[0].align = align;
      const line = (await service.compose(req)).layout.lines[0],
        last = line.carets.find((caret) => caret.index === line.contentEnd);
      close(line.originX, 10 + (490 - line.visibleWidth) * flush, 'Tracking-aware flush origin');
      close(last.primary, line.originX + line.visibleWidth, 'Final visual caret');
    }
  },
);

test(
  'exact shipped fonts apply real OpenType substitutions while preserving source indexes',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    for (const [font, text, features] of [
      ['cmu', 'office abc\u2029', { smcp: true }],
      ['cmu', '0123456789\u2029', { onum: true }],
      ['geist', '1/2 3/4\u2029', { frac: true }],
      ['geist', '1a 2o\u2029', { ordn: true }],
    ]) {
      const req = await request(text, { font, features }),
        original = structuredClone(req),
        result = await service.compose(req),
        control = await service.compose(await request(text, { font }));
      assert.notDeepEqual(
        glyphIDs(result),
        glyphIDs(control),
        font + ' ' + Object.keys(features).join(',') + ' actual feature substitutions',
      );
      assert.deepEqual(req, original);
      assert.equal(result.layout.coveredLength, text.length);
      assert.ok(
        glyphs(result.layout.lines[0]).every(
          (glyph) => glyph.index >= 0 && glyph.end <= text.length,
        ),
      );
    }
    const onum = await service.compose(
        await request('0123456789\u2029', { features: { onum: true } }),
      ),
      regular = await service.compose(await request('0123456789\u2029'));
    close(
      onum.layout.lines[0].visibleWidth,
      regular.layout.lines[0].visibleWidth,
      'Same width can still contain different glyphs',
    );
  },
);

test(
  'native character feature availability distinguishes missing tags from unchanged supported samples and missing glyphs',
  mac,
  async (t) => {
    const service = await serviceFor(t);
    await assert.rejects(
      service.compose(await request('abc\u2029', { features: { dlig: true } })),
      /feature.*dlig|dlig.*feature/i,
    );
    const req = await request('abc\u2029', { features: { dlig: false, salt: true } }),
      result = await service.compose(req),
      control = await service.compose(await request(req.text));
    assert.deepEqual(
      glyphIDs(result),
      glyphIDs(control),
      'A declared feature need not substitute this sample',
    );
    const ordinals = await service.compose(
        await request('1st 2nd\u2029', { font: 'geist', features: { ordn: true } }),
      ),
      plainOrdinals = await service.compose(await request('1st 2nd\u2029', { font: 'geist' }));
    assert.deepEqual(
      glyphIDs(ordinals),
      glyphIDs(plainOrdinals),
      'Declared ordinals need an applicable glyph sequence',
    );
    await assert.rejects(service.compose(await request('abc\u{10ffff}\u2029')), /fallback|glyph/i);
  },
);

test(
  'protocol4 validates character transport without broadening legacy protocol semantics',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Bounded character transport.\u2029');
    for (const style of [
      { baselineShift: -2001 },
      { baselineShift: 2001 },
      { horizontalScale: 9 },
      { verticalScale: 1001 },
      { baselineShift: Number.NaN },
      { baselineShift: null },
      { horizontalScale: null },
      { verticalScale: null },
      { features: null },
      { features: { xxxx: true } },
      { features: { frac: 2 } },
    ]) {
      await assert.rejects(
        service.compose({ ...req, runs: req.runs.map((run) => ({ ...run, ...style })) }),
      );
    }
    for (const protocol of [1, 2, 3]) {
      const { placements, paragraphs, ...base } = req,
        legacy = protocol === 1 ? base : { ...base, paragraphs };
      for (const style of [
        { baselineShift: 0 },
        { horizontalScale: 100 },
        { verticalScale: 100 },
        { features: {} },
      ]) {
        await assert.rejects(
          service.compose({
            ...legacy,
            protocol,
            mode: 'measure-lines-proof',
            candidates: [{ start: 0, end: req.text.length }],
            runs: req.runs.map((run) => ({ ...run, ...style })),
          }),
          /protocol 4/i,
        );
      }
    }
  },
);

test(
  'character transforms preserve blank-row struts and native greedy baseline policies',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      base = await request('A\u2028B\u2029', { leading: 0, autoLeading: 120 }),
      changed = await request(base.text, {
        leading: 0,
        autoLeading: 120,
        verticalScale: 150,
        baselineShift: 4,
      });
    const greedy = (req) => {
      const { placements, ...rest } = req;
      return {
        ...rest,
        mode: 'greedy-geometry-proof',
        frames: [{ id: 'first', width: 500, height: 100, firstBaseline: 'ascent' }],
      };
    };
    const control = await service.compose(greedy(base)),
      result = await service.compose(greedy(changed));
    assert.deepEqual(
      result.layout.lines.map((line) => line.baseline),
      control.layout.lines.map((line) => line.baseline),
    );
    const blank = await request('\u2029', { verticalScale: 150, baselineShift: 4 }),
      original = await measure(service, await request('\u2029')),
      measured = await measure(service, blank),
      line = (await service.compose(blank)).layout.lines[0];
    close(measured.ascent, original.ascent);
    close(line.ascent, original.ascent);
    close(measured.advance, original.advance);
    close(line.inkAscent, original.ascent * 1.5 + 4);
    assert.equal(line.carets[0].measurement, 'empty-paragraph-origin');
  },
);

test(
  'native character PDF uses the same matrix-mapped selectable glyph positions and shifts',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('AB CD\u2029');
    req.runs = [
      { ...req.runs[0], end: 3 },
      { ...req.runs[0], start: 3, horizontalScale: 150, verticalScale: 125, baselineShift: 4 },
    ];
    const result = await service.compose(req),
      line = result.layout.lines[0],
      directory = await mkdtemp(path.join(tmpdir(), 'ivo-character-pdf-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'character.pdf'),
      reader = path.join(directory, 'read.swift');
    await writeFile(
      file,
      Buffer.from((await service.pdf(result.token, { invisible: false })).data, 'base64'),
    );
    await writeFile(
      reader,
      `import Foundation
import PDFKit
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let page = document.page(at: 0)!
let scale = 3, width = 1500, height = 300
let pixels = UnsafeMutablePointer<UInt8>.allocate(capacity: width * height)
defer { pixels.deallocate() }
let bitmap = CGContext(data: pixels, width: width, height: height, bitsPerComponent: 8,
 bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
bitmap.setFillColor(gray: 1, alpha: 1)
bitmap.fill(CGRect(x: 0, y: 0, width: width, height: height))
bitmap.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
bitmap.drawPDFPage(page.pageRef!)
var rows: [[String: Any]] = []
for index in [0, 3] {
 let box = page.selection(for: NSRange(location: index, length: 1))!.bounds(for: page)
 var occupied: [Int] = []
 let left = max(0, Int(ceil(box.minX * CGFloat(scale))) + 1)
 let right = min(width - 1, Int(floor(box.maxX * CGFloat(scale))) - 1)
 for y in 0..<height {
   if (left...right).contains(where: { pixels[y * width + $0] < 128 }) { occupied.append(y) }
 }
 rows.append(["index": index, "left": box.minX, "rasterMinY": occupied.min() ?? -1, "rasterMaxY": occupied.max() ?? -1])
}
let bottomUp = (rows[0]["rasterMinY"] as! Int) > height / 2
for index in rows.indices {
 rows[index]["inkTop"] = bottomUp
   ? Double(height - (rows[index]["rasterMaxY"] as! Int)) / Double(scale)
   : Double(rows[index]["rasterMinY"] as! Int) / Double(scale)
}
print(String(data: try JSONSerialization.data(withJSONObject: ["text": page.string ?? "", "selections": rows]), encoding: .utf8)!)
`,
    );
    const { stdout } = await exec(
        '/usr/bin/xcrun',
        ['swift', '-module-cache-path', path.join(directory, 'cache'), reader, file],
        { timeout: 120000 },
      ),
      independent = JSON.parse(stdout);
    assert.equal(independent.text.replaceAll('\n', ''), 'AB CD');
    for (const selected of independent.selections) {
      const glyph = glyphs(line).find((g) => g.index === selected.index);
      close(selected.left, glyph.position[0], 'PDF selectable transformed origin');
    }
    assert.ok(
      independent.selections.every((part) => part.rasterMinY >= 0),
      'PDF glyph ink must be visible',
    );
    assert.ok(
      independent.selections[1].inkTop < independent.selections[0].inkTop - 3.5,
      'Independent PDF raster must retain the positive baseline shift and vertical scale',
    );
  },
);
