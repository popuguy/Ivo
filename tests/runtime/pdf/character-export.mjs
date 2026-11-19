import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

const targets = [
  'Raised',
  'Lowered',
  'Wide',
  'Tall',
  'smallcaps',
  '0123456789',
  'Combined',
  'office',
];
const near = (actual, expected, label, tolerance = 0.001) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < tolerance,
    `${label}: ${actual} versus ${expected}`,
  );

function fixture(advanced) {
  let doc = createSceneDocument(advanced ? 'Native character PDF' : 'Native character PDF control');
  enablePublishing(doc);
  const attributes = [
      'data-ivo-baseline="6" data-ivo-highlight="#fff176" data-ivo-underline="true"',
      'data-ivo-baseline="-6"',
      'data-ivo-hscale="150"',
      'data-ivo-vscale="125"',
      'data-ivo-smcp="true"',
      'data-ivo-onum="true"',
      'data-ivo-hscale="150" data-ivo-vscale="125" data-ivo-baseline="6"',
      '',
    ],
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 54,
      y: 72,
      w: 500,
      h: 420,
      textStyle: 'cmu-serif',
      fontSize: 16,
      leading: 32,
      frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 48, verticalAlign: 'top' },
      html: targets
        .map(
          (word, index) =>
            '<p>' + (advanced ? `<span ${attributes[index]}>${word}</span>` : word) + '</p>',
        )
        .join(''),
    });
  enableNativeComposition(
    doc,
    startTextFlow(doc, frame.id, { automaticPages: false }),
    'paragraph',
  );
  doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];
  return { doc, frame: doc.blocks.find((block) => block.id === frame.id) };
}

function wordGeometry(composition, frame, word) {
  const { request, result } = composition,
    start = request.text.indexOf(word),
    end = start + word.length,
    line = result.layout.lines.find((item) => item.start <= start && item.end > start),
    run = line?.runs.find((item) => item.start <= start && item.end > start),
    first = line?.carets.find((caret) => caret.index === start),
    last = line?.carets.find((caret) => caret.index === end),
    glyph = line?.runs.flatMap((item) => item.glyphs).find((item) => item.index === start);
  assert(
    start >= 0 && line && run && first && last && glyph,
    'Character PDF has no native word geometry: ' + word,
  );
  const inkAscent = run.inkAscent ?? line.ascent,
    inkDescent = run.inkDescent ?? line.descent;
  return {
    word,
    start,
    end,
    page: 0,
    left: frame.x + first.primary,
    right: frame.x + last.primary,
    baseline: frame.y + line.baseline,
    top: frame.y + line.baseline - inkAscent,
    bottom: frame.y + line.baseline + inkDescent,
    ascent: line.ascent,
    descent: line.descent,
    inkAscent,
    inkDescent,
    glyphX: glyph.position[0],
    glyphY: line.baseline - glyph.position[1],
    underlineY: frame.y + line.baseline - (run.baselineShift || 0) - run.underlinePosition,
    underlineThickness: run.underlineThickness,
  };
}

const layoutText = (text) => text.replace(/\s/g, '');

async function inlineLigatureReplacement(bytes) {
  const pdf = await PDFDocument.load(bytes),
    records = [];
  for (const [reference, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let text;
    try {
      text = Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
    } catch {
      continue;
    }
    for (const match of text.matchAll(
      /\/ActualText\s*(?:\(ffi\)|<\s*(?:[fF][eE][fF][fF])?006600660069\s*>)/g,
    ))
      if (/>>\s*BDC/.test(text.slice(match.index, match.index + 200)))
        records.push({
          reference: reference.toString(),
          snippet: text.slice(Math.max(0, match.index - 24), match.index + 180),
        });
  }
  return { asciiFFIReplacement: records.length > 0, records };
}

async function inspectPoppler(advancedPath, controlPath, source, output) {
  const configured = process.env.IVO_TEST_PDFTOTEXT;
  if (configured)
    assert(path.isAbsolute(configured), 'IVO_TEST_PDFTOTEXT must be an absolute executable path.');
  const executable = configured || 'pdftotext',
    exec = promisify(execFile);
  let version;
  try {
    version = await exec(executable, ['-v'], { timeout: 10000, maxBuffer: 100000 });
  } catch (error) {
    if (!configured && error.code === 'ENOENT') {
      const unavailable = {
        available: false,
        reason:
          'pdftotext is absent from PATH; set optional IVO_TEST_PDFTOTEXT for exact cross-reader qualification.',
      };
      await writeFile(
        path.join(output, 'native-character-poppler.json'),
        JSON.stringify(unavailable, null, 2),
      );
      return unavailable;
    }
    throw error;
  }
  const advanced = await exec(executable, ['-raw', '-enc', 'UTF-8', advancedPath, '-'], {
      timeout: 30000,
      maxBuffer: 4000000,
    }),
    control = await exec(executable, ['-raw', '-enc', 'UTF-8', controlPath, '-'], {
      timeout: 30000,
      maxBuffer: 4000000,
    }),
    report = {
      available: true,
      version: (version.stderr || version.stdout).trim().split('\n')[0],
      advancedText: advanced.stdout,
      controlText: control.stdout,
      advancedSourceExact: layoutText(advanced.stdout) === layoutText(source),
      controlSourceExact: layoutText(control.stdout) === layoutText(source),
    };
  await Promise.all([
    writeFile(path.join(output, 'native-character-poppler-advanced.txt'), advanced.stdout),
    writeFile(path.join(output, 'native-character-poppler-control.txt'), control.stdout),
    writeFile(path.join(output, 'native-character-poppler.json'), JSON.stringify(report, null, 2)),
  ]);
  return report;
}

/** Frozen production PDF + independent PDFKit source/selection/raster character witness. */
export async function verifyCharacterPDF({ renderPDF, root, output, profile, nativeCompositions }) {
  await mkdir(output, { recursive: true });
  const advanced = fixture(true),
    control = fixture(false),
    advancedSnapshot = createPDFSnapshot([advanced.doc], [], advanced.doc.id),
    controlSnapshot = createPDFSnapshot([control.doc], [], control.doc.id),
    advancedBefore = JSON.stringify(advancedSnapshot),
    controlBefore = JSON.stringify(controlSnapshot);
  let rendered;
  const advancedPDF = await renderPDF(advancedSnapshot, {
      project: root,
      onRendered: async (window) => {
        const token = await window.webContents.executeJavaScript(
            `document.querySelector('svg[data-composed-text]')?.dataset.compositionToken`,
          ),
          composition = nativeCompositions.findLast((entry) => entry.result.token === token);
        assert(composition, 'Character PDF renderer has no matching actual native plan');
        const words = targets.map((word) => wordGeometry(composition, advanced.frame, word));
        rendered = await window.webContents.executeJavaScript(`(() => {
        const svg=document.querySelector('svg[data-composed-text]');
        return {
          token:svg.dataset.compositionToken,
          vectors:svg.querySelectorAll('path').length,
          uses:svg.querySelectorAll('use').length,
          browserInk:document.querySelectorAll('[data-flow-frame] [data-flow-text]').length,
          glyphs:${JSON.stringify(words.map(({ word, start }) => ({ word, start })))}.map(({word,start})=>{
            const use=svg.querySelector('use[data-composed-index="'+start+'"]'), box=use.getBBox(), matrix=use.transform.baseVal.consolidate().matrix;
            return {word,start,box:{x:box.x,y:box.y,width:box.width,height:box.height},matrix:{a:matrix.a,b:matrix.b,c:matrix.c,d:matrix.d,e:matrix.e,f:matrix.f}};
          }),
          decorations:[...svg.querySelectorAll('rect')].map(rect=>({
            fill:rect.getAttribute('fill'),x:Number(rect.getAttribute('x')),y:Number(rect.getAttribute('y')),
            width:Number(rect.getAttribute('width')),height:Number(rect.getAttribute('height'))
          }))
        };
      })()`);
        assert.equal(rendered.browserInk, 0, 'Advanced PDF painted duplicate browser text');
        assert(
          rendered.vectors > 20 && rendered.uses >= 45,
          'Advanced PDF did not paint actual native glyph paths',
        );
        for (const word of words) {
          const glyph = rendered.glyphs.find((item) => item.word === word.word);
          near(glyph.matrix.e, word.glyphX, 'Frozen SVG native glyph x');
          near(glyph.matrix.f, word.glyphY, 'Frozen SVG shifted glyph y');
          near(glyph.matrix.a, 1, 'Frozen SVG glyph scale x');
          near(glyph.matrix.d, -1, 'Frozen SVG glyph flip y');
        }
        const raised = words[0],
          highlight = rendered.decorations.find((rect) => rect.fill === '#fff176'),
          underline = rendered.decorations.find(
            (rect) => rect.fill === '#252525' && rect.height < 3,
          );
        assert(highlight && underline, 'Frozen PDF omitted advanced text decorations');
        near(highlight.y, raised.top - advanced.frame.y, 'Frozen shifted highlight y');
        near(
          highlight.height,
          raised.inkAscent + raised.inkDescent,
          'Frozen signed highlight height',
        );
        near(underline.y, raised.underlineY - advanced.frame.y, 'Frozen shifted underline y');
      },
    }),
    controlPDF = await renderPDF(controlSnapshot, { project: root });
  assert.equal(
    JSON.stringify(advancedSnapshot),
    advancedBefore,
    'Character export mutated its frozen advanced snapshot',
  );
  assert.equal(
    JSON.stringify(controlSnapshot),
    controlBefore,
    'Character export mutated its frozen control snapshot',
  );
  for (const pdf of [advancedPDF, controlPDF]) {
    assert.deepEqual(pdf.manifest.warnings, []);
    assert.equal(pdf.manifest.pages.length, 1);
    assert.equal(pdf.manifest.composedText.length, 1);
    assert.equal(pdf.manifest.composedText[0].placements.length, 1);
  }
  const actual = (pdf) =>
      nativeCompositions.findLast(
        (entry) => entry.result.token === pdf.manifest.composedText[0].token,
      ),
    advancedComposition = actual(advancedPDF),
    controlComposition = actual(controlPDF);
  assert(
    advancedComposition && controlComposition,
    'Final character PDF lost its native token provenance',
  );
  assert.equal(advancedComposition.request.protocol, 4);
  assert.equal(advancedComposition.result.protocol, 4);
  assert.equal(controlComposition.request.protocol, 3);
  assert.equal(controlComposition.result.protocol, 3);
  assert.equal(advancedComposition.request.mode, 'planned-lines-proof');
  assert.equal(advancedComposition.request.text, controlComposition.request.text);
  assert.deepEqual(
    advancedComposition.request.placements,
    controlComposition.request.placements,
    'Character transforms changed the generous paragraph placements',
  );
  for (const composition of [advancedComposition, controlComposition]) {
    assert.equal(composition.result.layout.coveredLength, composition.request.text.length);
    assert.equal(composition.result.layout.lines.length, targets.length);
    for (const [index, line] of composition.result.layout.lines.entries()) {
      assert.equal(line.placementIndex, index);
      assert.equal(line.end, composition.request.placements[index].end);
      near(line.baseline, 48 + index * 32, 'Frozen character PDF declared baseline');
      near(
        line.baseline,
        composition.request.placements[index].baseline,
        'Frozen character PDF owned baseline',
      );
    }
  }
  for (const composition of [advancedComposition, controlComposition]) {
    const start = composition.request.text.indexOf('office'),
      ordinary = composition.request.runs.find((run) => run.start <= start && run.end > start);
    assert(
      ordinary?.ligatures === true && !Object.values(ordinary.features || {}).some(Boolean),
      'The ordinary office PDF witness must retain standard ligatures without extra OpenType features',
    );
  }
  const expected = targets.map((word) => ({
      word,
      advanced: wordGeometry(advancedComposition, advanced.frame, word),
      control: wordGeometry(controlComposition, control.frame, word),
    })),
    plan = {
      source: advancedComposition.request.text,
      expected,
      protocol: advancedComposition.request.protocol,
      mode: advancedComposition.request.mode,
      placements: advancedComposition.request.placements,
      lines: advancedComposition.result.layout.lines,
    },
    planPath = path.join(output, 'native-character-plan.json'),
    advancedPath = path.join(output, 'native-character.pdf'),
    controlPath = path.join(output, 'native-character-control.pdf'),
    inspector = path.join(profile, 'inspect-character-export.swift');
  await Promise.all([
    writeFile(advancedPath, advancedPDF.bytes),
    writeFile(controlPath, controlPDF.bytes),
    writeFile(planPath, JSON.stringify(plan, null, 2)),
    writeFile(
      path.join(output, 'native-character-source.json'),
      JSON.stringify(advancedSnapshot, null, 2),
    ),
    writeFile(
      path.join(output, 'native-character-manifest.json'),
      JSON.stringify(advancedPDF.manifest, null, 2),
    ),
    writeFile(
      path.join(output, 'native-character-renderer.json'),
      JSON.stringify(rendered, null, 2),
    ),
  ]);
  await writeFile(
    inspector,
    `import Foundation
import PDFKit
import CoreGraphics
let arguments = CommandLine.arguments
let plan = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: arguments[3]))) as! [String: Any]
let expected = plan["expected"] as! [[String: Any]]
guard let advancedDocument = PDFDocument(url: URL(fileURLWithPath: arguments[1])),
      let controlDocument = PDFDocument(url: URL(fileURLWithPath: arguments[2])),
      advancedDocument.pageCount == 1, controlDocument.pageCount == 1,
      let advanced = advancedDocument.page(at: 0), let control = controlDocument.page(at: 0)
else { fatalError("Character PDFs are not readable one-page documents") }
let scale = 3
struct Raster {
  let pixels: [UInt8]
  let width: Int
  let height: Int
  let bottomUp: Bool
}
func raster(_ page: PDFPage) -> Raster {
  let bounds = page.bounds(for: .mediaBox)
  let width = Int(bounds.width) * scale, height = Int(bounds.height) * scale
  var pixels = [UInt8](repeating: 255, count: width * height)
  pixels.withUnsafeMutableBytes { buffer in
    let context = CGContext(data: buffer.baseAddress!, width: width, height: height,
      bitsPerComponent: 8, bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    context.setFillColor(gray: 1, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    context.drawPDFPage(page.pageRef!)
    context.flush()
  }
  // These owned fixtures place every glyph in the upper half. Detect bitmap row orientation independently.
  let firstInk = pixels.firstIndex(where: { $0 < 128 }).map { $0 / width } ?? 0
  return Raster(pixels: pixels, width: width, height: height, bottomUp: firstInk > height / 2)
}
func sample(_ raster: Raster, _ box: [String: Double]) -> [String: Any] {
  let left = max(0, Int(floor(box["left"]! * Double(scale))))
  let right = min(raster.width - 1, Int(ceil(box["right"]! * Double(scale))))
  let top = max(0, Int(floor(box["top"]! * Double(scale))))
  let bottom = min(raster.height - 1, Int(ceil(box["bottom"]! * Double(scale))))
  var minX = raster.width, maxX = -1, minY = raster.height, maxY = -1, count = 0
  var hash: UInt64 = 14695981039346656037
  for y in top...bottom {
    let rawY = raster.bottomUp ? raster.height - 1 - y : y
    for x in left...right {
      let dark = raster.pixels[rawY * raster.width + x] < 128
      hash = (hash ^ (dark ? 0 : 255)) &* 1099511628211
      if dark { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y); count += 1 }
    }
  }
  return ["found": count > 0, "pixels": count, "fingerprint": String(hash, radix: 16),
    "left": Double(minX) / Double(scale), "top": Double(minY) / Double(scale),
    "width": maxX >= minX ? Double(maxX - minX + 1) / Double(scale) : 0,
    "height": maxY >= minY ? Double(maxY - minY + 1) / Double(scale) : 0]
}
func withoutLayoutWhitespace(_ text: String) -> String {
  text.components(separatedBy: CharacterSet.whitespacesAndNewlines).joined()
}
let advancedText = advanced.string ?? "", controlText = control.string ?? ""
let source = plan["source"] as! String
let advancedRaster = raster(advanced), controlRaster = raster(control)
var rows: [[String: Any]] = []
for item in expected {
  let word = item["word"] as! String
  let advancedPlan = item["advanced"] as! [String: Any], controlPlan = item["control"] as! [String: Any]
  func value(_ object: [String: Any], _ key: String) -> Double { (object[key] as! NSNumber).doubleValue }
  let box: [String: Double] = [
    "left": min(value(advancedPlan, "left"), value(controlPlan, "left")) - 1,
    "right": max(value(advancedPlan, "right"), value(controlPlan, "right")) + 1,
    "top": min(value(advancedPlan, "top"), value(controlPlan, "top")) - 1,
    "bottom": max(value(advancedPlan, "bottom"), value(controlPlan, "bottom")) + 1]
  var row: [String: Any] = ["word": word, "advancedInk": sample(advancedRaster, box), "controlInk": sample(controlRaster, box)]
  let sourceRange = (advancedText as NSString).range(of: word)
  row["sourceFound"] = sourceRange.location != NSNotFound
  let range = sourceRange
  if range.location != NSNotFound, let selection = advanced.selection(for: NSRange(location: range.location, length: 1)) {
    let bounds = selection.bounds(for: advanced)
    let left = value(advancedPlan, "left")
    let top = advanced.bounds(for: .mediaBox).height - bounds.maxY
    row["selectionLeft"] = bounds.minX
    row["selectionTop"] = top
    row["caretXMatches"] = abs(bounds.minX - left) < 0.06
    row["selectionInsideInkBand"] = top >= value(advancedPlan, "top") - 1 && top < value(advancedPlan, "bottom") + 1
  } else { row["caretXMatches"] = false; row["selectionInsideInkBand"] = false }
  rows.append(row)
}
let report: [String: Any] = ["source": source, "advancedText": advancedText, "controlText": controlText,
  "advancedSourceExact": withoutLayoutWhitespace(advancedText) == withoutLayoutWhitespace(source),
  "controlSourceExact": withoutLayoutWhitespace(controlText) == withoutLayoutWhitespace(source),
  "advancedOfficeSearches": advancedDocument.findString("office", withOptions: .literal).count,
  "controlOfficeSearches": controlDocument.findString("office", withOptions: .literal).count,
  "advancedBitmapBottomUp": advancedRaster.bottomUp, "controlBitmapBottomUp": controlRaster.bottomUp,
  "words": rows]
print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
`,
  );
  const { stdout } = await promisify(execFile)(
      '/usr/bin/xcrun',
      [
        'swift',
        '-module-cache-path',
        path.join(profile, 'swift-cache'),
        inspector,
        advancedPath,
        controlPath,
        planPath,
      ],
      { timeout: 120000, maxBuffer: 4000000 },
    ),
    inspection = JSON.parse(stdout);
  await writeFile(
    path.join(output, 'native-character-inspection.json'),
    JSON.stringify(inspection, null, 2),
  );
  const actualText = {
      advanced: await inlineLigatureReplacement(advancedPDF.bytes),
      control: await inlineLigatureReplacement(controlPDF.bytes),
    },
    poppler = await inspectPoppler(advancedPath, controlPath, plan.source, output),
    expectedPDFKit = layoutText(plan.source);
  await writeFile(
    path.join(output, 'native-character-actual-text.json'),
    JSON.stringify(actualText, null, 2),
  );
  assert.equal(
    actualText.advanced.asciiFFIReplacement,
    true,
    'Advanced PDF lost the original inline ASCII ffi ActualText.',
  );
  assert.equal(
    actualText.control.asciiFFIReplacement,
    true,
    'Control PDF lost the original inline ASCII ffi ActualText.',
  );
  assert.equal(
    layoutText(inspection.controlText),
    expectedPDFKit,
    'PDFKit changed the exact control source after native encoding: ' + inspection.controlText,
  );
  assert.equal(
    layoutText(inspection.advancedText),
    expectedPDFKit,
    'Advanced PDFKit changed exact case/digits/source after native encoding: ' +
      inspection.advancedText,
  );
  assert.equal(inspection.advancedOfficeSearches, 1);
  assert.equal(inspection.controlOfficeSearches, 1);
  for (const pdf of [advancedPDF, controlPDF])
    assert(
      pdf.manifest.nativeTextEncoding?.some(
        (entry) => entry.changed && entry.supported && entry.substitutions > 0,
      ),
      'Production PDF did not report its actual native source-encoding improvement',
    );
  if (poppler.available) {
    assert.equal(
      poppler.controlSourceExact,
      true,
      'Poppler control PDF changed exact source: ' + poppler.controlText,
    );
    assert.equal(
      poppler.advancedSourceExact,
      true,
      'Poppler advanced PDF changed exact source: ' + poppler.advancedText,
    );
  }
  assert.equal(inspection.words.length, targets.length);
  for (const word of inspection.words) {
    assert.equal(
      word.sourceFound,
      true,
      'PDFKit changed original character source word: ' + word.word,
    );
    assert.equal(
      word.caretXMatches,
      true,
      'Final PDF selection disagrees with native source caret x: ' + JSON.stringify(word),
    );
    assert.equal(
      word.selectionInsideInkBand,
      true,
      'Final PDF selection is outside its signed native run ink band: ' + JSON.stringify(word),
    );
    assert(
      word.advancedInk.found && word.controlInk.found,
      'Independent PDF raster contains no visible word ink: ' + word.word,
    );
  }
  const byWord = Object.fromEntries(inspection.words.map((row) => [row.word, row]));
  near(
    byWord.Raised.advancedInk.top,
    byWord.Raised.controlInk.top - 6,
    'Independent PDF raised ink',
    0.8,
  );
  near(
    byWord.Lowered.advancedInk.top,
    byWord.Lowered.controlInk.top + 6,
    'Independent PDF lowered ink',
    0.8,
  );
  near(
    byWord.Wide.advancedInk.width,
    byWord.Wide.controlInk.width * 1.5,
    'Independent PDF horizontal ink scale',
    1.2,
  );
  near(
    byWord.Tall.advancedInk.height,
    byWord.Tall.controlInk.height * 1.25,
    'Independent PDF vertical ink scale',
    1.2,
  );
  near(
    byWord.Combined.advancedInk.width,
    byWord.Combined.controlInk.width * 1.5,
    'Independent PDF combined horizontal ink scale',
    1.2,
  );
  near(
    byWord.Combined.advancedInk.height,
    byWord.Combined.controlInk.height * 1.25,
    'Independent PDF combined vertical ink scale',
    1.2,
  );
  assert(
    byWord.Combined.advancedInk.top < byWord.Combined.controlInk.top - 6,
    'Independent PDF combined transform lost its raised/scaled ink',
  );
  for (const word of ['smallcaps', '0123456789'])
    assert.notEqual(
      byWord[word].advancedInk.fingerprint,
      byWord[word].controlInk.fingerprint,
      'Independent PDF raster lost OpenType visible substitution: ' + word,
    );
  return {
    nativeCharacterPDFProtocol: 4,
    characterPDFSnapshotUnchanged: true,
    characterPDFSingleRetainedPlan: true,
    characterPDFDecorations: true,
    characterPDFPDFKitSourceExact: true,
    characterPDFPDFKitOfficeSearch: true,
    characterPDFInlineLigatureActualText: true,
    characterPDFPoppler: poppler.available
      ? { available: true, version: poppler.version, exactSource: true }
      : poppler,
    characterPDFCrossReaderExactSource: poppler.available ? true : null,
    characterPDFIndependentCaretX: true,
    characterPDFIndependentVisibleInk: true,
    characterPDFInspectedWords: targets.length,
  };
}
