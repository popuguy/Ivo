import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  composeNativeTextFlows,
  nativeFlowColumns,
  nativeSourceBoundary,
  validateNativeFlowSource,
} from '../../src/rendering/text/native-flow-layout.js';
import { inspectFont } from '../../src/domain/text/fonts.js';

// A deliberately narrow non-layout DOM: source fixtures are plain text. Tests
// exercise the real canonical projection, resource resolver and production driver,
// without pretending that Node supplies browser selection or glyph geometry.
const original = { document: globalThis.document, Node: globalThis.Node, fetch: globalThis.fetch };
before(() => {
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  globalThis.document = {
    createElement() {
      return {
        nodeType: 1,
        tagName: 'DIV',
        children: [],
        querySelectorAll: () => [],
        set innerHTML(value) {
          assert.ok(!value.includes('<'), 'The non-layout source fixture must be plain text');
          this.html = value;
          this.childNodes = value
            ? [
                {
                  nodeType: 3,
                  nodeName: '#text',
                  data: value,
                  length: value.length,
                  textContent: value,
                  parentElement: this,
                },
              ]
            : [];
        },
        get innerHTML() {
          return this.html;
        },
      };
    },
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    arrayBuffer: async () => {
      const bytes = await readFile(url);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  });
});
after(() => {
  Object.assign(globalThis, original);
});
function fixture({
  text = 'alpha beta gamma delta epsilon',
  composer = 'single-line',
  automaticPages = false,
  width = 60,
  height = 40,
} = {}) {
  return {
    pages: [{ id: 'page-a', name: 'Page 1', width: 612, height: 792 }],
    blocks: [
      {
        id: 'frame-a',
        type: 'text',
        textFlowId: 'flow-a',
        pageId: 'page-a',
        x: 20,
        y: 30,
        w: width,
        h: height,
        html: '',
      },
    ],
    textFlows: [
      {
        id: 'flow-a',
        html: text,
        style: { textStyle: 'cmu-serif', fontSize: 16 },
        frameIds: ['frame-a'],
        automaticPages,
        deleteEmptyPages: true,
        autoPages: [],
        composition: { version: 1, composer },
      },
    ],
  };
}
function port() {
  const calls = [];
  const compose = async (request) => {
    calls.push(request);
    if (request.mode === 'measure-lines-proof')
      return {
        sourceDigest: request.sourceDigest,
        measurements: request.candidates.map((part) => ({
          ...part,
          width: request.text.slice(part.start, part.end).trim().length * 5,
        })),
      };
    let start = 0;
    const lines = [];
    for (const frame of request.frames)
      for (let row = 0; row < Math.floor(frame.height / 20) && start < request.text.length; row++) {
        const paragraph = request.paragraphs.find((p) => p.start <= start && p.end > start),
          originX =
            paragraph.leftIndent + (start === paragraph.start ? paragraph.firstLineIndent : 0),
          availableWidth = frame.width - originX - paragraph.rightIndent,
          end =
            request.breaks?.find((end) => end > start) ??
            Math.min(paragraph.end, start + Math.floor(availableWidth / 5)),
          contentEnd = /[\u2028\u2029]/.test(request.text[end - 1]) ? end - 1 : end;
        lines.push({
          frame: frame.id,
          start,
          end,
          contentEnd,
          originX,
          availableWidth,
          paragraphStart: paragraph.start,
          paragraphEnd: paragraph.end,
          baseline: 15 + row * 20,
          ascent: 15,
          descent: 4,
          leading: 0,
          advance: 20,
          width: (contentEnd - start) * 5,
          visibleWidth: request.text.slice(start, contentEnd).trim().length * 5,
          carets: [],
          runs: [],
        });
        start = end;
      }
    return {
      protocol: request.protocol,
      sourceDigest: request.sourceDigest,
      requestDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
      token: 'ct1-fixture',
      vectors: [],
      diagnostics: [],
      layout: { lines, coveredLength: start, textLength: request.text.length },
    };
  };
  return { compose, calls };
}
test('native driver preserves authored source/objects, returns SVG and canonical column provenance, caches semantic results', async () => {
  const doc = fixture(),
    before = structuredClone(doc),
    frame = doc.blocks[0],
    native = port(),
    plan = await composeNativeTextFlows(doc, native);
  assert.deepEqual(doc, before);
  assert.equal(doc.blocks[0], frame);
  assert.equal(plan.changed, false);
  assert.equal(plan.status.get('flow-a').overset, true);
  const fragment = plan.fragments.get('frame-a');
  assert.equal(fragment.native, true);
  assert.match(fragment.html, /data-composed-text="true"/);
  assert.equal(fragment.columns[0].native.spans[0].logicalStart, 0);
  assert.equal(fragment.end, 24);
  const request = native.calls[0];
  assert.equal(request.allowFallback, false);
  assert.equal(request.protocol, 2);
  assert.equal(request.paragraphs.length, 1);
  assert.ok(!Object.hasOwn(request, 'links'));
  assert.ok(!Object.hasOwn(request.paragraphs[0], 'contentEnd'));
  assert.ok(!Object.hasOwn(request.paragraphs[0], 'logicalEnd'));
  assert.equal(request.resources[0].postscript, 'CMUSerif-Roman');
  assert.equal(
    request.resources[0].digest,
    createHash('sha256').update(Buffer.from(request.resources[0].data, 'base64')).digest('hex'),
  );
  assert.equal(plan.compositions[0].frames[0].frameId, frame.id);
  assert.equal(plan.compositions[0].frames[0].pageId, frame.pageId);
  assert.equal(plan.compositions[0].result.token, 'ct1-fixture');
  await composeNativeTextFlows(doc, native);
  assert.equal(native.calls.length, 1);
  const snapshot = structuredClone(doc);
  snapshot.blocks[0].x += 200;
  snapshot.pages[0].name = 'Renamed page';
  await composeNativeTextFlows(snapshot, native);
  assert.equal(
    native.calls.length,
    1,
    'Immutable snapshots with the same native geometry must reuse native work',
  );
  frame.x += 1;
  await composeNativeTextFlows(doc, native);
  assert.equal(native.calls.length, 1, 'Object translation must not recompose glyphs');
  frame.w += 1;
  await composeNativeTextFlows(doc, native);
  assert.equal(native.calls.length, 2, 'Text area width changes invalidate native lines');
});
test('synchronous native source guard checks effective styles and exact faces without loading bytes', () => {
  const doc = fixture({ text: 'guard' }),
    savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('A synchronous source guard must never fetch');
  };
  try {
    doc.textFlows[0].style.textOverrides = { fontSize: 21, italic: true };
    const source = validateNativeFlowSource(doc, doc.textFlows[0]);
    assert.equal(source.runs[0].size, 21);
    assert.equal(source.runs[0].font, 'cmu-italic');
    doc.textFlows[0].style.textOverrides.kerning = 'optical';
    assert.throws(() => validateNativeFlowSource(doc, doc.textFlows[0]), /kerning/);
    delete doc.textFlows[0].style.textOverrides.kerning;
    doc.textFlows[0].style.textOverrides.language = 'sr-RS';
    assert.throws(() => validateNativeFlowSource(doc, doc.textFlows[0]), /language-specific/);
    delete doc.textFlows[0].style.textOverrides.language;
    doc.textFlows[0].style.textOverrides.textStyle = 'system:UnpackagedFont';
    assert.throws(() => validateNativeFlowSource(doc, doc.textFlows[0]), /exact portable/);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
test('native source budgets reject an unsupported edit synchronously before source persistence', () => {
  const doc = fixture({ text: 'word '.repeat(2100), composer: 'paragraph' });
  assert.throws(() => validateNativeFlowSource(doc, doc.textFlows[0]), /source\/font budget/);
  const marks = fixture({ text: '\u2029'.repeat(10001) });
  assert.throws(() => validateNativeFlowSource(marks, marks.textFlows[0]), /source\/font budget/);
});
test('native paragraph source guards admit real paragraph styles and reject impossible areas before IO', () => {
  const doc = fixture({ text: 'Paragraph policy', width: 200 }),
    style = doc.textFlows[0].style;
  Object.assign(style, {
    align: 'justify-right',
    leftIndent: 18,
    rightIndent: 12,
    firstLineIndent: -9,
    paragraphBefore: 7,
    paragraphAfter: 11,
  });
  const before = structuredClone(doc),
    source = validateNativeFlowSource(doc, doc.textFlows[0]);
  assert.equal(source.paragraphs[0].align, 'justify-right');
  assert.equal(source.paragraphs[0].firstLineIndent, -9);
  assert.deepEqual(doc, before);
  style.leftIndent = 250;
  assert.throws(() => validateNativeFlowSource(doc, doc.textFlows[0]), /text width/);
  style.leftIndent = 18;
  doc.textFlows[0].html = 'A\tB';
  assert.throws(() => validateNativeFlowSource(doc, doc.textFlows[0]), /tabs combined/);
});
test('mismatched paragraph geometry rejects the full result without derived page mutations', async () => {
  for (const corrupt of [
    (r) => {
      r.protocol = 1;
    },
    (r) => {
      r.layout.lines[0].originX = NaN;
    },
    (r) => {
      r.layout.lines[0].availableWidth = 1;
    },
    (r) => {
      r.layout.lines[0].paragraphStart = 1;
    },
    (r) => {
      r.layout.lines[0].end = r.layout.lines[0].paragraphEnd + 1;
    },
  ]) {
    const doc = fixture({ automaticPages: true, text: 'A\u2029Second paragraph source' }),
      before = structuredClone(doc),
      native = port();
    await assert.rejects(
      composeNativeTextFlows(doc, {
        compose: async (request) => {
          const result = await native.compose(request);
          corrupt(result);
          return result;
        },
      }),
      /match its source|paragraph geometry/,
    );
    assert.deepEqual(doc, before);
  }
});
test('columns convert insets/gutters/text scale once and forward baseline policy', () => {
  const doc = fixture({ width: 260, height: 140 }),
    frame = doc.blocks[0];
  frame.textScale = { x: 2, y: 4 };
  frame.frameOptions = {
    columns: 2,
    gutter: 20,
    insetLeft: 10,
    insetRight: 10,
    insetTop: 8,
    insetBottom: 12,
    firstBaseline: 'cap-height',
    minimumFirstBaseline: 16,
    verticalAlign: 'bottom',
  };
  const columns = nativeFlowColumns(doc, doc.textFlows[0]);
  assert.deepEqual(
    columns.map(({ left, top, width, height }) => ({ left, top, width, height })),
    [
      { left: 5, top: 2, width: 55, height: 30 },
      { left: 70, top: 2, width: 55, height: 30 },
    ],
  );
  assert.equal(columns[0].minimumFirstBaseline, 4);
  assert.equal(columns[0].firstBaseline, 'cap-height');
  assert.equal(columns[0].verticalAlign, 'bottom');
  frame.frameOptions.verticalAlign = 'justify';
  assert.throws(() => nativeFlowColumns(doc, doc.textFlows[0]), /justified vertical/);
});
test('owned automatic pages append/trim without replacing existing objects or changing canonical text', async () => {
  const doc = fixture({ automaticPages: true }),
    frame = doc.blocks[0],
    source = doc.textFlows[0].html,
    native = port();
  const plan = await composeNativeTextFlows(doc, native);
  assert.equal(plan.changed, true);
  assert.equal(plan.status.get('flow-a').overset, false);
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.textFlows[0].autoPages.length, 1);
  assert.equal(doc.textFlows[0].html, source);
  assert.equal(doc.blocks[0], frame);
  const ranges = [...plan.fragments.values()].map(({ start, end }) => [start, end]);
  assert.deepEqual(ranges, [
    [0, 24],
    [24, source.length],
  ]);
  doc.textFlows[0].html = 'short';
  const trimmed = await composeNativeTextFlows(doc, native);
  assert.equal(trimmed.changed, true);
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0], frame);
});
test('allowPages=false reports overset; empty and spaces retain native paragraph/caret geometry', async () => {
  const doc = fixture({ automaticPages: true }),
    native = port();
  assert.equal(
    (await composeNativeTextFlows(doc, { ...native, allowPages: false })).changed,
    false,
  );
  assert.equal(doc.pages.length, 1);
  assert.equal(native.calls.length, 1);
  doc.textFlows[0].html = '';
  const empty = await composeNativeTextFlows(doc, native);
  assert.equal(empty.status.get('flow-a').used, 1);
  assert.equal(native.calls.length, 2);
  assert.equal(empty.compositions.length, 1);
  assert.equal(empty.fragments.get('frame-a').columns[0].native.lines.length, 1);
  assert.equal(empty.fragments.get('frame-a').end, 0);
  assert.equal(doc.pages.length, 1);
  doc.textFlows[0].html = '   ';
  const spaces = await composeNativeTextFlows(doc, native);
  assert.equal(spaces.compositions[0].source.text, '   \u2029');
  assert.equal(spaces.fragments.get('frame-a').end, 3);
});
test('paragraph mode measures actual alternatives then renders explicit owned decisions, with no greedy fallback', async () => {
  const doc = fixture({
      composer: 'paragraph',
      text: 'one two three four five six',
      width: 60,
      height: 200,
    }),
    native = port();
  const plan = await composeNativeTextFlows(doc, native);
  assert.deepEqual(
    native.calls.map((r) => r.mode),
    ['measure-lines-proof', 'explicit-lines-proof'],
  );
  const measured = native.calls[0],
    rendered = native.calls[1];
  assert.equal(rendered.breaks.at(-1), rendered.text.length);
  assert.ok(
    rendered.breaks.every((end) => measured.candidates.some((candidate) => candidate.end === end)),
  );
  assert.equal(plan.status.get('flow-a').policy, 'ragged-right-quadratic-v1');
  assert.equal(plan.status.get('flow-a').overset, false);
  const before = structuredClone(doc);
  doc.blocks.push({ ...doc.blocks[0], id: 'frame-b', w: 100 });
  doc.textFlows[0].frameIds.push('frame-b');
  await assert.rejects(composeNativeTextFlows(doc, native), /unequal column widths/);
  assert.equal(
    native.calls.length,
    2,
    'Unsupported paragraph geometry must not fall back to greedy',
  );
  assert.equal(doc.textFlows[0].html, before.textFlows[0].html);
});
test('a malformed paragraph batch can retry the same source without retaining a corrupt response', async () => {
  const doc = fixture({
      composer: 'paragraph',
      text: 'one two three four',
      width: 60,
      height: 200,
    }),
    native = port(),
    original = native.compose,
    before = structuredClone(doc);
  let malformed = true;
  native.compose = async (query) => {
    const result = await original(query);
    if (query.mode === 'measure-lines-proof' && malformed) {
      malformed = false;
      result.measurements[0].end++;
    }
    return result;
  };
  await assert.rejects(composeNativeTextFlows(doc, native), /requested alternative/);
  assert.deepEqual(doc, before);
  const retry = await composeNativeTextFlows(doc, native);
  assert.equal(retry.status.get('flow-a').overset, false);
  assert.equal(native.calls.filter((query) => query.mode === 'measure-lines-proof').length, 2);
});
test('source boundary mapping partitions virtual marks without duplicating the next paragraph', () => {
  const source = {
    text: 'A\u2029B\u2029',
    logicalLength: 6,
    spans: [
      { kind: 'structure', logicalStart: 0, logicalEnd: 1, start: 0, end: 0 },
      { kind: 'text', logicalStart: 1, logicalEnd: 2, start: 0, end: 1 },
      { kind: 'paragraph', logicalStart: 2, logicalEnd: 3, start: 1, end: 2 },
      { kind: 'structure', logicalStart: 3, logicalEnd: 4, start: 2, end: 2 },
      { kind: 'text', logicalStart: 4, logicalEnd: 5, start: 2, end: 3 },
      { kind: 'paragraph', logicalStart: 5, logicalEnd: 6, start: 3, end: 4 },
    ],
  };
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => nativeSourceBoundary(source, i)),
    [0, 2, 3, 5, 6],
  );
  assert.throws(() => nativeSourceBoundary(source, 5), /source boundary/);
});
test('explicit unsupported versions/styles and stale native results reject without partial automatic page edits', async () => {
  const doc = fixture({ automaticPages: true }),
    native = port();
  const originalCompose = native.compose;
  native.compose = async (request) => {
    if (request.frames.length > 1) throw Error('fixture native failure');
    return originalCompose(request);
  };
  const before = structuredClone(doc);
  await assert.rejects(composeNativeTextFlows(doc, native), /fixture native failure/);
  assert.deepEqual(doc, before);
  doc.textFlows[0].style.baselineShift = 3;
  await assert.rejects(composeNativeTextFlows(doc, port()), /baseline shift/);
  delete doc.textFlows[0].style.baselineShift;
  doc.textFlows[0].composition.version = 2;
  await assert.rejects(composeNativeTextFlows(doc, port()), /composition version/);
  doc.textFlows[0].composition.version = 1;
  await assert.rejects(
    composeNativeTextFlows(doc, { compose: async () => ({ sourceDigest: 'wrong' }) }),
    /match its source/,
  );
  assert.equal(doc.pages.length, 1);
});
test('vault resources preserve exact chosen face bytes/companions and reject forged identities', async () => {
  const bytes = await readFile(new URL('../../public/fonts/cmu-serif/cmunti.ttf', import.meta.url)),
    digest = createHash('sha256').update(bytes).digest('hex'),
    asset = {
      id: 'font-' + digest,
      data: 'data:font/ttf;base64,' + bytes.toString('base64'),
      mimeType: 'font/ttf',
      font: inspectFont(bytes),
    },
    doc = fixture({ text: 'portable', width: 100, height: 100 }),
    native = port();
  doc.textFlows[0].style = {
    textStyle: asset.id,
    fontSize: 16,
    italic: true,
    textOverrides: { fontSize: 18 },
  };
  await composeNativeTextFlows(doc, { ...native, assets: [asset] });
  assert.equal(native.calls[0].resources[0].digest, digest);
  assert.equal(native.calls[0].resources[0].data, bytes.toString('base64'));
  assert.equal(native.calls[0].runs[0].size, 18);
  assert.equal(native.calls[0].runs[0].font, asset.id);
  doc.textFlows[0].style.italic = false;
  await assert.rejects(
    composeNativeTextFlows(doc, { ...native, assets: [asset] }),
    /exact portable/,
  );
  doc.textFlows[0].style.italic = true;
  asset.data =
    'data:font/ttf;base64,' +
    (await readFile(new URL('../../public/fonts/cmu-serif/cmunrm.ttf', import.meta.url))).toString(
      'base64',
    );
  await assert.rejects(
    composeNativeTextFlows(doc, { ...native, assets: [asset] }),
    /immutable identity/,
  );
});
