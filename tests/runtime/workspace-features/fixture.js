import { createIndexedDBStore } from '../../../src/storage/indexeddb.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { setLibraryInfo, libraryInfo } from '../../../src/domain/documents/library.js';
import {
  createWorkspace,
  replaceTab,
  splitGroup,
  activateTab,
} from '../../../src/domain/workspace/state.js';
import { createWorkspacePreferences } from '../../../src/storage/workspace-preferences.js';
import { startApplication } from '../../../src/app/application.js';
// A successful result must not hide an uncaught renderer error along the way.
window.addEventListener('error', (event) => {
  console.log(
    'IVO_WORKSPACE_FEATURES_RESULT:' +
      JSON.stringify({ error: event.error?.stack || event.message }),
  );
});
window.addEventListener('unhandledrejection', (event) => {
  console.log(
    'IVO_WORKSPACE_FEATURES_RESULT:' +
      JSON.stringify({ error: event.reason?.stack || String(event.reason) }),
  );
});
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait = async (predicate, message) => {
    for (let i = 0; i < 250; i++) {
      if (await predicate()) return;
      await tick();
    }
    throw new Error(message + ' · ' + document.querySelector('#toast').textContent);
  };
let chromeRequestId = 0;
async function chromeHost(type, values = {}) {
  const id = ++chromeRequestId;
  console.log('IVO_WORKSPACE_CHROME:' + JSON.stringify({ type, id, ...values }));
  await wait(
    () => globalThis.ivoWorkspaceChromeAck === id,
    'Chrome host action was not acknowledged',
  );
  await tick();
}
async function hover(element) {
  const rect = element.getBoundingClientRect();
  await chromeHost('hover', { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
}
const backend = createIndexedDBStore(),
  reloaded = sessionStorage.getItem('features-reloaded') === 'true';
let sourceWrites = 0,
  failWrites = false,
  failWorkspaceWrites = false,
  failLibrary = false,
  nativeCommand,
  prepareClose;
const menuChoices = [],
  seenMenus = [];
const originalAsset = {
  id: 'features-image',
  name: 'Original.png',
  mimeType: 'image/png',
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGN49vorVmSUsgUrYhjVQBMNuCRwGTSqgSYaACk0CB+bcN8GAAAAAElFTkSuQmCC',
};
const canonical = (key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : value;
const sourceShape = (doc) =>
  JSON.stringify(
    {
      id: doc.id,
      pages: doc.pages,
      blocks: doc.blocks,
      textFlows: doc.textFlows,
      other: doc.extensions?.thirdParty,
    },
    canonical,
  );
const make = (id, folder) => {
  const doc = createSceneDocument(id === 'features-alpha' ? 'Alpha' : 'Beta');
  doc.id = id;
  doc.extensions = { thirdParty: { retain: 'source' } };
  setLibraryInfo(doc, { folder, bookmarked: true });
  startTextFlow(
    doc,
    insertObject(doc, 'text', doc.pages[0].id, {
      x: 48.125,
      y: 48,
      w: 516,
      h: 600,
      html: '<p>' + doc.title + ' <strong>retained</strong> source.</p><p><br></p>',
    }).id,
  );
  return doc;
};
if (!reloaded) {
  const alpha = make('features-alpha', 'Research/Scans'),
    beta = make('features-beta', '');
  insertObject(alpha, 'image', alpha.pages[0].id, {
    x: 48,
    y: 400,
    w: 70,
    h: 70,
    src: 'asset:' + originalAsset.id,
  });
  await backend.saveImport({ schemaVersion: 5, documents: [alpha, beta], assets: [originalAsset] });
  await backend.putMeta('library:1', { version: 1, folders: ['Research/Empty', 'Studio'] });
  await backend.putMeta('history:' + alpha.id, [alpha]);
  const workspace = createWorkspace();
  replaceTab(workspace, 'document', alpha.id, true);
  const first = workspace.active;
  workspace.tabs[0].canvasState = {
    camera: { x: 15, y: 20, zoom: 0.7 },
    selection: [],
    tool: 'select',
  };
  splitGroup(workspace);
  replaceTab(workspace, 'document', beta.id, false);
  activateTab(workspace, first);
  await backend.putMeta('workspace:1', workspace);
  sessionStorage.setItem('features-source', JSON.stringify([alpha, beta].map(sourceShape)));
}
globalThis.ivoNative = {
  platform: 'macos',
  store: {
    ...backend,
    putMeta: async (key, value) => {
      if (failWorkspaceWrites && key === 'workspace:1')
        throw new Error('Simulated workspace persistence failure');
      return backend.putMeta(key, value);
    },
    saveDocument: async (doc) => {
      if (failWrites) throw new Error('Simulated source failure');
      sourceWrites++;
      return backend.saveDocument(doc);
    },
    changeLibrary: async (command) => {
      if (failLibrary) throw new Error('Simulated library failure');
      return backend.changeLibrary(command);
    },
  },
  vaults: {
    info: async () => ({ id: 'workspace-features', name: 'Feature vault', manager: false }),
  },
  windows: {
    info: async () => ({ windowId: 'features-main', active: true, main: true }),
    ready: async () => true,
  },
  onCommand: (callback) => {
    nativeCommand = callback;
  },
  onPrepareClose: (callback) => {
    prepareClose = callback;
  },
  showNavigationMenu: async (items) => {
    seenMenus.push(items);
    return menuChoices.shift() || null;
  },
  updateHistory: () => {},
};
const active = () => document.querySelector('.workspace-pane.active'),
  panes = () => [...document.querySelectorAll('[data-workspace-group]')],
  field = (name) => document.querySelector('#dialog [name="' + name + '"]'),
  click = (element) => {
    assert(element, 'Missing clickable target');
    element.click();
  },
  submit = async (values) => {
    for (const [name, value] of Object.entries(values)) field(name).value = value;
    document.querySelector('#dialog form').dispatchEvent(
      new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true,
        submitter: document.querySelector('#dialog [type=submit]'),
      }),
    );
    await tick();
  };
function pointer(target, type, x, y, id = 71) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}
const folder = (path) =>
    [...document.querySelectorAll('summary[data-folder-path]')].find(
      (element) => element.dataset.folderPath === path,
    ),
  row = (id) => document.querySelector('#document-list [data-open="' + id + '"]');
async function context(element, choice) {
  menuChoices.push(choice);
  element.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 150 }),
  );
  await tick();
}
async function drag(from, to) {
  const transfer = new DataTransfer();
  from.dispatchEvent(
    new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  to.dispatchEvent(
    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  to.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  await tick();
}
try {
  await startApplication({
    workspaceFeatures: { stackedTabs: true, savedLayouts: true },
    root: document.querySelector('#app'),
    dialog: document.querySelector('#dialog'),
  });
  await wait(() => panes().length >= 2, 'Initial panes missing');
  const prefs = createWorkspacePreferences({
      vaultId: 'workspace-features',
      windowId: 'features-main',
    }),
    expectedSources = JSON.parse(sessionStorage.getItem('features-source'));
  if (reloaded) {
    assert(panes().length === 3, 'Current named layout did not reopen');
    assert(prefs.catalog().layouts[0].name === 'Studio layout', 'Renamed layout did not persist');
    assert(
      Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 320,
      'Sidebar width did not reopen',
    );
    assert(
      (await backend.loadDocuments()).map(sourceShape).join('|') === expectedSources.join('|'),
      'Reopen changed original source',
    );
    assert(
      (await backend.loadAssets())[0].data === originalAsset.data,
      'Reopen changed original media',
    );
    assert(
      (await backend.getMeta('history:features-alpha')).value[0].textFlows[0].html.includes(
        'retained',
      ),
      'Folder move changed history',
    );
    console.log(
      'IVO_WORKSPACE_FEATURES_RESULT:' +
        JSON.stringify({
          ok: true,
          namedWorkspaceSaveRenameReplaceAndReopen: true,
          previousWorkspaceRestore: true,
          failedFlushPreventsRestore: true,
          workspaceCommitBeforeViewSwap: true,
          sidebarPointerKeyboardCancelAndPersistence: true,
          retainedLiveEditorOnResize: true,
          nativeWindowCornerPreserved: true,
          continuousSidebarFramesAndReversal: true,
          noSceneRewriteDuringSidebarMotion: true,
          modalHoverClickDragAndOutsideDismissal: true,
          viewportQuickSwitcherAndClearBehavior: true,
          reachableTitlebarToggleAndHiddenPanelFocus: true,
          spatialPaneFocus: true,
          atomicBrowserFolderRenameMoveAndFailure: true,
          documentAndFolderDrag: true,
          cyclicDropRejected: true,
          bookmarkSearch: true,
          bookmarkSearchLeavesGraphIndependent: true,
          createWithinFolder: true,
          sourceMediaAndHistoryRetained: true,
        }),
    );
  } else {
    const originalTab = active().querySelector('[data-tab-id][aria-selected="true"]').dataset.tabId;
    click(active().querySelector('[data-action="new-tab"]'));
    await wait(() => active().querySelector('.empty-document-tab'), 'Temporary tab did not open');
    const temporaryTab = active().querySelector('[data-tab-id][aria-selected="true"]').dataset
      .tabId;
    click(document.querySelector(`[data-tab-id="${originalTab}"]`));
    await wait(
      () => active().querySelector('[data-document-title]')?.value === 'Alpha',
      'Original view did not restore',
    );
    const background = document
        .querySelector(`[data-tab-id="${temporaryTab}"]`)
        .closest('.document-tab'),
      inner = background.querySelector('.document-tab-inner'),
      close = background.querySelector('[data-close-tab]');
    await hover(background.querySelector('[data-tab-id]'));
    const fill = getComputedStyle(inner).backgroundColor,
      box = inner.getBoundingClientRect(),
      closeBox = close.getBoundingClientRect();
    assert(
      getComputedStyle(close).display !== 'none' && fill !== 'rgba(0, 0, 0, 0)',
      'Background tab did not reveal contained Close on real hover',
    );
    assert(
      closeBox.left >= box.left &&
        closeBox.right <= box.right &&
        closeBox.top >= box.top &&
        closeBox.bottom <= box.bottom,
      'Tab hover fill ends before its Close control',
    );
    await hover(close);
    assert(
      getComputedStyle(inner).backgroundColor === fill &&
        getComputedStyle(close).backgroundColor === 'rgba(0, 0, 0, 0)',
      'Close hover detached from the shared background tab fill',
    );
    assert(getComputedStyle(close).cursor === 'default', 'Tab Close uses a link cursor');
    const closeIcon = close.querySelector('.reference-icon');
    assert(
      closeIcon.dataset.iconSource === 'Obsidian/Lucide' &&
        closeIcon.getBoundingClientRect().width === 16 &&
        close.getBoundingClientRect().width === 20 &&
        getComputedStyle(closeIcon).opacity === '1' &&
        getComputedStyle(close).color === 'rgb(34, 34, 34)',
      'Background tab Close does not use the reference glyph/size/hover ink',
    );
    click(close);
    await wait(
      () => !document.querySelector(`[data-tab-id="${temporaryTab}"]`),
      'Background tab did not close',
    );
    assert(
      active().querySelector(`[data-tab-id="${originalTab}"]`)?.getAttribute('aria-selected') ===
        'true',
      'Closing a background tab activated it',
    );
    const activeClose = active().querySelector('.document-tab.active [data-close-tab]');
    await hover(active().querySelector('.document-tab.active [data-tab-id]'));
    assert(
      getComputedStyle(active().querySelector('.document-tab.active [data-tab-id]')).color ===
        'rgb(34, 34, 34)',
      'Tab title inherits the generic blue button hover after the sidebar control moves away',
    );
    assert(
      getComputedStyle(activeClose).color === 'rgb(92, 92, 92)' &&
        getComputedStyle(activeClose).backgroundColor === 'rgba(0, 0, 0, 0)',
      'Active tab Close changed before its own hover target was entered',
    );
    await hover(activeClose);
    assert(
      getComputedStyle(activeClose).color === 'rgb(34, 34, 34)' &&
        getComputedStyle(activeClose).backgroundColor === 'rgba(0, 0, 0, 0.067)' &&
        getComputedStyle(activeClose.querySelector('.reference-icon')).opacity === '1',
      'Active tab Close hover ink/fill differs from the reference',
    );
    const header = document.querySelector('.workspace-window-header');
    assert(
      header && getComputedStyle(document.querySelector('#app'), '::before').content === 'none',
      'Native corner still depends on an overlapping pseudo-element patch',
    );
    for (const zoom of [1, 1.1, 1.25]) {
      await chromeHost('zoom', { zoom });
      const edge = header.getBoundingClientRect().bottom,
        bars = [...document.querySelectorAll('.workspace-pane > .document-tabs')].filter(
          (bar) =>
            Math.abs(bar.getBoundingClientRect().top - header.getBoundingClientRect().top) < 0.02,
        );
      assert(
        bars.length > 0 &&
          bars.every(
            (bar) =>
              Math.abs(bar.getBoundingClientRect().bottom - edge) < 0.02 &&
              getComputedStyle(bar).boxShadow.includes(getComputedStyle(header).borderBottomColor),
          ),
        'Titlebar baseline or outline diverges at UI zoom ' +
          zoom +
          ' ' +
          JSON.stringify({
            edge,
            headerColor: getComputedStyle(header).borderBottomColor,
            bars: bars.map((bar) => ({
              top: bar.getBoundingClientRect().top,
              bottom: bar.getBoundingClientRect().bottom,
              divider: getComputedStyle(bar).boxShadow,
            })),
          }),
      );
      assert(
        !document.elementFromPoint(22, 20)?.closest('button'),
        'Web control overlaps native close button space at UI zoom ' + zoom,
      );
    }
    await chromeHost('zoom', { zoom: 1 });
    const modal = document.querySelector('#dialog');
    async function openOptions() {
      click(document.querySelector('.workspace-ribbon [data-action="options"]'));
      await wait(() => modal.open && modal.querySelector('h2')?.textContent === 'Vault options');
      await tick();
    }
    const center = (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    await openOptions();
    const modalClose = modal.querySelector('.dialog-close');
    await hover(modalClose);
    assert(
      getComputedStyle(modalClose).cursor === 'default' &&
        getComputedStyle(modalClose).backgroundColor !== 'rgba(0, 0, 0, 0)',
      'Modal Close does not have contained hover with arrow cursor',
    );
    await chromeHost('click', center(modalClose));
    await wait(() => !modal.open, 'Real modal Close click failed');
    await openOptions();
    const inside = center(modal.querySelector('p'));
    await chromeHost('click', inside);
    assert(modal.open, 'An inside click dismissed the modal');
    await chromeHost('drag', { from: inside, to: { x: 20, y: 200 } });
    assert(modal.open, 'A drag begun inside dismissed the modal');
    await chromeHost('drag', { from: { x: 20, y: 200 }, to: { x: 40, y: 200 } });
    assert(modal.open, 'An outside drag was treated as an outside click');
    await chromeHost('click', { x: 20, y: 200 });
    await wait(() => !modal.open, 'Ordinary backdrop click did not dismiss modal');
    const world = active().querySelector('.canvas-world'),
      handle = document.querySelector('.workspace-sidebar-resize'),
      r = handle.getBoundingClientRect();
    assert(r.top >= 40, 'Sidebar divider overlaps window controls');
    let sidebar = document.querySelector('.sidebar');
    const toggle = document.querySelector('.workspace-header-toggle-slot [data-action="menu"]'),
      root = document.querySelector('#app'),
      expandedWidth = sidebar.getBoundingClientRect().width,
      widths = [];
    let worldMutations = 0;
    const motionObserver = new MutationObserver((records) => (worldMutations += records.length));
    motionObserver.observe(world, { childList: true, subtree: true });
    function toggleIsReachable() {
      const rect = toggle.getBoundingClientRect();
      return (
        rect.top === 0 &&
        rect.left >= 80 &&
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest('button') === toggle
      );
    }
    assert(toggleIsReachable(), 'Expanded titlebar toggle is clipped or overlaps native controls');
    const hoverBox = toggle.querySelector('.workspace-toggle-hover').getBoundingClientRect();
    assert(
      hoverBox.width === 28 &&
        hoverBox.height === 24 &&
        toggle.getBoundingClientRect().height === 39,
      'Sidebar toggle paints the whole titlebar slot on hover',
    );
    async function checkToggleHover() {
      const inner = toggle.querySelector('.workspace-toggle-hover'),
        rect = toggle.getBoundingClientRect(),
        glyph = inner.querySelector('.reference-icon');
      // Renderer input injection bypasses the native window-drag hit test. Check
      // its ordered drag/exclusion geometry too; physical coordinate clicks are
      // still required for the macOS frame and integration boundary.
      const regions = [...root.querySelectorAll('*')].flatMap((node) => {
        const style = getComputedStyle(node),
          region = style.webkitAppRegion,
          box = node.getBoundingClientRect();
        return ['drag', 'no-drag'].includes(region) &&
          style.visibility === 'visible' &&
          box.width &&
          box.height
          ? [{ region, box, name: node.className }]
          : [];
      });
      assert(
        regions.some((item) => item.region === 'drag'),
        'Native drag-region check did not find the real header drag surfaces',
      );
      for (const x of [rect.left + 2, rect.left + rect.width / 2, rect.right - 2]) {
        for (const y of [rect.top + 7, rect.top + 20, rect.bottom - 2]) {
          const covering = regions.filter(
              ({ box }) => x >= box.left && x < box.right && y >= box.top && y < box.bottom,
            ),
            last = covering.at(-1);
          assert(
            last?.region === 'no-drag',
            'A native drag rectangle covers the sidebar toggle at ' +
              JSON.stringify({ x, y, covering: covering.map((item) => item.name) }),
          );
          assert(
            document.elementFromPoint(x, y)?.closest('[data-action="menu"]') === toggle,
            'A DOM overlay intercepts part of the sidebar toggle',
          );
        }
      }
      // The wrapper padding stays clickable but does not paint the inner hover.
      await chromeHost('hover', { x: rect.right - 2, y: rect.top + 3 });
      assert(
        toggle.matches(':hover') &&
          !inner.matches(':hover') &&
          getComputedStyle(inner).backgroundColor === 'rgba(0, 0, 0, 0)' &&
          getComputedStyle(toggle).color === 'rgb(92, 92, 92)',
        'Sidebar wrapper padding triggers an early hover or leaks the generic blue button ink',
      );
      await hover(inner);
      await wait(
        () => getComputedStyle(glyph).opacity === '1',
        'Toggle hover opacity did not settle',
      );
      assert(
        inner.matches(':hover') &&
          getComputedStyle(inner).backgroundColor === 'rgba(0, 0, 0, 0.067)' &&
          getComputedStyle(inner).color === 'rgb(92, 92, 92)' &&
          getComputedStyle(toggle).cursor === 'default',
        'Sidebar icon hover color/fill/cursor differs from the reference',
      );
      await chromeHost('hover', { x: rect.left + 2, y: rect.bottom + 3 });
      assert(
        !toggle.matches(':hover') && getComputedStyle(inner).backgroundColor === 'rgba(0, 0, 0, 0)',
        'Sidebar toggle hover remains after leaving the control',
      );
    }
    await checkToggleHover();
    click(toggle);
    await wait(() => sidebar.inert);
    assert(
      sidebar.inert && toggle.getAttribute('aria-expanded') === 'false',
      'Closing sidebar leaves its hidden controls keyboard accessible',
    );
    for (let frame = 0; frame < 20 && root.classList.contains('sidebar-transition'); frame++) {
      widths.push(sidebar.getBoundingClientRect().width);
      await tick();
    }
    assert(
      widths.some((width) => width > 0 && width < expandedWidth),
      'Sidebar collapse skipped its intermediate frames',
    );
    assert(
      sidebar.getBoundingClientRect().width === 0 && toggleIsReachable(),
      'Collapsed sidebar or titlebar toggle ended in the wrong position',
    );
    const firstTab = active().querySelector('[data-tab-id]').getBoundingClientRect();
    assert(
      firstTab.left >= toggle.getBoundingClientRect().right,
      'Collapsed titlebar toggle overlaps the first document tab',
    );
    await checkToggleHover();
    click(document.querySelector('.workspace-ribbon [data-action="quick-switcher"]'));
    await wait(
      () => document.querySelector('#quick-search'),
      'Collapsed ribbon quick switcher did not open',
    );
    assert(
      document.body.classList.contains('sidebar-collapsed') && sidebar.inert,
      'Quick switcher expanded navigation',
    );
    const promptInput = document.querySelector('#quick-search'),
      promptRect = modal.getBoundingClientRect();
    assert(
      Math.abs(promptRect.x + promptRect.width / 2 - innerWidth / 2) < 1 &&
        Math.abs(promptRect.y - innerHeight * 0.15) < 1,
      'Collapsed quick switcher is not positioned from the viewport',
    );
    promptInput.value = 'Alpha';
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nativeCommand('quick-switcher');
    assert(
      document.querySelector('#quick-search') === promptInput && promptInput.value === 'Alpha',
      'Repeated switcher command recreated the prompt',
    );
    await chromeHost('click', center(modal.querySelector('.prompt-clear')));
    assert(
      modal.open && promptInput.value === '' && document.activeElement === promptInput,
      'Prompt clear lost focus or closed a nonempty search',
    );
    await chromeHost('click', center(modal.querySelector('.prompt-clear')));
    await wait(() => !modal.open, 'Empty prompt clear did not close the switcher');
    click(document.querySelector('.workspace-ribbon [data-action="sidebar-search"]'));
    await wait(
      () => !document.querySelector('.sidebar').inert && document.activeElement?.id === 'search',
      'Search panel remained hidden or inert after its ribbon action',
    );
    await wait(() => !root.classList.contains('sidebar-transition'));
    assert(
      active().querySelector('.canvas-world') === world,
      'Opening Search rebuilt the document',
    );
    click(document.querySelector('.sidebar-tabs [data-action="sidebar-files"]'));
    sidebar = document.querySelector('.sidebar');
    click(toggle);
    await wait(
      () =>
        root.querySelector(':scope > .sidebar').inert &&
        !root.classList.contains('sidebar-transition'),
    );
    // Interrupt and reverse the same transition; a stale completion must not hide the open panel.
    click(toggle);
    await tick();
    click(toggle);
    await tick();
    click(toggle);
    await wait(() => !root.classList.contains('sidebar-transition'));
    assert(
      !sidebar.inert &&
        sidebar.getBoundingClientRect().width === expandedWidth &&
        toggleIsReachable(),
      'Interrupted sidebar motion left stale visibility or control placement',
    );
    assert(
      active().querySelector('.canvas-world') === world,
      'Sidebar motion replaced the live editor',
    );
    worldMutations += motionObserver.takeRecords().length;
    motionObserver.disconnect();
    assert(worldMutations === 0, 'Sidebar actions rewrote page/text DOM during animation');

    pointer(handle, 'pointerdown', r.x + 2, 150);
    pointer(window, 'pointermove', r.x + 88, 150);
    pointer(window, 'pointerup', r.x + 88, 150);
    await tick();
    assert(
      Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 326,
      'Pointer sidebar width incorrect: ' +
        JSON.stringify({
          width: document.querySelector('.sidebar').getBoundingClientRect().width,
          style: root.getAttribute('style'),
          connected: handle.isConnected,
          classes: root.className,
          body: document.body.className,
        }),
    );
    assert(active().querySelector('.canvas-world') === world, 'Resize rebuilt the live editor');
    pointer(handle, 'pointerdown', r.x + 2, 150);
    pointer(window, 'pointermove', r.x + 100, 150);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert(
      Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 326,
      'Canceled sidebar resize was committed',
    );
    handle.focus();
    for (const key of ['Home', 'ArrowRight', 'ArrowRight'])
      handle.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          shiftKey: key === 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
    assert(
      Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 320,
      'Keyboard sidebar width incorrect',
    );
    await nativeCommand('focus-pane-right');
    assert(
      active().querySelector('[data-document-title]').value === 'Beta',
      'Directional focus did not move right',
    );
    await nativeCommand('split-down');
    assert(panes().length === 3, 'Third pane missing');
    click(toggle);
    await wait(
      () =>
        root.querySelector(':scope > .sidebar').inert &&
        !root.classList.contains('sidebar-transition'),
    );
    assert(
      panes().filter(
        (pane) => getComputedStyle(pane.querySelector('.document-tabs')).paddingLeft === '80px',
      ).length === 1,
      'Window-control clearance leaked into nested or lower pane tab bars',
    );
    await checkToggleHover();
    console.log('IVO_WORKSPACE_NARROW');
    await wait(() => globalThis.ivoWorkspaceNarrow && innerWidth <= 760, 'Narrow viewport missing');
    click(toggle);
    await wait(() => document.body.classList.contains('nav-open'));
    await checkToggleHover();
    const filesButton = root.querySelector('.sidebar-tabs [data-action="sidebar-files"]'),
      filesRect = filesButton.getBoundingClientRect();
    assert(
      document
        .elementFromPoint(filesRect.x + filesRect.width / 2, filesRect.y + filesRect.height / 2)
        ?.closest('button') === filesButton,
      'The narrow header control layer covers the navigation buttons',
    );
    click(toggle);
    await wait(() => !document.body.classList.contains('nav-open'));
    console.log('IVO_WORKSPACE_WIDE');
    await wait(() => globalThis.ivoWorkspaceWide && innerWidth > 760, 'Wide viewport missing');
    await nativeCommand('focus-pane-up');
    assert(
      root.querySelector(':scope > .sidebar').inert,
      'Navigation render lost hidden sidebar keyboard isolation',
    );
    click(toggle);
    await wait(
      () =>
        !root.querySelector(':scope > .sidebar').inert &&
        !root.classList.contains('sidebar-transition'),
    );

    await nativeCommand('focus-pane-up');
    assert(
      active().dataset.workspaceGroup === panes()[1].dataset.workspaceGroup,
      'Directional up focus chose wrong pane',
    );
    await nativeCommand('focus-pane-down');
    click(document.querySelector('[data-action=graph]'));
    await wait(() => !!active().querySelector('.graph-stage'), 'Graph pane did not open');
    await nativeCommand('focus-pane-up');
    await nativeCommand('workspaces');
    await submit({ name: 'Drafting' });
    await wait(() => document.querySelector('[data-load-workspace]'), 'Workspace was not saved');
    assert(sourceWrites === 0, 'Saving a layout wrote document content');
    const savedId = prefs.catalog().layouts[0].id;
    document.querySelector('#dialog').close();
    await nativeCommand('merge-pane');
    assert(panes().length === 2, 'Merge did not change layout');
    await nativeCommand('workspaces');
    click(document.querySelector('[data-load-workspace="' + savedId + '"]'));
    await wait(
      () => !document.querySelector('#dialog').open && panes().length === 3,
      'Saved layout did not restore',
    );
    await nativeCommand('restore-workspace');
    assert(panes().length === 2, 'Previous workspace did not restore');
    failWrites = true;
    const title = active().querySelector('[data-document-title]');
    title.value = 'Pending title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    title.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await nativeCommand('workspaces');
    click(document.querySelector('[data-load-workspace]'));
    await wait(
      () => document.querySelector('#toast').textContent.includes('Could not save'),
      'Expected save failure missing',
    );
    assert(
      panes().length === 2 && document.querySelector('#dialog').open,
      'Failed source save replaced the workspace',
    );
    failWrites = false;
    document.querySelector('#dialog').close();
    assert(await prepareClose(), 'Pending source retry failed');
    const oldTitle = active().querySelector('[data-document-title]');
    oldTitle.value = 'Beta';
    oldTitle.dispatchEvent(new Event('input', { bubbles: true }));
    oldTitle.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    assert(await prepareClose(), 'Title recovery failed');
    assert(await prepareClose(), 'Pre-restore flush failed');
    failWorkspaceWrites = true;
    await nativeCommand('workspaces');
    click(document.querySelector('[data-load-workspace]'));
    await wait(
      () =>
        document
          .querySelector('#toast')
          .textContent.includes('Simulated workspace persistence failure'),
      'Workspace persistence failure missing',
    );
    assert(
      panes().length === 2 && document.querySelector('#dialog').open,
      'Workspace persistence failure replaced the live view',
    );
    failWorkspaceWrites = false;
    click(document.querySelector('[data-load-workspace]'));
    await wait(
      () => panes().length === 3 && !document.querySelector('#dialog').open,
      'Layout retry failed',
    );
    await nativeCommand('workspaces');
    menuChoices.push('rename');
    click(document.querySelector('[data-workspace-menu]'));
    await wait(
      () => document.querySelector('#dialog h2').textContent === 'Rename workspace',
      'Workspace rename dialog missing',
    );
    await submit({ name: 'Studio layout' });
    await wait(
      () => prefs.catalog().layouts[0].name === 'Studio layout',
      'Workspace rename failed',
    );
    await wait(
      () => document.querySelector('#dialog h2').textContent === 'Workspaces',
      'Rename did not return to manager',
    );
    document.querySelector('#dialog').close();
    const beforeWorlds = panes().map((pane) => pane.querySelector('.canvas-world'));
    failLibrary = true;
    await context(folder('Research'), 'rename');
    await submit({ name: 'References' });
    await wait(
      () => document.querySelector('#toast').textContent.includes('Simulated library failure'),
      'Library failure missing',
    );
    assert(!!folder('Research') && !folder('References'), 'Failed folder move changed the tree');
    failLibrary = false;
    await submit({ name: 'References' });
    await wait(() => !!folder('References/Scans'), 'Folder rename did not update descendants');
    assert(
      panes().every((pane, index) => pane.querySelector('.canvas-world') === beforeWorlds[index]),
      'Folder rename rebuilt document DOM',
    );
    await context(folder('References'), 'move');
    await submit({ destination: 'Studio' });
    await wait(() => !!folder('Studio/References/Scans'), 'Folder reparent failed');
    await drag(row('features-beta'), folder('Studio/References/Empty'));
    await wait(
      async () =>
        libraryInfo((await backend.loadDocuments()).find((doc) => doc.id === 'features-beta'))
          .folder === 'Studio/References/Empty',
      'Document drop failed',
    );
    const beforeCycle = JSON.stringify((await backend.getMeta('library:1')).value);
    await drag(folder('Studio/References'), folder('Studio/References/Scans'));
    await wait(
      () => document.querySelector('#toast').textContent.includes('inside itself'),
      'Cyclic drop was not rejected',
    );
    assert(
      JSON.stringify((await backend.getMeta('library:1')).value) === beforeCycle,
      'Cyclic drop changed folder metadata',
    );
    assert(
      !document.querySelector('.library-drop-target'),
      'Drop highlight remained after completion',
    );
    await drag(folder('Studio/References'), document.querySelector('#document-list'));
    await wait(() => !!folder('References/Empty'), 'Folder drop to root failed');
    const retainedGraph = document.querySelector('.graph-stage');
    click(document.querySelector('[data-action=sidebar-bookmarks]'));
    await wait(
      () => !document.querySelector('#search').closest('.sidebar-search').hidden,
      'Bookmark search is hidden',
    );
    const search = document.querySelector('#search');
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    assert(
      !!row('features-alpha') && !row('features-beta'),
      'Bookmark search did not filter documents',
    );
    assert(
      document.querySelector('.graph-stage') === retainedGraph,
      'Bookmark search replaced an independent graph view',
    );
    click(document.querySelector('[data-action=sidebar-files]'));
    await nativeCommand('workspaces');
    const beforeUpdateForm = document.querySelector('#dialog form');
    menuChoices.push('replace');
    click(document.querySelector('[data-workspace-menu]'));
    await wait(
      () => document.querySelector('#dialog form') !== beforeUpdateForm,
      'Workspace update failed',
    );
    document.querySelector('#dialog').close();
    assert(await prepareClose(), 'Final view save failed');
    assert(
      (await backend.loadDocuments()).map(sourceShape).join('|') === expectedSources.join('|'),
      'Workspace/library operations changed authored source',
    );
    await context(folder('References'), 'folder');
    await wait(
      () => document.querySelector('#dialog h2').textContent === 'New folder',
      'Nested folder creation missing',
    );
    assert(
      field('folder').value === 'References/' &&
        field('folder').selectionStart === field('folder').value.length,
      'Nested folder prefix/caret missing',
    );
    await submit({ folder: 'References/Subfolder' });
    await wait(() => !!folder('References/Subfolder'), 'Nested folder not created');
    await context(folder('References/Subfolder'), 'document');
    await wait(
      async () => (await backend.loadDocuments()).length === 3,
      'Document in folder not created',
    );
    const created = (await backend.loadDocuments()).find(
      (doc) => !['features-alpha', 'features-beta'].includes(doc.id),
    );
    assert(
      libraryInfo(created).folder === 'References/Subfolder',
      'New document went to the wrong folder',
    );
    assert(await prepareClose(), 'Created document did not flush');
    sessionStorage.setItem(
      'features-source',
      JSON.stringify((await backend.loadDocuments()).map(sourceShape)),
    );
    if (new URL(location.href).searchParams.has('capture')) {
      console.log('IVO_WORKSPACE_FEATURES_CAPTURE');
      await wait(() => globalThis.ivoWorkspaceFeaturesCaptured, 'Capture missing');
    }
    sessionStorage.setItem('features-reloaded', 'true');
    location.reload();
  }
} catch (error) {
  console.log(
    'IVO_WORKSPACE_FEATURES_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
