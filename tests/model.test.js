import test from 'node:test';
import assert from 'node:assert/strict';
import { uid, createDocument, createBlock, buildIndex, filterDocuments, localGraph, validateImport, exportMarkdown } from '../src/model.js';

const document = (id, title, html = '', extra = {}) => ({ ...createDocument(title), id, blocks: [createBlock('text', { id: `block-${id}`, html })], ...extra });
const archive = (...documents) => ({ schemaVersion: 1, documents, assets: [] });

// Each graph surface consumes the same directed edges, not its own link parser.
test('canonical IDs, case-insensitive aliases, heading links and duplicates resolve together', () => {
  const atlas = document('atlas', 'Atlas', '', { aliases: ['World book'], tags: ['Science/Optics', 'science/optics'] });
  const observer = document('observer', 'Observer', '<p><a data-doc-id="atlas">A view</a> [[WORLD BOOK#Intro|view]] [[Atlas]] [[Missing#Part]]</p>');
  const index = buildIndex([atlas, observer]);
  assert.deepEqual(index.edges, [{ source: 'observer', target: 'atlas', count: 3 }]);
  assert.deepEqual(index.backlinks.atlas, [{ source: 'observer', target: 'atlas', count: 3, title: 'Observer' }]);
  assert.deepEqual(index.unresolved, [{ source: 'observer', target: 'Missing#Part' }]);
  assert.equal(index.tagCounts['science/optics'], 1);
});

test('canonical ID links survive title renames and missing IDs do not fall back to titles', () => {
  const source = document('source', 'Source', '<a data-doc-id="target">Previous title</a><a data-doc-id="Missing">Missing</a>');
  const target = document('target', 'Renamed title');
  const other = document('other', 'Missing');
  const index = buildIndex([source, target, other]);
  assert.deepEqual(index.edges, [{ source: 'source', target: 'target', count: 1 }]);
  assert.deepEqual(index.unresolved, [{ source: 'source', target: 'Missing' }]);
  assert.equal(index.backlinks.other.length, 0);
});

test('ambiguous aliases remain unresolved; exact titles take precedence; self headings resolve', () => {
  const first = document('one', 'One', '[[Shared]] [[Two]] [[#Section]]', { aliases: ['Two', 'Shared'] });
  const second = document('two', 'Two', '', { aliases: ['Shared'] });
  const index = buildIndex([first, second]);
  assert.deepEqual(index.unresolved, [{ source: 'one', target: 'Shared' }]);
  assert.deepEqual(index.edges, [{ source: 'one', target: 'two', count: 1 }, { source: 'one', target: 'one', count: 1 }]);
});

test('anchor display text is not counted twice and code examples do not form edges', () => {
  const source = document('source', 'Source', '<a data-doc-id="target">[[Target]]</a><code>[[Target]]</code><pre>[[Target]]</pre>');
  assert.equal(buildIndex([source, document('target', 'Target')]).edges[0].count, 1);
});

test('tag hierarchy search is case-insensitive and respects slash boundaries', () => {
  const docs = [
    document('one', 'Optical notes', '<p>Light &amp; perception</p>', { tags: ['Science/Optics'], aliases: ['Seeing'] }),
    document('two', 'Other', '', { tags: ['sciencefiction'] }),
    document('three', 'Chemistry', '', { tags: ['Science'] })
  ];
  assert.deepEqual(filterDocuments(docs, '', '#SCIENCE').map(doc => doc.id), ['one', 'three']);
  assert.deepEqual(filterDocuments(docs, 'tag:Science "light & perception"').map(doc => doc.id), ['one']);
  assert.deepEqual(filterDocuments(docs, 'seeing tag:science/optics').map(doc => doc.id), ['one']);
  assert.deepEqual(filterDocuments(docs, 'light absent'), []);
});

test('local graph traverses both directions with bounded depth and retains isolated root', () => {
  const docs = [document('a', 'A', '[[B]]'), document('b', 'B', '[[C]]'), document('c', 'C'), document('d', 'D')];
  const index = buildIndex(docs);
  assert.deepEqual(localGraph(index, 'b', 0).nodes.map(node => node.id), ['b']);
  assert.deepEqual(localGraph(index, 'c', 1).nodes.map(node => node.id), ['b', 'c']);
  assert.deepEqual(localGraph(index, 'c', 2).nodes.map(node => node.id), ['a', 'b', 'c']);
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
  doc.blocks.push(createBlock('image', { id: 'image', src: 'asset:photo', x: 6, y: 1, w: 6, h: 8, fontSize: 24, textStyle: 'sans', align: 'center', crop: { x: 30, y: 65 }, objectPosition: '30% 65%' }));
  doc.blocks.push(createBlock('equation', { id: 'formula', extensions: { latex: 'E=mc^2', numbered: true } }));
  const payload = { ...archive(doc), assets: [{ id: 'photo', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', name: 'photo.png' }] };
  const before = JSON.stringify(payload);
  const normalized = validateImport(payload);
  assert.equal(JSON.stringify(payload), before);
  assert.equal(normalized.documents[0].id, 'atlas');
  assert.equal(normalized.documents[0].blocks[1].id, 'image');
  assert.deepEqual(normalized.documents[0].blocks[1].objectPosition, { x: 30, y: 65 });
  assert.deepEqual(normalized.documents[0].blocks[2].extensions, { latex: 'E=mc^2', numbered: true });
  assert.equal(normalized.assets[0].id, 'photo');
});

test('import rejects duplicate IDs including block/document collisions', () => {
  assert.throws(() => validateImport(archive(document('same', 'One'), document('same', 'Two'))), /duplicate ID/);
  const doc = document('same', 'One');
  doc.blocks[0].id = 'same';
  assert.throws(() => validateImport(archive(doc)), /duplicate ID/);
});

test('import rejects invalid shapes, layout overflow, nonfinite values and oversized counts', () => {
  assert.throws(() => validateImport({ schemaVersion: 2, documents: [] }), /schema version/);
  assert.throws(() => validateImport({ schemaVersion: 1, documents: new Array(5001).fill({}) }), /at most 5000/);
  assert.throws(() => validateImport(archive({ ...document('a', 'A'), blocks: new Array(1001).fill({}) })), /block limits/);
  for (const overrides of [{ x: NaN }, { h: Infinity }, { w: 13 }, { y: 37, h: 5 }, { crop: { x: 101, y: 0 } }, { fontSize: 121 }, { align: 'diagonal' }]) {
    const doc = document('a', 'A');
    Object.assign(doc.blocks[0], overrides);
    assert.throws(() => validateImport(archive(doc)), TypeError);
  }
  assert.throws(() => validateImport(archive({ ...document('a', 'A'), tags: 'science' })), /100 strings/);
});

test('import rejects dangerous URLs and active HTML, including entity-obfuscated schemes', () => {
  for (const src of ['javascript:alert(1)', 'data:text/html;base64,PGgxPg==', 'data:image/svg+xml;base64,PHN2Zz4=', 'file:///etc/passwd', 'blob:https://example.com/id', 'java\tscript:alert(1)']) {
    const doc = document('a', 'A');
    doc.blocks[0].src = src;
    assert.throws(() => validateImport(archive(doc)), TypeError, src);
  }
  for (const html of ['<a href="java&#115;cript:alert(1)">link</a>', '<a href="javascript&#58;alert(1)">link</a>', '<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<span style="background:url(javascript:alert(1))">a</span>']) {
    assert.throws(() => validateImport(archive(document('a', 'A', html))), TypeError, html);
  }
});

test('import requires asset references to exist and MIME metadata to agree', () => {
  const doc = document('a', 'A');
  for (const src of ['asset:missing', ' ASSET:missing ']) {
    doc.blocks[0].src = src;
    assert.throws(() => validateImport(archive(doc)), /missing asset/);
  }
  assert.throws(() => validateImport(archive(document('a', 'A', '<a href="asset:missing">file</a>'))), /missing asset/);
  assert.throws(() => validateImport({ ...archive(), assets: [{ id: 'photo', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'application/pdf' }] }), /does not match/);
  assert.throws(() => validateImport(JSON.parse('{"schemaVersion":1,"documents":[],"__proto__":{}}')), /unsafe key/);
});

test('Markdown export preserves reading order, metadata, emphasis, media and canonical links', () => {
  const target = document('target', 'A renamed note', '', { aliases: ['Original'] });
  const doc = document('source', 'Source', '', { tags: ['design'], aliases: ['Magazine'] });
  doc.blocks = [
    createBlock('image', { id: 'image', x: 6, y: 8, src: 'asset:photo', alt: 'An image', caption: 'A caption' }),
    createBlock('text', { id: 'text', y: 0, html: '<p><strong>First</strong> and <a data-doc-id="target">the note</a>. [[Original#Overview|Read more]]</p>' }),
    createBlock('quote', { id: 'quote', y: 5, html: '<p>A thought.</p>' })
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
