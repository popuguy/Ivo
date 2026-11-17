import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { libraryInfo, setLibraryInfo, isTrashed } from '../../../src/domain/documents/library.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait = async (predicate, message = 'Shell application timeout') => {
    for (let i = 0; i < 250; i++) {
      if (predicate()) return;
      await tick();
    }
    throw Error(
      message +
        ' · ' +
        document.querySelector('#toast').textContent +
        ' · ' +
        document.querySelector('#app').textContent.slice(0, 400),
    );
  };
const reload = JSON.parse(sessionStorage.getItem('ivo-shell-reload') || 'null'),
  make = (id, title, html) => {
    const doc = createSceneDocument(title);
    doc.id = id;
    const frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 48,
      y: 48,
      w: 516,
      h: 696,
      html: cleanHTML(html),
    });
    startTextFlow(doc, frame.id);
    return doc;
  };
const alpha = make(
    'shell-a',
    'Alpha',
    '<p>Alpha <strong>retained</strong> source. <a data-doc-id="shell-b" href="#doc=shell-b">Beta</a></p>',
  ),
  beta = make('shell-b', 'Beta', '<p>Beta original <em>source</em>.</p>'),
  gamma = make('shell-c', 'Gamma', '<p>Gamma source stays intact.</p>'),
  delta = make('shell-trash', 'Already in Trash', '<p>Previously trashed source is retained.</p>');
setLibraryInfo(delta, { folder: 'Old', trashedAt: '2026-11-14T00:00:00.000Z' });
beta.extensions = { thirdParty: { retain: 'source extension' } };
const asset = {
  id: 'shell-image',
  name: 'Original.png',
  mimeType: 'image/png',
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGN49vorVmSUsgUrYhjVQBMNuCRwGTSqgSYaACk0CB+bcN8GAAAAAElFTkSuQmCC',
};
insertObject(beta, 'image', beta.pages[0].id, {
  x: 80,
  y: 300,
  w: 90,
  h: 90,
  src: 'asset:' + asset.id,
  crop: { x: 32, y: 74 },
});
const oldBeta = structuredClone(beta);
oldBeta.title = 'Archived Beta';
oldBeta.updatedAt = '2026-11-01T12:00:00.000Z';
oldBeta.textFlows[0].html = '<p>Earlier <strong>Beta</strong> source.</p>';
const workspace = {
  version: 1,
  tabs: [
    {
      id: 'shell-tab-alpha',
      kind: 'document',
      docId: alpha.id,
      editing: true,
      canvasState: {
        activePage: alpha.pages[0].id,
        activeTextId: alpha.blocks[0].id,
        tool: 'text',
        selection: [alpha.blocks[0].id],
        camera: { x: 0, y: 0, zoom: 0.8 },
      },
    },
    { id: 'shell-tab-beta', kind: 'document', docId: beta.id, editing: false },
  ],
  active: 'shell-tab-alpha',
  groups: [
    { id: 'shell-group', tabIds: ['shell-tab-alpha', 'shell-tab-beta'], active: 'shell-tab-alpha' },
  ],
  layout: { type: 'group', id: 'shell-group' },
};
const documents = new Map(
    (reload?.docs || [alpha, beta, gamma, delta]).map((doc) => [doc.id, doc]),
  ),
  assets = new Map((reload?.assets || [asset]).map((value) => [value.id, value])),
  meta = new Map(
    reload?.meta || [
      ['initialized', true],
      ['workspace:1', workspace],
      ['library:1', { version: 1, folders: ['Empty folder'] }],
      ['history:' + beta.id, [oldBeta]],
    ],
  ),
  nativeCalls = [];
let command, close, nativeHistory, pendingMenu;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
globalThis.ivoNative = {
  platform: 'macos',
  zoomFactor: () => 1,
  onCommand: (callback) => (command = callback),
  onPrepareClose: (callback) => (close = callback),
  updateHistory: (value) => (nativeHistory = value),
  vaults: {
    info: async () => ({
      id: 'shell-fixture',
      name: 'Shell test vault',
      directory: '/private/shell-fixture',
    }),
    menu: async () => true,
  },
  showNavigationMenu: (items) =>
    new Promise((resolve) => {
      assert(!pendingMenu, 'An old native menu is still pending');
      pendingMenu = { items, resolve };
    }),
  documents: {
    info: async (id) => ({ id, relativePath: 'documents/' + id + '.json' }),
    copyPath: async (id, kind) => nativeCalls.push(['copyPath', id, kind]),
    reveal: async (id) => nativeCalls.push(['reveal', id]),
  },
  store: {
    loadDocuments: async () => structuredClone([...documents.values()]),
    loadAssets: async () => structuredClone([...assets.values()]),
    loadAsset: async (id) => structuredClone(assets.get(id) || null),
    saveAsset: async (value) => assets.set(value.id, structuredClone(value)),
    saveDocument: async (doc) => {
      validateImport({ schemaVersion: 5, documents: [doc], assets: [...assets.values()] });
      documents.set(doc.id, structuredClone(doc));
    },
    getMeta: async (key) =>
      meta.has(key) ? { id: key, value: structuredClone(meta.get(key)) } : null,
    putMeta: async (key, value) => meta.set(key, structuredClone(value)),
    saveImport: async () => {},
  },
};
const active = () => document.querySelector('.workspace-pane.active'),
  title = () => active()?.querySelector('[data-document-title]')?.value,
  source = () => active()?.querySelector('.canvas-document-source'),
  panes = () => [...document.querySelectorAll('[data-workspace-group]')],
  tabs = () => [...document.querySelectorAll('#app [data-tab-id]')],
  row = (id) => document.querySelector(`#document-list [data-open="${id}"]`),
  trashRow = (id) => document.querySelector(`#document-list [data-trash-document="${id}"]`),
  ribbon = (action) =>
    document.querySelector(
      `${action === 'sidebar-files' ? '.sidebar-tabs' : '.workspace-ribbon'} [data-action="${action}"]`,
    ),
  field = (name) => document.querySelector(`#dialog [name="${name}"]`);
const item = (items, id) => {
  for (const value of items) {
    if (value.id === id) return value;
    const found = value.submenu && item(value.submenu, id);
    if (found) return found;
  }
  return null;
};
async function menuFor(element) {
  assert(element, 'Missing context-menu source');
  element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: element.getBoundingClientRect().left + 20,
      clientY: element.getBoundingClientRect().top + 12,
    }),
  );
  await wait(() => pendingMenu, 'Document native menu did not open');
  return pendingMenu.items;
}
async function choose(action) {
  assert(pendingMenu, 'No native menu to choose from');
  if (action) {
    const entry = item(pendingMenu.items, action);
    assert(entry && entry.enabled !== false, 'Native action is disabled or missing ' + action);
  }
  const old = pendingMenu;
  pendingMenu = null;
  old.resolve(action);
  await tick();
}
async function documentAction(id, action) {
  await menuFor(row(id) || trashRow(id));
  await choose(action);
}
async function submit() {
  const form = document.querySelector('#dialog form');
  assert(form, 'No dialog form');
  form.requestSubmit(form.querySelector('[type=submit]'));
  await wait(() => !document.querySelector('#dialog').open, 'Dialog did not submit');
  await tick();
}
function tabMenu(id) {
  const tab = document.querySelector(`#app [data-tab-id="${id}"]`);
  assert(tab, 'Missing tab ' + id);
  tab.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: tab.getBoundingClientRect().left + 15,
      clientY: tab.getBoundingClientRect().bottom,
    }),
  );
  return document.querySelector('.tab-context-menu');
}
async function tabOption(id, action) {
  const menu = tabMenu(id);
  if (menu) {
    assert(menu.querySelector(`[data-tab-option="${action}"]`), 'Missing tab option ' + action);
    menu.querySelector(`[data-tab-option="${action}"]`).click();
    await tick();
  } else {
    await wait(() => pendingMenu, 'Native tab menu did not open');
    await choose(action);
  }
}
async function activateAlpha() {
  document.querySelector('[data-tab-id="shell-tab-alpha"]').click();
  await wait(() => title() === 'Alpha');
  await command('document-text');
  await wait(() => source()?.isContentEditable);
  await tick();
}
try {
  await import('../../../src/app/main.js');
  await wait(() => document.querySelector('.canvas-world'));
  await wait(() => document.hasFocus());
  if (reload) {
    assert(!document.querySelector('.topbar,.workspace-chrome'), 'Old global header reappeared');
    assert(
      title() === 'Alpha' &&
        tabs().length === 1 &&
        tabs()[0].closest('.document-tab').classList.contains('pinned'),
      'Pinned survivor/workspace did not reopen',
    );
    assert(
      row(beta.id) && !row(delta.id) && !trashRow(delta.id),
      'Live and trashed documents were not partitioned after reload',
    );
    assert(
      document.querySelector('[data-folder="Fashion/Fittings"]') &&
        document.querySelector('[data-folder="Empty folder"]'),
      'Folders did not reopen',
    );
    assert(
      libraryInfo(documents.get(beta.id)).bookmarked &&
        libraryInfo(documents.get(beta.id)).folder === 'Fashion/Fittings',
      'Library metadata did not reopen',
    );
    assert(
      documents.get(beta.id).textFlows[0].html === oldBeta.textFlows[0].html,
      'Restored version source did not reopen',
    );
    assert(assets.get(asset.id).data === asset.data, 'Original media changed on reopening'); // Importing only recoverable trash must keep a valid live view, not mount a hidden document.
    const importedTrash = structuredClone(documents.get(delta.id)),
      transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [JSON.stringify({ schemaVersion: 5, documents: [importedTrash], assets: [] })],
        'trash-only.json',
        { type: 'application/json' },
      ),
    );
    const input = document.querySelector('#import-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.querySelector('#dialog button[type=submit]'));
    await submit();
    assert(
      title() === 'Alpha' && row(alpha.id) && !row(delta.id) && isTrashed(documents.get(delta.id)),
      'Trash-only import chose an unavailable view',
    );
    ribbon('sidebar-trash').click();
    await wait(() => trashRow(delta.id));
    assert(!trashRow(beta.id), 'Restored document returned to Trash');
    await close();
    sessionStorage.removeItem('ivo-shell-reload');
    console.log(
      'IVO_SHELL_RESULT:' +
        JSON.stringify({
          ok: true,
          compactPaneLocalShell: true,
          nativeCapturedOwnerMenus: true,
          canceledMenuRetainsSourceAndCamera: true,
          newTabAndRightOpening: true,
          backgroundTabFileActions: true,
          foldersAndCollapse: true,
          bookmarks: true,
          pathAndRevealOwnership: true,
          versionRestoreRetainsLibraryAndAssets: true,
          independentDocumentDuplication: true,
          reversibleTrashAndGraphFiltering: true,
          pinnedBulkCloseProtection: true,
          libraryAndWorkspaceReopened: true,
          trashOnlyImportKeepsLiveView: true,
        }),
    );
  } else {
    assert(!document.querySelector('.topbar,.workspace-chrome'), 'Global document header remains');
    assert(
      document.querySelector('.workspace-ribbon').getBoundingClientRect().width === 44,
      'Ribbon is not compact44px',
    );
    assert(
      active().querySelector('.document-tabs').getBoundingClientRect().height === 40 &&
        active().querySelector('.view-header').getBoundingClientRect().height === 40,
      'Pane tabs/header do not use compact40px rows',
    );
    assert(
      panes().every(
        (pane) =>
          pane.querySelector(':scope > .document-tabs') &&
          pane.querySelector(':scope > .workspace-view-deck > .workspace-view > .view-header'),
      ),
      'Headers do not belong to each pane',
    );
    assert(
      row(alpha.id) && row(beta.id) && row(gamma.id) && !row(delta.id),
      'Trashed document leaked into ordinary navigation',
    );
    assert(
      document.querySelector('[data-folder="Empty folder"]'),
      'Saved empty folder did not load',
    );
    await activateAlpha();
    const originalAlpha = source(),
      alphaHTML = source().innerHTML,
      alphaWorld = active().querySelector('.canvas-world'),
      alphaZoom = active().querySelector('.zoom-value').textContent,
      text = source().querySelector('p').firstChild;
    source().focus();
    getSelection().setBaseAndExtent(text, 0, text, 5);
    document.dispatchEvent(new Event('selectionchange'));
    const firstMenu = await menuFor(row(beta.id));
    assert(
      title() === 'Alpha' && source() === originalAlpha,
      'Right-clicking a background note activated it',
    );
    for (const id of [
      'open-tab',
      'open-right',
      'duplicate',
      'move',
      'bookmark',
      'copy-relative',
      'copy-absolute',
      'history',
      'reveal',
      'rename',
      'trash',
    ])
      assert(item(firstMenu, id), 'Missing document menu option ' + id);
    assert(
      item(firstMenu, 'open-window').enabled === false &&
        item(firstMenu, 'copy-relative').enabled !== false,
      'Native capability flags incorrect',
    );
    await choose(null);
    assert(
      source() === originalAlpha &&
        source().innerHTML === alphaHTML &&
        getSelection().toString() === 'Alpha' &&
        active().querySelector('.canvas-world') === alphaWorld &&
        active().querySelector('.zoom-value').textContent === alphaZoom,
      'Canceled menu replaced source/selection/camera',
    );
    const beforeTabs = tabs().length;
    await documentAction(beta.id, 'open-tab');
    await wait(() => title() === 'Beta' && tabs().length === beforeTabs + 1);
    await activateAlpha();
    await documentAction(gamma.id, 'open-right');
    await wait(() => panes().length === 2 && title() === 'Gamma');
    assert(
      panes().every((pane) =>
        pane.querySelector(':scope > .workspace-view-deck > .workspace-view > .view-header'),
      ),
      'Split lost pane-local headers',
    );
    await command('merge-pane');
    await wait(() => panes().length === 1);
    await activateAlpha();
    // A file action on a background tab retains its document owner and does not switch the current note.
    await tabOption('shell-tab-beta', 'document-rename');
    await wait(() => document.querySelector('#dialog').open && field('name'));
    assert(
      title() === 'Alpha' && field('name').value === 'Beta',
      'Background tab rename activated or targeted the wrong note',
    );
    field('name').value = 'Beta fitting';
    await submit();
    assert(
      documents.get(beta.id).title === 'Beta fitting' && documents.get(alpha.id).title === 'Alpha',
      'Rename changed wrong document',
    );
    document.querySelector('.sidebar [data-action="new-folder"]').click();
    await wait(() => field('folder'));
    field('folder').value = 'Fashion/Fittings';
    await submit();
    assert(
      meta.get('library:1').folders.includes('Fashion') &&
        meta.get('library:1').folders.includes('Fashion/Fittings'),
      'Folder ancestors not saved',
    );
    await documentAction(beta.id, 'move');
    await wait(() => field('newFolder'));
    field('folder').value = 'Fashion/Fittings';
    await submit();
    assert(
      libraryInfo(documents.get(beta.id)).folder === 'Fashion/Fittings' &&
        row(beta.id).closest('[data-folder]').dataset.folder === 'Fashion/Fittings',
      'Document did not move to selected logical folder',
    );
    document.querySelector('.sidebar [data-action="collapse-folders"]').click();
    await tick();
    assert(
      [...document.querySelectorAll('.document-folder')].every((folder) => !folder.open),
      'Collapse folders failed',
    );
    document.querySelector('.sidebar [data-action="collapse-folders"]').click();
    await tick();
    assert(
      [...document.querySelectorAll('.document-folder')].every((folder) => folder.open),
      'Expand folders failed',
    );
    await documentAction(beta.id, 'bookmark');
    await wait(() => libraryInfo(documents.get(beta.id)).bookmarked);
    ribbon('sidebar-bookmarks').click();
    await wait(() => row(beta.id) && !row(alpha.id));
    assert(!row(gamma.id), 'Bookmarks included unbookmarked note');
    await documentAction(beta.id, 'bookmark');
    await wait(() => !row(beta.id));
    ribbon('sidebar-files').click();
    await wait(() => row(beta.id));
    await documentAction(beta.id, 'bookmark');
    await wait(() => libraryInfo(documents.get(beta.id)).bookmarked);
    await documentAction(beta.id, 'copy-relative');
    await documentAction(beta.id, 'copy-absolute');
    await documentAction(beta.id, 'reveal');
    assert(
      JSON.stringify(nativeCalls) ===
        JSON.stringify([
          ['copyPath', beta.id, 'relative'],
          ['copyPath', beta.id, 'absolute'],
          ['reveal', beta.id],
        ]),
      'Path/reveal APIs used wrong document',
    );
    await documentAction(beta.id, 'history');
    await wait(() => document.querySelector('#dialog [data-library-version]'));
    assert(title() === 'Alpha', 'Background version history activated the note');
    const version = [...document.querySelectorAll('[data-library-version]')].find((button) =>
      button.textContent.includes('Archived Beta'),
    );
    assert(version, 'Owned history entry not listed');
    version.click();
    await wait(() => !document.querySelector('#dialog').open);
    await close();
    assert(
      documents.get(beta.id).textFlows[0].html === oldBeta.textFlows[0].html &&
        documents.get(beta.id).title === 'Archived Beta',
      'Version source/title did not restore',
    );
    assert(
      libraryInfo(documents.get(beta.id)).folder === 'Fashion/Fittings' &&
        libraryInfo(documents.get(beta.id)).bookmarked,
      'Version restore discarded current library placement',
    );
    assert(
      documents.get(beta.id).extensions.thirdParty.retain === 'source extension' &&
        assets.get(asset.id).data === asset.data,
      'Version restore lost unrelated source/media',
    );
    const beforeDuplicate = documents.size,
      betaBeforeCopy = JSON.stringify(documents.get(beta.id));
    await documentAction(beta.id, 'duplicate');
    await wait(() => documents.size === beforeDuplicate + 1 && title() === 'Archived Beta (copy)');
    const copy = [...documents.values()].find((doc) => doc.title === 'Archived Beta (copy)');
    assert(
      copy &&
        copy.id !== beta.id &&
        copy.textFlows[0].id !== documents.get(beta.id).textFlows[0].id &&
        copy.textFlows[0].html === documents.get(beta.id).textFlows[0].html,
      'Duplicate shared mutable identity or lost textFlow',
    );
    assert(
      copy.blocks.find((block) => block.type === 'image').src === 'asset:' + asset.id &&
        assets.size === 1 &&
        !libraryInfo(copy).bookmarked &&
        !isTrashed(copy),
      'Duplicate lost original media or copied trash/bookmark state',
    );
    const copyTitle = active().querySelector('[data-document-title]');
    copyTitle.value = 'Independent copy';
    copyTitle.dispatchEvent(new Event('input', { bubbles: true }));
    copyTitle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await close();
    assert(
      JSON.stringify(documents.get(beta.id)) === betaBeforeCopy &&
        documents.get(copy.id).title === 'Independent copy',
      'Editing duplicate changed original document',
    );
    await command('split-right');
    await tick();
    ribbon('graph').click();
    await wait(() => active().querySelector('.ivo-graph-canvas'));
    const graphPane = active(),
      beforeTrash = structuredClone(documents.get(beta.id));
    if (new URLSearchParams(location.search).has('capture')) {
      await tick();
      console.log('IVO_SHELL_CAPTURE');
      await wait(() => window.ivoShellCaptured, 'Review screenshot was not captured');
    }
    await documentAction(beta.id, 'trash');
    await wait(() => isTrashed(documents.get(beta.id)) && !row(beta.id));
    assert(
      !document.querySelector(`#app [data-tab-id="shell-tab-beta"]`),
      'Trashed note kept an editable tab',
    );
    const liveCount = [...documents.values()].filter((doc) => !isTrashed(doc)).length;
    await wait(
      () =>
        graphPane.querySelector('.graph-footer')?.textContent.includes(liveCount + ' documents'),
      'Graph kept trashed document count',
    );
    assert(
      !graphPane.querySelector(`[data-open="${beta.id}"]`),
      'Graph directory kept trashed document',
    );
    assert(
      documents.get(beta.id).textFlows[0].html === beforeTrash.textFlows[0].html &&
        assets.get(asset.id).data === asset.data,
      'Trash deleted source or original media',
    );
    ribbon('sidebar-trash').click();
    await wait(() => trashRow(beta.id) && trashRow(delta.id));
    await documentAction(beta.id, 'restore');
    await wait(() => !isTrashed(documents.get(beta.id)) && !trashRow(beta.id));
    ribbon('sidebar-files').click();
    await wait(() => row(beta.id));
    await wait(
      () =>
        graphPane
          .querySelector('.graph-footer')
          ?.textContent.includes(liveCount + 1 + ' documents'),
      'Graph did not include restored note',
    );
    assert(
      documents.get(beta.id).textFlows[0].html === beforeTrash.textFlows[0].html &&
        libraryInfo(documents.get(beta.id)).folder === 'Fashion/Fittings' &&
        libraryInfo(documents.get(beta.id)).bookmarked,
      'Restore changed source/library identity',
    );
    await command('merge-pane');
    await wait(() => panes().length === 1);
    await activateAlpha();
    await tabOption('shell-tab-alpha', 'pin');
    assert(
      document
        .querySelector('[data-tab-id="shell-tab-alpha"]')
        .closest('.document-tab')
        .classList.contains('pinned'),
      'Pin not applied',
    );
    await documentAction(beta.id, 'open-tab');
    await wait(() => title() === 'Archived Beta');
    const betaTab = active().querySelector('[data-tab-id][aria-selected=true]').dataset.tabId;
    await tabOption(betaTab, 'close-others');
    await wait(() => tabs().length === 2);
    assert(
      document.querySelector('[data-tab-id="shell-tab-alpha"]') &&
        document.querySelector(`[data-tab-id="${betaTab}"]`),
      'Bulk close discarded pinned or target view',
    );
    await tabOption(betaTab, 'close-all');
    await wait(() => tabs().length === 1 && title() === 'Alpha');
    assert(
      documents.size === beforeDuplicate + 1 && !isTrashed(documents.get(beta.id)),
      'Closing views deleted documents',
    );
    await close();
    assert(
      documents.get(alpha.id).textFlows[0].html === alpha.textFlows[0].html &&
        documents.get(gamma.id).textFlows[0].html === gamma.textFlows[0].html,
      'Navigation/library operations changed unrelated source',
    );
    assert(
      nativeHistory && typeof nativeHistory.canUndo === 'boolean',
      'Native history state not refreshed',
    );
    sessionStorage.setItem(
      'ivo-shell-reload',
      JSON.stringify({
        docs: [...documents.values()],
        assets: [...assets.values()],
        meta: [...meta.entries()],
      }),
    );
    location.reload();
  }
} catch (error) {
  console.log('IVO_SHELL_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
