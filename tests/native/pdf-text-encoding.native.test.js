import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createTextComposition } from '../../desktop/text-composition.mjs';
import { improveNativePDFEncoding } from '../../desktop/native-pdf-encoding.mjs';
import { nativeTextTestExecutable } from '../runtime/helpers/native-text.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  exec = promisify(execFile),
  samples = [
    { id: 'ascii', source: 'office abc' },
    { id: 'literal', source: 'o\uFB03ce abc' },
    { id: 'mixed', source: 'office o\uFB03ce ffi \uFB03' },
  ];

async function sourceRequest(source) {
  const bytes = await readFile(new URL('../../public/fonts/cmu-serif/cmunrm.ttf', import.meta.url)),
    text = source + '\u2029',
    sourceHTML = '<p>' + text + '</p>';
  return {
    protocol: 4,
    mode: 'planned-lines-proof',
    id: 'native-pdf-encoding',
    text,
    sourceHTML,
    sourceDigest: hash(sourceHTML),
    logicalLength: text.length,
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
    frames: [{ id: 'first', width: 500, height: 100 }],
    placements: [{ end: text.length, frame: 0, baseline: 20, left: 10, width: 490 }],
    allowFallback: false,
    includeVectors: true,
  };
}

async function identities(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false }),
    streams = new Map(),
    fonts = new Map();
  for (const [reference, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      streams.set(String(reference), {
        compressed: hash(object.contents),
        decoded: hash(decodePDFRawStream(object).decode()),
      });
    } else if (object instanceof PDFDict && String(object.get(PDFName.of('Type'))) === '/Font') {
      fonts.set(
        String(reference),
        object
          .entries()
          .filter(([key]) => String(key) !== '/ToUnicode')
          .map(String),
      );
    }
  }
  return { streams, fonts };
}

async function embedded(bytes) {
  const native = await PDFDocument.load(bytes, { updateMetadata: false }),
    output = await PDFDocument.create(),
    source = native.getPage(0),
    size = source.getSize(),
    page = await output.embedPage(source);
  output.addPage([size.width, size.height]).drawPage(page, {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
  });
  return Buffer.from(await output.save());
}

const readerSource = `import Foundation
import PDFKit
import CoreGraphics
import CryptoKit
let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String: Any]]
var output: [[String: Any]] = []
for entry in manifest {
 let document = PDFDocument(url: URL(fileURLWithPath: entry["path"] as! String))!
 let page = document.page(at: 0)!
 let bounds = page.bounds(for: .mediaBox), scale = 3
 let width = Int(ceil(bounds.width * Double(scale))), height = Int(ceil(bounds.height * Double(scale)))
 let pixels = UnsafeMutablePointer<UInt8>.allocate(capacity: width * height)
 let bitmap = CGContext(data: pixels, width: width, height: height, bitsPerComponent: 8,
  bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
 bitmap.setFillColor(gray: 1, alpha: 1)
 bitmap.fill(CGRect(x: 0, y: 0, width: width, height: height))
 bitmap.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
 bitmap.drawPDFPage(page.pageRef!)
 var ink = 0
 for index in 0..<(width * height) { if pixels[index] < 128 { ink += 1 } }
 let text = page.string ?? ""
 let string = text as NSString
 var characters: [[String: Any]] = []
 for index in 0..<string.length {
  let selection = page.selection(for: NSRange(location: index, length: 1))
  characters.append(["index": index, "text": selection?.string ?? ""])
 }
 let words: [[String: Any]] = document.findString("office", withOptions: .literal).map { selection in
  let box = selection.bounds(for: page)
  return ["text": selection.string ?? "", "x": box.minX, "width": box.width]
 }
 output.append(["id": entry["id"]!, "invisible": entry["invisible"]!, "variant": entry["variant"]!,
  "text": text, "selection": document.selectionForEntireDocument?.string ?? "",
  "asciiOffice": words, "characters": characters, "ink": ink,
  "pixelHash": SHA256.hash(data: Data(bytes: pixels, count: width * height)).map { String(format: "%02x", $0) }.joined()])
 pixels.deallocate()
}
print(String(data: try JSONSerialization.data(withJSONObject: output), encoding: .utf8)!)
`;

test(
  'native PDF encoding preserves source ligatures, font paint and PDFKit selection across embedding',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const service = createTextComposition(await nativeTextTestExecutable()),
      directory = await mkdtemp(path.join(tmpdir(), 'ivo-native-pdf-encoding-')),
      manifest = [],
      native = new Map();
    t.after(() => service.close());
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const sample of samples) {
      const request = await sourceRequest(sample.source),
        composition = await service.compose(request);
      native.set(sample.id, composition);
      for (const invisible of [false, true]) {
        const original = Buffer.from(
            (await service.pdf(composition.token, { invisible })).data,
            'base64',
          ),
          retained = Buffer.from(original),
          result = await improveNativePDFEncoding(original);
        assert.deepEqual(original, retained, 'The transform cannot mutate worker-owned bytes.');
        if (sample.id === 'ascii') {
          assert.equal(result.supported, true);
          assert.equal(result.changed, true);
          assert.ok(
            result.audit.some(
              (item) =>
                item.status === 'patched' &&
                item.updates.some((update) => update.desired === 'ffi'),
            ),
          );
        } else {
          assert.equal(result.changed, false);
          assert.deepEqual(
            result.bytes,
            original,
            'Literal and blocked mixed sources stay byte-exact.',
          );
          assert.equal(result.supported, sample.id === 'literal');
          if (sample.id === 'mixed') {
            assert.match(result.reason, /ambiguous|unsupported/i);
            assert.ok(result.audit.some((item) => item.reason === 'unannotated-use'));
          }
        }
        const before = await identities(original),
          after = await identities(result.bytes);
        assert.deepEqual(
          after.fonts,
          before.fonts,
          'Font programs, widths, encoding and identity remain unchanged.',
        );
        for (const [reference, value] of before.streams)
          assert.deepEqual(
            after.streams.get(reference),
            value,
            'Every existing paint/font/metadata stream stays byte-exact.',
          );
        assert.equal(
          after.streams.size - before.streams.size,
          result.audit.filter((item) => item.status === 'patched').length,
        );
        const second = await improveNativePDFEncoding(result.bytes);
        assert.equal(second.changed, false);
        assert.deepEqual(second.bytes, result.bytes, 'Encoding improvement is idempotent.');
        for (const [variant, bytes] of [
          ['original', original],
          ['improved', result.bytes],
          ['embedded', await embedded(result.bytes)],
        ]) {
          const file = path.join(directory, sample.id + '-' + invisible + '-' + variant + '.pdf');
          await writeFile(file, bytes);
          manifest.push({ id: sample.id, invisible, variant, path: file });
        }
      }
    }
    const reader = path.join(directory, 'reader.swift'),
      manifestFile = path.join(directory, 'manifest.json');
    await writeFile(reader, readerSource);
    await writeFile(manifestFile, JSON.stringify(manifest));
    const { stdout } = await exec(
      '/usr/bin/xcrun',
      ['swift', '-module-cache-path', path.join(directory, 'cache'), reader, manifestFile],
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
    const independent = JSON.parse(stdout);
    assert.equal(independent.length, samples.length * 2 * 3);
    for (const sample of samples)
      for (const invisible of [false, true]) {
        const rows = independent.filter(
            (item) => item.id === sample.id && item.invisible === invisible,
          ),
          original = rows.find((item) => item.variant === 'original');
        assert.equal(
          original.ink > 0,
          !invisible,
          'Visible native text paints; invisible selectable text does not.',
        );
        for (const row of rows) {
          assert.equal(
            row.pixelHash,
            original.pixelHash,
            'Rendering and positioning are identical, including embedPage.',
          );
          if (sample.id === 'mixed') {
            assert.equal(
              row.text,
              original.text,
              'A blocked ambiguity cannot change extracted source.',
            );
          } else if (row.variant !== 'original' || sample.id === 'literal') {
            assert.equal(row.text, sample.source);
            assert.equal(row.selection, sample.source);
            if (sample.id === 'ascii') {
              assert.equal(row.asciiOffice.length, 1);
              assert.equal(row.asciiOffice[0].text, 'office');
              const carets = native.get('ascii').layout.lines[0].carets;
              assert.ok(Math.abs(row.asciiOffice[0].x - carets[0].primary) < 0.001);
              assert.ok(
                Math.abs(row.asciiOffice[0].width - (carets[6].primary - carets[0].primary)) <
                  0.001,
              );
              // Exact source extraction does not promise PDFKit's per-character hit subdivision.
              assert.deepEqual(
                row.characters.slice(1, 4).map((item) => item.text),
                ['ffi', 'ffi', 'ffi'],
              );
            }
          }
        }
      }
  },
);
