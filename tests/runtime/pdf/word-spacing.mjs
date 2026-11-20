import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { wordSpacingSettings } from '../../../src/domain/text/word-spacing.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

const near = (actual, expected, label, tolerance = 0.001) =>
    assert(
      Number.isFinite(actual) && Math.abs(actual - expected) < tolerance,
      `${label}: ${actual} versus ${expected}`,
    ),
  glyphs = (line) => line.runs.flatMap((run) => run.glyphs),
  definitions = [
    {
      name: 'desired-control',
      width: 360,
      advanced: true,
      policy: null,
      align: 'left',
      text: '  Ragged alpha beta  ',
      targets: ['Ragged', 'alpha', 'beta'],
    },
    {
      name: 'desired',
      width: 360,
      advanced: true,
      policy: '80:200:250',
      align: 'left',
      text: '  Ragged alpha beta  ',
      targets: ['Ragged', 'alpha', 'beta'],
    },
    {
      name: 'soft-return',
      width: 300,
      policy: '80:100:133',
      align: 'justify',
      text: '  Full alpha beta  <br>Final gamma delta  ',
      targets: ['Full', 'alpha', 'beta', 'Final', 'gamma', 'delta'],
    },
    {
      name: 'condensed-final',
      width: 78,
      policy: '0:100:133',
      align: 'justify',
      text: '  AA BB CC  ',
      targets: ['AA', 'BB', 'CC'],
    },
    {
      name: 'nonbreaking-spaces',
      width: 240,
      policy: '60:150:200',
      align: 'justify-all',
      text: 'Pair\u00a0One with\u202fTwo\u00a0  ',
      targets: ['Pair', 'One', 'with', 'Two'],
    },
    {
      name: 'fixed-preferences',
      width: 300,
      policy: '100:100:100',
      align: 'justify-all',
      text: '  Wide alpha beta  ',
      targets: ['Wide', 'alpha', 'beta'],
    },
    {
      name: 'letter-and-glyph',
      width: 360,
      policy: '80:100:125|-5:8:18|96:105:112',
      align: 'left',
      text: 'Office print editing',
      targets: ['Office', 'print', 'editing'],
    },
  ];

function fixture(definition) {
  let doc = createSceneDocument('Native word-spacing PDF ' + definition.name, {
    width: 500,
    height: 350,
  });
  enablePublishing(doc);
  const html =
      '<p data-ivo-align="' +
      definition.align +
      '"' +
      (definition.policy ? ' data-ivo-wordspace="' + definition.policy + '"' : '') +
      '>' +
      (definition.advanced
        ? '<span data-ivo-hscale="150" data-ivo-vscale="125" data-ivo-baseline="4" data-ivo-tracking="100">' +
          definition.text +
          '</span>'
        : definition.text) +
      '</p>',
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 40,
      w: definition.width,
      h: 180,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 24,
      frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 40, verticalAlign: 'top' },
      html,
    });
  enableNativeComposition(
    doc,
    startTextFlow(doc, frame.id, { automaticPages: false }),
    'paragraph',
  );
  markTypographyVersion(doc);
  doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];
  return { doc, frame: doc.blocks.find((block) => block.id === frame.id) };
}

function selectedWords(composition, frame, definition) {
  return definition.targets.map((word) => {
    const start = composition.request.text.indexOf(word),
      line = composition.result.layout.lines.find((row) => row.start <= start && row.end > start),
      glyph = line && glyphs(line).find((part) => part.index === start),
      caret = line?.carets.find((part) => part.index === start);
    assert(
      start >= 0 && line && glyph && caret,
      'Word-spacing PDF lost source/glyph/caret for ' + word,
    );
    return {
      word,
      start,
      x: frame.x + glyph.position[0],
      localX: glyph.position[0],
      localY: line.baseline - glyph.position[1],
      baseline: frame.y + line.baseline,
      frame: line.frame,
      caretX: frame.x + caret.primary,
      scaleX: (line.wordSpacing?.glyphPercentage ?? 100) / 100,
      vector: glyph.vector,
      glyph: glyph.glyph,
    };
  });
}

/** Real export/retained-line witnesses; no browser/native window activation. */
export async function verifyWordSpacingPDF({
  renderPDF,
  root,
  output,
  profile,
  nativeCompositions,
}) {
  await mkdir(output, { recursive: true });
  const publications = [];
  for (const definition of definitions) {
    const { doc, frame } = fixture(definition),
      snapshot = createPDFSnapshot([doc], [], doc.id),
      before = JSON.stringify(snapshot),
      documentBefore = JSON.stringify(doc),
      sourceBefore = doc.textFlows[0].html;
    let rendered;
    const pdf = await renderPDF(snapshot, {
      project: root,
      onRendered: async (window) => {
        const token = await window.webContents.executeJavaScript(
            `document.querySelector('svg[data-composed-text]')?.dataset.compositionToken`,
          ),
          composition = nativeCompositions.findLast((entry) => entry.result.token === token);
        assert(composition, 'Word-spacing PDF has no retained production plan');
        const words = selectedWords(composition, frame, definition);
        rendered = await window.webContents.executeJavaScript(`(() => {
          const svg=document.querySelector('svg[data-composed-text]');
          return {token:svg.dataset.compositionToken,
            nativeFrames:document.querySelectorAll('svg[data-composed-text]').length,
            browserInk:document.querySelectorAll('[data-flow-frame] [data-flow-text]').length,
            glyphs:${JSON.stringify(words.map(({ start }) => start))}.map(start=>{
              const use=[...svg.querySelectorAll('use[data-glyph-offset]')].find(node=>Number(node.parentElement.dataset.lineStart)+Number(node.dataset.glyphOffset)===start), matrix=use.transform.baseVal.consolidate().matrix, box=use.getBBox();
              return {start,x:matrix.e,y:matrix.f,a:matrix.a,d:matrix.d,width:box.width,height:box.height};
            })};
        })()`);
        assert.equal(rendered.nativeFrames, 1);
        assert.equal(rendered.browserInk, 0, 'Word-spacing PDF painted duplicate browser text');
        for (const word of words) {
          const actual = rendered.glyphs.find((glyph) => glyph.start === word.start);
          near(actual.x, word.localX, 'Frozen word-spaced SVG glyph x');
          near(actual.y, word.localY, 'Frozen word-spaced SVG glyph y');
          near(actual.a, word.scaleX, 'Frozen glyph scale');
          near(actual.d, -1, 'Frozen glyph orientation');
          assert(
            actual.width > 0 && actual.height > 0,
            'Word-spacing SVG has no real native outline',
          );
        }
      },
    });
    assert.equal(
      JSON.stringify(snapshot),
      before,
      'Word-spacing export mutated frozen source/frame/page data',
    );
    assert.equal(
      JSON.stringify(doc),
      documentBefore,
      'Word-spacing export changed authored document',
    );
    assert.equal(doc.textFlows[0].html, sourceBefore);
    assert.deepEqual(pdf.manifest.warnings, []);
    assert.equal(pdf.manifest.composedText.length, 1);
    const layer = pdf.manifest.composedText[0],
      composition = nativeCompositions.findLast((entry) => entry.result.token === layer.token);
    assert(
      composition && rendered.token === layer.token,
      'Paint/export word-spacing retained plans disagree',
    );
    const { request, result } = composition,
      lines = result.layout.lines,
      active = Boolean(definition.policy),
      words = selectedWords(composition, frame, definition);
    await writeFile(
      path.join(output, 'native-word-spacing-' + definition.name + '-plan.json'),
      JSON.stringify(
        {
          request: {
            ...request,
            resources: request.resources.map(({ data: _data, ...identity }) => identity),
          },
          result,
        },
        null,
        2,
      ),
    );
    assert.equal(request.protocol, definition.policy?.includes('|') ? 6 : active ? 5 : 4);
    assert.equal(result.protocol, request.protocol);
    assert.equal(request.mode, 'planned-lines-proof');
    assert.equal(request.sourceHTML, sourceBefore);
    assert.equal(result.layout.coveredLength, request.text.length);
    assert.equal(result.sourceDigest, request.sourceDigest);
    assert.equal(request.placements.length, lines.length);
    assert.equal(lines.length, definition.name === 'soft-return' ? 2 : 1);
    assert.deepEqual(
      (await PDFDocument.load(pdf.bytes)).getPages().map((page) => page.getSize()),
      [{ width: 500, height: 350 }],
    );
    for (const [index, line] of lines.entries()) {
      near(line.baseline, 40 + 24 * index, 'Frozen word-space baseline strut');
      near(line.availableWidth, definition.width, 'Frozen word-space placement width');
      near(line.baseline, request.placements[index].baseline, 'Retained native baseline');
      assert.equal(line.placementIndex, index);
      assert(line.runs.every((run) => run.font === 'CMUSerif-Roman' && run.size === 16));
      if (!active) {
        assert.equal(line.wordSpacing, undefined);
        continue;
      }
      assert.deepEqual(request.paragraphs[0].wordSpacing, wordSpacingSettings(definition.policy));
      assert.equal(line.wordSpacing.fallback, null);
      if (line.wordSpacing.justified) {
        near(line.visibleWidth, definition.width, 'Actual justified point width');
        assert.equal(line.wordSpacing.collapsedTrailingStart, line.contentEnd - 2);
        const trailing = glyphs(line).filter(
          (glyph) => glyph.index >= line.wordSpacing.collapsedTrailingStart,
        );
        assert.equal(trailing.length, 2);
        for (const glyph of trailing) {
          near(glyph.advance[0], 0, 'Actual trailing-space native advance');
          near(glyph.position[0], trailing[0].position[0], 'Actual trailing-space native edge');
        }
        for (const caret of line.carets.filter(
          (part) => part.index >= line.wordSpacing.collapsedTrailingStart,
        )) {
          near(caret.primary, trailing[0].position[0], 'Collapsed source caret/paint agreement');
          near(
            caret.secondary,
            trailing[0].position[0],
            'Collapsed secondary caret/paint agreement',
          );
          assert.equal(caret.measurement, 'native-collapsed-space');
        }
      }
    }
    if (definition.name === 'desired') {
      near(lines[0].wordSpacing.percentage, 200, 'Ragged desired spaces');
      assert.equal(lines[0].wordSpacing.justified, false);
      assert.equal(lines[0].wordSpacing.eligibleGaps, 4);
    }
    if (definition.name === 'soft-return') {
      assert.equal(lines[0].wordSpacing.justified, true);
      assert(lines[0].wordSpacing.percentage > 133);
      assert.equal(lines[1].wordSpacing.justified, false);
      near(lines[1].wordSpacing.percentage, 100, 'Paragraph-final desired spaces');
    }
    if (definition.name === 'condensed-final') {
      assert.equal(lines[0].wordSpacing.justified, true);
      assert(lines[0].wordSpacing.percentage > 0 && lines[0].wordSpacing.percentage < 80);
    }
    if (definition.name === 'fixed-preferences') {
      assert(lines[0].wordSpacing.percentage > 100);
      assert.equal(lines[0].wordSpacing.offPreference, true);
    }
    const file = path.join(output, 'native-word-spacing-' + definition.name + '.pdf'),
      publication = {
        name: definition.name,
        pdf: file,
        source: request.text,
        words,
        rendered,
        lines,
        placements: request.placements,
        font: request.resources.map(({ id, digest, postscript }) => ({ id, digest, postscript })),
        vectors: result.vectors,
      };
    await Promise.all([
      writeFile(file, pdf.bytes),
      writeFile(
        path.join(output, 'native-word-spacing-' + definition.name + '-source.json'),
        before,
      ),
      writeFile(
        path.join(output, 'native-word-spacing-' + definition.name + '-manifest.json'),
        JSON.stringify(pdf.manifest, null, 2),
      ),
      writeFile(
        path.join(output, 'native-word-spacing-' + definition.name + '-plan.json'),
        JSON.stringify(publication, null, 2),
      ),
    ]);
    publications.push(publication);
  }
  const [control, desired] = publications;
  assert.deepEqual(desired.font, control.font, 'Word spacing replaced exact font bytes');
  assert.deepEqual(
    desired.words.map(({ glyph, vector }) => [glyph, vector]),
    control.words.map(({ glyph, vector }) => [glyph, vector]),
    'Word spacing changed actual nonspace glyph shapes',
  );
  near(
    desired.lines[0].visibleWidth - control.lines[0].visibleWidth,
    desired.lines[0].wordSpacing.nominalSpaceWidth,
    'Production desired200 affine native width',
  );
  const input = path.join(output, 'native-word-spacing-expectations.json'),
    inspector = path.join(profile, 'inspect-word-spacing.swift');
  await writeFile(input, JSON.stringify(publications, null, 2));
  await writeFile(
    inspector,
    `import Foundation
import PDFKit
let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String: Any]]
var reports: [[String: Any]] = []
for item in cases {
  guard let document = PDFDocument(url: URL(fileURLWithPath: item["pdf"] as! String)), document.pageCount == 1 else { fatalError("Word-spaced publication is not one readable page") }
  let page = document.page(at: 0)!, text = page.string ?? "", words = item["words"] as! [[String: Any]]
  let rows = words.map { expected -> [String: Any] in
    let word = expected["word"] as! String, range = (text as NSString).range(of: word)
    guard range.location != NSNotFound, let selection = page.selection(for: NSRange(location: range.location, length: 1)) else { fatalError("Word-spaced source word is not selectable") }
    let rect = selection.bounds(for: page)
    return ["word": word, "left": rect.minX, "top": page.bounds(for: .mediaBox).height - rect.maxY, "expectedX": expected["x"]!]
  }
  reports.append(["name": item["name"]!, "text": text, "rows": rows])
}
print(String(data: try JSONSerialization.data(withJSONObject: reports, options: [.sortedKeys]), encoding: .utf8)!)
`,
  );
  const { stdout } = await promisify(execFile)(
      '/usr/bin/xcrun',
      ['swift', '-module-cache-path', path.join(profile, 'swift-cache'), inspector, input],
      { timeout: 120000, maxBuffer: 2000000 },
    ),
    inspection = JSON.parse(stdout);
  await writeFile(
    path.join(output, 'native-word-spacing-inspection.json'),
    JSON.stringify(inspection, null, 2),
  );
  assert.equal(inspection.length, publications.length);
  for (const [index, publication] of inspection.entries()) {
    // PDF readers may omit/collapse literal layout whitespace; source letters,
    // case and digits must remain exact. No Unicode/ligature normalization.
    assert.equal(
      publication.text.replace(/\s/gu, ''),
      publications[index].source.replace(/\s/gu, ''),
      'Independent PDF reader changed word-spaced source: ' + publication.text,
    );
    for (const word of publication.rows)
      near(word.left, word.expectedX, 'Independent word-spaced selectable glyph x', 0.06);
    if (publication.name === 'soft-return')
      near(
        publication.rows[3].top - publication.rows[0].top,
        24,
        'Independent soft-return PDF baseline spacing',
        0.06,
      );
  }
  return {
    wordSpacingPDFFrozenSnapshots: true,
    nineFieldJustificationPDF: true,
    wordSpacingPDFNative5RetainedPlans: true,
    wordSpacingPDFDesiredAndCondensedFinal: true,
    wordSpacingPDFSoftBoundsAndReturns: true,
    wordSpacingPDFLeadingTrailingCarets: true,
    wordSpacingPDFIndependentSourceAndGlyphPositions: true,
    wordSpacingPDFFontAndGlyphShapeUnchanged: true,
    wordSpacingPDFCases: publications.length,
  };
}
