import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

const near = (actual, expected, label) =>
  assert(Math.abs(actual - expected) < 0.001, `${label}: ${actual} versus ${expected}`);
const standardFrames = [
  [0, 1],
  [2, 3, 4, 5],
  [6, 7, 8],
];
const cases = [
  {
    name: 'all',
    html: '<p>PRE1</p><p>PRE2</p><p data-ivo-keep="true">A1 alpha<br>A2 beta<br>A3 gamma<br>A4 delta</p><p>N1 next<br>N2 next<br>N3 next</p>',
    rows: [
      'PRE1\u2029',
      'PRE2\u2029',
      'A1 alpha\u2028',
      'A2 beta\u2028',
      'A3 gamma\u2028',
      'A4 delta\u2029',
      'N1 next\u2028',
      'N2 next\u2028',
      'N3 next\u2029',
    ],
  },
  {
    name: 'next',
    html: '<p data-ivo-next="true">A1 alpha<br>A2 beta<br>A3 gamma</p><p>N1 next</p><p>T1 tail<br>T2 tail<br>T3 tail<br>T4 tail<br>T5 tail</p>',
    rows: [
      'A1 alpha\u2028',
      'A2 beta\u2028',
      'A3 gamma\u2029',
      'N1 next\u2029',
      'T1 tail\u2028',
      'T2 tail\u2028',
      'T3 tail\u2028',
      'T4 tail\u2028',
      'T5 tail\u2029',
    ],
  },
  {
    name: 'chain',
    html: '<p>PRE1</p><p>PRE2</p><p data-ivo-next="true">A1 title</p><p data-ivo-next="true">A2 deck</p><p data-ivo-keep="true">N1 first<br>N2 second</p><p>T1 tail<br>T2 tail<br>T3 tail</p>',
    rows: [
      'PRE1\u2029',
      'PRE2\u2029',
      'A1 title\u2029',
      'A2 deck\u2029',
      'N1 first\u2028',
      'N2 second\u2029',
      'T1 tail\u2028',
      'T2 tail\u2028',
      'T3 tail\u2029',
    ],
  },
  {
    name: 'count-and-previous',
    html: '<p>PRE1</p><p data-ivo-next="true" data-ivo-nextlines="2">A1 heading</p><p>N1 first line<br>N2 second line<br>N3 third line</p><p data-ivo-previous="true">T1 attribution</p>',
    rows: [
      'PRE1\u2029',
      'A1 heading\u2029',
      'N1 first line\u2028',
      'N2 second line\u2028',
      'N3 third line\u2029',
      'T1 attribution\u2029',
    ],
    frames: [[0], [1, 2, 3], [4, 5]],
  },
  {
    name: 'section-starts',
    html: '<p>PRE1 opening notes</p><p data-ivo-pstart="even">A1 section heading</p><p data-ivo-pstart="page">T1 next section</p>',
    rows: ['PRE1 opening notes\u2029', 'A1 section heading\u2029', 'T1 next section\u2029'],
    frames: [[0], [1], [2]],
  },
  {
    name: 'odd-section-blank-page',
    html: '<p>PRE1 opening paragraph</p><p data-ivo-pstart="odd">A1 next section heading</p><p>T1 remaining description</p>',
    rows: [
      'PRE1 opening paragraph\u2029',
      'A1 next section heading\u2029',
      'T1 remaining description\u2029',
    ],
    frames: [[0], [], [1, 2]],
  },
];

function fixture(definition) {
  let doc = createSceneDocument('Paragraph keep PDF ' + definition.name, {
    width: 500,
    height: 400,
  });
  enablePublishing(doc);
  const frames = [];
  for (const [index, width] of [180, 240, 320].entries()) {
    const page = index ? addPage(doc, doc.pages.at(-1).id) : doc.pages[0],
      frame = insertObject(doc, 'text', page.id, {
        x: 40,
        y: 40,
        w: width,
        h: [60, 80, 100][index],
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
        frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 16, verticalAlign: 'top' },
        html: index ? '' : definition.html,
      });
    if (!index) startTextFlow(doc, frame.id, { automaticPages: false });
    else threadFrame(doc, frames.at(-1).id, frame.id);
    frames.push(frame);
  }
  enableNativeComposition(doc, doc.textFlows[0], 'paragraph');
  markTypographyVersion(doc);
  doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];
  return { doc, frames: frames.map((frame) => doc.blocks.find((block) => block.id === frame.id)) };
}

/** Independent forced-row/native-plan publication witnesses for authored paragraph keeps. */
export async function verifyParagraphKeepsPDF({
  renderPDF,
  root,
  output,
  profile,
  nativeCompositions,
}) {
  await mkdir(output, { recursive: true });
  const publications = [];
  for (const definition of cases) {
    const byFrame = definition.frames ?? standardFrames,
      { doc, frames } = fixture(definition),
      snapshot = createPDFSnapshot([doc], [], doc.id),
      before = JSON.stringify(snapshot),
      sourceBefore = doc.textFlows[0].html;
    const pdf = await renderPDF(snapshot, {
      project: root,
      onRendered: async (window) => {
        const painted = await window.webContents.executeJavaScript(
          `({frames:document.querySelectorAll('svg[data-composed-text]').length, browserInk:document.querySelectorAll('[data-flow-frame] [data-flow-text]').length, glyphs:document.querySelectorAll('svg[data-composed-text] use').length})`,
        );
        assert.equal(painted.frames, 3, 'Kept PDF lost a physical native frame');
        assert.equal(painted.browserInk, 0, 'Kept PDF paints duplicate browser text');
        assert(painted.glyphs > 35, 'Kept PDF has no actual native vector ink');
      },
    });
    assert.equal(
      JSON.stringify(snapshot),
      before,
      'Kept PDF changed frozen source/frame/page data',
    );
    assert.equal(doc.textFlows[0].html, sourceBefore, 'Kept PDF rewrote canonical authored source');
    assert.deepEqual(pdf.manifest.warnings, []);
    assert.equal(pdf.manifest.composedText.length, 1);
    const layer = pdf.manifest.composedText[0],
      composition = nativeCompositions.findLast((entry) => entry.result.token === layer.token);
    assert(composition, 'Kept PDF lost its retained native composition provenance');
    const { request, result } = composition;
    assert.equal(request.protocol, 3);
    assert.equal(result.protocol, 3);
    assert.equal(request.mode, 'planned-lines-proof');
    assert.equal(request.sourceHTML, sourceBefore);
    assert.equal(request.text, definition.rows.join(''));
    assert.equal(result.sourceDigest, request.sourceDigest);
    assert.equal(result.layout.coveredLength, request.text.length);
    assert.equal(result.layout.lines.length, definition.rows.length);
    assert.equal(request.placements.length, definition.rows.length);
    assert.equal('paragraphKeeps' in request, false);
    assert.equal('limits' in request, false);
    assert(
      request.paragraphs.every(
        (paragraph) =>
          ![
            'keepTogether',
            'keepWithNext',
            'keepNextLines',
            'paragraphStart',
            'keepWithPrevious',
            'widows',
            'orphans',
          ].some((key) => key in paragraph),
      ),
      'Renderer keep policy leaked into native paragraph metadata',
    );
    assert.deepEqual(
      request.frames.map((frame) => [frame.width, frame.height]),
      [
        [180, 60],
        [240, 80],
        [320, 100],
      ],
    );
    assert.deepEqual(
      layer.placements.map((placement) => [
        placement.sourcePageIndex,
        placement.destinationPageIndex,
      ]),
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    );
    assert.deepEqual(
      (await PDFDocument.load(pdf.bytes)).getPages().map((page) => page.getSize()),
      Array.from({ length: 3 }, () => ({ width: 500, height: 400 })),
    );
    const ends = [];
    let offset = 0,
      lineIndex = 0;
    for (const row of definition.rows) {
      offset += row.length;
      ends.push(offset);
    }
    for (const [frameIndex, rowNumbers] of byFrame.entries())
      for (const [rowIndex, rowNumber] of rowNumbers.entries()) {
        const line = result.layout.lines[lineIndex],
          placement = request.placements[lineIndex];
        assert.equal(line.start, rowNumber ? ends[rowNumber - 1] : 0);
        assert.equal(line.end, ends[rowNumber]);
        assert.equal(request.text.slice(line.start, line.end), definition.rows[rowNumber]);
        assert.equal(line.frame, frames[frameIndex].id + '-column-0');
        assert.equal(line.placementIndex, lineIndex);
        assert.equal(placement.frame, frameIndex);
        assert.equal(placement.end, line.end);
        near(line.baseline, 16 + 20 * rowIndex, 'Independent kept paragraph baseline');
        near(line.baseline, placement.baseline, 'Retained kept paragraph baseline');
        near(line.originX, 0, 'Kept paragraph native left edge');
        near(
          line.availableWidth,
          [180, 240, 320][frameIndex],
          'Kept paragraph native available width',
        );
        assert(line.runs.every((run) => run.size === 16 && run.font === 'CMUSerif-Roman'));
        lineIndex++;
      }
    const file = path.join(output, 'native-paragraph-keep-' + definition.name + '.pdf'),
      plan = {
        name: definition.name,
        pdf: file,
        source: request.text,
        expectedRows: byFrame.map((indices) =>
          indices.map((index) => definition.rows[index].replace(/[\u2028\u2029]/g, '')),
        ),
        placements: request.placements,
        lines: result.layout.lines,
      };
    await Promise.all([
      writeFile(file, pdf.bytes),
      writeFile(
        path.join(output, 'native-paragraph-keep-' + definition.name + '-source.json'),
        JSON.stringify(snapshot, null, 2),
      ),
      writeFile(
        path.join(output, 'native-paragraph-keep-' + definition.name + '-manifest.json'),
        JSON.stringify(pdf.manifest, null, 2),
      ),
      writeFile(
        path.join(output, 'native-paragraph-keep-' + definition.name + '-plan.json'),
        JSON.stringify(plan, null, 2),
      ),
    ]);
    publications.push(plan);
  }
  const input = path.join(output, 'native-paragraph-keeps-expectations.json'),
    inspector = path.join(profile, 'inspect-paragraph-keeps.swift');
  await writeFile(input, JSON.stringify(publications, null, 2));
  await writeFile(
    inspector,
    `import Foundation
import PDFKit
let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String: Any]]
var reports: [[String: Any]] = []
for item in cases {
  guard let document = PDFDocument(url: URL(fileURLWithPath: item["pdf"] as! String)), document.pageCount == 3 else { fatalError("Kept publication is not a readable three-page PDF") }
  let expected = item["expectedRows"] as! [[String]], source = item["source"] as! String
  var pages: [[String: Any]] = [], allText = "", firstTops: [Double] = []
  let labels = try NSRegularExpression(pattern: "\\\\b(?:PRE[12]|A[1-4]|N[1-3]|T[1-5])\\\\b")
  for index in 0..<document.pageCount {
    let page = document.page(at: index)!, text = page.string ?? "", height = page.bounds(for: .mediaBox).height
    allText += text
    let actualLabels = labels.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { (text as NSString).substring(with: $0.range) }
    let expectedLabels = expected[index].map { String($0.split(separator: " ")[0]) }
    var rows: [[String: Any]] = [], tops: [Double] = []
    for expectedRow in expected[index] {
      let label = String(expectedRow.split(separator: " ")[0]), range = (text as NSString).range(of: label)
      guard range.location != NSNotFound, let selection = page.selection(for: NSRange(location: range.location, length: 1)) else { fatalError("Expected kept source label is not selectable") }
      let rect = selection.bounds(for: page), top = height - rect.maxY
      rows.append(["label": label, "left": Double(rect.minX), "top": Double(top)])
      tops.append(Double(top))
    }
    if let first = tops.first { firstTops.append(first) }
    pages.append(["labels": actualLabels, "expectedLabels": expectedLabels, "labelsExact": actualLabels == expectedLabels,
      "rows": rows, "leftEdgesExact": rows.allSatisfy { abs(($0["left"] as! Double) - 40) < 0.06 },
      "spacingExact": tops.enumerated().allSatisfy { abs($0.element - tops[0] - Double($0.offset) * 20) < 0.06 }])
  }
  let squash: (String) -> String = { $0.components(separatedBy: CharacterSet.whitespacesAndNewlines).joined() }
  reports.append(["name": item["name"]!, "text": allText, "sourceExact": squash(allText) == squash(source), "pages": pages,
    "firstBaselinesConsistent": firstTops.allSatisfy { abs($0 - firstTops[0]) < 0.06 }])
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
    path.join(output, 'native-paragraph-keeps-inspection.json'),
    JSON.stringify(inspection, null, 2),
  );
  assert.equal(inspection.length, cases.length);
  for (const publication of inspection) {
    assert.equal(
      publication.sourceExact,
      true,
      'Kept PDF changed exact ASCII source/case: ' + publication.text,
    );
    assert.equal(
      publication.firstBaselinesConsistent,
      true,
      'Kept PDF changed the first baseline across pages: ' + JSON.stringify(publication),
    );
    assert.deepEqual(
      publication.pages.map((page) => page.rows.length),
      (cases.find((item) => item.name === publication.name).frames ?? standardFrames).map(
        (rows) => rows.length,
      ),
    );
    for (const page of publication.pages) {
      assert.equal(
        page.labelsExact,
        true,
        'Independent PDF reader found wrong kept row/page order: ' + JSON.stringify(page),
      );
      assert.equal(
        page.leftEdgesExact,
        true,
        'Independent kept PDF source left edge changed: ' + JSON.stringify(page),
      );
      assert.equal(
        page.spacingExact,
        true,
        'Independent kept PDF physical row spacing changed: ' + JSON.stringify(page),
      );
    }
  }
  return {
    paragraphKeepPDFAll: true,
    paragraphKeepPDFNextFinalRow: true,
    paragraphKeepPDFFrozenSnapshots: true,
    paragraphKeepPDFRetainedThreePagePlan: true,
    paragraphKeepPDFNativeMetadataBoundary: true,
    paragraphKeepPDFIndependentASCIIAndRowGeometry: true,
    paragraphKeepPDFLinkedHeadings: true,
    paragraphKeepPDFCountAndPrevious: true,
    paragraphStartPDFPageOwnership: true,
    paragraphKeepPDFInspectedRows: cases.reduce((total, item) => total + item.rows.length, 0),
  };
}
