import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { buildNativeText } from '../../scripts/build-native-text.mjs';
import { createTextComposition } from '../../desktop/text-composition.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
async function request(
  text = 'Office affinity and exact native typography.\u2029Second paragraph.',
) {
  const bytes = await readFile(new URL('../../public/fonts/cmu-serif/cmunrm.ttf', import.meta.url));
  const sourceHTML = '<p>' + text + '</p>';
  return {
    protocol: 1,
    mode: 'greedy-geometry-proof',
    id: 'native-fixture',
    sourceHTML,
    sourceDigest: hash(sourceHTML),
    logicalLength: text.length,
    text,
    spans: [{ kind: 'text', start: 0, end: text.length, logicalStart: 0, logicalEnd: text.length }],
    runs: [{ start: 0, end: text.length, font: 'cmu', size: 12, ligatures: true, tracking: 0 }],
    resources: [
      {
        id: 'cmu',
        digest: hash(bytes),
        postscript: 'CMUSerif-Roman',
        data: bytes.toString('base64'),
      },
    ],
    frames: [
      { id: 'first', width: 160, height: 80 },
      { id: 'second', width: 220, height: 100 },
    ],
    allowFallback: false,
    includeVectors: true,
  };
}
const portable = (req) => ({
  ...req,
  resources: req.resources.map(({ data: _data, ...resource }) => resource),
});

test(
  'persistent native composition retains exact fonts, vectors, geometry and immutable PDF lines',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const executable = await buildNativeText();
    let process;
    const service = createTextComposition(executable, {
      spawn: (...args) => (process = spawn(...args)),
    });
    t.after(() => service.close());
    const req = await request(),
      began = performance.now(),
      result = await service.compose(req);
    const cold = performance.now() - began;
    assert.equal(result.layout.coveredLength, req.text.length);
    assert(result.layout.lines.length >= 3);
    assert(result.vectors.length > 10);
    assert(
      result.vectors.every(
        ({ id, pathD }) => /^g-[a-f0-9]{64}$/.test(id) && /^[MLQCZ0-9eE+.,\s-]+$/.test(pathD),
      ),
    );
    assert(
      result.layout.lines
        .flatMap((line) => line.runs)
        .every(
          (run) => run.font === 'CMUSerif-Roman' && run.underlineThickness > 0 && run.xHeight > 0,
        ),
    );
    const warmBegan = performance.now(),
      warm = await service.compose(portable(req));
    t.diagnostic(
      JSON.stringify({
        coldMs: +cold.toFixed(2),
        cachedMs: +(performance.now() - warmBegan).toFixed(2),
        lines: result.layout.lines.length,
        vectorCount: result.vectors.length,
      }),
    );
    assert.equal(warm.token, result.token);
    assert.deepEqual(warm.layout, result.layout);
    assert.deepEqual(warm.vectors, result.vectors);
    const visible = await service.pdf(result.token, { invisible: false });
    const invisible = await service.pdf(result.token);
    for (const pdf of [visible, invisible]) {
      const doc = await PDFDocument.load(Buffer.from(pdf.data, 'base64'));
      assert.deepEqual(
        doc.getPages().map((page) => [page.getWidth(), page.getHeight()]),
        [
          [160, 80],
          [220, 100],
        ],
      );
    }
    const oldProcess = process;
    oldProcess.kill('SIGKILL');
    await once(oldProcess, 'close');
    // The client has no font data in this request; it must register retained exact bytes after restart.
    const recovered = await service.compose(portable(req));
    assert.equal(recovered.token, result.token);
    assert.deepEqual(recovered.layout, result.layout);
    assert.deepEqual(recovered.vectors, result.vectors);
    process.kill('SIGKILL');
    await once(process, 'close');
    const recoveredPDF = await service.pdf(result.token);
    assert.equal(recoveredPDF.token, result.token);
    assert.equal(
      (await PDFDocument.load(Buffer.from(recoveredPDF.data, 'base64'))).getPageCount(),
      2,
    );
    const corrupted = structuredClone(req);
    corrupted.resources[0].data = Buffer.alloc(100, 3).toString('base64');
    await assert.rejects(service.compose(corrupted), /digest mismatch/);
    const rebound = structuredClone(req);
    rebound.resources[0].postscript = 'Wrong-Font';
    await assert.rejects(service.compose(rebound), /identity mismatch/);
    const changed = structuredClone(req);
    changed.runs[0].size = 13;
    const changedResult = await service.compose(changed);
    const before = result.layout.lines
      .flatMap((l) => l.runs)
      .flatMap((r) => r.glyphs)
      .find((g) => g.vector);
    const after = changedResult.layout.lines
      .flatMap((l) => l.runs)
      .flatMap((r) => r.glyphs)
      .find((g) => g.vector);
    assert.equal(before.glyph, after.glyph);
    assert.notEqual(before.vector, after.vector);
  },
);

test(
  'native leading is baseline spacing, including mixed ascent and deliberately overlapping fixed leading',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const service = createTextComposition(await buildNativeText());
    t.after(() => service.close());
    const req = await request('small\u2029LARGE\u2029small');
    req.frames = [{ id: 'first', width: 220, height: 200 }];
    req.runs = [
      {
        start: 0,
        end: 6,
        font: 'cmu',
        size: 10,
        ligatures: true,
        tracking: 0,
        leading: 7,
        textColor: '#123456',
      },
      {
        start: 6,
        end: 12,
        font: 'cmu',
        size: 30,
        ligatures: true,
        tracking: 0,
        leading: 8,
        textColor: '#abcdef',
      },
      {
        start: 12,
        end: req.text.length,
        font: 'cmu',
        size: 10,
        ligatures: true,
        tracking: 0,
        leading: 9,
      },
    ];
    const result = await service.compose(req),
      [first, second, third] = result.layout.lines;
    assert.equal(first.baseline, first.ascent);
    assert(Math.abs(second.baseline - first.baseline - 8) < 1e-8);
    assert(Math.abs(third.baseline - second.baseline - 9) < 1e-8);
    assert(second.ascent > first.ascent * 2);
    assert.equal(second.runs[0].textColor, '#abcdef');
    req.runs = req.runs.map((run) => ({ ...run, leading: 0, autoLeading: 150 }));
    const auto = await service.compose(req),
      [a, b, c] = auto.layout.lines;
    assert(Math.abs(b.baseline - a.baseline - 45) < 1e-8);
    assert(Math.abs(c.baseline - b.baseline - 15) < 1e-8);
  },
);

test(
  'Unicode paragraph choices use real grapheme boundaries and do not allow unregistered fallback',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const service = createTextComposition(await buildNativeText());
    t.after(() => service.close());
    const req = await request('café e\u0301 words');
    req.mode = 'measure-lines-proof';
    req.candidates = [{ start: 0, end: req.text.length }];
    assert((await service.compose(req)).measurements[0].width > 0);
    req.candidates = [{ start: 0, end: 6 }];
    await assert.rejects(service.compose(req), /grapheme boundary/);
    req.mode = 'explicit-lines-proof';
    delete req.candidates;
    req.breaks = [7, req.text.length];
    assert.equal((await service.compose(req)).layout.coveredLength, req.text.length);
    req.breaks = [6, req.text.length];
    await assert.rejects(service.compose(req), /grapheme boundary/);
    const fallback = await request('hello 😀');
    fallback.mode = 'measure-lines-proof';
    fallback.candidates = [{ start: 0, end: fallback.text.length }];
    await assert.rejects(service.compose(fallback), /Unpackaged fallback/);
    const whitespace = await request('AB');
    whitespace.logicalLength = 5;
    whitespace.spans = [
      { kind: 'text', start: 0, end: 1, logicalStart: 0, logicalEnd: 1 },
      { kind: 'whitespace', start: 1, end: 1, logicalStart: 1, logicalEnd: 4 },
      { kind: 'text', start: 1, end: 2, logicalStart: 4, logicalEnd: 5 },
    ];
    const result = await service.compose(whitespace);
    assert.deepEqual(
      result.layout.lines[0].carets.find((caret) => caret.index === 1).logicalCandidates,
      [1, 4],
    );
  },
);

test(
  'native first-baseline policies, minimum offsets and vertical alignment move retained geometry together',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const service = createTextComposition(await buildNativeText());
    t.after(() => service.close());
    const req = await request('One line');
    req.frames = [{ id: 'first', width: 200, height: 100 }];
    const normal = (await service.compose(req)).layout.lines[0];
    for (const [policy, expected] of [
      ['ascent', normal.ascent],
      ['cap-height', normal.runs[0].capHeight],
      ['x-height', normal.runs[0].xHeight],
      ['leading', 14.4],
      ['fixed', 0],
    ]) {
      req.frames[0] = { ...req.frames[0], firstBaseline: policy, minimumFirstBaseline: 2 };
      const line = (await service.compose(req)).layout.lines[0];
      assert(Math.abs(line.baseline - Math.max(2, expected)) < 1e-8, policy);
    }
    req.frames[0] = { ...req.frames[0], firstBaseline: 'cap-height', minimumFirstBaseline: 30 };
    assert.equal((await service.compose(req)).layout.lines[0].baseline, 30);
    req.frames[0] = { id: 'first', width: 200, height: 100, verticalAlign: 'bottom' };
    const bottomResult = await service.compose(req),
      bottom = bottomResult.layout.lines[0];
    assert(Math.abs(bottom.baseline + bottom.descent - 100) < 1e-8);
    req.frames[0].verticalAlign = 'center';
    const center = (await service.compose(req)).layout.lines[0];
    assert(Math.abs(center.baseline - (normal.baseline + bottom.baseline) / 2) < 1e-8);
    // Extended production frame capacity is explicit, beyond the old proof's 16 frames.
    req.frames = Array.from({ length: 128 }, (_, index) => ({
      id: 'page-' + index,
      width: 14400,
      height: 14400,
    }));
    assert.equal((await service.compose(req)).layout.coveredLength, req.text.length);
    req.frames.push({ id: 'extra', width: 100, height: 100 });
    await assert.rejects(service.compose(req), /Invalid frame identities/);
  },
);

test(
  'native font bindings cannot be rebound and worker PDF actions cannot select output paths',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const executable = await buildNativeText(),
      service = createTextComposition(executable);
    t.after(() => service.close());
    const req = await request('immutable identity');
    await service.compose(req);
    const italic = await readFile(
      new URL('../../public/fonts/cmu-serif/cmunti.ttf', import.meta.url),
    );
    req.resources[0] = {
      id: 'cmu',
      digest: hash(italic),
      postscript: 'CMUSerif-Italic',
      data: italic.toString('base64'),
    };
    await assert.rejects(service.compose(req), /rebound to different bytes/);
    const worker = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    worker.stdout.on('data', (bytes) => (stdout += bytes));
    worker.stdin.end(
      JSON.stringify({
        id: 'path-rejected',
        action: 'pdf',
        token: 'anything',
        invisible: true,
        outputPath: '/not-an-export-target.pdf',
      }) + '\n',
    );
    await once(worker, 'close');
    const response = JSON.parse(stdout);
    assert.equal(response.ok, false);
    assert.match(response.error, /Invalid PDF action/);
  },
);

test(
  'measured candidate metrics hand explicit lines from a full narrow column to a wider next column',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const service = createTextComposition(await buildNativeText());
    t.after(() => service.close());
    const req = await request('A\u2029A much longer line that belongs to the second column');
    req.mode = 'measure-lines-proof';
    req.candidates = [
      { start: 0, end: 2 },
      { start: 2, end: req.text.length },
    ];
    const [first, second] = (await service.compose(req)).measurements;
    assert(first.ascent > 0 && first.descent > 0 && first.capHeight > first.xHeight);
    assert.equal(second.advance, 14.4);
    assert(second.width > 40);
    req.mode = 'explicit-lines-proof';
    delete req.candidates;
    req.breaks = [2, req.text.length];
    req.frames = [
      { id: 'narrow', width: 40, height: first.ascent + first.descent + 0.01 },
      { id: 'wide', width: 600, height: 100 },
    ];
    const result = await service.compose(req);
    assert.equal(result.layout.coveredLength, req.text.length);
    assert.deepEqual(
      result.layout.lines.map((line) => line.frame),
      ['narrow', 'wide'],
    );
  },
);
