import {
  createWorkspace,
  replaceTab,
  pinTab,
  splitGroup,
  setSplitRatio,
  normalizeWorkspace,
} from '../../src/domain/workspace/state.js';
import { setLibraryInfo, libraryInfo } from '../../src/domain/documents/library.js';
import { startTextFlow, appendTextFlowPage } from '../../src/domain/documents/text-flows.js';
import { markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import { createSceneDocument, addPage, insertObject } from '../../src/domain/documents/scene.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createFileVault, encodeBytes, decodeBytes } from '../../src/storage/file-vault.js';
import { openVault } from '../../desktop/vault.mjs';
import { templateDocument } from '../helpers/documents.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
test(
  'iOS Foundation byte adapter interoperates with the desktop vault and rejects stale/path writes',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ivo-native-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const executable = path.join(directory, 'atlas-harness');
    const compile = spawnSync(
      'xcrun',
      [
        'swiftc',
        '-module-cache-path',
        path.join(directory, 'ModuleCache'),
        path.join(project, 'ios/App/App/AtlasFiles.swift'),
        path.join(project, 'tests/native/AtlasFilesHarness.swift'),
        '-o',
        executable,
      ],
      { encoding: 'utf8', timeout: 120000 },
    );
    assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
    const folder = path.join(directory, 'Atlas');
    const desktop = await openVault(folder);
    const document = templateDocument('From Mac', 'blank');
    const asset = {
      id: 'native-image',
      name: 'bytes.png',
      mimeType: 'image/png',
      data: 'data:image/png;base64,AQIDBA==',
    };
    const scene = createSceneDocument('Native pages');
    const second = addPage(scene, scene.pages[0].id);
    second.width = 800.25;
    second.height = 500;
    const mask = insertObject(scene, 'polygon', second.id, { x: 12.125, y: 15.375 });
    insertObject(scene, 'image', second.id, { parentId: mask.id, src: 'asset:' + asset.id });
    insertObject(scene, 'text', second.id, {
      x: 100,
      y: 120,
      w: 230,
      h: 140,
      fontSize: 20,
      leading: 24,
      tracking: 12.5,
      textColor: '#334455',
      html: '<p>Native <span data-ivo-size="26.25" style="font-size:26.25px">typography</span></p>',
    });
    markTypographyVersion(scene);
    const flow = insertObject(scene, 'text', scene.pages[0].id, {
      x: 50,
      y: 50,
      w: 420,
      h: 500,
      html: '<p>Native canonical textFlow survives all byte adapters.</p>',
    });
    appendTextFlowPage(scene, startTextFlow(scene, flow.id));
    await desktop.saveImport({ schemaVersion: 5, documents: [document, scene], assets: [asset] });
    const originalManifest = JSON.parse(await fs.readFile(path.join(folder, 'atlas.json'), 'utf8'));
    const originalSceneRevision = await fs.readFile(
      path.join(folder, originalManifest.documents[scene.id].file),
    );
    const child = spawn(executable, [folder], { stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => {
      child.stdin.end();
      child.kill();
    });
    const responses = [],
      waiting = [];
    let stderr = '';
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const answer = JSON.parse(line);
      const resolve = waiting.shift();
      if (resolve) resolve(answer);
      else responses.push(answer);
    });
    const call = async (request) => {
      child.stdin.write(JSON.stringify(request) + '\n');
      const result = responses.length
        ? responses.shift()
        : await new Promise((resolve) => waiting.push(resolve));
      if (result.error) throw new Error(result.error);
      return result;
    };
    const openMobile = () =>
      createFileVault({
        directory: folder,
        hash: async (bytes) => (await call({ method: 'hash', data: encodeBytes(bytes) })).sha256,
        initialize: () => call({ method: 'initialize' }),
        read: async (relative) => {
          const { data } = await call({ method: 'read', path: relative });
          return data === null ? null : decodeBytes(data);
        },
        writeAtomic: (relative, bytes, guard = {}) =>
          call({
            method: 'write',
            path: relative,
            data: encodeBytes(bytes),
            expectedHash: guard.expectedHash ?? null,
          }),
      });
    const mobile = await openMobile();
    assert.deepEqual(await mobile.loadDocuments(), [document, scene]);
    assert.deepEqual(await mobile.loadAssets(), [asset]);
    await mobile.saveDocument({ ...document, title: 'From iPhone', version: 2 });
    await mobile.putMeta('history:' + document.id, [document]);
    await mobile.putMeta('history:' + scene.id, [scene]);
    const workspace = createWorkspace();
    replaceTab(workspace, 'document', scene.id, true);
    pinTab(workspace, workspace.active);
    splitGroup(workspace, 'row');
    replaceTab(workspace, 'document', document.id);
    workspace.tabs.find((tab) => tab.id === workspace.active).graphState = {
      center: { x: 12.25, y: -7.5 },
      scale: 1.4,
    };
    splitGroup(workspace, 'column');
    setSplitRatio(workspace, workspace.layout.id, 0.63);
    await mobile.putMeta('workspace:1', workspace);
    const satellite = createWorkspace();
    replaceTab(satellite, 'document', scene.id, false);
    satellite.tabs[0].canvasState = { camera: { x: -87.25, y: 51.5, zoom: 1.235 }, tool: 'select' };
    satellite.tabs[0].textView = { html: 'PRIVATE SOURCE IS NOT WINDOW METADATA' };
    const windows = [
      { id: 'fitting-review', bounds: { x: -350, y: 80, width: 1000, height: 700 }, open: true },
      { id: 'archived-review', bounds: { width: 800, height: 600 }, open: false },
      { id: '../outside', bounds: { width: 800, height: 600 }, open: true },
    ];
    await mobile.putMeta('workspace-window:fitting-review', satellite);
    await mobile.putMeta('workspace-windows:1', windows);
    await mobile.putMeta('library:1', {
      version: 1,
      folders: ['Collections/Native', 'Research', '../outside', 'Collections/Native'],
    });
    const organized = structuredClone(scene);
    setLibraryInfo(organized, {
      folder: 'Collections/Native',
      bookmarked: true,
      trashedAt: '2026-11-15T19:21:00.000Z',
    });
    organized.version++;
    await mobile.saveDocument(organized);
    const reopened = await openVault(folder);
    assert.equal((await reopened.loadDocuments())[0].title, 'From iPhone');
    assert.deepEqual((await reopened.loadDocuments())[1], organized);
    assert.deepEqual(organized.textFlows, scene.textFlows);
    assert.deepEqual(organized.blocks, scene.blocks);
    assert.equal(organized.canvasVersion, 4);
    assert.deepEqual(libraryInfo((await reopened.loadDocuments())[1]), {
      folder: 'Collections/Native',
      bookmarked: true,
      trashedAt: '2026-11-15T19:21:00.000Z',
    });
    assert.deepEqual(await reopened.loadAssets(), [asset]);
    assert.deepEqual((await reopened.getMeta('history:' + document.id)).value, [document]);
    assert.deepEqual((await reopened.getMeta('history:' + scene.id)).value, [scene]);
    assert.deepEqual((await reopened.getMeta('workspace:1')).value, workspace);
    assert.deepEqual(
      (await reopened.getMeta('workspace-window:fitting-review')).value,
      normalizeWorkspace(satellite, [document, organized]),
    );
    assert.equal(
      JSON.stringify((await reopened.getMeta('workspace-window:fitting-review')).value).includes(
        'PRIVATE SOURCE',
      ),
      false,
    );
    assert.deepEqual((await reopened.getMeta('workspace-windows:1')).value, windows.slice(0, 2));
    assert.deepEqual((await reopened.getMeta('library:1')).value, {
      version: 1,
      folders: ['Collections', 'Collections/Native', 'Research'],
    });
    assert.deepEqual(
      await fs.readFile(path.join(folder, originalManifest.documents[scene.id].file)),
      originalSceneRevision,
    );
    assert.deepEqual(
      await fs.readFile(path.join(folder, originalManifest.assets[asset.id].file)),
      Buffer.from([1, 2, 3, 4]),
    );
    const nativeManifest = JSON.parse(await fs.readFile(path.join(folder, 'atlas.json'), 'utf8'));
    assert.equal(nativeManifest.schemaVersion, 1);
    for (const entry of Object.values(nativeManifest.documents))
      assert.match(entry.file, /^documents\/[A-Za-z0-9_-]+-[a-f0-9]{64}\.json$/);
    const beforeBadMeta = await fs.readFile(path.join(folder, 'atlas.json'), 'utf8');
    await assert.rejects(
      reopened.putMeta('workspace-window:../../outside', satellite),
      /Unknown atlas metadata/,
    );
    await assert.rejects(
      reopened.putMeta('workspace-window:fitting-review', {
        ...satellite,
        source: 'x'.repeat(250001),
      }),
      /too large/,
    );
    assert.equal(await fs.readFile(path.join(folder, 'atlas.json'), 'utf8'), beforeBadMeta);
    await mobile.changeLibrary({ type: 'rename-folder', path: 'Collections', name: 'Archive' });
    const libraryReopened = await openVault(folder),
      libraryDocuments = await libraryReopened.loadDocuments(),
      libraryScene = libraryDocuments.find((doc) => doc.id === scene.id);
    assert.equal(libraryInfo(libraryScene).folder, 'Archive/Native');
    assert.equal(libraryInfo(libraryScene).trashedAt, libraryInfo(organized).trashedAt);
    assert.deepEqual(libraryScene.textFlows, scene.textFlows);
    assert.deepEqual(libraryScene.blocks, scene.blocks);
    assert.deepEqual((await libraryReopened.getMeta('history:' + scene.id)).value, [scene]);
    assert.deepEqual(await libraryReopened.loadAssets(), [asset]);
    await assert.rejects(
      desktop.saveDocument({ ...document, title: 'Stale Mac' }),
      /changed outside/,
    );
    await assert.rejects(
      reopened.saveDocument({ ...document, title: 'Stale pre-folder-change Mac' }),
      /changed outside/,
    );
    await libraryReopened.saveDocument({ ...document, title: 'New Mac commit', version: 3 });
    await assert.rejects(
      mobile.saveDocument({ ...document, title: 'Stale phone' }),
      /changed outside/,
    );
    for (const relative of [
      '../escape',
      '/tmp/escape',
      'assets/../atlas.json',
      'documents/not-a-hash.json',
      'atlas.json\n',
    ]) {
      await assert.rejects(
        call({ method: 'write', path: relative, data: 'AA==' }),
        /Invalid atlas object path/,
      );
    }
    const link = path.join(folder, 'assets');
    const backup = path.join(folder, 'assets-original');
    await fs.rename(link, backup);
    await fs.symlink(os.tmpdir(), link);
    await assert.rejects(
      call({ method: 'read', path: 'assets/' + 'a'.repeat(64) + '.bin' }),
      /symbolic links/,
    );
    await fs.unlink(link);
    await fs.rename(backup, link);
    const manifest = await fs.readFile(path.join(folder, 'atlas.json'), 'utf8');
    await assert.rejects(
      call({ method: 'write', path: 'atlas.json', data: 'AA==', expectedHash: '0'.repeat(64) }),
      /changed outside/,
    );
    assert.equal(await fs.readFile(path.join(folder, 'atlas.json'), 'utf8'), manifest);
    const card = createSceneDocument('Supply card'),
      table = insertObject(card, 'table', card.pages[0].id);
    table.table.headerRows = 1;
    table.table.cells[0][0] = 'Fibre';
    table.table.cells[1][0] = 'Шёлк\n丝';
    table.table.merges.push({ row: 1, column: 0, rows: 1, columns: 2 });
    await libraryReopened.saveDocument(card);
    const phone = await openMobile(),
      onPhone = (await phone.loadDocuments()).find((d) => d.id === card.id);
    assert.deepEqual(onPhone.blocks[0].table, table.table);
    onPhone.blocks[0].table.cells[2][1] = 'Lino';
    onPhone.version++;
    await phone.saveDocument(onPhone);
    const again = await openVault(folder),
      onMac = (await again.loadDocuments()).find((d) => d.id === card.id);
    assert.deepEqual(onMac.blocks[0].table, onPhone.blocks[0].table);
    assert.equal(stderr, '');
    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
  },
);
