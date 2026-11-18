import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import electron from 'electron';
import { buildNativeText } from './build-native-text.mjs';
import { createTextComposition } from '../desktop/text-composition.mjs';
import { inspectFont } from '../src/domain/text/fonts.js';
import { chooseParagraphBreaks } from '../src/domain/text/paragraph-breaks.js';
const exec = promisify(execFile),
  root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'release/composition-preview'),
  temp = await mkdtemp(path.join(tmpdir(), 'ivo-composition-preview-'));
await mkdir(out, { recursive: true });
let service;
try {
  const sourceFile = path.join(temp, 'sources.json');
  await exec(
    electron,
    [path.join(root, 'tests/prototypes/text-composition/source-runner.mjs'), sourceFile],
    { timeout: 30000 },
  );
  const source = JSON.parse(await readFile(sourceFile, 'utf8')).sources.find(
      (s) => s.id === 'paragraph',
    ),
    resources = [];
  for (const [id, file] of Object.entries({
    'cmu-regular': 'cmunrm.ttf',
    'cmu-italic': 'cmunti.ttf',
    'cmu-bold': 'cmunbx.ttf',
    'cmu-bold-italic': 'cmunbi.ttf',
  })) {
    const bytes = await readFile(path.join(root, 'public/fonts/cmu-serif', file));
    resources.push({
      id,
      digest: createHash('sha256').update(bytes).digest('hex'),
      postscript: inspectFont(bytes).postscript,
      data: bytes.toString('base64'),
    });
  }
  service = createTextComposition(await buildNativeText());
  const base = {
      ...source,
      sourceDigest: createHash('sha256').update(source.sourceHTML).digest('hex'),
      resources,
      frames: [{ id: 'sample', width: 320, height: 360 }],
      allowFallback: false,
    },
    opportunities = [
      { index: 0 },
      ...[...source.text.matchAll(/ +/g)].map((m) => ({ index: m.index + m[0].length })),
      { index: source.text.length },
    ],
    candidates = [];
  for (let a = 0; a < opportunities.length - 1; a++)
    for (let b = a + 1; b < opportunities.length; b++)
      candidates.push({ start: opportunities[a].index, end: opportunities[b].index });
  const measured = await service.compose({ ...base, mode: 'measure-lines-proof', candidates }),
    layouts = [],
    vectors = new Map();
  for (const width of [80, 100, 120, 140, 160, 180, 200, 220, 250, 280, 320]) {
    const value = { width };
    for (const mode of ['single-line', 'paragraph']) {
      const choice = chooseParagraphBreaks({
        start: 0,
        end: source.text.length,
        opportunities,
        measurements: measured.measurements,
        lineWidths: Array(40).fill(width),
        mode,
      });
      if (choice.status !== 'fit') throw Error('Preview paragraph did not fit.');
      const result = await service.compose({
        ...base,
        mode: 'explicit-lines-proof',
        frames: [{ id: 'sample', width, height: 360 }],
        breaks: choice.lines.map((l) => l.end),
        includeVectors: true,
      });
      for (const vector of result.vectors) vectors.set(vector.id, vector);
      delete result.vectors;
      value[mode] = result;
    }
    layouts.push(value);
  }
  const data = { source, layouts, vectors: [...vectors.values()] },
    script = await build({
      absWorkingDir: root,
      entryPoints: ['tools/composition-preview/app.js'],
      bundle: true,
      write: false,
      format: 'iife',
      target: 'es2022',
    }),
    css = await build({
      absWorkingDir: root,
      entryPoints: ['tools/composition-preview/style.css'],
      bundle: true,
      write: false,
      loader: { '.ttf': 'dataurl' },
      target: 'es2022',
    });
  let html = await readFile(path.join(root, 'tools/composition-preview/index.html'), 'utf8');
  html = html
    .replace('__IVO_PREVIEW_DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'))
    .replace('</head>', () => '<style>' + css.outputFiles[0].text + '</style></head>')
    .replace(
      '</body>',
      () =>
        '<script>' +
        script.outputFiles[0].text.replace(/<\/script/gi, '<\\/script') +
        '</script></body>',
    );
  const target = path.join(out, 'IvoComposition.html');
  await writeFile(target, html);
  console.log(
    JSON.stringify(
      {
        file: target,
        widths: layouts.length,
        glyphPaths: vectors.size,
        bytes: Buffer.byteLength(html),
        selfContained: true,
      },
      null,
      2,
    ),
  );
} finally {
  service?.close();
  await rm(temp, { recursive: true, force: true });
}
