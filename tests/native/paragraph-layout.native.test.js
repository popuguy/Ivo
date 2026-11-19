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

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  mac = { skip: process.platform !== 'darwin' },
  exec = promisify(execFile),
  close = (a, b, label = 'Native paragraph coordinate differs') =>
    assert.ok(Math.abs(a - b) < 0.001, `${label}: ${a} versus ${b}`);
const defaults = {
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
    protocol: 2,
    mode: 'greedy-geometry-proof',
    id: 'native-paragraph-fixture',
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
    frames: [
      { id: 'first', width: 180, height: 600, firstBaseline: 'fixed', minimumFirstBaseline: 12 },
    ],
    allowFallback: false,
    includeVectors: true,
  };
}
async function serviceFor(t) {
  const service = createTextComposition(await buildNativeText());
  t.after(() => service.close());
  return service;
}
const glyphs = (line) => line.runs.flatMap((run) => run.glyphs);

test(
  'native paragraph protocol defaults retain legacy glyph, caret and break geometry',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Alpha beta gamma delta epsilon zeta.\u2029Another paragraph.'),
      legacy = structuredClone(req);
    delete legacy.paragraphs;
    legacy.protocol = 1;
    const old = await service.compose(legacy),
      current = await service.compose(req);
    assert.equal(old.protocol, 1);
    assert.equal(current.protocol, 2);
    assert.deepEqual(
      current.layout.lines.map(
        ({ originX, availableWidth, paragraphStart, paragraphEnd, ...line }) => {
          assert.equal(originX, 0);
          assert.equal(availableWidth, 180);
          assert.ok(paragraphEnd > paragraphStart);
          return line;
        },
      ),
      old.layout.lines,
    );
    assert.deepEqual(current.vectors, old.vectors);
    await assert.rejects(service.compose({ ...legacy, paragraphs: req.paragraphs }), /protocol 2/);
  },
);

test(
  'native paragraph alignment and last-line justification share positioned glyph and caret geometry',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      chunks = ['Alpha beta ', 'gamma delta ', 'epsilon zeta.\u2029'],
      text = chunks.join(''),
      breaks = chunks.map((_, i) => chunks.slice(0, i + 1).join('').length),
      base = await request(text),
      left = await service.compose({ ...base, mode: 'explicit-lines-proof', breaks });
    for (const align of [
      'center',
      'right',
      'end',
      'start',
      'justify',
      'justify-center',
      'justify-right',
      'justify-all',
    ]) {
      const req = await request(text, [{ align }]),
        result = await service.compose({ ...req, mode: 'explicit-lines-proof', breaks });
      assert.equal(result.layout.coveredLength, text.length);
      assert.deepEqual(
        result.layout.lines.map((line) => line.end),
        breaks,
      );
      for (const [i, line] of result.layout.lines.entries()) {
        const last = i === result.layout.lines.length - 1,
          justified = align.startsWith('justify') && (!last || align === 'justify-all'),
          flush =
            align === 'center' || (last && align === 'justify-center')
              ? 0.5
              : align === 'right' || align === 'end' || (last && align === 'justify-right')
                ? 1
                : 0;
        close(line.originX, (180 - line.visibleWidth) * flush, 'Alignment origin');
        if (justified) close(line.visibleWidth, 180, 'Justified line width');
        else close(line.visibleWidth, left.layout.lines[i].visibleWidth, 'Unstretched line width');
        close(glyphs(line)[0].position[0], line.originX, 'First glyph origin');
        close(line.carets[0].primary, line.originX, 'First caret origin');
      }
    }
    const one = await request('One\u2029', [{ align: 'justify-all' }]),
      singleWord = (await service.compose(one)).layout.lines[0],
      natural = (await service.compose(await request('One\u2029'))).layout.lines[0];
    close(singleWord.visibleWidth, 180, 'Fully justified single-word width');
    assert.ok(
      glyphs(singleWord)[1].position[0] > glyphs(natural)[1].position[0] + 10,
      'Fully justified single word did not expand between letters',
    );
  },
);

test(
  'native paragraph indents retain hanging first lines and suppress first indent after soft returns and continuation',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      chunks = ['Alpha beta\u2028', 'gamma delta ', 'epsilon zeta.\u2029'],
      text = chunks.join(''),
      req = await request(text, [{ leftIndent: 30, rightIndent: 20, firstLineIndent: -12 }]);
    req.mode = 'explicit-lines-proof';
    req.breaks = chunks.map((_, i) => chunks.slice(0, i + 1).join('').length);
    req.frames = [
      { ...req.frames[0], height: 31 },
      { ...req.frames[0], id: 'second', height: 200 },
    ];
    const result = await service.compose(req),
      lines = result.layout.lines;
    assert.equal(lines.length, 3);
    assert.equal(lines[0].frame, 'first');
    assert.equal(lines[1].frame, 'first');
    assert.equal(lines[2].frame, 'second');
    assert.deepEqual(
      lines.map((line) => line.originX),
      [18, 30, 30],
    );
    assert.deepEqual(
      lines.map((line) => line.availableWidth),
      [142, 130, 130],
    );
    for (const line of lines) {
      close(glyphs(line)[0].position[0], line.originX);
      close(line.carets[0].primary, line.originX);
    }
  },
);

test(
  'paragraph spacing sums between paragraphs and disappears at physical column tops',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('A\u2029B\u2028C\u2029\u2029D', [
        { paragraphBefore: 100, paragraphAfter: 10 },
        { paragraphBefore: 7, paragraphAfter: 11 },
        { paragraphBefore: 3, paragraphAfter: 5 },
        { paragraphBefore: 2, paragraphAfter: 100 },
      ]),
      result = await service.compose(req),
      lines = result.layout.lines;
    assert.deepEqual(
      lines.map((line) => line.baseline),
      [12, 45, 61, 91, 114],
    );
    const continued = await request('A\u2029B\u2029', [
      { paragraphAfter: 11 },
      { paragraphBefore: 25 },
    ]);
    continued.frames = [
      { ...continued.frames[0], height: 20 },
      { ...continued.frames[0], id: 'second', height: 20 },
    ];
    const flowed = await service.compose(continued);
    assert.deepEqual(
      flowed.layout.lines.map((line) => line.baseline),
      [12, 12],
    );
    assert.equal(flowed.layout.coveredLength, continued.text.length);
  },
);

test(
  'native indented half-inch tabs keep frame-relative origins in geometry and measured alternatives',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('A\tB\tC\u2029', [{ leftIndent: 18, firstLineIndent: 9 }]),
      result = await service.compose({
        ...req,
        runs: req.runs.map((run) => ({ ...run, size: 11 })),
      }),
      line = result.layout.lines[0];
    // At 12pt CMU's A ends exactly on the 36pt stop, so the following tab
    // correctly skips to 72pt. At 11pt it ends before 36pt and uses that stop.
    req.runs[0].size = 11;
    for (const [index, x] of [
      [0, 27],
      [2, 36],
      [4, 72],
    ])
      close(line.carets.find((caret) => caret.index === index).primary, x, 'Frame-relative tab');
    const measured = await service.compose({
      ...req,
      mode: 'measure-lines-proof',
      includeVectors: false,
      candidates: [{ start: 0, end: req.text.length, offset: 27 }],
    });
    close(measured.measurements[0].width, line.visibleWidth, 'Offset-aware line measurement');
    const zeroOffset = await service.compose({
      ...req,
      mode: 'measure-lines-proof',
      candidates: [{ start: 0, end: req.text.length, offset: 0 }],
    });
    close(zeroOffset.measurements[0].width - measured.measurements[0].width, 27);
  },
);

test(
  'paragraph protocol rejects missing, discontinuous and impossible layout before producing a token',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Alpha\u2029Beta\u2029');
    for (const change of [
      { paragraphs: undefined },
      { paragraphs: [] },
      { paragraphs: [{ ...req.paragraphs[0], end: req.text.length }] },
      { paragraphs: [req.paragraphs[0]] },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, leftIndent: 180 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, leftIndent: -1 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, rightIndent: -1 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, firstLineIndent: -1 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, paragraphBefore: -1 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, firstLineIndent: 2001 })) },
      { paragraphs: req.paragraphs.map((p) => ({ ...p, align: 'magic' })) },
    ])
      await assert.rejects(service.compose({ ...req, ...change }));
    await assert.rejects(
      service.compose({
        ...req,
        mode: 'measure-lines-proof',
        candidates: [{ start: 0, end: 6, offset: 4001 }],
      }),
      /origin/,
    );
    await assert.rejects(
      service.compose(await request('A\tB', [{ align: 'center' }])),
      /tab policy/,
    );
    assert.equal((await service.compose(req)).layout.coveredLength, req.text.length);
  },
);

test(
  'native paragraph PDF retains exact shifted text placement and selectable source',
  mac,
  async (t) => {
    const service = await serviceFor(t),
      req = await request('Aligned native paragraph.', [
        { align: 'right', leftIndent: 10, rightIndent: 20 },
      ]),
      result = await service.compose(req),
      line = result.layout.lines[0],
      directory = await mkdtemp(path.join(tmpdir(), 'ivo-paragraph-pdf-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'paragraph.pdf'),
      reader = path.join(directory, 'read.swift');
    await writeFile(file, Buffer.from((await service.pdf(result.token)).data, 'base64'));
    await writeFile(
      reader,
      `import Foundation
import PDFKit
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let page = document.page(at: 0)!
let first = page.selection(for: NSRange(location: 0, length: 1))!.bounds(for: page)
let result: [String: Any] = ["text": page.string ?? "", "left": first.minX, "top": page.bounds(for: .mediaBox).height - first.maxY]
print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
`,
    );
    const { stdout } = await exec(
      '/usr/bin/xcrun',
      ['swift', '-module-cache-path', path.join(directory, 'cache'), reader, file],
      { timeout: 120000 },
    );
    const independent = JSON.parse(stdout);
    assert.equal(independent.text.replaceAll('\n', ''), req.text);
    close(independent.left, glyphs(line)[0].position[0], 'Independent selectable PDF origin');
    assert.ok(independent.top < line.baseline && independent.top > 0);
  },
);
