import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { verifyParagraphDecision } from './paragraph.js';
import { inspectFont } from '../../../src/domain/text/fonts.js';

if (process.platform !== 'darwin') {
  console.log('Skipped native composition proof: macOS is required.');
  process.exit(0);
}
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  here = path.join(root, 'tests/prototypes/text-composition'),
  out = process.env.IVO_COMPOSITION_PROOF_OUT
    ? path.resolve(process.env.IVO_COMPOSITION_PROOF_OUT)
    : await mkdtemp(path.join(tmpdir(), 'ivo-composition-proof-')),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(out, { recursive: true });
function run(command, args, { input, timeout = 60000, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '',
      size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', reject);
    child.stdout.on('data', (bytes) => {
      stdout += bytes;
      size += bytes.length;
      if (size > 16000000) child.kill();
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
      size += bytes.length;
      if (size > 16000000) child.kill();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || allowFailure) resolve({ code, stdout, stderr });
      else reject(Error(command + ' failed (' + code + '): ' + stderr + stdout));
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}
const sourcesFile = path.join(out, 'sources.json');
await run(electron, [path.join(here, 'source-runner.mjs'), sourcesFile], { timeout: 30000 });
const { sources } = JSON.parse(await readFile(sourcesFile, 'utf8')),
  binary = path.join(out, 'core-text-proof');
await run(
  '/usr/bin/xcrun',
  [
    'swiftc',
    '-O',
    '-module-cache-path',
    path.join(out, 'module-cache'),
    path.join(here, 'CoreTextProof.swift'),
    '-o',
    binary,
  ],
  { timeout: 120000 },
);
const files = {
    'cmu-regular': 'cmunrm.ttf',
    'cmu-italic': 'cmunti.ttf',
    'cmu-bold': 'cmunbx.ttf',
    'cmu-bold-italic': 'cmunbi.ttf',
  },
  resources = [];
for (const [id, file] of Object.entries(files)) {
  const bytes = await readFile(path.join(root, 'public/fonts/cmu-serif', file)),
    metadata = inspectFont(bytes);
  resources.push({
    id,
    digest: hash(bytes),
    postscript: metadata.postscript,
    data: bytes.toString('base64'),
  });
}
const frames = [
  { id: 'first', width: 200, height: 100 },
  { id: 'second', width: 280, height: 120 },
  { id: 'third', width: 260, height: 1100 },
];
function accept(result, bytes) {
  assert.equal(result.protocol, 1);
  assert.equal(result.requestDigest, hash(bytes), 'Stale or mismatched native result');
  return result;
}
async function compose(request, name) {
  const bytes = JSON.stringify(request),
    pdf = path.join(out, name + '.pdf'),
    execution = await run(binary, [pdf], { input: bytes }),
    result = accept(JSON.parse(execution.stdout), bytes);
  await writeFile(
    path.join(out, name + '.json'),
    JSON.stringify(
      {
        request: { ...request, resources: request.resources.map(({ data, ...face }) => face) },
        result,
      },
      null,
      2,
    ),
  );
  return result;
}
async function rejects(request, expected) {
  const result = await run(binary, [path.join(out, 'rejected.pdf')], {
    input: JSON.stringify(request),
    allowFailure: true,
  });
  assert.notEqual(result.code, 0, 'Invalid native input was accepted');
  assert.match(result.stderr, expected);
}
async function measure(request) {
  const bytes = JSON.stringify(request),
    execution = await run(binary, [path.join(out, 'measure-does-not-write.pdf')], { input: bytes });
  return accept(JSON.parse(execution.stdout), bytes);
}
const results = [];
let paragraph;
for (const source of sources) {
  const request = {
      ...source,
      sourceDigest: hash(source.sourceHTML),
      resources,
      frames,
      allowFallback: source.id === 'unicode',
    },
    result = await compose(request, source.id),
    again = await compose(request, source.id + '-repeat');
  assert.deepEqual(
    result,
    again,
    'Native geometry is not repeatable for identical source/font bytes',
  );
  assert.equal(
    result.layout.coveredLength,
    source.text.length,
    'Native layout lost or unexpectedly overset source',
  );
  assert.equal(result.sourceDigest, hash(source.sourceHTML));
  const lines = result.layout.lines;
  const edges = new Set([
    0,
    ...[...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source.text)].map(
      (s) => s.index + s.segment.length,
    ),
  ]);
  let position = 0;
  for (const line of lines) {
    assert.equal(line.start, position);
    position = line.end;
    assert(line.end > line.start);
    assert(edges.has(line.start) && edges.has(line.end), 'Line split a grapheme');
    assert(
      !source.text.slice(line.start, line.contentEnd).includes('\u2029'),
      'A line crossed a paragraph break',
    );
    assert([line.baseline, line.ascent, line.descent, line.width].every(Number.isFinite));
    for (const run of line.runs)
      for (const glyph of run.glyphs) {
        assert(glyph.index >= line.start && glyph.end <= line.end && glyph.end > glyph.index);
        assert(glyph.end <= line.contentEnd, 'A source control was painted as a glyph');
        assert(glyph.position.every(Number.isFinite) && glyph.advance.every(Number.isFinite));
        assert(glyph.sourceRanges.length > 0, 'Glyph has no canonical-source provenance');
      }
    for (const caret of line.carets) {
      assert(Number.isFinite(caret.primary) && Number.isFinite(caret.secondary));
      assert(caret.logicalCandidates[0] <= caret.logicalCandidates[1]);
    }
  }
  if (source.id === 'latin') {
    assert(!result.diagnostics.length, 'Portable Latin proof unexpectedly used fallback/overflow');
    assert.equal(
      new Set(lines.map((l) => l.frame)).size,
      3,
      'Unequal-frame continuation was not exercised',
    );
    const noLigatures = await compose(
        { ...request, runs: request.runs.map((r) => ({ ...r, ligatures: false })) },
        'latin-no-ligatures',
      ),
      glyphCount = (value) =>
        value.layout.lines.flatMap((l) => l.runs).reduce((n, r) => n + r.glyphs.length, 0);
    assert(
      glyphCount(result) < glyphCount(noLigatures),
      'Requested ligature feature did not change actual glyphs',
    );
    assert(
      lines
        .flatMap((l) => l.runs)
        .flatMap((r) => r.glyphs)
        .some((g) => g.end - g.index > 1),
      'No many-to-one shaping cluster was measured',
    );
    const overset = await compose(
      { ...request, frames: [{ id: 'small', width: 20, height: 10 }] },
      'overset',
    );
    assert(
      overset.diagnostics.includes('overset') && overset.layout.coveredLength < source.text.length,
    );
    await rejects({ ...request, sourceDigest: '0'.repeat(64) }, /Source digest/);
    await rejects(
      {
        ...request,
        resources: resources.map((r, i) => (i ? r : { ...r, digest: '0'.repeat(64) })),
      },
      /Font resource digest/,
    );
    await rejects(
      { ...request, resources: resources.filter((r) => r.id !== 'cmu-regular') },
      /Unavailable font/,
    );
    await rejects(
      { ...request, spans: source.spans.map((s, i) => (i ? s : { ...s, start: 1 })) },
      /Discontinuous source map/,
    );
    assert.throws(
      () => accept(result, JSON.stringify({ ...request, id: 'different' })),
      /Stale or mismatched/,
    );
  } else if (source.id === 'unicode') {
    assert(
      result.diagnostics.some((s) => s.startsWith('unpackaged-fallback:')),
      'Complex-script fallback identity was hidden',
    );
    assert(
      lines.flatMap((l) => l.runs).some((r) => r.rtl),
      'RTL visual runs were not measured',
    );
    assert(
      lines.flatMap((l) => l.carets).some((c) => Math.abs(c.primary - c.secondary) > 0.01),
      'Directional boundary lost its secondary caret',
    );
    await rejects({ ...request, allowFallback: false }, /Unpackaged fallback/);
    const start = source.text.indexOf('👩') + 1,
      run = request.runs.find((r) => r.start < start && r.end > start),
      at = request.runs.indexOf(run);
    await rejects(
      {
        ...request,
        runs: [
          ...request.runs.slice(0, at),
          { ...run, end: start },
          { ...run, start },
          ...request.runs.slice(at + 1),
        ],
      },
      /surrogate pair/,
    );
  }
  if (source.id === 'paragraph')
    paragraph = await verifyParagraphDecision(request, {
      compose,
      rejects,
      measure,
    });
  if (source.id === 'kerning') {
    const query = {
        ...request,
        mode: 'measure-lines-proof',
        candidates: [{ start: 0, end: request.text.length }],
      },
      metrics = await measure(query),
      none = await measure({
        ...query,
        runs: query.runs.map((run) => ({ ...run, kerning: 'none' })),
      }),
      tracked = await measure({
        ...query,
        runs: query.runs.map((run) => ({ ...run, tracking: 100 })),
      });
    assert(
      metrics.measurements[0].width < none.measurements[0].width,
      'Zero tracking disabled metrics kerning',
    );
    assert(
      tracked.measurements[0].width > metrics.measurements[0].width,
      'Tracking did not add independent cluster spacing',
    );
  }
  results.push({
    id: source.id,
    lines: lines.length,
    glyphs: lines.flatMap((l) => l.runs).reduce((n, r) => n + r.glyphs.length, 0),
    diagnostics: result.diagnostics,
  });
}
await assert.rejects(access(path.join(out, 'measure-does-not-write.pdf')), { code: 'ENOENT' });
await assert.rejects(access(path.join(out, 'rejected.pdf')), { code: 'ENOENT' });
const python = process.env.IVO_PDF_PYTHON || 'python3';
const inspected = await run(python, [path.join(here, 'inspect-pdf.py'), out]);
const report = {
  ok: true,
  sourceAdapter: true,
  exactFontBytes: true,
  nativeGlyphCaretMaps: true,
  repeatableGeometry: true,
  sameFrozenLinesToPDF: true,
  controlledFailures: true,
  results,
  paragraph,
  pdf: JSON.parse(inspected.stdout),
  artifacts: out,
};
await writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
