import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { improveNativePDFEncoding } from '../../desktop/native-pdf-encoding.mjs';

const require = createRequire(import.meta.url);
const {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFString,
  PDFRawStream,
  decodePDFRawStream,
} = require('pdf-lib');
const name = (value) => PDFName.of(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');
// An owned opaque byte fixture, deliberately not a usable font. These unit tests
// verify encoding metadata/paint preservation; native tests qualify real fonts
// and actual reader/rendering behavior independently.
const OWNED_PROGRAM = Buffer.from('Ivo test-owned opaque font program, version 1.');

function cmap({ width = 1, entries = [[33, 'FB03']], extra = '' } = {}) {
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Ivo-Test-UCS def
/CMapType 2 def
1 begincodespacerange
<${'00'.repeat(width)}><${'FF'.repeat(width)}>
endcodespacerange
${entries.length} beginbfchar
${entries.map(([code, hex]) => `<${code.toString(16).padStart(width * 2, '0')}><${hex}>`).join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
${extra}`;
}

function makeFont(doc, { unicode = cmap(), width = 1, sharedMap } = {}) {
  const program = doc.context.register(doc.context.flateStream(OWNED_PROGRAM));
  const descriptor = doc.context.register(
    doc.context.obj({
      Type: 'FontDescriptor',
      FontName: 'IvoTestOwned',
      Flags: 32,
      FontBBox: [0, -200, 1000, 800],
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 700,
      StemV: 80,
      FontFile2: program,
    }),
  );
  const map = sharedMap || doc.context.register(doc.context.flateStream(unicode));
  if (width === 2) {
    const descendant = doc.context.register(
      doc.context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: 'IvoTestOwned',
        CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
        FontDescriptor: descriptor,
        DW: 500,
      }),
    );
    return doc.context.register(
      doc.context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: 'IvoTestOwned',
        Encoding: 'Identity-H',
        DescendantFonts: [descendant],
        ToUnicode: map,
      }),
    );
  }
  return doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'IvoTestOwned',
      FirstChar: 33,
      LastChar: 34,
      Widths: [600, 500],
      FontDescriptor: descriptor,
      Encoding: { Type: 'Encoding', Differences: [33, 'f_f_i', 'A'] },
      ToUnicode: map,
    }),
  );
}

const show = (actual = '(ffi)', text = '(!) Tj') =>
  `q /Span << /ActualText ${actual} >> BDC BT /F1 12 Tf 1 0 0 1 20 80 Tm ${text} ET EMC Q`;
const literalShow = 'q BT /F1 12 Tf 1 0 0 1 20 80 Tm (!) Tj ET Q';
function addPage(doc, font, content = show(), resources) {
  const page = doc.addPage([300, 160]);
  page.node.set(name('Resources'), resources || doc.context.obj({ Font: { F1: font } }));
  page.node.set(name('Contents'), doc.context.register(doc.context.flateStream(content)));
  return page;
}
async function fixture({ content = show(), unicode, width = 1, modify } = {}) {
  const doc = await PDFDocument.create();
  const font = makeFont(doc, { unicode, width });
  const page = addPage(doc, font, content);
  await modify?.({ doc, font, page });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
async function fontMap(bytes, pageIndex = 0, key = 'F1') {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[pageIndex];
  const font = page.node.Resources().lookup(name('Font'), PDFDict).lookup(name(key), PDFDict);
  const stream = font.lookup(name('ToUnicode'), PDFRawStream);
  return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
}
async function identitySnapshot(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const excluded = new Set();
  const fonts = {};
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || String(object.get(name('Type'))) !== '/Font') continue;
    if (object.has(name('ToUnicode'))) excluded.add(String(object.get(name('ToUnicode'))));
    fonts[String(ref)] = object
      .entries()
      .filter(([key]) => String(key) !== '/ToUnicode')
      .map(([key, value]) => [String(key), String(value)]);
  }
  const streams = {};
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    streams[String(ref)] = {
      dictionary: object.dict.toString(),
      raw: digest(object.contents),
      decoded: digest(decodePDFRawStream(object).decode()),
    };
  }
  return { fonts, streams, unicodeRefs: [...excluded] };
}
async function repaired(bytes) {
  const before = await identitySnapshot(bytes);
  const result = await improveNativePDFEncoding(bytes);
  assert.equal(result.supported, true, result.reason);
  assert.equal(result.changed, true);
  assert.ok(result.audit.some((entry) => entry.status === 'patched'));
  const after = await identitySnapshot(result.bytes);
  assert.deepEqual(
    after.fonts,
    before.fonts,
    'all non-ToUnicode font metadata must remain unchanged',
  );
  for (const [ref, stream] of Object.entries(before.streams))
    assert.deepEqual(
      after.streams[ref],
      stream,
      'every preexisting raw/decoded paint, font and CMap stream stays identical',
    );
  for (const ref of Object.keys(after.streams))
    if (!Object.hasOwn(before.streams, ref))
      assert.ok(after.unicodeRefs.includes(ref), 'only new ToUnicode streams may be added');
  return result;
}
async function rejected(bytes, pattern) {
  const result = await improveNativePDFEncoding(bytes);
  assert.equal(result.changed, false);
  assert.equal(result.supported, false);
  assert.deepEqual(
    Buffer.from(result.bytes),
    bytes,
    'unsupported files must return the exact original bytes',
  );
  if (pattern)
    assert.match(JSON.stringify({ reason: result.reason, audit: result.audit }), pattern);
  return result;
}

test('single native-style character code maps to exact ASCII source without normalizing source or repainting', async () => {
  const bytes = await fixture();
  const result = await repaired(bytes);
  assert.match(await fontMap(result.bytes), /<21><006600660069>/i);
  assert.match(await fontMap(bytes), /<21><FB03>/i);
  const second = await improveNativePDFEncoding(result.bytes);
  assert.equal(second.changed, false);
  assert.equal(second.supported, true);
  assert.deepEqual(
    Buffer.from(second.bytes),
    Buffer.from(result.bytes),
    'a second pass is byte-idempotent',
  );
});

test('a literal compatibility ligature remains its original code points with no normalization', async () => {
  const bytes = await fixture({ content: literalShow });
  const result = await improveNativePDFEncoding(bytes);
  assert.equal(result.changed, false);
  assert.equal(result.supported, true);
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  assert.match(await fontMap(result.bytes), /<21><FB03>/i);
});

for (const [label, actual, text] of [
  ['octal', '(\\146\\146\\151)', '(\\041) Tj'],
  ['line continuation', '(f\\\nfi)', '(\\\n!) Tj'],
  ['hex', '<FEFF006600660069>', '<21> Tj'],
  ['hex whitespace', '<FEFF 0066 0066 0069>', '<2 1> Tj'],
  ['TJ array', '(ffi)', '[<> 30 (!) -12] TJ'],
  ['single quote', '(ffi)', "(!) '"],
  ['double quote', '(ffi)', '0 0 (!) "'],
])
  test(`PDF literal/hex parsing preserves ${label} source and encoded bytes`, async () => {
    const result = await repaired(await fixture({ content: show(actual, text) }));
    assert.match(await fontMap(result.bytes), /<21><006600660069>/i);
  });

test('fixed two-byte Identity-H codes are distinguished from simple one-byte fonts', async () => {
  const result = await repaired(
    await fixture({ width: 2, unicode: cmap({ width: 2 }), content: show('(ffi)', '<0021> Tj') }),
  );
  assert.match(await fontMap(result.bytes), /<0021><006600660069>/i);
});

test('multi-code ActualText produces an explicit diagnostic and original bytes', async () => {
  await rejected(await fixture({ content: show('(ffi)', '(!!) Tj') }), /multicode-ActualText/);
});

test('nested conflicting ActualText cannot authorize a font-wide mapping', async () => {
  const nested = show('(ffi)', '/Span << /ActualText (other) >> BDC (!) Tj EMC');
  await rejected(await fixture({ content: nested }), /conflicting/);
});

test('a glyph code used for both ASCII and literal ligature cannot be globally rewritten', async () => {
  await rejected(await fixture({ content: `${show()}\n${literalShow}` }), /unannotated-use/);
});

test('font identity covers all pages, even with differing resource names', async () => {
  const bytes = await fixture({
    modify({ doc, font }) {
      addPage(
        doc,
        font,
        literalShow.replace('/F1', '/OtherName'),
        doc.context.obj({ Font: { OtherName: font } }),
      );
    },
  });
  await rejected(bytes, /unannotated-use/);
});

test('recursive Form traversal observes shared fonts and inherits fallback resources', async () => {
  const bytes = await fixture({
    modify({ doc, font, page }) {
      const resources = doc.context.obj({ Font: { F1: font } });
      const first = doc.context.register(
        doc.context.flateStream(show(), {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 300, 160],
          Resources: resources,
        }),
      );
      const second = doc.context.register(
        doc.context.flateStream(literalShow, {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 300, 160],
        }),
      );
      resources.set(name('XObject'), doc.context.obj({ First: first, Second: second }));
      page.node.set(name('Resources'), resources);
      page.node.set(
        name('Contents'),
        doc.context.register(doc.context.flateStream('q /First Do Q q /Second Do Q')),
      );
    },
  });
  await rejected(bytes, /unannotated-use/);
});

test('distinct fonts sharing one ToUnicode stream are isolated before a repair', async () => {
  const bytes = await fixture({
    modify({ doc, font }) {
      const first = doc.context.lookup(font, PDFDict);
      const literalFont = makeFont(doc, { sharedMap: first.get(name('ToUnicode')) });
      addPage(doc, literalFont, literalShow);
    },
  });
  const result = await repaired(bytes);
  assert.match(await fontMap(result.bytes, 0), /<21><006600660069>/i);
  assert.match(await fontMap(result.bytes, 1), /<21><FB03>/i);
  assert.equal(result.audit.filter((entry) => entry.status === 'patched').length, 1);
});

test('inherited page resources and named ActualText properties resolve exactly', async () => {
  const bytes = await fixture({
    content: show().replace('<< /ActualText (ffi) >>', '/Source'),
    modify({ doc, page }) {
      const resources = page.node.Resources();
      resources.set(
        name('Properties'),
        doc.context.obj({ Source: { ActualText: PDFString.of('ffi') } }),
      );
      page.node.Parent().set(name('Resources'), resources);
      page.node.delete(name('Resources'));
    },
  });
  const result = await repaired(bytes);
  assert.match(await fontMap(result.bytes), /<21><006600660069>/i);
});

test('CMap comments cannot invent active mappings; unchanged mappings stay byte-for-byte Unicode', async () => {
  const unicode = cmap({
    entries: [
      [33, 'FB03'],
      [34, '00410049'],
    ],
    extra: '% 1 beginbfchar <23><0058> endbfchar\n',
  });
  const result = await repaired(await fixture({ unicode }));
  const map = await fontMap(result.bytes);
  assert.match(map, /<21><006600660069>/i);
  assert.match(map, /<22><00410049>/i);
  assert.doesNotMatch(map, /<23>/i);
});

test('unknown CMap operations, malformed declarations and variable codespaces reject without partial output', async () => {
  for (const unicode of [
    cmap({ extra: 'OpaqueCMapCustomOp\n' }),
    cmap().replace('1 beginbfchar', '2 beginbfchar'),
    cmap().replace(
      '1 begincodespacerange\n<00><FF>',
      '2 begincodespacerange\n<00><FF>\n<0000><FFFF>',
    ),
    cmap().replace('<21><FB03>', '<21><D800>'),
    cmap()
      .replace('<21><FB03>', '<21><FB03>\n<21><0066>')
      .replace('1 beginbfchar', '2 beginbfchar'),
  ])
    await rejected(await fixture({ unicode }), /unsupported-cmap|CMap|ToUnicode/);
});

for (const [label, content, pattern] of [
  [
    'unknown operator',
    show().replace('(!) Tj', '(!) Tj OpaqueCustomOp'),
    /Unsupported content operator/,
  ],
  [
    'inline image',
    show().replace('(!) Tj', '(!) Tj ET BI /W 1 /H 1 /BPC 8 /CS /G ID x EI BT'),
    /Unsupported content operator/,
  ],
  ['unbalanced marked content', show().replace(' EMC', ''), /Incomplete content state/],
  ['unbalanced graphics state', show().replace(/ Q$/, ''), /Incomplete content state/],
  ['empty source', show('()'), /Unsupported ActualText/],
])
  test(`${label} returns original bytes even after an otherwise repairable claim`, async () => {
    await rejected(await fixture({ content }), pattern);
  });

test('Form cycles and ambiguous resource paths reject before emitting changes', async () => {
  const cycle = await fixture({
    modify({ doc, font, page }) {
      const resources = doc.context.obj({ Font: { F1: font } });
      const form = doc.context.register(
        doc.context.flateStream('q /Loop Do Q', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 100, 100],
          Resources: resources,
        }),
      );
      resources.set(name('XObject'), doc.context.obj({ Loop: form }));
      page.node.set(name('Resources'), resources);
      page.node.set(
        name('Contents'),
        doc.context.register(doc.context.flateStream(`${show()}\nq /Loop Do Q`)),
      );
    },
  });
  await rejected(cycle, /Cyclic Form/);
  await rejected(
    await fixture({ content: show().replace('/F1', '/MissingFont') }),
    /resource dictionary/,
  );
});

test('annotations, patterns and unknown font encodings are explicit unsupported inputs', async () => {
  await rejected(
    await fixture({
      modify({ doc, page }) {
        page.node.set(
          name('Annots'),
          doc.context.obj([{ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10] }]),
        );
      },
    }),
    /Annotation/,
  );
  await rejected(
    await fixture({
      modify({ doc, page }) {
        page.node.Resources().set(name('Pattern'), doc.context.obj({}));
      },
    }),
    /Pattern/,
  );
  await rejected(
    await fixture({
      modify({ doc, font }) {
        doc.context.lookup(font, PDFDict).set(name('Subtype'), name('Type3'));
      },
    }),
    /font encoding/,
  );
});

test('load errors return the exact original bytes and a clear unsupported reason', async () => {
  await rejected(Buffer.from('This is an owned non-PDF test input.'), /load|PDF|header|parse/i);
});

test('strict whole-file operation and character-use budgets cannot be bypassed by an earlier valid claim', async () => {
  await rejected(
    await fixture({ content: `${show()}\n${'q Q\n'.repeat(50001)}` }),
    /operation budget/,
  );
  const manyUses = `q BT /F1 12 Tf (${'!'.repeat(100001)}) Tj ET Q`;
  await rejected(await fixture({ content: `${show()}\n${manyUses}` }), /Text use budget/);
});

test('Form depth and CMap declaration budgets fail closed without changing original bytes', async () => {
  const bytes = await fixture({
    modify({ doc, font, page }) {
      let body = show();
      let resources = doc.context.obj({ Font: { F1: font } });
      for (let index = 0; index < 22; index++) {
        const form = doc.context.register(
          doc.context.flateStream(body, {
            Type: 'XObject',
            Subtype: 'Form',
            BBox: [0, 0, 100, 100],
            Resources: resources,
          }),
        );
        resources = doc.context.obj({ Font: { F1: font }, XObject: { Child: form } });
        body = 'q /Child Do Q';
      }
      page.node.set(name('Resources'), resources);
      page.node.set(name('Contents'), doc.context.register(doc.context.flateStream(body)));
    },
  });
  await rejected(bytes, /Form depth budget/);
  await rejected(
    await fixture({ unicode: cmap().replace('1 beginbfchar', '65537 beginbfchar') }),
    /CMap count budget/,
  );
});

test('input byte admission returns the original buffer before parsing an oversized file', async () => {
  const bytes = Buffer.alloc(24000001, 32);
  await rejected(bytes, /input.*budget/i);
});

test('serialization failure after admitted mapping changes returns original bytes and cannot poison a retry', async () => {
  const bytes = await fixture();
  const original = Buffer.from(bytes);
  const save = PDFDocument.prototype.save;
  let attempts = 0;
  PDFDocument.prototype.save = async function () {
    attempts++;
    const font = this.getPages()[0]
      .node.Resources()
      .lookup(name('Font'), PDFDict)
      .lookup(name('F1'), PDFDict);
    const stream = font.lookup(name('ToUnicode'), PDFRawStream);
    const text = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    assert.match(
      text,
      /<21><006600660069>/i,
      'the injected failure follows internal mapping mutation',
    );
    throw Error('Owned serialization failure after mapping mutation.');
  };
  try {
    const result = await rejected(bytes, /Owned serialization failure/);
    assert.deepEqual(
      result.audit,
      [],
      'an unsuccessful serialization must not report a completed repair',
    );
    assert.deepEqual(Buffer.from(result.bytes), original);
    assert.deepEqual(bytes, original, 'the caller-owned source buffer stays untouched');
    assert.equal(attempts, 1);
  } finally {
    PDFDocument.prototype.save = save;
  }
  const retry = await repaired(bytes);
  assert.match(await fontMap(retry.bytes), /<21><006600660069>/i);
});
