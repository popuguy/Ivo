import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { inspectFont } from '../../../src/domain/text/fonts.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import {
  enableNativeComposition,
  startTextFlow,
} from '../../../src/domain/documents/text-flows.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

export async function verifyPortableTypeSpecimens({
  root,
  profile,
  captionReader,
  renderPDF,
  nativeCompositions,
}) {
  const languagesDoc = createSceneDocument('Multilingual narrow captions', {
    width: 220,
    height: 360,
  });
  const samples = [
    ['es', 'composición'],
    ['it', 'tipografia'],
    ['el', 'τυπογραφία'],
    ['en-GB', 'organisation'],
    ['ru', 'типографика'],
    ['tr', 'ışıklandırma'],
    ['cs', 'kůň'],
    ['hu', 'tűző'],
  ];
  const sampleHTML = samples
    .map(
      ([lang, word]) => '<p data-ivo-hyphens="true" data-ivo-lang="' + lang + '">' + word + '</p>',
    )
    .join('');
  const sampleFrame = insertObject(languagesDoc, 'text', languagesDoc.pages[0].id, {
    x: 16,
    y: 16,
    w: 48,
    h: 320,
    textStyle: 'cmu-serif',
    fontSize: 12,
    html: sampleHTML,
  });
  enableNativeComposition(
    languagesDoc,
    startTextFlow(languagesDoc, sampleFrame.id, { automaticPages: false }),
    'single-line',
  );
  const samplePDF = await renderPDF(createPDFSnapshot([languagesDoc], [], languagesDoc.id), {
    project: root,
  });
  const sampleNative = nativeCompositions.findLast(
    ({ result }) => result.token === samplePDF.manifest.composedText[0]?.token,
  );
  assert.deepEqual(
    sampleNative.request.runs.map((run) => run.language),
    samples.map(([language]) => language),
  );
  assert.equal(sampleNative.result.layout.coveredLength, sampleNative.request.text.length);
  assert(
    sampleNative.result.layout.lines.some((line) =>
      line.runs.some((run) => run.glyphs.some((glyph) => glyph.generated)),
    ),
  );
  const mixedFile = path.join(profile, 'multilingual.pdf');
  await writeFile(mixedFile, samplePDF.bytes);
  const extracted = await promisify(execFile)('xcrun', [
    'swift',
    '-module-cache-path',
    path.join(profile, 'swift-cache'),
    captionReader,
    mixedFile,
  ]);
  assert.equal(extracted.stdout.replace(/\s/gu, ''), samples.map(([, word]) => word).join(''));
  const bytes = await readFile(path.join(root, 'public/fonts/geist/Geist-Variable.ttf')),
    metadata = inspectFont(bytes),
    asset = {
      id: 'font-' + createHash('sha256').update(bytes).digest('hex'),
      font: metadata,
      name: 'Variable specimen.ttf',
      mimeType: metadata.mimeType,
      data: 'data:' + metadata.mimeType + ';base64,' + bytes.toString('base64'),
    };
  let bundled;
  for (const [textStyle, assets] of [
    ['geist', []],
    [asset.id, [asset]],
  ]) {
    const variableDoc = createSceneDocument('Variable type specimen', { width: 260, height: 220 }),
      variableHTML = [330, 790, 330]
        .map((weight) => '<p data-ivo-axes="wght:' + weight + '">Rhythm</p>')
        .join(''),
      variableFrame = insertObject(variableDoc, 'text', variableDoc.pages[0].id, {
        x: 16,
        y: 16,
        w: 220,
        h: 170,
        textStyle,
        fontSize: 24,
        leading: 40,
        html: variableHTML,
      });
    enableNativeComposition(
      variableDoc,
      startTextFlow(variableDoc, variableFrame.id, { automaticPages: false }),
      'paragraph',
    );
    const variablePDF = await renderPDF(createPDFSnapshot([variableDoc], assets, variableDoc.id), {
      project: root,
    });
    const actual = nativeCompositions.findLast(
      ({ result }) => result.token === variablePDF.manifest.composedText[0]?.token,
    );
    assert.deepEqual(
      actual.request.resources.map((face) => face.id),
      [textStyle],
    );
    assert.deepEqual(
      actual.request.runs.map((run) => run.variations?.wght),
      [330, 790, 330],
    );
    const variableFile = path.join(profile, 'variable-font.pdf');
    await writeFile(variableFile, variablePDF.bytes);
    const variableReader = path.join(root, 'tests/runtime/pdf/inspect-variable-font.swift');
    const inspectedVariable = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      variableReader,
      variableFile,
    ]);
    const [light, heavy, restored] = JSON.parse(inspectedVariable.stdout);
    assert.ok(
      heavy.advance > light.advance + 1 && heavy.ink > light.ink * 1.2,
      'The exported word should get visibly heavier and wider at the chosen weight',
    );
    assert.ok(
      Math.abs(light.advance - restored.advance) < 0.01 &&
        Math.abs(light.ink - restored.ink) < light.ink * 0.02,
      'Returning to the initial coordinates should restore the same word and ink',
    );
    if (bundled)
      assert.deepEqual(
        [light, heavy, restored],
        bundled,
        'The same vault font and bundled font must export identical geometry and ink',
      );
    else bundled = [light, heavy, restored];
  }
  return {
    variableFontPDFSelectionAndInk: true,
    variableVaultFontPDF: true,
    multilingualSelectableCaptions: samples.length,
  };
}
