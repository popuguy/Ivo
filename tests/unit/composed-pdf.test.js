import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
  StandardFonts,
  TextRenderingMode,
  setTextRenderingMode,
} from 'pdf-lib';
import { embedComposedTextLayers } from '../../desktop/composed-pdf.mjs';

async function sourcePDF({ blank = false } = {}) {
  const source = await PDFDocument.create(),
    page = source.addPage([220, 100]);
  if (!blank) {
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText('Invisible native stand-in', { x: 0, y: 75, size: 14, font });
  }
  return source.save();
}
function pageOperators(page) {
  const contents = page.node.Contents();
  const values = contents instanceof PDFArray ? contents.asArray() : [contents];
  return values
    .map((ref) => page.doc.context.lookup(ref))
    .map((stream) =>
      new TextDecoder().decode(
        stream instanceof PDFRawStream
          ? decodePDFRawStream(stream).decode()
          : stream.getUnencodedContents(),
      ),
    )
    .join('\n');
}

test('composed PDF layers retain their embedded text resources and explicit affine/clip placement', async () => {
  const bytes = await sourcePDF(),
    original = bytes.slice(),
    destination = await PDFDocument.create();
  destination.addPage([612, 792]);
  destination.addPage([400, 400]);
  const layers = [
    {
      bytes,
      placements: [
        {
          sourcePageIndex: 0,
          destinationPageIndex: 0,
          matrix: [0, 1.25, -0.75, 0, 350.5, 100.25],
          clips: [
            [
              { x: 10, y: 20 },
              { x: 580, y: 20 },
              { x: 580, y: 720 },
              { x: 10, y: 720 },
            ],
          ],
        },
        { sourcePageIndex: 0, destinationPageIndex: 1, matrix: [1, 0.2, 0.1, 1, 30, 40] },
      ],
    },
  ];
  const input = structuredClone(layers),
    result = await embedComposedTextLayers(destination, layers);
  assert.deepEqual(result, {
    layers: 1,
    placements: 2,
    drawnPlacements: 2,
    emptyPlacements: 0,
    textEncoding: [{ layerIndex: 0, changed: false, supported: true, substitutions: 0 }],
  });
  assert.deepEqual(bytes, original);
  assert.deepEqual(layers, input);
  assert.match(pageOperators(destination.getPage(0)), /0 1\.25 -0\.75 0 350\.5 100\.25 cm/);
  assert.match(pageOperators(destination.getPage(0)), /W\s+n/);
  const saved = await PDFDocument.load(await destination.save());
  assert.deepEqual(
    saved.getPages().map((p) => p.getSize()),
    [
      { width: 612, height: 792 },
      { width: 400, height: 400 },
    ],
  );
  const xobjects = saved.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  const form = saved.context.lookup(xobjects.values()[0]);
  const operators = new TextDecoder().decode(decodePDFRawStream(form).decode());
  assert.match(operators, /3 Tr/);
  assert.match(operators, /Tj/);
  assert.ok(form.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('Font')).keys().length);
});

test('each tagged appearance of repeated native text has its own PDF structure parent', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  const labels = ['first', undefined, 'second', undefined];
  const placements = labels.map((marker, i) => ({
    sourcePageIndex: 0,
    destinationPageIndex: 0,
    matrix: [1, 0, 0, 1, 0, i * 50],
    marker,
  }));
  const tags = new Map();
  await embedComposedTextLayers(pdf, [{ bytes: await sourcePDF(), placements }], {
    frame: (_token, value) => value.marker,
    attachFrame: (marker, _source, ref) => tags.set(marker, ref),
  });
  const forms = page.node.Resources().lookup(PDFName.of('XObject')).values();
  assert.equal(forms.length, 4);
  assert.deepEqual([...tags.keys()], ['first', 'second']);
  assert.equal(forms[0], tags.get('first'));
  assert.equal(forms[2], tags.get('second'));
  assert.equal(forms[1], forms[3]);
  assert.equal(new Set(forms).size, 3);
});

test('invalid composed geometry and missing pages reject before changing destination content', async () => {
  const bytes = await sourcePDF(),
    destination = await PDFDocument.create();
  destination.addPage([612, 792]);
  const valid = { sourcePageIndex: 0, destinationPageIndex: 0, matrix: [1, 0, 0, 1, 0, 0] };
  const invalid = [
    { ...valid, matrix: [1, 0, 0, 1, NaN, 0] },
    { ...valid, matrix: [0, 0, 0, 0, 0, 0] },
    { ...valid, matrix: [1, 0, 0, 1] },
    { ...valid, destinationPageIndex: 1 },
    { ...valid, sourcePageIndex: 1 },
    {
      ...valid,
      clips: [
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      ],
    },
    {
      ...valid,
      clips: [
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: Infinity, y: 3 },
        ],
      ],
    },
  ];
  const before = await destination.save({ useObjectStreams: false });
  for (const placement of invalid) {
    await assert.rejects(
      embedComposedTextLayers(destination, [{ bytes, placements: [valid, placement] }]),
    );
    assert.deepEqual(await destination.save({ useObjectStreams: false }), before);
  }
});

test('blank native source pages add no content, and no requested layers is a no-op', async () => {
  const destination = await PDFDocument.create();
  destination.addPage([612, 792]);
  const before = await destination.save({ useObjectStreams: false });
  assert.deepEqual(await embedComposedTextLayers(destination, []), {
    layers: 0,
    placements: 0,
    drawnPlacements: 0,
    emptyPlacements: 0,
    textEncoding: [],
  });
  assert.deepEqual(await destination.save({ useObjectStreams: false }), before);
  const result = await embedComposedTextLayers(destination, [
    {
      bytes: await sourcePDF({ blank: true }),
      placements: [{ sourcePageIndex: 0, destinationPageIndex: 0, matrix: [1, 0, 0, 1, 20, 30] }],
    },
  ]);
  assert.equal(result.emptyPlacements, 1);
  assert.equal(result.drawnPlacements, 0);
  assert.deepEqual(await destination.save({ useObjectStreams: false }), before);
});

test('unsupported native encoding retains its original content and reports compatibility separately', async () => {
  const source = await PDFDocument.load(await sourcePDF()),
    fonts = source.getPage(0).node.Resources().lookup(PDFName.of('Font')),
    font = source.context.lookup(fonts.values()[0]),
    originalMap = 'An explicitly unsupported owned-test ToUnicode grammar';
  font.set(
    PDFName.of('ToUnicode'),
    source.context.register(source.context.flateStream(originalMap)),
  );
  const bytes = await source.save(),
    original = bytes.slice(),
    destination = await PDFDocument.create();
  destination.addPage([612, 792]);
  const result = await embedComposedTextLayers(destination, [
    {
      bytes,
      placements: [{ sourcePageIndex: 0, destinationPageIndex: 0, matrix: [1, 0, 0, 1, 20, 30] }],
    },
  ]);
  assert.deepEqual(bytes, original);
  assert.equal(result.drawnPlacements, 1);
  assert.equal(result.textEncoding[0].supported, false);
  assert.equal(result.textEncoding[0].changed, false);
  assert.equal(result.textEncoding[0].substitutions, 0);
  assert.match(result.textEncoding[0].reason, /unsupported font mapping/i);
  const saved = await PDFDocument.load(await destination.save()),
    fontsAfter = [...saved.context.enumerateIndirectObjects()]
      .map(([, object]) => object)
      .filter((object) => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Form');
  assert(
    fontsAfter.some((form) =>
      new TextDecoder().decode(decodePDFRawStream(form).decode()).includes('Tj'),
    ),
  );
  assert(
    [...saved.context.enumerateIndirectObjects()].some(
      ([, object]) =>
        object instanceof PDFRawStream &&
        new TextDecoder().decode(decodePDFRawStream(object).decode()) === originalMap,
    ),
  );
});
