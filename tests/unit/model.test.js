import { CURRENT_ARCHIVE_VERSION } from '../../src/domain/documents/capabilities.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { uid, createDocument, createBlock } from '../../src/domain/documents/model.js';
import { buildIndex, filterDocuments, localGraph } from '../../src/domain/knowledge/index.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { exportMarkdown } from '../../src/features/export/markdown.js';

const document = (id, title, html = '', extra = {}) => ({
  ...createDocument(title),
  id,
  blocks: [createBlock('text', { id: `block-${id}`, html })],
  ...extra,
});
const archive = (...documents) => ({ schemaVersion: 1, documents, assets: [] });

// Each graph surface consumes the same directed edges, not its own link parser.
test('canonical IDs, case-insensitive aliases, heading links and duplicates resolve together', () => {
  const atlas = document('atlas', 'Atlas', '', {
    aliases: ['World book'],
    tags: ['Science/Optics', 'science/optics'],
  });
  const observer = document(
    'observer',
    'Observer',
    '<p><a data-doc-id="atlas">A view</a> [[WORLD BOOK#Intro|view]] [[Atlas]] [[Missing#Part]]</p>',
  );
  const index = buildIndex([atlas, observer]);
  assert.deepEqual(index.edges, [{ source: 'observer', target: 'atlas', count: 3 }]);
  assert.deepEqual(index.backlinks.atlas, [
    { source: 'observer', target: 'atlas', count: 3, title: 'Observer' },
  ]);
  assert.deepEqual(index.unresolved, [{ source: 'observer', target: 'Missing#Part' }]);
  assert.equal(index.tagCounts['science/optics'], 1);
});

test('canonical ID links survive title renames and missing IDs do not fall back to titles', () => {
  const source = document(
    'source',
    'Source',
    '<a data-doc-id="target">Previous title</a><a data-doc-id="Missing">Missing</a>',
  );
  const target = document('target', 'Renamed title');
  const other = document('other', 'Missing');
  const index = buildIndex([source, target, other]);
  assert.deepEqual(index.edges, [{ source: 'source', target: 'target', count: 1 }]);
  assert.deepEqual(index.unresolved, [{ source: 'source', target: 'Missing' }]);
  assert.equal(index.backlinks.other.length, 0);
});

test('ambiguous aliases remain unresolved; exact titles take precedence; self headings resolve', () => {
  const first = document('one', 'One', '[[Shared]] [[Two]] [[#Section]]', {
    aliases: ['Two', 'Shared'],
  });
  const second = document('two', 'Two', '', { aliases: ['Shared'] });
  const index = buildIndex([first, second]);
  assert.deepEqual(index.unresolved, [{ source: 'one', target: 'Shared' }]);
  assert.deepEqual(index.edges, [
    { source: 'one', target: 'two', count: 1 },
    { source: 'one', target: 'one', count: 1 },
  ]);
});

test('anchor display text is not counted twice and code examples do not form edges', () => {
  const source = document(
    'source',
    'Source',
    '<a data-doc-id="target">[[Target]]</a><code>[[Target]]</code><pre>[[Target]]</pre>',
  );
  assert.equal(buildIndex([source, document('target', 'Target')]).edges[0].count, 1);
});

test('tag hierarchy search is case-insensitive and respects slash boundaries', () => {
  const docs = [
    document('one', 'Optical notes', '<p>Light &amp; perception</p>', {
      tags: ['Science/Optics'],
      aliases: ['Seeing'],
    }),
    document('two', 'Other', '', { tags: ['sciencefiction'] }),
    document('three', 'Chemistry', '', { tags: ['Science'] }),
  ];
  assert.deepEqual(
    filterDocuments(docs, '', '#SCIENCE').map((doc) => doc.id),
    ['one', 'three'],
  );
  assert.deepEqual(
    filterDocuments(docs, 'tag:Science "light & perception"').map((doc) => doc.id),
    ['one'],
  );
  assert.deepEqual(
    filterDocuments(docs, 'seeing tag:science/optics').map((doc) => doc.id),
    ['one'],
  );
  assert.deepEqual(filterDocuments(docs, 'light absent'), []);
});

test('local graph traverses both directions with bounded depth and retains isolated root', () => {
  const docs = [
    document('a', 'A', '[[B]]'),
    document('b', 'B', '[[C]]'),
    document('c', 'C'),
    document('d', 'D'),
  ];
  const index = buildIndex(docs);
  assert.deepEqual(
    localGraph(index, 'b', 0).nodes.map((node) => node.id),
    ['b'],
  );
  assert.deepEqual(
    localGraph(index, 'c', 1).nodes.map((node) => node.id),
    ['b', 'c'],
  );
  assert.deepEqual(
    localGraph(index, 'c', 2).nodes.map((node) => node.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(localGraph(index, 'd'), { nodes: [index.nodes[3]], edges: [] });
  assert.deepEqual(localGraph(index, 'absent'), { nodes: [], edges: [] });
});

test('creation uses unique IDs and preserves the empty document contract', () => {
  assert.notEqual(uid(), uid());
  const doc = createDocument('  Studio  ', 'editorial');
  assert.equal(doc.title, 'Studio');
  assert.equal(doc.template, 'editorial');
  assert.deepEqual(doc.blocks, []);
  assert.deepEqual(doc.layout, { columns: 12, rows: 38 });
  assert.deepEqual(createBlock('image').crop, { x: 50, y: 50 });
  assert.throws(() => createBlock('executable'), /Unknown block type/);
});

test('import round trip preserves IDs, styling, assets, crop and scientific extensions without mutation', () => {
  const doc = document('atlas', 'Atlas');
  doc.blocks.push(
    createBlock('image', {
      id: 'image',
      src: 'asset:photo',
      x: 6,
      y: 1,
      w: 6,
      h: 8,
      fontSize: 24,
      textStyle: 'sans',
      align: 'center',
      crop: { x: 30, y: 65 },
      objectPosition: '30% 65%',
    }),
  );
  doc.blocks.push(
    createBlock('equation', { id: 'formula', extensions: { latex: 'E=mc^2', numbered: true } }),
  );
  const payload = {
    ...archive(doc),
    assets: [
      {
        id: 'photo',
        data: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/png',
        name: 'photo.png',
      },
    ],
  };
  const before = JSON.stringify(payload);
  const normalized = validateImport(payload);
  assert.equal(JSON.stringify(payload), before);
  assert.equal(normalized.documents[0].id, 'atlas');
  assert.equal(normalized.documents[0].blocks[1].id, 'image');
  assert.deepEqual(normalized.documents[0].blocks[1].objectPosition, { x: 30, y: 65 });
  assert.deepEqual(normalized.documents[0].blocks[2].extensions, {
    latex: 'E=mc^2',
    numbered: true,
  });
  assert.equal(normalized.assets[0].id, 'photo');
});

test('import rejects duplicate IDs including block/document collisions', () => {
  assert.throws(
    () => validateImport(archive(document('same', 'One'), document('same', 'Two'))),
    /duplicate ID/,
  );
  const doc = document('same', 'One');
  doc.blocks[0].id = 'same';
  assert.throws(() => validateImport(archive(doc)), /duplicate ID/);
});

test('edited backup revisions round trip independently of the archive schema', () => {
  const doc = { ...document('edited', 'Edited'), version: 37 };
  assert.equal(validateImport(archive(doc)).documents[0].version, 37);
  for (const version of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) {
    assert.throws(() => validateImport(archive({ ...doc, version })), /positive safe integer/);
  }
});

test('CMU Serif survives document and backup validation', () => {
  const doc = document(
    'latex-note',
    'A mathematical thought',
    '<p>Regular <strong>bold</strong> and <em>italic</em>.</p>',
  );
  doc.blocks[0].textStyle = 'cmu-serif';
  const restored = validateImport(JSON.parse(JSON.stringify(archive(doc))));
  assert.equal(restored.documents[0].blocks[0].textStyle, 'cmu-serif');
  assert.equal(restored.documents[0].blocks[0].html, doc.blocks[0].html);
});

test('import rejects invalid shapes, layout overflow, nonfinite values and oversized counts', () => {
  assert.throws(
    () => validateImport({ schemaVersion: CURRENT_ARCHIVE_VERSION + 1, documents: [] }),
    /schema version/,
  );
  assert.throws(
    () => validateImport({ schemaVersion: 1, documents: new Array(5001).fill({}) }),
    /at most 5000/,
  );
  assert.throws(
    () => validateImport(archive({ ...document('a', 'A'), blocks: new Array(1001).fill({}) })),
    /block limits/,
  );
  for (const overrides of [
    { x: NaN },
    { h: Infinity },
    { w: 13 },
    { y: 37, h: 5 },
    { crop: { x: 101, y: 0 } },
    { fontSize: 121 },
    { align: 'diagonal' },
  ]) {
    const doc = document('a', 'A');
    Object.assign(doc.blocks[0], overrides);
    assert.throws(() => validateImport(archive(doc)), TypeError);
  }
  assert.throws(
    () => validateImport(archive({ ...document('a', 'A'), tags: 'science' })),
    /100 strings/,
  );
});

test('import rejects dangerous URLs and active HTML, including entity-obfuscated schemes', () => {
  for (const src of [
    'javascript:alert(1)',
    'data:text/html;base64,PGgxPg==',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'file:///etc/passwd',
    'blob:https://example.com/id',
    'java\tscript:alert(1)',
  ]) {
    const doc = document('a', 'A');
    doc.blocks[0].src = src;
    assert.throws(() => validateImport(archive(doc)), TypeError, src);
  }
  for (const html of [
    '<a href="java&#115;cript:alert(1)">link</a>',
    '<a href="javascript&#58;alert(1)">link</a>',
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '<span style="background:url(javascript:alert(1))">a</span>',
  ]) {
    assert.throws(() => validateImport(archive(document('a', 'A', html))), TypeError, html);
  }
});

test('import requires asset references to exist and MIME metadata to agree', () => {
  const doc = document('a', 'A');
  for (const src of ['asset:missing', ' ASSET:missing ']) {
    doc.blocks[0].src = src;
    assert.throws(() => validateImport(archive(doc)), /missing asset/);
  }
  assert.throws(
    () => validateImport(archive(document('a', 'A', '<a href="asset:missing">file</a>'))),
    /missing asset/,
  );
  assert.throws(
    () =>
      validateImport({
        ...archive(),
        assets: [
          { id: 'photo', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'application/pdf' },
        ],
      }),
    /does not match/,
  );
  assert.throws(
    () => validateImport(JSON.parse('{"schemaVersion":1,"documents":[],"__proto__":{}}')),
    /unsafe key/,
  );
});

test('Markdown export preserves reading order, metadata, emphasis, media and canonical links', () => {
  const target = document('target', 'A renamed note', '', { aliases: ['Original'] });
  const doc = document('source', 'Source', '', { tags: ['design'], aliases: ['Magazine'] });
  doc.blocks = [
    createBlock('image', {
      id: 'image',
      x: 6,
      y: 8,
      src: 'asset:photo',
      alt: 'An image',
      caption: 'A caption',
    }),
    createBlock('text', {
      id: 'text',
      y: 0,
      html: '<p><strong>First</strong> and <a data-doc-id="target">the note</a>. [[Original#Overview|Read more]]</p>',
    }),
    createBlock('quote', { id: 'quote', y: 5, html: '<p>A thought.</p>' }),
  ];
  const markdown = exportMarkdown(doc, [target]);
  assert.match(markdown, /tags: \["design"\]/);
  assert.match(markdown, /\*\*First\*\* and \[the note\]\(A%20renamed%20note\.md\)/);
  assert.match(markdown, /\[Read more\]\(A%20renamed%20note\.md#Overview\)/);
  assert.match(markdown, /> A thought\./);
  assert.match(markdown, /!\[An image\]\(assets\/photo\)/);
  assert.ok(markdown.indexOf('**First**') < markdown.indexOf('> A thought.'));
  assert.ok(markdown.indexOf('> A thought.') < markdown.indexOf('![An image]'));
});

test('point and area text metadata round trips without changing rich content or stable links', () => {
  const html =
    '<p><strong>Headline</strong> <a data-doc-id="target">linked phrase</a><br><em>Second line</em></p>';
  const source = document('source-type', 'Source', html),
    target = document('target', 'Target');
  const block = source.blocks[0];
  block.textKind = 'point';
  block.textScale = { x: 1.23456789, y: 0.8754321 };
  const payload = archive(source, target),
    before = JSON.stringify(payload);
  const restored = validateImport(JSON.parse(before));
  const actual = restored.documents[0].blocks[0];
  assert.equal(JSON.stringify(payload), before);
  assert.equal(actual.textKind, 'point');
  assert.deepEqual(actual.textScale, block.textScale);
  assert.equal(actual.html, html);
  assert.equal(actual.id, block.id);
  assert.deepEqual(buildIndex(restored.documents).edges, [
    { source: source.id, target: target.id, count: 1 },
  ]);
  actual.textKind = 'area';
  const roundTrip = validateImport(JSON.parse(JSON.stringify(restored)));
  assert.equal(roundTrip.documents[0].blocks[0].textKind, 'area');
  assert.deepEqual(roundTrip.documents[0].blocks[0].textScale, block.textScale);
  assert.equal(roundTrip.documents[0].blocks[0].html, html);
});

test('legacy text and quotes default to area type and identity glyph scale', () => {
  const source = document('legacy-type', 'Legacy', '<p>Keep this paragraph.</p>');
  source.blocks.push(createBlock('quote', { id: 'legacy-quote', html: '<p>Keep this quote.</p>' }));
  for (const block of source.blocks) {
    delete block.textKind;
    delete block.textScale;
  }
  const restored = validateImport(archive(source));
  for (const block of restored.documents[0].blocks) {
    assert.equal(block.textKind, 'area');
    assert.deepEqual(block.textScale, { x: 1, y: 1 });
  }
  assert.equal(createBlock('text').textKind, 'area');
  assert.deepEqual(createBlock('quote').textScale, { x: 1, y: 1 });
  assert.equal(createBlock('image').textKind, undefined);
});

test('text kinds and glyph scales reject malformed or unbounded imported state', () => {
  for (const overrides of [
    { textKind: 'path' },
    { textKind: null },
    { textScale: null },
    { textScale: [1, 1] },
    ...[0, -0.1, 0.009, 100.01, Infinity, NaN, '1'].map((x) => ({ textScale: { x, y: 1 } })),
    ...[0, 101, Infinity, '1'].map((y) => ({ textScale: { x: 1, y } })),
  ]) {
    const source = document('bad-type', 'Invalid');
    Object.assign(source.blocks[0], overrides);
    assert.throws(() => validateImport(archive(source)), TypeError);
  }
  for (const scale of [0.01, 100]) {
    const source = document('edge-type', 'Boundary');
    source.blocks[0].textScale = { x: scale, y: scale };
    assert.deepEqual(validateImport(archive(source)).documents[0].blocks[0].textScale, {
      x: scale,
      y: scale,
    });
  }
});
