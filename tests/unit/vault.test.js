import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openVault } from '../../desktop/vault.mjs';
import { templateDocument } from '../helpers/documents.js';
import {
  createWorkspace,
  replaceTab,
  splitGroup,
  normalizeWorkspace,
} from '../../src/domain/workspace/state.js';
import { setLibraryInfo, libraryInfo } from '../../src/domain/documents/library.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import {
  setTextWrap,
  setIgnoreTextWrap,
  setTextWrapPreferences,
  setLayerIgnoreWrap,
} from '../../src/domain/documents/text-wrap.js';

async function fixture(t, options) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ivo-vault-test-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'Atlas');
  return { directory, vault: await openVault(directory, options) };
}
const image = {
  id: 'asset-test',
  name: 'dot.png',
  mimeType: 'image/png',
  data: 'data:image/png;base64,AQIDBA==',
};
const archive = (documents, assets = []) => ({ schemaVersion: 1, documents, assets });

test('file vault reopens documents, original asset bytes and local history', async (t) => {
  const { directory, vault } = await fixture(t);
  const doc = templateDocument('A durable thought', 'blank');
  await vault.saveImport(archive([doc], [image]));
  await vault.putMeta('history:' + doc.id, [doc]);
  const reopened = await openVault(directory);
  assert.deepEqual(await reopened.loadDocuments(), [doc]);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  assert.equal((await reopened.getMeta('initialized')).value, true);
  assert.deepEqual((await reopened.getMeta('history:' + doc.id)).value, [doc]);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'atlas.json')));
  assert.deepEqual(
    await fs.readFile(path.join(directory, manifest.assets[image.id].file)),
    Buffer.from([1, 2, 3, 4]),
  );
});

test('wrap9 canonical source and options survive fresh folder-engine reopen without changing manifest1 on read', async (t) => {
  const { directory, vault } = await fixture(t),
    manifestFile = path.join(directory, 'atlas.json'),
    originalManifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')),
    doc = createSceneDocument('Durable object wrapping'),
    source = '<p>Portable <em>canonical source</em>, with a leading space.</p>',
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      html: source,
      x: 40.125,
      y: 50.25,
      w: 300.5,
      h: 210.75,
    }),
    object = insertObject(doc, 'polygon', doc.pages[0].id, {
      x: 120.125,
      y: 90.25,
      w: 80.5,
      h: 100.75,
    });
  setTextWrap(doc, [object.id], {
    mode: 'bounds',
    side: 'right',
    offsets: { top: 4.5, right: 8.25, bottom: -1.125, left: 3.75 },
  });
  setIgnoreTextWrap(doc, [frame.id], true);
  setTextWrapPreferences(doc, { onlyBelow: true, facingPages: true, firstPageSide: 'left' });
  setLayerIgnoreWrap(doc, doc.publishing.layers[0].id, true);
  const originalSource = structuredClone(doc),
    expected = validateImport({ schemaVersion: 9, documents: [doc], assets: [] }).documents[0];
  await vault.saveDocument(doc);
  await vault.putMeta('history:' + doc.id, [doc]);
  assert.deepEqual(
    doc,
    originalSource,
    'Saving must not edit canonical source or geometry in place',
  );
  const committedManifestBytes = await fs.readFile(manifestFile, 'utf8'),
    committedManifest = JSON.parse(committedManifestBytes),
    objectFile = path.join(directory, committedManifest.documents[doc.id].file),
    committedObjectBytes = await fs.readFile(objectFile),
    reopened = await openVault(directory),
    loaded = (await reopened.loadDocuments())[0];
  assert.equal(originalManifest.schemaVersion, 1);
  assert.equal(committedManifest.schemaVersion, 1);
  assert.equal(committedManifest.format, 'ivo-folder');
  assert.deepEqual(loaded, expected);
  assert.equal(loaded.canvasVersion, 8);
  assert.equal(loaded.blocks.find((block) => block.id === frame.id).ignoreTextWrap, true);
  assert.deepEqual(loaded.blocks.find((block) => block.id === object.id).textWrap, object.textWrap);
  assert.deepEqual(loaded.textWrapPreferences, doc.textWrapPreferences);
  assert.equal(loaded.publishing.layers[0].ignoreWrap, true);
  assert.equal(loaded.textFlows[0].html, source);
  assert.deepEqual(loaded.textFlows[0].frameIds, [frame.id]);
  assert.deepEqual((await reopened.getMeta('history:' + doc.id)).value, [expected]);
  assert.equal(
    await fs.readFile(manifestFile, 'utf8'),
    committedManifestBytes,
    'Fresh open must not rewrite manifest1',
  );
  assert.deepEqual(
    await fs.readFile(objectFile),
    committedObjectBytes,
    'Fresh open must not normalize immutable source bytes on disk',
  );
  const invalid = structuredClone(loaded);
  invalid.blocks.find((block) => block.id === object.id).textWrap = {
    ...object.textWrap,
    mode: 'contour',
    contour: { source: 'unknown' },
  };
  await assert.rejects(reopened.saveDocument(invalid), /contour source/);
  assert.equal(
    await fs.readFile(manifestFile, 'utf8'),
    committedManifestBytes,
    'Unsupported contour combinations must reject before commit',
  );
  assert.deepEqual(await reopened.loadDocuments(), [expected]);
});

test('interrupted import leaves the entire previous manifest readable and permits retry', async (t) => {
  let fail = false;
  const { directory, vault } = await fixture(t, {
    beforeCommit: () => {
      if (fail) throw new Error('simulated disk failure');
    },
  });
  const first = templateDocument('Before', 'blank');
  await vault.saveImport(archive([first]));
  const manifestBefore = await fs.readFile(path.join(directory, 'atlas.json'), 'utf8');
  const replacement = { ...first, title: 'After' };
  const addition = templateDocument('Added together', 'blank');
  fail = true;
  await assert.rejects(vault.saveImport(archive([replacement, addition], [image])), /disk failure/);
  assert.equal(await fs.readFile(path.join(directory, 'atlas.json'), 'utf8'), manifestBefore);
  const reopened = await openVault(directory);
  assert.deepEqual(await reopened.loadDocuments(), [first]);
  assert.deepEqual(await reopened.loadAssets(), []);
  fail = false;
  await vault.saveImport(archive([replacement, addition], [image]));
  assert.equal((await vault.loadDocuments()).length, 2);
});

test('concurrent saves are serialized and do not lose other documents', async (t) => {
  const { directory, vault } = await fixture(t);
  const a = templateDocument('A', 'blank'),
    b = templateDocument('B', 'blank');
  await Promise.all([
    vault.saveDocument(a),
    vault.saveDocument(b),
    vault.saveDocument({ ...a, title: 'Latest A', version: 3 }),
  ]);
  assert.deepEqual(
    (await (await openVault(directory)).loadDocuments()).map((doc) => doc.title),
    ['Latest A', 'B'],
  );
  assert.equal((await vault.loadDocuments())[0].version, 3);
});

test('import merges existing asset references and rejects ID collisions without changing disk', async (t) => {
  const { directory, vault } = await fixture(t);
  const doc = templateDocument('With image', 'blank');
  await vault.saveAsset(image);
  doc.blocks.push({
    id: 'block-image',
    type: 'image',
    x: 0,
    y: 0,
    w: 4,
    h: 4,
    src: 'asset:' + image.id,
  });
  await vault.saveDocument(doc);
  const before = await fs.readFile(path.join(directory, 'atlas.json'), 'utf8');
  const bad = { ...templateDocument('Bad', 'blank'), id: image.id };
  await assert.rejects(vault.saveDocument(bad), /duplicate ID/);
  assert.equal(await fs.readFile(path.join(directory, 'atlas.json'), 'utf8'), before);
});

test('changed document bytes and forged paths fail closed without reseeding', async (t) => {
  const { directory, vault } = await fixture(t);
  const doc = templateDocument('Keep me', 'blank');
  await vault.saveImport(archive([doc]));
  const file = path.join(directory, 'atlas.json');
  const manifest = JSON.parse(await fs.readFile(file));
  const revision = path.join(directory, manifest.documents[doc.id].file);
  const original = await fs.readFile(revision);
  await fs.writeFile(revision, 'changed');
  await assert.rejects(openVault(directory), /changed or is damaged/);
  await fs.writeFile(revision, original);
  manifest.documents[doc.id].file = '../../outside.json';
  await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(openVault(directory), /Invalid document reference/);
});

test('refuses unrelated nonempty folders and symbolic asset folders', async (t) => {
  const { directory } = await fixture(t);
  const unrelated = path.join(path.dirname(directory), 'Other');
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, 'keep.txt'), 'unrelated material');
  await assert.rejects(openVault(unrelated), /not an Ivo atlas/);
  assert.equal(await fs.readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'unrelated material');
  await fs.rm(path.join(directory, 'assets'), { recursive: true, force: true });
  await fs.writeFile(
    path.join(directory, 'atlas.json'),
    JSON.stringify({ format: 'ivo-folder', schemaVersion: 1, documents: {}, assets: {}, meta: {} }),
  );
  await fs.symlink(os.tmpdir(), path.join(directory, 'assets'));
  await assert.rejects(openVault(directory), /symbolic links/);
});

test('metadata cannot write arbitrary files or mismatched history', async (t) => {
  const { vault } = await fixture(t);
  await assert.rejects(vault.putMeta('../../outside', true), /Unknown atlas metadata/);
  const doc = templateDocument('A', 'blank');
  await assert.rejects(vault.putMeta('history:another-id', [doc]), /another document/);
});

test('a stale open store cannot silently overwrite a newer manifest', async (t) => {
  const { directory, vault } = await fixture(t);
  const original = templateDocument('Original', 'blank');
  await vault.saveImport(archive([original]));
  const stale = await openVault(directory);
  await vault.saveDocument({ ...original, title: 'Newer commit', version: 2 });
  await assert.rejects(
    stale.saveDocument({ ...original, title: 'Stale edit', version: 2 }),
    /changed outside this window/,
  );
  assert.equal((await (await openVault(directory)).loadDocuments())[0].title, 'Newer commit');
});

test('accepted writes and returned reads do not retain mutable caller objects', async (t) => {
  const { vault } = await fixture(t);
  const document = templateDocument('Accepted value', 'blank');
  const saving = vault.saveDocument(document);
  document.title = 'Later mutation';
  await saving;
  const loaded = await vault.loadDocuments();
  assert.equal(loaded[0].title, 'Accepted value');
  loaded[0].title = 'Read mutation';
  assert.equal((await vault.loadDocuments())[0].title, 'Accepted value');
});

test('damaged history metadata is rejected when reopening, without replacing the manifest', async (t) => {
  const { directory, vault } = await fixture(t);
  const document = templateDocument('Keep me', 'blank');
  await vault.saveImport(archive([document]));
  const file = path.join(directory, 'atlas.json'),
    manifest = JSON.parse(await fs.readFile(file));
  manifest.meta['history:' + document.id] = [{ id: document.id, title: 'Malformed revision' }];
  const bytes = JSON.stringify(manifest);
  await fs.writeFile(file, bytes);
  await assert.rejects(openVault(directory), /Invalid Ivo archive/);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
});

test('page-scene revisions and legacy history reopen together without changing original assets', async (t) => {
  const { upgradeDocument, insertObject, addPage } =
    await import('../../src/domain/documents/scene.js');
  const { directory, vault } = await fixture(t),
    old = templateDocument('Legacy to pages', 'blank');
  await vault.saveImport(archive([old], [image]));
  await vault.putMeta('history:' + old.id, [old]);
  const scene = upgradeDocument(old);
  const second = addPage(scene, scene.pages[0].id);
  second.width = 800;
  second.height = 500;
  const mask = insertObject(scene, 'polygon', second.id, { x: 72.125, y: 90.375 });
  insertObject(scene, 'image', second.id, { parentId: mask.id, src: 'asset:' + image.id });
  await vault.saveDocument(scene);
  const reopened = await openVault(directory),
    loaded = (await reopened.loadDocuments())[0];
  assert.deepEqual(loaded.pages, scene.pages);
  assert.equal(loaded.blocks.at(-1).parentId, mask.id);
  assert.deepEqual((await reopened.getMeta('history:' + old.id)).value, [old]);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  const before = await fs.readFile(path.join(directory, 'atlas.json'), 'utf8');
  loaded.blocks.at(-1).parentId = 'missing';
  await assert.rejects(reopened.saveDocument(loaded), /clipping parent/);
  assert.equal(await fs.readFile(path.join(directory, 'atlas.json'), 'utf8'), before);
});

test('primary and satellite workspace metadata reopen independently without writing document or asset files', async (t) => {
  const { directory, vault } = await fixture(t),
    a = templateDocument('Primary source stays here', 'blank'),
    b = templateDocument('Another note', 'blank');
  await vault.saveImport(archive([a, b], [image]));
  await vault.putMeta('history:' + a.id, [a]);
  const primary = createWorkspace();
  replaceTab(primary, 'document', a.id, true);
  primary.tabs[0].canvasState = { camera: { x: 12.25, y: -30.75, zoom: 1.125 }, tool: 'text' };
  primary.tabs[0].textView = { html: 'PRIVATE SOURCE MUST NOT ENTER VIEW METADATA' };
  const satellite = createWorkspace();
  replaceTab(satellite, 'document', b.id, false);
  splitGroup(satellite, 'row');
  replaceTab(satellite, 'graph', a.id);
  satellite.tabs.find((tab) => tab.id === satellite.active).graphState = {
    center: { x: 81.25, y: -33.5 },
    scale: 1.6,
  };
  const manifestFile = path.join(directory, 'atlas.json'),
    before = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  await Promise.all([
    vault.putMeta('workspace:1', primary),
    vault.putMeta('workspace-window:review-window', satellite),
    vault.putMeta('workspace-windows:1', [
      { id: 'review-window', bounds: { x: -500, y: 42, width: 900, height: 640 }, open: true },
    ]),
  ]);
  const reopened = await openVault(directory),
    primarySaved = (await reopened.getMeta('workspace:1')).value,
    satelliteSaved = (await reopened.getMeta('workspace-window:review-window')).value;
  assert.deepEqual(primarySaved, normalizeWorkspace(primary, [a, b]));
  assert.deepEqual(satelliteSaved, normalizeWorkspace(satellite, [a, b]));
  assert.notEqual(primarySaved.active, satelliteSaved.active);
  assert.equal(satelliteSaved.groups.length, 2);
  assert.equal(JSON.stringify(primarySaved).includes('PRIVATE SOURCE'), false);
  assert.deepEqual((await reopened.getMeta('workspace-windows:1')).value, [
    { id: 'review-window', bounds: { x: -500, y: 42, width: 900, height: 640 }, open: true },
  ]);
  primarySaved.tabs[0].docId = b.id;
  assert.equal((await reopened.getMeta('workspace:1')).value.tabs[0].docId, a.id);
  const after = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  assert.equal(after.schemaVersion, 1);
  assert.deepEqual(after.documents, before.documents);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(await reopened.loadDocuments(), [a, b]);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  assert.deepEqual((await reopened.getMeta('history:' + a.id)).value, [a]);
  for (const entry of Object.values(after.documents))
    assert.match(entry.file, /^documents\/[A-Za-z0-9_-]+-[a-f0-9]{64}\.json$/);
  for (const entry of Object.values(after.assets))
    assert.match(entry.file, /^assets\/[a-f0-9]{64}\.bin$/);
  const bytes = await fs.readFile(manifestFile, 'utf8');
  for (const key of [
    'workspace-window:../escape',
    'workspace-window:/tmp/escape',
    'workspace-window:atlas.json',
    'workspace-window:' + 'x'.repeat(121),
  ])
    await assert.rejects(reopened.putMeta(key, primary), /Unknown atlas metadata/);
  await assert.rejects(
    reopened.putMeta('workspace-window:review-window', {
      ...satellite,
      source: 'x'.repeat(250001),
    }),
    /too large/,
  );
  assert.equal(await fs.readFile(manifestFile, 'utf8'), bytes);
});

test('native window descriptors and logical folder metadata are bounded before manifest commit', async (t) => {
  const { directory, vault } = await fixture(t),
    doc = templateDocument('Descriptor validation', 'blank');
  await vault.saveImport(archive([doc], [image]));
  const descriptors = [
    {
      id: 'first',
      bounds: { x: Infinity, y: -1e12, width: -1, height: 1e12 },
      open: 'yes',
      source: doc,
    },
    { id: 'first', bounds: { width: 640, height: 480 }, open: true },
    { id: '../../outside', bounds: { width: 640, height: 480 }, open: true },
    null,
    { id: 'second', bounds: { x: 22.8, y: 12.2, width: 999.5, height: 600.25 }, open: true },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: 'extra-' + index,
      bounds: { width: 800, height: 600 },
      open: true,
    })),
  ];
  await vault.putMeta('workspace-windows:1', descriptors);
  await vault.putMeta('library:1', {
    version: 1,
    folders: [
      'Collections/Autumn',
      'Collections/Autumn',
      '../outside',
      '/absolute',
      'C:\\outside',
      '  Collections / Spring  ',
      '',
      null,
    ],
    documents: [doc],
  });
  const reopened = await openVault(directory),
    windows = (await reopened.getMeta('workspace-windows:1')).value,
    folders = (await reopened.getMeta('library:1')).value;
  assert.ok(windows.length <= 8);
  assert.equal(new Set(windows.map((item) => item.id)).size, windows.length);
  assert.equal(
    windows.some((item) => item.id.includes('/')),
    false,
  );
  assert.deepEqual(windows[0], {
    id: 'first',
    bounds: { y: -100000, width: 400, height: 12000 },
    open: false,
  });
  assert.deepEqual(
    windows.find((item) => item.id === 'second'),
    { id: 'second', bounds: { x: 23, y: 12, width: 1000, height: 600 }, open: true },
  );
  assert.equal(JSON.stringify(windows).includes(doc.title), false);
  assert.deepEqual(folders, {
    version: 1,
    folders: ['Collections', 'Collections/Autumn', 'Collections/Spring'],
  });
  assert.deepEqual(await reopened.loadDocuments(), [doc]);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  const file = path.join(directory, 'atlas.json'),
    before = await fs.readFile(file, 'utf8');
  await assert.rejects(
    reopened.putMeta('workspace-windows:1', { windows: descriptors }),
    /Invalid workspace window list/,
  );
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await reopened.putMeta('library:1', {
    version: 1,
    folders: Array.from({ length: 700 }, (_, index) => 'Collection-' + index + '/Season'),
  });
  const bounded = (await reopened.getMeta('library:1')).value;
  assert.ok(bounded.folders.length <= 500);
  assert.equal(new Set(bounded.folders).size, bounded.folders.length);
  assert.deepEqual(await reopened.loadDocuments(), [doc]);
});

test('reopening normalizes external view metadata in memory without rewriting disk or weakening damaged-metadata rejection', async (t) => {
  const { directory, vault } = await fixture(t),
    doc = templateDocument('External metadata keeps its note', 'blank');
  await vault.saveImport(archive([doc], [image]));
  const file = path.join(directory, 'atlas.json'),
    raw = JSON.parse(await fs.readFile(file, 'utf8')),
    flat = {
      version: 1,
      tabs: [
        {
          id: 'legacy-tab',
          kind: 'document',
          docId: doc.id,
          editing: true,
          canvasState: { camera: { x: 12.25, y: -8.5, zoom: 1.4 }, tool: 'text' },
          textView: { html: 'SOURCE MUST NOT PERSIST IN WORKSPACE' },
          navigation: {
            back: [{ kind: 'document', docId: 'missing-note', editing: false }],
            forward: [],
          },
        },
      ],
      active: 'legacy-tab',
      groups: [{ id: 'missing-group', tabIds: ['missing-tab'], active: 'missing-tab' }],
      layout: { type: 'group', id: 'missing-group' },
    };
  raw.meta['workspace:1'] = flat;
  raw.meta['workspace-window:side-window'] = {
    version: 1,
    tabs: [
      {
        id: 'side-tab',
        kind: 'graph',
        docId: doc.id,
        editing: false,
        graphState: { center: { x: 9.5, y: -20 }, scale: 1.25 },
      },
    ],
    active: 'side-tab',
    source: 'SOURCE MUST NOT PERSIST IN WORKSPACE',
  };
  raw.meta['workspace-windows:1'] = [
    {
      id: 'side-window',
      bounds: { x: 8.2, y: 5.8, width: 1000, height: 700 },
      open: true,
      path: '../../outside',
    },
    { id: '../../outside', bounds: { width: 800, height: 600 }, open: true },
    { id: 'side-window', bounds: { width: 400, height: 300 }, open: false },
  ];
  raw.meta['library:1'] = {
    version: 1,
    folders: ['Lookbooks/Autumn', '../outside', '/absolute', 'Lookbooks/Autumn'],
    source: 'SOURCE MUST NOT PERSIST IN WORKSPACE',
  };
  const bytes = JSON.stringify(raw, null, 1) + '\n';
  await fs.writeFile(file, bytes);
  const reopened = await openVault(directory),
    primary = (await reopened.getMeta('workspace:1')).value,
    side = (await reopened.getMeta('workspace-window:side-window')).value;
  assert.equal(primary.groups.length, 1);
  assert.deepEqual(primary.groups[0].tabIds, ['legacy-tab']);
  assert.equal(primary.groups[0].active, 'legacy-tab');
  assert.deepEqual(primary.layout, { type: 'group', id: primary.groups[0].id });
  assert.equal(primary.tabs[0].navigation, undefined);
  assert.deepEqual(primary.tabs[0].canvasState, flat.tabs[0].canvasState);
  assert.equal(JSON.stringify(primary).includes('SOURCE MUST NOT PERSIST'), false);
  assert.equal(side.groups.length, 1);
  assert.equal(side.tabs[0].kind, 'graph');
  assert.deepEqual(side.tabs[0].graphState, { center: { x: 9.5, y: -20 }, scale: 1.25 });
  assert.equal(Object.hasOwn(side, 'source'), false);
  assert.deepEqual((await reopened.getMeta('workspace-windows:1')).value, [
    { id: 'side-window', bounds: { x: 8, y: 6, width: 1000, height: 700 }, open: true },
  ]);
  assert.deepEqual((await reopened.getMeta('library:1')).value, {
    version: 1,
    folders: ['Lookbooks', 'Lookbooks/Autumn'],
  });
  assert.deepEqual(await reopened.loadDocuments(), [doc]);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  // A subsequent ordinary write uses the original manifest hash guard and commits normalized metadata.
  await reopened.putMeta('workspace:1', primary);
  const committed = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(committed.documents, raw.documents);
  assert.deepEqual(committed.assets, raw.assets);
  assert.deepEqual(committed.meta['workspace:1'], primary);
  assert.equal(JSON.stringify(committed.meta).includes('SOURCE MUST NOT PERSIST'), false);
  assert.deepEqual(committed.meta['workspace-windows:1'], [
    { id: 'side-window', bounds: { x: 8, y: 6, width: 1000, height: 700 }, open: true },
  ]);
  for (const [mutate, expected] of [
    [(manifest) => (manifest.meta['workspace-window:../outside'] = flat), /Unknown atlas metadata/],
    [
      (manifest) => (manifest.meta['workspace-windows:1'] = { windows: [] }),
      /Invalid workspace window list/,
    ],
    [
      (manifest) =>
        (manifest.meta['history:' + doc.id] = [{ id: doc.id, title: 'Damaged revision' }]),
      /Invalid Ivo archive/,
    ],
  ]) {
    const damaged = structuredClone(raw);
    mutate(damaged);
    const damagedBytes = JSON.stringify(damaged);
    await fs.writeFile(file, damagedBytes);
    await assert.rejects(openVault(directory), expected);
    assert.equal(await fs.readFile(file, 'utf8'), damagedBytes);
  }
});

test('logical move, bookmark and recoverable trash survive portable archives while original history and media remain intact', async (t) => {
  const { createSceneDocument, insertObject } = await import('../../src/domain/documents/scene.js'),
    { startTextFlow } = await import('../../src/domain/documents/text-flows.js');
  const { directory, vault } = await fixture(t),
    doc = createSceneDocument('Archive collection item'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 48.25,
      y: 51.125,
      w: 400,
      h: 500,
      html: '<p>Canonical <strong>fashion source</strong> survives library changes.</p>',
    });
  startTextFlow(doc, frame.id);
  insertObject(doc, 'image', doc.pages[0].id, {
    x: 52.5,
    y: 200,
    w: 100,
    h: 80,
    src: 'asset:' + image.id,
  });
  doc.extensions = { 'another.vendor': { unchanged: ['original', 12] } };
  const original = structuredClone(doc);
  await vault.saveImport({ schemaVersion: 5, documents: [doc], assets: [image] });
  await vault.putMeta('history:' + doc.id, [original]);
  const before = JSON.parse(await fs.readFile(path.join(directory, 'atlas.json'), 'utf8')),
    originalRevision = await fs.readFile(path.join(directory, before.documents[doc.id].file));
  setLibraryInfo(doc, {
    folder: 'Collections/Autumn',
    bookmarked: true,
    trashedAt: '2026-11-15T18:45:12.000Z',
  });
  doc.version++;
  await vault.saveDocument(doc);
  await vault.putMeta('library:1', {
    version: 1,
    folders: ['Collections/Autumn', 'Empty collection'],
  });
  const reopened = await openVault(directory),
    loaded = (await reopened.loadDocuments())[0];
  assert.deepEqual(libraryInfo(loaded), {
    folder: 'Collections/Autumn',
    bookmarked: true,
    trashedAt: '2026-11-15T18:45:12.000Z',
  });
  assert.deepEqual(loaded.textFlows, original.textFlows);
  assert.deepEqual(loaded.blocks, original.blocks);
  assert.deepEqual(loaded.extensions['another.vendor'], original.extensions['another.vendor']);
  assert.equal(loaded.canvasVersion, 4);
  assert.deepEqual((await reopened.getMeta('history:' + doc.id)).value, [original]);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  assert.deepEqual(
    await fs.readFile(path.join(directory, before.documents[doc.id].file)),
    originalRevision,
  );
  const payload = validateImport({
      schemaVersion: 5,
      documents: [loaded],
      assets: await reopened.loadAssets(),
    }),
    portableDirectory = path.join(path.dirname(directory), 'Portable copy'),
    portable = await openVault(portableDirectory);
  await portable.saveImport(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(await portable.loadDocuments(), [loaded]);
  assert.deepEqual(await portable.loadAssets(), [image]);
  assert.equal(await portable.getMeta('history:' + doc.id), undefined);
  assert.equal(await portable.getMeta('workspace:1'), undefined);
  assert.deepEqual((await reopened.getMeta('library:1')).value, {
    version: 1,
    folders: ['Collections', 'Collections/Autumn', 'Empty collection'],
  });
  setLibraryInfo(loaded, { trashedAt: null });
  loaded.version++;
  await reopened.saveDocument(loaded);
  const restored = (await (await openVault(directory)).loadDocuments())[0];
  assert.deepEqual(libraryInfo(restored), {
    folder: 'Collections/Autumn',
    bookmarked: true,
    trashedAt: null,
  });
  assert.deepEqual(restored.textFlows, original.textFlows);
  assert.deepEqual(await reopened.loadAssets(), [image]);
  assert.deepEqual((await reopened.getMeta('history:' + doc.id)).value, [original]);
  const safe = await fs.readFile(path.join(directory, 'atlas.json'), 'utf8');
  assert.throws(() => setLibraryInfo(restored, { folder: '../../outside' }), /relative segments/);
  assert.equal(await fs.readFile(path.join(directory, 'atlas.json'), 'utf8'), safe);
});
