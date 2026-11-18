import { createInstalledFontLibrary } from '../features/editor/assets/installed-fonts.js';
import { prepareVaultFonts } from '../rendering/text/fonts.js';
import { dialogMarkup, installDialogDismissal } from '../shared/ui/dialog.js';
import { normalizePanels } from '../domain/workspace/panels.js';
import { presentStartup, afterStartupPaint } from './startup.js';
import { createLibraryOperations } from './library-operations.js';
import { planLibraryChange, remapFolder } from '../domain/documents/library-commands.js';
import { showFolderActions } from '../features/workspace/library-menus.js';
import { installLibraryDrag } from '../features/workspace/library-drag.js';
import { createWorkspaceManager } from './workspace-manager.js';
import { showWorkspaceManager } from '../features/workspace/manager-dialog.js';
import { createWorkspacePreferences } from '../storage/workspace-preferences.js';
import { normalizeChrome, DEFAULT_SIDEBAR_WIDTH } from '../domain/workspace/chrome.js';
import { adjacentPane } from '../domain/workspace/spatial.js';
import { receiveTab } from '../domain/workspace/transfer.js';
import { installSidebar, isSidebarOpen } from '../features/workspace/sidebar.js';
import { CURRENT_ARCHIVE_VERSION } from '../domain/documents/capabilities.js';
import { showQuickSwitcher } from '../features/workspace/quick-switcher.js';
import { createPassiveRefresh } from './passive-refresh.js';
import * as workspaceViews from '../features/workspace/views.js';
import { actionButton as button } from '../shared/ui/controls.js';
import {
  libraryInfo,
  setLibraryInfo,
  isTrashed,
  normalizeFolder,
  normalizeLibraryMeta,
  folderPaths,
} from '../domain/documents/library.js';
import { showNavigationMenu } from '../features/workspace/menu.js';
import { startTextFlow } from '../domain/documents/text-flows.js';
import {
  createWorkspace,
  normalizeWorkspace,
  activeTab,
  addTab,
  replaceTab,
  closeTab,
  reopenTab,
  untitledName,
  moveTab,
  pinTab,
  groupTabs,
  groupForTab,
  activeGroup,
  activateTab,
  splitGroup,
  mergeGroup,
  moveTabToGroup,
  setSplitRatio,
  navigateHistory,
  canNavigate,
  syncLinkedViews,
} from '../domain/workspace/state.js';
import { prepareTextFlowFonts } from '../rendering/text/flow-layout.js';
import {
  copyDocument,
  isTemplate,
  createUserTemplate,
  instantiateTemplate,
} from '../domain/documents/copy.js';
import { rememberDocument, readRecentDocuments } from '../domain/knowledge/navigation.js';
import { createPDFSnapshot } from '../features/export/pdf-plan.js';
import { icon, installReferenceCursors } from '../shared/ui/icons.js';
import { installTooltips } from '../shared/ui/tooltips.js';
import { installTabBar } from '../features/workspace/tabs.js';
import { installWorkspaceLayout } from '../features/workspace/layout.js';

import { createTransitionQueue } from '../shared/async/transition-queue.js';
import { buildIndex, filterDocuments, localGraph } from '../domain/knowledge/index.js';
import { validateImport } from '../domain/documents/schema.js';
import { exportMarkdown } from '../features/export/markdown.js';
import { archiveVersion, markTypographyVersion } from '../domain/documents/capabilities.js';
import {
  createSceneDocument,
  isSceneDocument,
  upgradeDocument,
  insertObject,
} from '../domain/documents/scene.js';
import { mountCanvasEditor } from '../features/editor/canvas-editor.js';
import {
  loadDocuments,
  saveDocument,
  changeLibrary,
  loadAssets,
  saveAsset,
  getMeta,
  putMeta,
  saveImport,
  snapshot,
  loadHistory,
} from '../storage/store.js';
import { escapeHTML as esc, cleanHTML, safeURL } from '../shared/html/sanitize.js';
import { mountGraph } from '../features/graph/view.js';
import { createDocumentSession } from './document-session.js';
import { initializePlatform } from '../platform/initialize.js';

/** One application instance per native/browser window. Authored data and view state have separate owners. */
export function startApplication({ root, dialog }) {
  installReferenceCursors(document.documentElement);
  installTooltips(root, { exclude: '.scene-editor' });

  let trashedDocs = [],
    sidebarMode = 'files',
    libraryMeta = { version: 1, folders: [] },
    sortMode = 'name',
    windowLease = true,
    windowInfo = null,
    windowRefreshing = false;
  const collapsedFolders = new Set();
  let docs = [],
    assets = new Map(),
    activeId = '',
    view = 'document',
    editing = false,
    query = '',
    bookmarkQuery = '',
    tag = '',
    graphScope = 'global',
    graphDepth = 1,
    showTags = true,
    graphHandle,
    canvasHandle,
    fontLibrary;
  let workspace = createWorkspace(),
    vaultInfo = { name: 'Local vault', manager: false },
    workspaceTimer,
    lastWorkspace = '',
    titleComposing = false,
    pendingTabRestore = null;
  let workspacePreferences,
    sidebarController = null,
    preferredSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  const titleWaiters = [];
  let initialized = false,
    startupPresented = false;
  let recentDocuments = [];
  try {
    recentDocuments = readRecentDocuments(localStorage);
  } catch {}
  function rememberCurrent() {
    if (!current()) return;
    recentDocuments = rememberDocument(recentDocuments, current().id);
    try {
      localStorage.setItem('ivo:recent-documents', JSON.stringify(recentDocuments));
    } catch {}
  }
  let toastTimer, linkResolve;
  const panes = new Map(),
    paneGroups = new Map();
  let layoutController = null,
    rendering = false,
    mirrorScheduled = false;
  let panelLayout;
  try {
    panelLayout = normalizePanels(JSON.parse(localStorage.getItem('ivo:workspace-panels:1')));
  } catch {
    panelLayout = normalizePanels();
  }
  const mirrorDocuments = new Set();
  const documentHistory = (id = current()?.id) => documentSession.history(id);
  const transitions = createTransitionQueue({
    onBusy: (busy) => {
      for (const pane of panes.values()) pane.canvas?.setBusy(busy);
      if (!busy && pendingTabRestore) {
        const pending = pendingTabRestore;
        pendingTabRestore = null;
        if (pending.handle === canvasHandle && pending.id === workspace.active) {
          canvasHandle.restoreView(pending.view);
          const pane = panes.get(workspace.active);
          if (pane) pane.suspended = false;
        }
      }
      updateNativeHistory();
    },
  });
  function chromeState() {
    return normalizeChrome({
      sidebarWidth: preferredSidebarWidth,
      sidebarCollapsed: document.body.classList.contains('sidebar-collapsed'),
      sidebarMode,
      sortMode,
      collapsedFolders: [...collapsedFolders],
      query,
      bookmarkQuery,
      tag,
      graphScope,
      graphDepth,
      showTags,
      panelLayout,
    });
  }
  function applyChrome(value) {
    const next = normalizeChrome(value);
    preferredSidebarWidth = next.sidebarWidth;
    sidebarMode = next.sidebarMode;
    sortMode = next.sortMode;
    collapsedFolders.clear();
    next.collapsedFolders.forEach((folder) => collapsedFolders.add(folder));
    query = next.query;
    bookmarkQuery = next.bookmarkQuery;
    tag = next.tag;
    graphScope = next.graphScope;
    graphDepth = next.graphDepth;
    showTags = next.showTags;
    panelLayout = next.panelLayout;
    document.body.classList.toggle('sidebar-collapsed', next.sidebarCollapsed);
    sidebarController?.refresh();
  }
  function persistChrome() {
    try {
      workspacePreferences?.writeChrome(chromeState());
    } catch (error) {
      toast('Could not save workspace preferences: ' + error.message);
    }
  }
  async function applyWorkspaceLayout(saved) {
    const nextWorkspace = normalizeWorkspace(saved.workspace, docs);
    await putMeta('workspace:1', nextWorkspace);
    for (const pane of panes.values()) {
      pane.canvas?.destroy();
      pane.graph?.destroy();
    }
    panes.clear();
    paneGroups.clear();
    layoutController?.destroy();
    layoutController = null;
    sidebarController?.destroy();
    sidebarController = null;
    graphHandle = null;
    canvasHandle = null;
    pendingTabRestore = null;
    workspace = nextWorkspace;
    applyChrome(saved.chrome);
    root.innerHTML = '';
    lastWorkspace = JSON.stringify(nextWorkspace);
    adoptTab();
    render();
  }
  const workspaceManager = createWorkspaceManager({
    preferences: () => workspacePreferences,
    getWorkspace: () => workspace,
    getChrome: chromeState,
    getDocuments: () => docs,
    capture: captureAllTabs,
    flush,
    apply: applyWorkspaceLayout,
    allowed: () => windowLease,
  });
  function manageWorkspaces() {
    showWorkspaceManager({
      dialog,
      showDialog,
      manager: workspaceManager,
      run: (task) => transitions.run(task),
      onError: (error) => toast(error.message),
    });
  }
  const tabBar = installTabBar(root, {
    nativeMenu: globalThis.ivoNative?.showNavigationMenu
      ? (items, options) => showNavigationMenu(items, options)
      : undefined,
    onAction: (action, id) =>
      transitions.run(() => tabAction(action, id)).catch((error) => toast(error.message)),
    getActions: (id) => tabDocumentActions(id),
    canAction: (name) =>
      name === 'open-new-window' ? !!globalThis.ivoNative?.windows : windowLease,
    onDetach: globalThis.ivoNative?.windows
      ? (id, position) =>
          transitions
            .run(() => openWindowForTab(id, { move: true, position }))
            .catch((error) => toast(error.message))
      : undefined,
    onDrag: globalThis.ivoNative?.windows?.drag
      ? (phase, payload) =>
          globalThis.ivoNative.windows.drag(phase, { ...payload, title: payload.label })
      : undefined,
    getTabs: (groupId) => groupTabs(workspace, groupId || activeGroup(workspace).id),
    allowed: () =>
      windowLease &&
      !transitions.busy &&
      !dialog.open &&
      !titleComposing &&
      !canvasHandle?.getState().composing &&
      !vaultInfo.manager,
    onMove: (id, index, targetGroup) => {
      const cross = targetGroup && groupForTab(workspace, id)?.id !== targetGroup;
      const apply = () => {
        captureAllTabs();
        const changed = cross
          ? moveTabToGroup(workspace, id, targetGroup, index)
          : moveTab(workspace, id, index);
        if (changed) {
          if (cross) {
            adoptTab();
            render();
          } else renderTabs();
          scheduleWorkspace();
        }
      };
      if (cross)
        transitions
          .run(async () => {
            if (await flush()) apply();
            else renderTabs();
          })
          .catch((error) => {
            renderTabs();
            toast(error.message);
          });
      else apply();
    },
    onPin: (id, value) => {
      captureTab();
      if (pinTab(workspace, id, value)) {
        renderTabs();
        scheduleWorkspace();
      }
    },
    onClose: (id) => transitions.run(() => closeTabNow(id)),
    onSplit: (id, axis) =>
      transitions.run(async () => {
        await activateTabNow(id);
        await splitNow(axis);
      }),
    onError: (error) => toast(error.message),
  });
  const current = () => docs.find((d) => d.id === activeId) || docs[0];
  const allDocuments = () => [...docs, ...trashedDocs];
  function receiveDocuments(documents) {
    const canonical = documents.map(cleanDocument);
    docs.splice(0, docs.length, ...canonical.filter((doc) => !isTrashed(doc)));
    trashedDocs.splice(0, trashedDocs.length, ...canonical.filter(isTrashed));
  }
  const source = (src) =>
    src?.startsWith('asset:') ? assets.get(src.slice(6))?.data || '' : safeURL(src);
  function toast(message) {
    const el = document.querySelector('#toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3400);
  }
  function setSaveStatus(label, error = false) {
    for (const el of root.querySelectorAll('[data-save-status]')) {
      el.textContent = label;
      el.classList.toggle('error', error);
    }
  }
  const activeTitle = () =>
    panes.get(workspace.active)?.element.querySelector('[data-document-title]');
  const documentSession = createDocumentSession({
    save: saveDocument,
    snapshot,
    onStatus: (state) =>
      setSaveStatus(
        state === 'error' ? 'Save failed' : state === 'pending' ? 'Saving…' : 'Saved',
        state === 'error',
      ),
    onError: (error) => toast('Could not save: ' + error.message),
    onChanged: (id) => scheduleMirrors(id),
  });
  const saves = documentSession.saves;
  function changed(document = current()) {
    documentSession.changed(document);
  }

  function commitDocument(id, tabId, before, metadata = {}) {
    const doc = docs.find((doc) => doc.id === id);
    if (!doc) return;
    markTypographyVersion(doc);
    const tagged = {
      ...metadata,
      viewBefore: metadata.viewBefore && { ...metadata.viewBefore, tabId },
      viewAfter: metadata.viewAfter && { ...metadata.viewAfter, tabId },
      mergeKey: metadata.mergeKey ? tabId + ':' + metadata.mergeKey : null,
    };
    if (documentHistory(id).record(before, doc, tagged)) changed(doc);
    updateNativeHistory();
  }
  function committed(before, metadata = {}) {
    commitDocument(activeId, workspace.active, before, metadata);
  }
  function performHistory(direction) {
    if (transitions.busy || dialog.open || !canvasHandle?.prepareHistory()) return;
    const viewNow = canvasHandle.captureView(),
      result = documentHistory()[direction](current());
    if (!result) return;
    const previousVersion = current().version;
    docs[docs.findIndex((d) => d.id === activeId)] = {
      ...result.document,
      version: previousVersion,
    };
    changed();
    canvasHandle.restoreView(
      result.view?.tabId && result.view.tabId !== workspace.active ? viewNow : result.view,
    );
    metadataChanged();
    updateNativeHistory();
  }
  function captureTab() {
    const tab = activeTab(workspace);
    if (!tab) return;
    tab.kind = view;
    tab.docId = activeId || null;
    tab.editing = editing;
    const pane = panes.get(workspace.active);
    if (graphHandle) tab.graphState = graphHandle.captureView();
    if (canvasHandle) {
      tab.canvasState = canvasHandle.getState();
      if (!pane?.suspended || tab.canvasState.activeTextId) {
        tab.textView = canvasHandle.captureView();
        if (pane) pane.suspended = false;
      }
    }
  }
  function captureAllTabs() {
    captureTab();
    for (const pane of panes.values()) {
      if (pane.tabId === workspace.active) continue;
      const tab = workspace.tabs.find((tab) => tab.id === pane.tabId);
      if (tab && pane.graph) tab.graphState = pane.graph.captureView();
      if (tab && pane.canvas)
        tab.canvasState = {
          ...pane.canvas.getState(),
          activeTextId: tab.textView?.activeTextId || null,
        };
    }
  }
  function scheduleMirrors(id) {
    mirrorDocuments.add(id);
    if (mirrorScheduled) return;
    mirrorScheduled = true;
    queueMicrotask(() => {
      mirrorScheduled = false;
      const ids = new Set(mirrorDocuments);
      mirrorDocuments.clear();
      for (const pane of panes.values()) {
        if (pane.docId && ids.has(pane.docId) && pane.tabId !== workspace.active)
          pane.canvas?.refreshExternal();
        if (workspace.tabs.find((tab) => tab.id === pane.tabId)?.kind === 'backlinks') {
          pane.key = null;
          renderView(
            groupForTab(workspace, pane.tabId),
            workspace.tabs.find((tab) => tab.id === pane.tabId),
          );
        }
        if (pane.graph) {
          const tab = workspace.tabs.find((tab) => tab.id === pane.tabId),
            signature = JSON.stringify(graphIndex(tab));
          if (signature !== pane.graphSignature) {
            if (tab) tab.graphState = pane.graph.captureView();
            pane.key = null;
            renderPane(workspace.groups.find((group) => group.id === pane.id));
          }
        }
      }
    });
  }

  async function saveWorkspace() {
    if (!initialized || vaultInfo.manager) return;
    captureAllTabs();
    persistChrome();
    const value = normalizeWorkspace(workspace, docs),
      signature = JSON.stringify(value);
    if (signature === lastWorkspace) return;
    await putMeta('workspace:1', value);
    lastWorkspace = signature;
  }
  function scheduleWorkspace() {
    clearTimeout(workspaceTimer);
    workspaceTimer = setTimeout(
      () => saveWorkspace().catch((error) => toast('Could not save workspace: ' + error.message)),
      250,
    );
  }
  function commitTitle(element = activeTitle()) {
    if (!windowLease || !element || element.dataset.documentTitle !== activeId || titleComposing)
      return;
    const doc = current(),
      title = element.value.trim().slice(0, 180) || doc.title || 'Untitled';
    element.value = title;
    element.dataset.editing = 'false';
    if (title === doc.title) return;
    const before = structuredClone(doc);
    doc.title = title;
    committed(before, {
      label: 'Rename document',
      viewBefore: canvasHandle?.captureView(),
      viewAfter: canvasHandle?.captureView(),
    });
    metadataChanged();
  }
  async function flush() {
    if (!initialized || vaultInfo.manager) return true;
    if (titleComposing) {
      document.activeElement?.blur();
      if (titleComposing) await new Promise((resolve) => titleWaiters.push(resolve));
    }
    commitTitle();
    for (const pane of panes.values()) await pane.canvas?.flush();
    if (!(await saves.flush())) return false;
    try {
      await saveWorkspace();
      return true;
    } catch (error) {
      toast('Could not save workspace: ' + error.message);
      return false;
    }
  }
  function cleanDocument(document) {
    for (const textFlow of document.textFlows || []) textFlow.html = cleanHTML(textFlow.html);
    document.blocks = document.blocks.map((block) => ({
      ...block,
      html: cleanHTML(block.html || ''),
    }));
    return document;
  }
  function ensureScene(id = activeId) {
    let document = docs.find((doc) => doc.id === id);
    if (document?.canvasVersion !== undefined && !isSceneDocument(document))
      throw new Error('This document needs a newer version of Ivo.');
    if (document && !isSceneDocument(document)) {
      documentSession.preserveLegacy(document);
      document = upgradeDocument(document);
      docs[docs.findIndex((d) => d.id === document.id)] = document;
    }
    return document;
  }
  function sidebarDocuments() {
    const list =
      sidebarMode === 'trash'
        ? trashedDocs
        : sidebarMode === 'bookmarks'
          ? docs.filter((doc) => libraryInfo(doc).bookmarked)
          : docs;
    return filterDocuments(list, sidebarMode === 'bookmarks' ? bookmarkQuery : query, tag).sort(
      (a, b) =>
        sortMode === 'updated'
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }

  function fileTree() {
    return workspaceViews.fileTree({
      list: sidebarDocuments(),
      sidebarMode,
      query,
      tag,
      docs,
      libraryMeta,
      collapsedFolders,
      activeId,
      view,
    });
  }
  function ribbon() {
    return workspaceViews.ribbon();
  }
  function sidebar() {
    return workspaceViews.sidebar({
      sidebarMode,
      hidden: !isSidebarOpen(),
      query: sidebarMode === 'bookmarks' ? bookmarkQuery : query,
      tag,
      docs,
      vaultInfo,
      tree: fileTree(),
    });
  }
  function toolbar(group = activeGroup(workspace)) {
    return workspaceViews.toolbar({ group, workspace, docs });
  }
  function renderLibrary() {
    return workspaceViews.renderLibrary({ docs, query, tag });
  }
  function graphIndex(tab = activeTab(workspace)) {
    const all = buildIndex(docs),
      neighborhood =
        tab.linkedTo || (tab.graphScope || graphScope) === 'local'
          ? localGraph(all, tab.docId, graphDepth)
          : all,
      allowed = new Set(filterDocuments(docs, query, tag).map((d) => d.id)),
      nodes = neighborhood.nodes.filter((n) => allowed.has(n.id)),
      ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: neighborhood.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  }
  function renderGraph(tab) {
    return workspaceViews.renderGraph({
      docs,
      graphScope: tab?.linkedTo ? 'local' : tab?.graphScope || graphScope,
      graphDepth,
      showTags,
      linked: !!tab?.linkedTo,
    });
  }
  function paneContentId(group) {
    return workspaceViews.paneContentId(group, workspace);
  }
  function tabMarkup(group = activeGroup(workspace)) {
    return workspaceViews.tabMarkup({ group, workspace, docs });
  }
  function renderTabs() {
    tabBar.cancel();
    for (const group of workspace.groups) {
      const bar = paneGroups.get(group.id)?.element.querySelector('.document-tabs');
      if (bar) bar.innerHTML = tabMarkup(group);
    }
    sidebarController?.refreshHeader();
  }

  function windowTitle(title) {
    return title + (vaultInfo.id ? ' — ' + vaultInfo.name : '') + ' — Ivo';
  }
  function metadataChanged() {
    document.title = windowTitle(current()?.title || 'Ivo');
    for (const input of root.querySelectorAll('[data-document-title]')) {
      const doc = docs.find((doc) => doc.id === input.dataset.documentTitle);
      if (doc && document.activeElement !== input) input.value = doc.title;
    }
    const list = root.querySelector('#document-list');
    if (list) list.innerHTML = fileTree();
    renderTabs();
  }
  function renderEmpty() {
    return workspaceViews.renderEmpty();
  }
  function ensureShell() {
    if (root.querySelector('.workspace-layout')) return;
    root.innerHTML = `${workspaceViews.windowHeader()}${ribbon()}${sidebar()}<div class="app-main page-workspace"><main class="workspace-layout" aria-label="Document workspace"></main></div>`;
    sidebarController?.destroy();
    sidebarController = installSidebar(root, {
      getWidth: () => preferredSidebarWidth,
      onChange: (width) => {
        preferredSidebarWidth = width;
        scheduleWorkspace();
      },
      prepare: () => {
        canvasHandle?.finish();
        captureTab();
      },
      allowed: () =>
        windowLease &&
        !transitions.busy &&
        !dialog.open &&
        !titleComposing &&
        !canvasHandle?.getState().composing,
    });
    layoutController?.destroy();
    layoutController = installWorkspaceLayout(root.querySelector('.workspace-layout'), {
      createPane: (id) => {
        let group = paneGroups.get(id);
        if (!group) {
          const element = document.createElement('section');
          element.className = 'workspace-pane';
          element.dataset.workspaceGroup = id;
          element.innerHTML =
            '<nav class="document-tabs" role="tablist" aria-label="Open documents"></nav><div class="workspace-view-deck"></div>';
          group = { id, element };
          paneGroups.set(id, group);
        }
        return group.element;
      },
      onRatio: (id, value) => {
        setSplitRatio(workspace, id, value);
        scheduleWorkspace();
      },
      prepare: () => {
        canvasHandle?.finish();
        captureTab();
      },
      allowed: () =>
        windowLease && !transitions.busy && !dialog.open && !canvasHandle?.getState().composing,
    });
  }
  function attachSaveStatus(pane) {
    const footer = pane.element.querySelector('.canvas-status,.graph-footer');
    if (!footer || footer.querySelector('[data-save-status]')) return;
    const status = document.createElement('span');
    status.className = 'save-status';
    status.dataset.saveStatus = '';
    status.setAttribute('role', 'status');
    status.textContent = saves.dirty ? 'Saving…' : 'Saved';
    footer.insertBefore(status, footer.querySelector('.canvas-zoom'));
  }
  function renderPane(group) {
    if (!group) return;
    const owner = paneGroups.get(group.id),
      deck = owner?.element.querySelector('.workspace-view-deck');
    if (!deck) return;
    const visible = group.stacked
      ? groupTabs(workspace, group.id)
      : [workspace.tabs.find((tab) => tab.id === group.active)];
    owner.element.classList.toggle('tabs-stacked', !!group.stacked);
    for (const [index, tab] of visible.entries()) {
      let pane = panes.get(tab.id);
      if (!pane) {
        const element = document.createElement('section');
        element.className = 'workspace-view';
        element.dataset.workspaceTab = tab.id;
        element.innerHTML =
          '<button class="stack-tab-spine"></button><header class="view-header"></header><div class="workspace-pane-content" role="tabpanel"></div>';
        pane = {
          id: group.id,
          tabId: tab.id,
          element,
          key: null,
          canvas: null,
          graph: null,
          suspended: true,
        };
        panes.set(tab.id, pane);
      }
      pane.id = group.id;
      const spine = pane.element.querySelector('.stack-tab-spine');
      spine.dataset.stackTab = tab.id;
      spine.textContent = workspaceViews.tabTitle(tab, docs);
      spine.setAttribute('aria-label', 'Activate ' + workspaceViews.tabTitle(tab, docs));
      pane.element.style.setProperty('--stack-order', Math.min(index, 8));
      if (deck.children[index] !== pane.element)
        deck.insertBefore(pane.element, deck.children[index] || null);
      renderView(group, tab);
    }
  }
  function renderView(group, tab) {
    const pane = panes.get(tab.id);
    if (!pane) return;
    const key = [
      tab.id,
      tab.kind,
      tab.docId,
      tab.editing,
      tab.linkedTo || '',
      tab.kind === 'graph'
        ? JSON.stringify([tab.graphScope || graphScope, graphDepth, showTags, query, tag])
        : '',
    ].join('|');
    if (key === pane.key) return;
    pane.canvas?.destroy();
    pane.graph?.destroy();
    pane.canvas = null;
    pane.graph = null;
    pane.key = key;
    pane.tabId = tab.id;
    pane.docId = tab.kind === 'document' ? tab.docId : null;
    pane.suspended = true;
    const content = pane.element.querySelector('.workspace-pane-content');
    if (!pane.element.clientWidth && tab.id !== workspace.active) {
      pane.key = null;
      content.innerHTML = '';
      return;
    }
    content.innerHTML =
      tab.kind === 'graph'
        ? renderGraph(tab)
        : tab.kind === 'backlinks'
          ? workspaceViews.renderBacklinks({ docs, tab })
          : tab.kind === 'library'
            ? renderLibrary()
            : tab.kind === 'empty'
              ? renderEmpty()
              : '<main data-canvas-host></main>';
    if (tab.kind === 'document') {
      ensureScene(tab.docId);
      const id = tab.docId;
      pane.canvas = mountCanvasEditor(content.querySelector('[data-canvas-host]'), {
        getDocument: () => docs.find((doc) => doc.id === id),
        documents: docs,
        index: () => buildIndex(docs),
        editing: tab.editing,
        sessionId: tab.id,
        panelLayout,
        panelPresets: workspacePreferences,
        onPanelLayout: (layout) => {
          panelLayout = normalizePanels(layout);
          for (const other of panes.values())
            if (other !== pane) other.canvas?.setPanelLayout(panelLayout);
          scheduleWorkspace();
        },
        initialState: tab.canvasState,
        isActive: () => windowLease && workspace.active === tab.id,
        source,
        fonts: () => [...assets.values()].filter((asset) => asset.font),
        assets: () => [...assets.values()],
        systemFonts: () => fontLibrary?.rows || [],
        refreshSystemFonts: async () => {
          await fontLibrary.load(true);
          for (const other of panes.values()) other.canvas?.refreshFonts();
        },
        resolveFont: (value) => fontLibrary.resolve(value),
        prepareDocumentFonts: (doc) => fontLibrary.prepareDocument(doc),
        ensureFontVariant: (id, bold, italic) => fontLibrary.ensureVariant(id, bold, italic),
        onCommit: (before, metadata) => commitDocument(id, tab.id, before, metadata),
        onChange: () => changed(docs.find((doc) => doc.id === id)),
        onOpen: (id, options) =>
          openDocument(id, {
            ...options,
            newTab: !!tab.linkedTo || options?.newTab,
            groupId: groupForTab(workspace, tab.id)?.id,
          }),
        onUndo: () => performHistory('undo'),
        onRedo: () => performHistory('redo'),
        onLink: linkDialog,
        onNotify: toast,
        onMetadata: metadataChanged,
        onAsset: async (asset) => {
          await saveAsset(asset);
          assets.set(asset.id, asset);
          await prepareVaultFonts([...assets.values()]);
        },
        onRequestEdit: async (files) => {
          const owner = tab.id;
          await runAction('toggle-edit');
          if (workspace.active === owner) canvasHandle?.addFiles(files);
        },
      });
      pane.canvas.setBusy(transitions.busy);
      const bookmark = tab.textView?.activeTextId
        ? tab.textView
        : tab.canvasState?.activeTextId
          ? { ...tab.canvasState, activeTextId: tab.canvasState.activeTextId }
          : null;
      if (bookmark && tab.editing) {
        if (tab.id === workspace.active) {
          if (transitions.busy)
            pendingTabRestore = {
              handle: pane.canvas,
              id: tab.id,
              view: structuredClone(bookmark),
            };
          else {
            pane.canvas.restoreView(bookmark);
            pane.suspended = false;
          }
        } else pane.canvas.restoreView(bookmark, { focus: false });
      }
    } else if (tab.kind === 'graph') {
      const stage = content.querySelector('.graph-stage');
      stage.id = group.id === activeGroup(workspace).id ? 'graph-stage' : 'graph-stage-' + group.id;
      pane.graphSignature = JSON.stringify(graphIndex(tab));
      pane.graph = mountGraph(stage, {
        index: graphIndex(tab),
        activeId: tab.docId,
        showTags,
        initialState: tab.graphState,
        onOpen: (id, options) =>
          openDocument(id, {
            ...options,
            newTab: !!tab.linkedTo || options?.newTab,
            groupId: groupForTab(workspace, tab.id)?.id,
          }),
      });
    }
    attachSaveStatus(pane);
  }
  function updatePaneRoles() {
    const groupId = activeGroup(workspace).id;
    for (const group of workspace.groups) {
      const owner = paneGroups.get(group.id);
      if (!owner) continue;
      owner.element.classList.toggle('active', group.id === groupId);
      owner.element.setAttribute('aria-label', 'Pane ' + (workspace.groups.indexOf(group) + 1));
      for (const button of owner.element.querySelectorAll('[data-tab-id]')) {
        const selected = button.dataset.tabId === group.active;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.setAttribute(
          'aria-controls',
          group.stacked ? 'pane-content-' + button.dataset.tabId : paneContentId(group),
        );
        button.closest('.document-tab').classList.toggle('active', selected);
      }
    }
    for (const pane of panes.values()) {
      const tab = workspace.tabs.find((tab) => tab.id === pane.tabId),
        group = groupForTab(workspace, pane.tabId);
      if (!tab || !group) continue;
      const selected = pane.tabId === workspace.active,
        content = pane.element.querySelector('.workspace-pane-content');
      pane.element.classList.toggle('active', selected);
      content.id = group.stacked ? 'pane-content-' + tab.id : paneContentId(group);
      content.setAttribute('aria-labelledby', tab.id);
      const canvas = pane.element.querySelector('[data-canvas-host]');
      if (canvas) canvas.id = selected ? 'canvas-host' : 'canvas-host-' + tab.id;
      const graph = pane.element.querySelector('.graph-stage');
      if (graph) graph.id = selected ? 'graph-stage' : 'graph-stage-' + tab.id;
    }
  }
  function renderChrome() {
    for (const button of root.querySelectorAll('.workspace-ribbon [data-action]'))
      button.classList.toggle(
        'active',
        button.dataset.action === 'graph'
          ? view === 'graph'
          : button.dataset.action === 'sidebar-' + sidebarMode,
      );
    for (const pane of panes.values()) {
      const tab = workspace.tabs.find((tab) => tab.id === pane.tabId),
        group = groupForTab(workspace, pane.tabId),
        header = pane.element.querySelector(':scope > .view-header'),
        headerKey = JSON.stringify([
          tab.id,
          tab.kind,
          tab.docId,
          tab.editing,
          tab.linkedTo || '',
          tab.navigation?.back.length || 0,
          tab.navigation?.forward.length || 0,
          workspace.groups.length,
          docs.find((doc) => doc.id === tab.docId)?.title,
        ]);
      const spine = pane.element.querySelector('.stack-tab-spine');
      spine.textContent = workspaceViews.tabTitle(tab, docs);
      spine.setAttribute('aria-label', 'Activate ' + spine.textContent);
      if (header && pane.headerKey !== headerKey) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = toolbar({ ...group, active: tab.id });
        header.replaceWith(wrapper.firstElementChild);
        pane.headerKey = headerKey;
      }
    }
    document.title = windowTitle(
      view === 'document'
        ? current()?.title || 'Untitled'
        : view === 'empty'
          ? 'New tab'
          : view === 'graph'
            ? 'Graph view'
            : 'Documents',
    );
    const list = root.querySelector('#document-list');
    if (list) list.innerHTML = fileTree();
    updatePaneRoles();
    updateNativeHistory();
    if (saves.state === 'error') setSaveStatus('Save failed', true);
  }

  function render() {
    rendering = true;
    syncLinkedViews(workspace);
    pendingTabRestore = null;
    tabBar.cancel();
    for (const pane of panes.values())
      if (
        pane.canvas &&
        pane.tabId !== workspace.active &&
        (!pane.suspended || pane.canvas.getState().activeTextId)
      ) {
        const tab = workspace.tabs.find((tab) => tab.id === pane.tabId),
          state = pane.canvas.getState(),
          view = pane.canvas.deactivate();
        if (tab && view) {
          tab.canvasState = state;
          tab.textView = view;
        }
        pane.suspended = true;
      }
    ensureShell();
    const aside = document.createElement('div');
    aside.innerHTML = sidebar();
    root.querySelector(':scope > .sidebar')?.replaceWith(aside.firstElementChild);
    const ids = new Set(workspace.groups.map((group) => group.id));
    for (const [id, group] of paneGroups)
      if (!ids.has(id)) {
        group.element.remove();
        paneGroups.delete(id);
      }
    for (const [id, pane] of panes) {
      const group = groupForTab(workspace, id);
      if (!group || (!group.stacked && group.active !== id)) {
        pane.canvas?.destroy();
        pane.graph?.destroy();
        pane.element.remove();
        panes.delete(id);
      }
    }
    layoutController.reconcile(workspace.layout);
    updatePaneRoles();
    for (const group of workspace.groups) renderPane(group);
    adoptTab();
    if (view === 'document') rememberCurrent();
    renderTabs();
    renderChrome();
    revealStackTab(workspace.active);
    rendering = false;
    updateNativeHistory();
    scheduleWorkspace();
  }
  function revealStackTab(id) {
    const group = groupForTab(workspace, id),
      deck = paneGroups.get(group?.id)?.element.querySelector('.workspace-view-deck');
    if (!group?.stacked || !deck) return;
    const index = group.tabIds.indexOf(id),
      cards = [...deck.children];
    deck.scrollLeft = cards
      .slice(0, index)
      .reduce((width, card) => width + card.getBoundingClientRect().width, 0);
  }
  function adoptTab() {
    const tab = activeTab(workspace);
    view = tab.kind;
    activeId = tab.docId || '';
    editing = tab.editing === true;
    const pane = panes.get(workspace.active);
    canvasHandle = pane?.tabId === tab.id ? pane.canvas : null;
    graphHandle = pane?.tabId === tab.id ? pane.graph : null;
    history.replaceState(
      null,
      '',
      view === 'document' ? '#doc=' + encodeURIComponent(activeId) : '#' + view,
    );
  }
  function activatePane(id, { focus = false, tabId } = {}) {
    const group = workspace.groups.find((group) => group.id === id);
    if (!group) return false;
    const targetTab = group.tabIds.includes(tabId) ? tabId : group.active;
    if (targetTab !== workspace.active) {
      commitTitle();
      captureTab();
      const old = activeTab(workspace),
        oldPane = panes.get(workspace.active),
        wasSuspended = oldPane?.suspended,
        viewBefore = canvasHandle?.deactivate();
      if (viewBefore === false) return false;
      if (viewBefore && (!wasSuspended || viewBefore.activeTextId)) old.textView = viewBefore;
      if (oldPane) oldPane.suspended = true;
      documentSession.existingHistory(activeId)?.breakGroup();
      activateTab(workspace, targetTab);
      adoptTab();
      updatePaneRoles();
      renderPane(group);
      adoptTab();
      renderChrome();
      scheduleWorkspace();
    }
    if (focus) {
      revealStackTab(workspace.active);
      const tab = activeTab(workspace),
        pane = panes.get(workspace.active);
      if (pane?.canvas) {
        const view = tab.textView || {
          selection: tab.canvasState?.selection,
          tool: tab.canvasState?.tool,
        };
        if (transitions.busy)
          pendingTabRestore = { handle: pane.canvas, id: tab.id, view: structuredClone(view) };
        else {
          pane.canvas.restoreView(view);
          pane.suspended = false;
        }
      } else
        paneGroups
          .get(id)
          ?.element.querySelector('[role=tab][aria-selected=true]')
          ?.focus({ preventScroll: true });
    }
    return true;
  }
  function openDocument(id, options = {}) {
    return transitions
      .run(() => openDocumentNow(id, options))
      .catch((error) => toast(error.message));
  }
  async function openDocumentNow(
    id,
    { newTab = false, toRight = false, groupId, editing: requestedEditing = false } = {},
  ) {
    if (!docs.some((d) => d.id === id) || !(await flush())) return;
    captureAllTabs();
    if (groupId) {
      const group = workspace.groups.find((group) => group.id === groupId);
      if (group) activateTab(workspace, group.active);
    }
    if (toRight)
      splitGroup(workspace, 'row', { kind: 'document', docId: id, editing: requestedEditing });
    else if (newTab)
      addTab(workspace, {
        kind: 'document',
        docId: id,
        reuseEmpty: true,
        editing: requestedEditing,
      });
    else replaceTab(workspace, 'document', id, requestedEditing);
    adoptTab();
    render();
    document.body.classList.remove('nav-open');
  }
  async function activateTabNow(id) {
    if (workspace.active === id || !workspace.tabs.some((tab) => tab.id === id) || !(await flush()))
      return;
    captureAllTabs();
    const old = activeTab(workspace),
      pane = panes.get(workspace.active),
      wasSuspended = pane?.suspended,
      viewBefore = canvasHandle?.deactivate();
    if (viewBefore && (!wasSuspended || viewBefore.activeTextId)) old.textView = viewBefore;
    if (pane) pane.suspended = true;
    activateTab(workspace, id);
    adoptTab();
    render();
  }
  async function closeTabNow(id = workspace.active) {
    if (!(await flush())) return;
    captureAllTabs();
    closeTab(workspace, id);
    adoptTab();
    render();
  }
  async function splitNow(axis = 'row') {
    if (!(await flush())) return;
    captureAllTabs();
    splitGroup(workspace, axis);
    adoptTab();
    render();
  }
  async function workspaceNavigation(direction) {
    if (!canNavigate(workspace, direction) || !(await flush())) return;
    captureTab();
    if (navigateHistory(workspace, direction)) {
      adoptTab();
      render();
    }
  }

  async function blankTabNow() {
    if (!(await flush())) return;
    captureTab();
    addTab(workspace, { atEnd: true });
    adoptTab();
    render();
  }
  function focusTitle() {
    const id = workspace.active;
    requestAnimationFrame(() => {
      if (workspace.active !== id) return;
      const input = activeTitle();
      input?.focus();
      input?.select();
    });
  }
  function focusBody() {
    const id = activeId;
    requestAnimationFrame(() => {
      if (activeId !== id) return;
      const flow = current()?.textFlows?.length;
      if (flow) canvasHandle?.command('document-text');
      else canvasHandle?.command('tool-text');
    });
  }
  async function createNote(
    title = untitledName(docs),
    { selectTitle = true, toRight = false, folder = '' } = {},
  ) {
    if (toRight && workspace.groups.length >= 8)
      throw new Error('Use up to eight panes in one window.');
    if (!(await flush())) return;
    if (folder && !folderPaths(docs, libraryMeta).includes(normalizeFolder(folder)))
      throw new Error('The destination folder no longer exists.');
    captureTab();
    const doc = createSceneDocument(title),
      p = doc.pages[0],
      frame = insertObject(doc, 'text', p.id, { x: 48, y: 48, w: p.width - 96, h: p.height - 96 });
    startTextFlow(doc, frame.id);
    if (folder) setLibraryInfo(doc, { folder: normalizeFolder(folder) });
    await saveDocument(doc);
    docs.unshift(doc);
    if (toRight) splitGroup(workspace, 'row', { kind: 'document', docId: doc.id, editing: true });
    else addTab(workspace, { kind: 'document', docId: doc.id, editing: true, reuseEmpty: true });
    adoptTab();
    if (dialog.open) dialog.close();
    render();
    if (selectTitle) focusTitle();
    else focusBody();
  }
  async function renderVaultManager() {
    const entries = await globalThis.ivoNative.vaults.list();
    document.title = 'Ivo vaults';
    root.innerHTML = `<main class="vault-manager"><aside><h1>Vaults</h1><div class="vault-list">${entries.map((entry) => `<div class="vault-list-row"><button data-vault-open="${esc(entry.id)}"><strong>${esc(entry.name)}</strong><span>${esc(entry.parent)}</span>${entry.open ? '<small>Open</small>' : ''}</button><button class="icon-button" data-vault-forget="${esc(entry.id)}" ${entry.open ? 'disabled' : ''} aria-label="Remove ${esc(entry.name)} from list" title="Remove from list. Files stay in their folder.">${icon('close')}</button></div>`).join('') || '<p>No vaults added.</p>'}</div></aside><section><div><h2>Create new vault</h2><p>Create an Ivo vault in a folder you choose.</p>${button('vault-create', 'Create')}</div><div><h2>Open folder as vault</h2><p>Open an existing Ivo vault, or initialize an empty folder.</p>${button('vault-choose', 'Open')}</div></section></main>`;
  }
  async function vaultAction(name, id) {
    const api = globalThis.ivoNative?.vaults;
    if (!api) return;
    if (name === 'open') {
      await api.open(id);
      return;
    }
    if (name === 'forget') {
      await api.forget(id);
      await renderVaultManager();
      return;
    }
    if (name === 'vault-choose') {
      const result = await api.choose();
      if (!result.canceled) await renderVaultManager();
      return;
    }
    if (name === 'vault-create') {
      showDialog(
        '<h2>Create vault</h2><label class="dialog-field">Vault name<input name="name" maxlength="80" autofocus autocomplete="off"></label><p class="dialog-note">Choose its location in the next window.</p><button type="submit" class="button-primary">Choose location…</button>',
        async (data) => {
          const name = data.get('name').trim();
          if (!name) return;
          const result = await api.create(name);
          if (!result.canceled) {
            dialog.close();
            await renderVaultManager();
          }
        },
      );
    }
  }
  function showDialog(html, onSubmit, { prompt = false } = {}) {
    dialog.dataset.dialogKind = prompt ? 'prompt' : 'modal';
    dialog.innerHTML = dialogMarkup(html, { prompt });
    dialog.showModal();
    updateNativeHistory();
    if (onSubmit)
      dialog.querySelector('form').addEventListener('submit', (event) => {
        if (event.submitter?.value === 'cancel') return;
        event.preventDefault();
        transitions
          .run(() => onSubmit(new FormData(event.target)))
          .catch((error) => toast(error.message));
      });
  }
  installDialogDismissal(dialog, { canDismiss: () => !transitions.busy });

  function newDocument() {
    const templates = docs.filter(isTemplate);
    showDialog(
      `<h2>New document</h2><label class="dialog-field">Name<input name="title" placeholder="Untitled" maxlength="180" autofocus></label>${templates.length ? `<label class="dialog-field">Template<select name="template"><option value="">Blank</option>${templates.map((doc) => `<option value="${esc(doc.id)}">${esc(doc.title)}</option>`).join('')}</select></label>` : ''}<label class="pdf-scope"><input type="checkbox" name="flow">Flow text across pages</label><div class="dialog-dimensions"><label class="dialog-field">Width · pt<input name="width" type="number" min="72" max="14400" step="any" value="612"></label><label class="dialog-field">Height · pt<input name="height" type="number" min="72" max="14400" step="any" value="792"></label></div><button class="button-primary" type="submit">Create</button>`,
      async (data) => {
        if (!(await flush())) return;
        const template = docs.find((doc) => doc.id === data.get('template') && isTemplate(doc)),
          title = data.get('title').trim() || 'Untitled';
        const doc = template
          ? instantiateTemplate(template, title)
          : createSceneDocument(title, {
              width: Math.max(72, Math.min(14400, Number(data.get('width')) || 612)),
              height: Math.max(72, Math.min(14400, Number(data.get('height')) || 792)),
            });
        if (!template && data.has('flow')) {
          const p = doc.pages[0],
            frame = insertObject(doc, 'text', p.id, {
              x: Math.min(48, p.width / 8),
              y: Math.min(48, p.height / 8),
              w: p.width - Math.min(96, p.width / 4),
              h: p.height - Math.min(96, p.height / 4),
            });
          startTextFlow(doc, frame.id);
        }
        await saveDocument(doc);
        captureTab();
        docs.unshift(doc);
        addTab(workspace, { kind: 'document', docId: doc.id, editing: true, reuseEmpty: true });
        adoptTab();
        dialog.close();
        render();
        if (doc.textFlows?.length)
          requestAnimationFrame(() => canvasHandle?.command('document-text'));
      },
    );
    dialog.querySelector('[name=template]')?.addEventListener('change', (event) => {
      const template = docs.find((doc) => doc.id === event.target.value && isTemplate(doc));
      const flow = dialog.querySelector('[name=flow]');
      flow.disabled = !!template;
      flow.checked = !!template?.textFlows?.length;
      for (const key of ['width', 'height']) {
        const input = dialog.querySelector(`[name=${key}]`);
        input.disabled = !!template;
        if (template) input.value = String(upgradeDocument(template).pages[0][key]);
      }
    });
  }
  function saveTemplateDialog() {
    const owner = activeId;
    showDialog(
      `<h2>Save as template</h2><label class="dialog-field">Name<input name="name" value="${esc(current().title + ' template')}" maxlength="180" autofocus></label><p class="dialog-note">Saves a reusable copy of all pages, objects and formatting. Create documents from it using New document.</p><button type="submit" class="button-primary">Save template</button>`,
      async (data) => {
        if (owner !== activeId || !(await flush())) return;
        const template = createUserTemplate(
          current(),
          data.get('name').trim() || current().title + ' template',
        );
        await saveDocument(template);
        docs.unshift(template);
        dialog.close();
        metadataChanged();
        toast('Template saved');
      },
    );
  }

  function options() {
    showDialog(
      `<h2>Vault options</h2><p>${globalThis.ivoNative?.store ? 'Documents and original media are saved in your vault folder.' : 'Documents and original media are saved on this device.'}</p><div class="options-list">${globalThis.ivoNative?.showFolder ? button('show-folder', 'Show vault folder', 'book') : ''}${globalThis.ivoNative?.vaults ? button('manage-vaults', 'Manage vaults…') : ''}${button('new-layout', 'New layout or template…')}${button('split-right', 'Split right')}${button('split-down', 'Split down')}${workspace.groups.length > 1 ? button('merge-pane', 'Merge this pane') : ''}${button('go-back', 'Back')}${button('go-forward', 'Forward')}${button('export', 'Export vault backup')}${button('import', 'Import atlas backup')}${view === 'document' ? (globalThis.ivoNative?.exportPDF ? button('export-pdf', 'Export PDF…') : '') + button('markdown', 'Export document as Markdown') + button('history', 'Document history') + button('duplicate-document', 'Duplicate document') + button('save-template', 'Save as template…') + button('insert-link', 'Insert document link…') : ''}</div>`,
    );
  }
  function pdfDialog() {
    if (view !== 'document' || !current()) return;
    showDialog(
      `<h2>Export PDF</h2><p>Pages retain their sizes, typography and object placement. Text stays selectable.</p><label class="pdf-scope"><input type="checkbox" name="linked"> Include linked documents</label><p class="dialog-note">Document links work when their targets are included. Links outside this export remain text. Legacy PDF attachment objects must be removed before export; their original files remain in the vault backup.</p><button type="submit" class="button-primary">Export…</button>`,
      async (data) => {
        if (!(await flush())) return;
        const snapshot = createPDFSnapshot(docs, assets, activeId, {
          includeLinked: data.has('linked'),
        });
        const submit = dialog.querySelector('button[type=submit]');
        submit.disabled = true;
        submit.textContent = 'Exporting…';
        try {
          const result = await globalThis.ivoNative.exportPDF(snapshot);
          dialog.close();
          if (!result.canceled) {
            if (result.warnings.length)
              showDialog(
                `<h2>PDF exported</h2><p>${result.pages} pages exported.</p><ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`,
              );
            else toast(`PDF exported · ${result.pages} pages`);
          }
        } finally {
          submit.disabled = false;
          submit.textContent = 'Export…';
        }
      },
    );
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function linkDialog() {
    return new Promise((resolve) => {
      linkResolve = resolve;
      showDialog(
        `<h2>Insert document link</h2><div class="link-options">${
          docs
            .filter((d) => d.id !== activeId)
            .map(
              (d) => `<button type="button" data-link-to="${esc(d.id)}">${esc(d.title)}</button>`,
            )
            .join('') || '<p>Create another document to link to it.</p>'
        }</div><p class="dialog-note">You can also type [[Document name]] in text.</p>`,
      );
    });
  }
  dialog.addEventListener('close', () => {
    linkResolve?.(null);
    linkResolve = null;
    updateNativeHistory();
  });
  async function showHistory() {
    await flush();
    const versions = await loadHistory(activeId);
    showDialog(
      `<h2>Document history</h2><p>Up to 20 editing-session snapshots are retained locally.</p><div class="link-options">${versions.map((v, i) => `<button type="button" data-version="${i}"><span>${esc(v.title)}</span><small>${new Date(v.updatedAt).toLocaleString()}</small></button>`).join('') || '<p>No snapshots yet.</p>'}</div>`,
    );
    dialog.querySelectorAll('[data-version]').forEach((button) =>
      button.addEventListener('click', () =>
        transitions
          .run(async () => {
            await snapshot(current());
            canvasHandle?.destroy();
            canvasHandle = null;
            const document = structuredClone(versions[Number(button.dataset.version)]);
            docs[docs.findIndex((d) => d.id === activeId)] = document;
            documentSession.discardLegacy(activeId);
            changed(document);
            documentHistory().clear();
            dialog.close();
            render();
            toast('Version restored');
          })
          .catch((error) => toast(error.message)),
      ),
    );
  }
  function duplicateDocument(document) {
    return copyDocument(document);
  }
  function refreshSearchViews() {
    for (const pane of panes.values()) {
      const tab = workspace.tabs.find((tab) => tab.id === pane.tabId),
        group = groupForTab(workspace, pane.tabId);
      if (tab.kind === 'library')
        pane.element.querySelector('.document-library').outerHTML = renderLibrary();
      if (tab.kind === 'graph') {
        if (pane.graph) tab.graphState = pane.graph.captureView();
        pane.key = null;
        renderView(group, tab);
      }
    }
    adoptTab();
    updatePaneRoles();
  }
  function renderSidebar() {
    const old = root.querySelector(':scope > .sidebar');
    if (!old) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = sidebar();
    old.replaceWith(wrapper.firstElementChild);
    for (const el of root.querySelectorAll('.workspace-ribbon [data-action^="sidebar-"]'))
      el.classList.toggle('active', el.dataset.action === 'sidebar-' + sidebarMode);
  }
  const libraryOperations = createLibraryOperations({
    flush,
    commit: changeLibrary,
    getDocuments: allDocuments,
    receive: receiveDocuments,
    getLibrary: () => libraryMeta,
    setLibrary: (next, _old, mapping) => {
      libraryMeta = next;
      if (mapping) {
        const names = [...collapsedFolders].map((path) =>
          remapFolder(path, mapping.from, mapping.to),
        );
        collapsedFolders.clear();
        names.forEach((path) => collapsedFolders.add(path));
      }
    },
    record: (before, after) =>
      documentHistory(after.id).record(before, after, { label: 'Move document' }),
    onChanged: (result) => {
      for (const doc of result.documents) scheduleMirrors(doc.id);
      metadataChanged();
      scheduleWorkspace();
    },
  });
  async function folderChange(command) {
    const changed = await libraryOperations.run(command);
    if (changed) {
      dialog.close();
      renderSidebar();
    }
    return changed;
  }
  function folderMenu(path, event) {
    return showFolderActions({
      path,
      event,
      paths: folderPaths(docs, libraryMeta),
      vaultName: vaultInfo.name,
      showDialog,
      onCreateDocument: (folder) => transitions.run(() => createNote(undefined, { folder })),
      onCreateFolder: newFolderDialog,
      onChange: folderChange,
    }).catch((error) => toast(error.message));
  }
  const libraryDrag = installLibraryDrag(root, {
    scope: () => vaultInfo.id || 'browser:' + location.origin,
    allowed: () =>
      sidebarMode === 'files' &&
      !query &&
      !tag &&
      windowLease &&
      !transitions.busy &&
      !dialog.open &&
      !titleComposing &&
      !canvasHandle?.getState().composing,
    onMove: (command) => transitions.run(() => libraryOperations.run(command)),
    onError: (error) => toast(error.message),
  });
  function newFolderDialog(parent = '') {
    showDialog(
      `<h2>New folder</h2><label class="dialog-field">Folder name<input name="folder" maxlength="256" autofocus value="${esc(parent ? parent + '/' : '')}" placeholder="Folder or parent/folder"></label><button type="submit" class="button-primary">Create folder</button>`,
      async (data) => {
        const folder = normalizeFolder(data.get('folder'));
        if (!folder) return;
        const plan = planLibraryChange(allDocuments(), libraryMeta, {
          type: 'create-folder',
          path: folder,
        });
        await putMeta('library:1', plan.library);
        libraryMeta = plan.library;
        sidebarMode = 'files';
        collapsedFolders.delete(folder);
        dialog.close();
        renderSidebar();
      },
    );
    if (parent) {
      const input = dialog.querySelector('[name=folder]');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  async function editDocumentMetadata(id, label, apply) {
    if (!windowLease || !(await flush())) return;
    const doc = docs.find((doc) => doc.id === id);
    if (!doc) return;
    const before = structuredClone(doc);
    apply(doc);
    commitDocument(id, workspace.active, before, { label });
    metadataChanged();
    await saves.flush();
  }
  async function documentAction(name, id) {
    const doc = docs.find((doc) => doc.id === id) || trashedDocs.find((doc) => doc.id === id);
    if (!doc) return;
    if (name === 'open') return openDocumentNow(id);
    if (name === 'open-tab') return openDocumentNow(id, { newTab: true });
    if (name === 'open-right') return openDocumentNow(id, { toRight: true });
    if (name === 'open-window') {
      if (!globalThis.ivoNative?.windows) return;
      return openWindowForTab(null, { documentId: id });
    }
    if (name === 'open-default') {
      if (!(await flush())) return;
      return globalThis.ivoNative?.documents?.openPreview(createPDFSnapshot(docs, assets, id));
    }
    if (name === 'reveal') return globalThis.ivoNative?.documents?.reveal(id);
    if (name === 'copy-relative' || name === 'copy-absolute')
      return globalThis.ivoNative?.documents?.copyPath(
        id,
        name === 'copy-relative' ? 'relative' : 'absolute',
      );
    if (name === 'copy-link') {
      if (!(await flush())) return;
      if (globalThis.ivoNative?.documents?.copyLink) {
        await globalThis.ivoNative.documents.copyLink(id);
        toast('Document link copied');
        return;
      }
      const plain = '[[' + doc.title + ']]',
        html = `<a data-doc-id="${esc(id)}" href="#doc=${encodeURIComponent(id)}">${esc(doc.title)}</a>`;
      if (globalThis.ClipboardItem && navigator.clipboard.write)
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      else await navigator.clipboard.writeText(plain);
      toast('Document link copied');
      return;
    }
    if (name === 'duplicate') {
      if (!windowLease || !(await flush())) return;
      const copy = duplicateDocument(doc);
      setLibraryInfo(copy, { trashedAt: null, bookmarked: false });
      await saveDocument(copy);
      docs.unshift(copy);
      return openDocumentNow(copy.id, { newTab: true, editing: true });
    }
    if (name === 'bookmark')
      return editDocumentMetadata(
        id,
        libraryInfo(doc).bookmarked ? 'Remove bookmark' : 'Bookmark document',
        (value) => setLibraryInfo(value, { bookmarked: !libraryInfo(value).bookmarked }),
      );
    if (name === 'rename') {
      showDialog(
        `<h2>Rename document</h2><label class="dialog-field">Name<input name="name" value="${esc(doc.title)}" maxlength="180" autofocus></label><button class="button-primary" type="submit">Rename</button>`,
        async (data) => {
          const title = data.get('name').trim();
          if (!title) return;
          await editDocumentMetadata(id, 'Rename document', (value) => (value.title = title));
          dialog.close();
        },
      );
      return;
    }
    if (name === 'move') {
      showDialog(
        `<h2>Move document</h2><label class="dialog-field">Folder<select name="folder"><option value="">${esc(vaultInfo.name)}</option>${folderPaths(
          docs,
          libraryMeta,
        )
          .map(
            (folder) =>
              `<option value="${esc(folder)}" ${libraryInfo(doc).folder === folder ? 'selected' : ''}>${esc(folder)}</option>`,
          )
          .join(
            '',
          )}</select></label><label class="dialog-field">Or new folder<input name="newFolder" maxlength="256" placeholder="Folder or parent/folder"></label><button class="button-primary" type="submit">Move</button>`,
        async (data) => {
          const folder = normalizeFolder(data.get('newFolder').trim() || data.get('folder'));
          libraryMeta = normalizeLibraryMeta({
            version: 1,
            folders: [...libraryMeta.folders, folder],
          });
          await putMeta('library:1', libraryMeta);
          await editDocumentMetadata(id, 'Move document', (value) =>
            setLibraryInfo(value, { folder }),
          );
          dialog.close();
        },
      );
      return;
    }
    if (name === 'history') {
      if (!(await flush())) return;
      const versions = await loadHistory(id);
      showDialog(
        `<h2>Version history · ${esc(doc.title)}</h2><div class="link-options">${versions.map((version, index) => `<button type="button" data-library-version="${index}"><span>${esc(version.title)}</span><small>${esc(new Date(version.updatedAt).toLocaleString())}</small></button>`).join('') || '<p>No snapshots yet.</p>'}</div>`,
      );
      dialog.querySelectorAll('[data-library-version]').forEach((button) =>
        button.addEventListener('click', () =>
          transitions
            .run(async () => {
              if (!windowLease || !(await flush())) return;
              const existing = docs.find((doc) => doc.id === id);
              if (!existing) return;
              await snapshot(existing);
              const restored = structuredClone(versions[Number(button.dataset.libraryVersion)]);
              restored.version = existing.version;
              setLibraryInfo(restored, libraryInfo(existing));
              docs[docs.indexOf(existing)] = restored;
              changed(restored);
              documentSession.discardHistory(id);
              for (const pane of panes.values()) if (pane.docId === id) pane.key = null;
              dialog.close();
              render();
            })
            .catch((error) => toast(error.message)),
        ),
      );
      return;
    }
    if (name === 'trash' || name === 'restore') {
      if (!windowLease || !(await flush())) return;
      await snapshot(doc);
      setLibraryInfo(doc, { trashedAt: name === 'trash' ? new Date().toISOString() : null });
      doc.updatedAt = new Date().toISOString();
      doc.version = (doc.version || 1) + 1;
      await saveDocument(doc);
      if (name === 'trash') {
        docs.splice(
          docs.findIndex((value) => value.id === id),
          1,
        );
        trashedDocs.push(doc);
        for (const tab of [...workspace.tabs])
          if (tab.kind === 'document' && tab.docId === id) closeTab(workspace, tab.id);
        workspace = normalizeWorkspace(workspace, docs);
        documentSession.discardHistory(id);
      } else {
        trashedDocs.splice(
          trashedDocs.findIndex((value) => value.id === id),
          1,
        );
        docs.push(doc);
      }
      adoptTab();
      for (const pane of panes.values()) if (pane.graph) pane.key = null;
      render();
      toast(name === 'trash' ? 'Moved to Trash · original source retained' : 'Document restored');
      return;
    }
  }
  function documentMenuItems(id) {
    const doc = docs.find((doc) => doc.id === id) || trashedDocs.find((doc) => doc.id === id);
    if (!doc) return [];
    if (isTrashed(doc)) return [{ id: 'restore', label: 'Restore document' }];
    const native = globalThis.ivoNative;
    return [
      { id: 'open-tab', label: 'Open in new tab' },
      { id: 'open-right', label: 'Open to the right' },
      { id: 'open-window', label: 'Open in new window', enabled: !!native?.windows },
      { type: 'separator' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'move', label: 'Move file to…' },
      { id: 'bookmark', label: libraryInfo(doc).bookmarked ? 'Remove bookmark' : 'Bookmark' },
      { type: 'separator' },
      {
        id: 'copy-path',
        label: 'Copy path',
        submenu: [
          { id: 'copy-link', label: 'Copy document link' },
          { id: 'copy-relative', label: 'Copy vault-relative path', enabled: !!native?.documents },
          { id: 'copy-absolute', label: 'Copy absolute path', enabled: !!native?.documents },
        ],
      },
      { type: 'separator' },
      { id: 'history', label: 'Open version history' },
      ...(native?.documents?.openPreview
        ? [{ id: 'open-default', label: 'Open PDF in default app' }]
        : []),
      { id: 'reveal', label: 'Reveal in Finder', enabled: !!native?.documents },
      { type: 'separator' },
      { id: 'rename', label: 'Rename…' },
      { id: 'trash', label: 'Move to Trash' },
    ];
  }
  async function documentMenu(id, event) {
    if (!windowLease) return;
    const action = await showNavigationMenu(documentMenuItems(id), {
      x: event.clientX,
      y: event.clientY,
      anchor: event.target.closest('[data-open],[data-trash-document]'),
    });
    if (action)
      return transitions
        .run(() => documentAction(action, id))
        .catch((error) => toast(error.message));
  }
  function tabDocumentActions(id) {
    const tab = workspace.tabs.find((tab) => tab.id === id),
      doc = tab?.kind === 'document' && docs.find((doc) => doc.id === tab.docId);
    return [
      {
        action: 'toggle-stack',
        label: groupForTab(workspace, id)?.stacked ? 'Unstack tabs' : 'Stack tabs',
      },
      ...(tab?.linkedTo ? [{ action: 'unlink-view', label: 'Unlink view' }] : []),
      ...(doc
        ? [
            { action: 'linked-graph', label: 'Open linked local graph' },
            { action: 'linked-backlinks', label: 'Open linked backlinks' },
            { action: 'document-rename', label: 'Rename…' },
            { action: 'document-move', label: 'Move file to…' },
            {
              action: 'document-bookmark',
              label: libraryInfo(doc).bookmarked ? 'Remove bookmark' : 'Bookmark',
            },
            { action: 'document-history', label: 'Open version history' },
            ...(globalThis.ivoNative?.documents
              ? [{ action: 'document-reveal', label: 'Reveal in Finder' }]
              : []),
            { action: 'document-trash', label: 'Move to Trash' },
          ]
        : []),
    ];
  }
  async function tabAction(name, id) {
    const tab = workspace.tabs.find((tab) => tab.id === id);
    if (!tab) return;
    if (name.startsWith('document-')) return documentAction(name.slice(9), tab.docId);
    if (name === 'open-new-window') return openWindowForTab(id);
    if (!(await flush())) return;
    captureAllTabs();
    const group = groupForTab(workspace, id);
    if (name === 'toggle-stack') {
      group.stacked = !group.stacked;
      activateTab(workspace, id);
    } else if (name === 'unlink-view') {
      delete tab.linkedTo;
    } else if (['linked-graph', 'linked-backlinks'].includes(name) && tab.kind === 'document') {
      activateTab(workspace, id);
      splitGroup(workspace, 'row', {
        kind: name === 'linked-graph' ? 'graph' : 'backlinks',
        docId: tab.docId,
      });
      activeTab(workspace).linkedTo = id;
    } else if (name === 'new-tab') {
      activateTab(workspace, group.active);
      addTab(workspace, { groupId: group.id, atEnd: true });
    } else if (name === 'duplicate-view') {
      const copy = addTab(workspace, {
        groupId: group.id,
        kind: tab.kind,
        docId: tab.docId,
        editing: tab.editing,
      });
      for (const key of ['canvasState', 'graphState', 'graphScope', 'textView', 'linkedTo'])
        if (tab[key]) copy[key] = structuredClone(tab[key]);
    } else if (name.startsWith('close-')) {
      const ids = [...group.tabIds],
        index = ids.indexOf(id),
        targets = ids.filter((value, at) => {
          const candidate = workspace.tabs.find((tab) => tab.id === value);
          return (
            !candidate.pinned &&
            (name === 'close-all' ||
              (name === 'close-others' && value !== id) ||
              (name === 'close-left' && at < index) ||
              (name === 'close-right' && at > index))
          );
        });
      for (const value of targets) closeTab(workspace, value);
    }
    adoptTab();
    render();
  }
  async function openWindowForTab(id, { move = false, position = {}, documentId } = {}) {
    if (!globalThis.ivoNative?.windows || !(await flush())) return;
    captureAllTabs();
    const tab = id
      ? workspace.tabs.find((tab) => tab.id === id)
      : { id: 'window-view', kind: 'document', docId: documentId, editing: false };
    if (!tab) return;
    await globalThis.ivoNative.windows.open({ tab: structuredClone(tab), move, position });
    if (move) {
      closeTab(workspace, id);
      adoptTab();
      render();
      await saveWorkspace();
      if (workspace.tabs.length === 1 && workspace.tabs[0].kind === 'empty')
        await globalThis.ivoNative.windows.close?.();
    }
  }
  async function viewOptions() {
    const id = workspace.active,
      tab = activeTab(workspace),
      items = [
        { id: 'workspaces', label: 'Workspaces…' },
        {
          id: 'restore-workspace',
          label: 'Restore previous workspace',
          enabled: workspaceManager.canRestorePrevious,
        },
        { type: 'separator' },
        {
          id: 'toggle-stack',
          label: activeGroup(workspace).stacked ? 'Unstack tabs' : 'Stack tabs',
        },
        ...(tab.linkedTo ? [{ id: 'unlink-view', label: 'Unlink view' }] : []),
        ...(tab.kind === 'document'
          ? [
              { id: 'linked-graph', label: 'Open linked local graph' },
              { id: 'linked-backlinks', label: 'Open linked backlinks' },
            ]
          : []),
        { id: 'split-right', label: 'Split right' },
        { id: 'split-down', label: 'Split down' },
        ...(workspace.groups.length > 1 ? [{ id: 'merge-pane', label: 'Merge pane' }] : []),
        {
          id: 'open-new-window',
          label: 'Open in new window',
          enabled: !!globalThis.ivoNative?.windows,
        },
        { type: 'separator' },
        ...(tab.kind === 'document'
          ? [
              { id: 'toggle-edit', label: editing ? 'Reading view' : 'Editing view' },
              { id: 'history', label: 'Open version history' },
              { id: 'rename', label: 'Rename…' },
              { id: 'insert-link', label: 'Insert document link…' },
              ...(globalThis.ivoNative?.exportPDF
                ? [{ id: 'export-pdf', label: 'Export PDF…' }]
                : []),
            ]
          : []),
      ];
    const choice = await showNavigationMenu(items, {
      anchor: panes.get(workspace.active)?.element.querySelector('[data-action="view-options"]'),
    });
    if (!choice || !workspace.tabs.some((tab) => tab.id === id)) return;
    if (choice === 'insert-link') {
      await transitions.run(() => activateTabNow(id));
      return runAction('insert-link');
    }
    return transitions
      .run(async () => {
        await activateTabNow(id);
        if (['toggle-stack', 'unlink-view', 'linked-graph', 'linked-backlinks'].includes(choice))
          return tabAction(choice, id);
        if (choice === 'open-new-window') return openWindowForTab(id);
        if (choice === 'rename' || choice === 'history') return documentAction(choice, tab.docId);
        if (choice === 'insert-link') {
          if (!editing) await action('toggle-edit');
          return canvasHandle?.command('link');
        }
        return action(choice);
      })
      .catch((error) => toast(error.message));
  }
  async function action(name) {
    if (name === 'workspaces') return manageWorkspaces();
    if (name === 'restore-workspace') return workspaceManager.restorePrevious();
    if (name.startsWith('focus-pane-')) {
      if (!(await flush())) return;
      const next = adjacentPane(workspace, activeGroup(workspace).id, name.slice(11));
      if (next) activatePane(next, { focus: true });
      return;
    }
    if (
      [
        'split-right',
        'split-down',
        'merge-pane',
        'next-pane',
        'previous-pane',
        'go-back',
        'go-forward',
      ].includes(name) &&
      dialog.open
    )
      dialog.close();
    if (name === 'manage-vaults') {
      dialog.close();
      return globalThis.ivoNative?.vaults?.manager();
    }
    if (name === 'save-template') {
      saveTemplateDialog();
      return;
    }
    if (name === 'export-pdf') {
      if (globalThis.ivoNative?.exportPDF) pdfDialog();
      return;
    }
    if (name === 'undo' || name === 'redo') return performHistory(name);
    if (name === 'fit-graph') {
      graphHandle?.fit();
      return;
    }
    if (name === 'menu') {
      sidebarController?.toggle();
      scheduleWorkspace();
      return;
    }
    if (name === 'new') return createNote();
    if (name === 'new-right') return createNote(undefined, { toRight: true });
    if (name === 'new-layout') {
      newDocument();
      return;
    }
    if (name === 'new-tab') return blankTabNow();
    if (name === 'quick-switcher') return quickSwitcher();
    if (name === 'close-tab') return closeTabNow();
    if (name === 'reopen-tab') {
      if (!(await flush())) return;
      captureTab();
      if (reopenTab(workspace)) {
        adoptTab();
        render();
      }
      return;
    }
    if (name === 'next-tab' || name === 'previous-tab') {
      const tabs = groupTabs(workspace),
        index = tabs.findIndex((tab) => tab.id === workspace.active),
        offset = name === 'next-tab' ? 1 : -1;
      return activateTabNow(tabs[(index + offset + tabs.length) % tabs.length].id);
    }
    if (name === 'vault-menu') {
      if (globalThis.ivoNative?.vaults) {
        if (!(await flush())) return;
        return globalThis.ivoNative.vaults.menu();
      }
      toast('Folder vault switching is available in the Mac app.');
      return;
    }
    if (name === 'split-right' || name === 'split-down')
      return splitNow(name === 'split-down' ? 'column' : 'row');
    if (name === 'merge-pane') {
      if (!(await flush())) return;
      captureAllTabs();
      if (mergeGroup(workspace)) {
        adoptTab();
        render();
      }
      return;
    }
    if (name === 'next-pane' || name === 'previous-pane') {
      const index = workspace.groups.indexOf(activeGroup(workspace)),
        offset = name === 'next-pane' ? 1 : -1;
      activatePane(
        workspace.groups[(index + offset + workspace.groups.length) % workspace.groups.length].id,
        { focus: true },
      );
      return;
    }
    if (name === 'go-back' || name === 'go-forward')
      return workspaceNavigation(name === 'go-back' ? 'back' : 'forward');
    if (name === 'options') {
      options();
      return;
    }
    if (name === 'view-options') return viewOptions();
    if (name.startsWith('sidebar-')) {
      const hadFilter = !!query || !!tag;
      sidebarMode = name.slice(8);
      sidebarController?.open();
      query = '';
      tag = '';
      renderSidebar();
      if (hadFilter) refreshSearchViews();
      scheduleWorkspace();
      if (sidebarMode === 'search') root.querySelector('#search')?.focus();
      return;
    }
    if (name === 'new-folder') return newFolderDialog();
    if (name === 'sort-documents') {
      sortMode = sortMode === 'name' ? 'updated' : 'name';
      renderSidebar();
      scheduleWorkspace();
      return;
    }
    if (name === 'collapse-folders') {
      const paths = folderPaths(docs, libraryMeta);
      if (collapsedFolders.size) collapsedFolders.clear();
      else paths.forEach((path) => collapsedFolders.add(path));
      renderSidebar();
      scheduleWorkspace();
      return;
    }
    if (name === 'clear-tag') {
      if (!(await flush())) return;
      tag = '';
      render();
      return;
    }
    if (name === 'toggle-edit') {
      if (!current() || !(await flush())) return;
      await snapshot(documentSession.legacyOriginal(activeId) || current());
      captureTab();
      editing = !editing;
      activeTab(workspace).editing = editing;
      if (!editing) delete activeTab(workspace).textView;
      render();
      return;
    }
    if (name === 'library' || name === 'graph') {
      if (!(await flush())) return;
      captureTab();
      replaceTab(workspace, name, activeId);
      adoptTab();
      render();
      return;
    }
    if (name === 'export') {
      await flush();
      download(
        'ivo-atlas-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(
          {
            schemaVersion: archiveVersion(allDocuments(), [...assets.values()]),
            exportedAt: new Date().toISOString(),
            documents: allDocuments(),
            assets: [...assets.values()],
          },
          null,
          2,
        ),
        'application/json',
      );
      dialog.close();
      return;
    }
    if (name === 'import') {
      dialog.close();
      const input = document.querySelector('#import-input');
      input.value = '';
      input.click();
      return;
    }
    if (name === 'markdown') {
      download(
        (current().title || 'document').replace(/[^\w .-]/g, '') + '.md',
        exportMarkdown(current(), docs),
        'text/markdown',
      );
      dialog.close();
      return;
    }
    if (name === 'insert-link') {
      dialog.close();
      if (!editing) await action('toggle-edit');
      return canvasHandle?.command('link');
    }
    if (name === 'history') return showHistory();
    if (name === 'duplicate-document') {
      if (!(await flush())) return;
      const d = duplicateDocument(current());
      await saveDocument(d);
      canvasHandle?.destroy();
      canvasHandle = null;
      docs.unshift(d);
      dialog.close();
      return openDocumentNow(d.id);
    }
    if (name === 'show-folder') {
      const error = await globalThis.ivoNative?.showFolder();
      if (error) toast(error);
    }
  }
  function runAction(name) {
    if (!windowLease) return Promise.resolve();
    // View-only navigation does not enter document busy/history transitions.
    if (name === 'menu' || name.startsWith('sidebar-')) {
      if (transitions.busy || dialog.open || titleComposing || canvasHandle?.getState().composing)
        return Promise.resolve();
      return Promise.resolve(action(name)).catch((error) => toast(error.message));
    }
    if (name === 'view-options') return viewOptions().catch((error) => toast(error.message));
    if (name === 'insert-link') {
      dialog.close();
      const owner = activeId;
      return (editing ? Promise.resolve() : transitions.run(() => action('toggle-edit')))
        .then(() => {
          if (activeId === owner) return canvasHandle?.command('link');
        })
        .catch((error) => toast(error.message));
    }
    const result =
      name === 'undo' || name === 'redo'
        ? Promise.resolve(action(name))
        : transitions.run(() => action(name));
    return result.catch((error) => toast(error.message));
  }
  function activatePaneFromEvent(event) {
    if (rendering || dialog.open || (event.type === 'pointerdown' && event.button !== 0)) return;
    const element =
      event.target instanceof Element ? event.target.closest('[data-workspace-group]') : null;
    if (!element) return;
    const id = element.dataset.workspaceGroup;
    if (
      id !== activeGroup(workspace).id ||
      (event.target.closest('[data-workspace-tab]')?.dataset.workspaceTab &&
        event.target.closest('[data-workspace-tab]').dataset.workspaceTab !== workspace.active)
    ) {
      if (transitions.busy || titleComposing || canvasHandle?.getState().composing) {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        transitions
          .run(async () => {
            if (await flush())
              activatePane(id, {
                focus: event.type === 'focusin',
                tabId: event.target.closest('[data-workspace-tab]')?.dataset.workspaceTab,
              });
          })
          .catch((error) => toast(error.message));
        return;
      }
      activatePane(id, {
        tabId: event.target.closest('[data-workspace-tab]')?.dataset.workspaceTab,
      });
    }
    if (event.type === 'pointerdown' && event.target.closest('.scene-editor')) {
      const pane = panes.get(workspace.active);
      if (pane) pane.suspended = false;
    }
  }
  for (const name of ['pointerdown', 'focusin', 'click'])
    root.addEventListener(name, activatePaneFromEvent, { capture: true });
  root.addEventListener('wheel', activatePaneFromEvent, { capture: true, passive: false });
  document.addEventListener('keydown', (event) => {
    if (
      dialog.open ||
      transitions.busy ||
      event.isComposing ||
      titleComposing ||
      canvasHandle?.getState().composing
    )
      return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && !event.shiftKey && ['[', ']'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      runAction(event.key === '[' ? 'go-back' : 'go-forward');
    } else if (event.key === 'F6') {
      event.preventDefault();
      event.stopPropagation();
      runAction(event.shiftKey ? 'previous-pane' : 'next-pane');
    }
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.altKey ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ||
        dialog.open ||
        transitions.busy ||
        event.isComposing ||
        titleComposing ||
        canvasHandle?.getState().composing
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runAction(
        'focus-pane-' +
          { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key],
      );
    },
    { capture: true },
  );
  root.addEventListener('contextmenu', (event) => {
    const folder = event.target.closest('summary[data-folder-path]');
    if (folder) {
      event.preventDefault();
      folderMenu(folder.dataset.folderPath, event);
      return;
    }
    const row = event.target.closest('[data-open],[data-trash-document]');
    if (!row || row.closest('.scene-editor')) return;
    event.preventDefault();
    documentMenu(row.dataset.open || row.dataset.trashDocument, event);
  });
  root.addEventListener('keydown', (event) => {
    const folder = event.target.closest('summary[data-folder-path]');
    if (folder && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
      event.preventDefault();
      const r = folder.getBoundingClientRect();
      folderMenu(folder.dataset.folderPath, {
        clientX: r.x + 12,
        clientY: r.bottom,
        target: folder,
      });
      return;
    }
    const row = event.target.closest('[data-open],[data-trash-document]');
    if (row && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
      event.preventDefault();
      const r = row.getBoundingClientRect();
      documentMenu(row.dataset.open || row.dataset.trashDocument, {
        clientX: r.x + 12,
        clientY: r.bottom,
        target: row,
      });
    }
  });
  root.addEventListener(
    'toggle',
    (event) => {
      const folder = event.target.closest?.('details[data-folder]');
      if (folder) {
        if (folder.open) collapsedFolders.delete(folder.dataset.folder);
        else collapsedFolders.add(folder.dataset.folder);
        scheduleWorkspace();
      }
    },
    { capture: true },
  );
  document.addEventListener('click', (event) => {
    if (event.target.closest('.scene-editor')) return;
    const trashed = event.target.closest('[data-trash-document]');
    if (trashed) {
      event.preventDefault();
      documentMenu(trashed.dataset.trashDocument, event);
      return;
    }
    const vault = event.target.closest('[data-vault-open],[data-vault-forget]');
    if (vault) {
      event.preventDefault();
      vaultAction(
        vault.hasAttribute('data-vault-open') ? 'open' : 'forget',
        vault.dataset.vaultOpen || vault.dataset.vaultForget,
      ).catch((error) => toast(error.message));
      return;
    }
    const vaultButton = event.target.closest('[data-action^="vault-"]');
    if (vaultInfo.manager && vaultButton) {
      event.preventDefault();
      vaultAction(vaultButton.dataset.action).catch((error) => toast(error.message));
      return;
    }
    const spine = event.target.closest('[data-stack-tab]');
    if (spine) {
      event.preventDefault();
      revealStackTab(spine.dataset.stackTab);
      return;
    }
    const tab = event.target.closest('[data-tab-id]');
    if (tab) {
      event.preventDefault();
      transitions
        .run(() => activateTabNow(tab.dataset.tabId))
        .catch((error) => toast(error.message));
      return;
    }
    const close = event.target.closest('[data-close-tab]');
    if (close) {
      event.preventDefault();
      transitions
        .run(() => closeTabNow(close.dataset.closeTab))
        .catch((error) => toast(error.message));
      return;
    }
    const open = event.target.closest('[data-open]');
    if (open) {
      event.preventDefault();
      openDocument(open.dataset.open, {
        newTab: event.metaKey || event.ctrlKey || !!open.closest('.linked-backlinks'),
        toRight: (event.metaKey || event.ctrlKey) && event.altKey,
      });
      return;
    }
    const link = event.target.closest('[data-link-to]');
    if (link) {
      const resolve = linkResolve;
      linkResolve = null;
      resolve?.(link.dataset.linkTo);
      dialog.close();
      return;
    }
    const t = event.target.closest('[data-tag]');
    if (t) {
      tag = tag === t.dataset.tag ? '' : t.dataset.tag;
      transitions
        .run(async () => {
          if (!(await flush())) return;
          replaceTab(workspace, 'library', activeId);
          adoptTab();
          render();
        })
        .catch((error) => toast(error.message));
      return;
    }
    const scope = event.target.closest('[data-scope]');
    if (scope) {
      const tab = activeTab(workspace);
      if (tab.graphScope) tab.graphScope = scope.dataset.scope;
      else graphScope = scope.dataset.scope;
      render();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (button) {
      event.preventDefault();
      if (button.dataset.action === 'toggle-edit' && (event.metaKey || event.ctrlKey)) {
        openDocument(activeId, { toRight: true, editing: !editing });
        return;
      }
      runAction(button.dataset.action);
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-document-title]')) event.target.dataset.editing = 'true';
    if (event.target.id === 'search') {
      if (sidebarMode === 'bookmarks') bookmarkQuery = event.target.value;
      else query = event.target.value;
      scheduleWorkspace();
      root.querySelector('#document-list').innerHTML = fileTree();
      if (sidebarMode !== 'bookmarks') refreshSearchViews();
    }
  });
  document.addEventListener('focusout', (event) => {
    if (event.target.matches('[data-document-title]')) commitTitle(event.target);
  });
  document.addEventListener('compositionstart', (event) => {
    if (event.target.matches('[data-document-title]')) titleComposing = true;
  });
  document.addEventListener('compositionend', (event) => {
    if (event.target.matches('[data-document-title]')) {
      titleComposing = false;
      for (const resolve of titleWaiters.splice(0)) resolve();
    }
  });
  document.addEventListener('auxclick', (event) => {
    const open = event.target.closest('[data-open]');
    if (event.button === 1 && open) {
      event.preventDefault();
      openDocument(open.dataset.open, { newTab: true });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || titleComposing) return;
    const title = event.target.closest('[data-document-title]');
    if (title && ['Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') title.value = current().title;
      commitTitle(title);
      title.blur();
      focusBody();
      return;
    }
    const tab = event.target.closest('[data-tab-id]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const tabs = groupTabs(workspace, groupForTab(workspace, tab.dataset.tabId).id),
        index = tabs.findIndex((value) => value.id === tab.dataset.tabId),
        next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      transitions
        .run(() => activateTabNow(tabs[next].id))
        .then(() => root.querySelector(`[data-tab-id="${workspace.active}"]`)?.focus())
        .catch((error) => toast(error.message));
      return;
    }
    if (dialog.open || transitions.busy || canvasHandle?.getState().composing || vaultInfo.manager)
      return;
    const key = event.key.toLowerCase(),
      modifier = event.metaKey || event.ctrlKey;
    if (modifier && ['n', 't', 'w'].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      runAction(
        key === 'n'
          ? event.shiftKey
            ? 'new-right'
            : 'new'
          : key === 'w'
            ? 'close-tab'
            : event.shiftKey
              ? 'reopen-tab'
              : 'new-tab',
      );
    } else if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      runAction(event.shiftKey ? 'previous-tab' : 'next-tab');
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'show-tags') {
      showTags = event.target.checked;
      render();
    }
    if (event.target.id === 'graph-depth') {
      graphDepth = Number(event.target.value);
      render();
    }
  });
  async function createQuickDocument(title) {
    if (title) return createNote(title, { selectTitle: false });
  }
  function quickSwitcher() {
    return showQuickSwitcher({
      dialog,
      showDialog,
      documents: docs,
      recentIds: recentDocuments,
      activeId,
      onOpen: openDocument,
      onCreate: (title) =>
        transitions.run(() => createQuickDocument(title)).catch((error) => toast(error.message)),
    });
  }
  document.addEventListener('keydown', (event) => {
    if (transitions.busy || event.isComposing || canvasHandle?.getState().composing) return;
    if ((event.metaKey || event.ctrlKey) && ['k', 'o'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (dialog.open && dialog.dataset.dialogKind !== 'prompt') dialog.close();
      quickSwitcher();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      flush();
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'e' &&
      !event.shiftKey &&
      !dialog.open &&
      view === 'document'
    ) {
      event.preventDefault();
      runAction('toggle-edit');
    }
  });
  document.querySelector('#import-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 120 * 1024 * 1024)
        throw new Error('This backup is too large (120 MB maximum).');
      const payload = validateImport(JSON.parse(await file.text()));
      payload.documents.forEach(cleanDocument);
      showDialog(
        `<h2>Import ${payload.documents.length} documents</h2><p>Matching documents will be replaced. Their current versions will be kept in local history.</p><button type="submit" class="button-primary">Import</button>`,
        async () => {
          if (!(await flush())) return;
          for (const d of payload.documents) {
            const existing = allDocuments().find((x) => x.id === d.id);
            if (existing) await snapshot(documentSession.legacyOriginal(d.id) || existing);
          }
          await saveImport(payload);
          for (const pane of panes.values()) {
            pane.canvas?.destroy();
            pane.graph?.destroy();
          }
          panes.clear();
          paneGroups.clear();
          layoutController?.destroy();
          layoutController = null;
          sidebarController?.destroy();
          sidebarController = null;
          root.innerHTML = '';
          canvasHandle = null;
          documentSession.clearLegacy();
          const loaded = validateImport({
            schemaVersion: CURRENT_ARCHIVE_VERSION,
            documents: await loadDocuments(),
            assets: await loadAssets(),
          });
          receiveDocuments(loaded.documents);
          assets = new Map(loaded.assets.map((a) => [a.id, a]));
          await prepareVaultFonts([...assets.values()]);
          workspace = normalizeWorkspace(workspace, docs);
          const importedId =
            payload.documents.find((document) => docs.some((live) => live.id === document.id))
              ?.id || docs[0]?.id;
          replaceTab(workspace, docs.length ? 'document' : 'library', importedId || null);
          for (const document of payload.documents) documentSession.discardHistory(document.id);
          adoptTab();
          dialog.close();
          render();
          toast('Atlas imported');
        },
      );
    } catch (error) {
      toast('Import failed: ' + error.message);
    }
  });
  window.addEventListener('beforeunload', (event) => {
    for (const pane of panes.values()) pane.canvas?.finish();
    if (saves.dirty || [...panes.values()].some((pane) => pane.canvas?.pending)) {
      flush();
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
  window.addEventListener('hashchange', () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('doc');
    if (id && (view !== 'document' || id !== activeId)) openDocument(id);
  });
  function updateNativeHistory() {
    if (!globalThis.ivoNative?.updateHistory) return;
    const target = document.activeElement,
      field = target?.matches('input,textarea'),
      nativeField =
        field &&
        (dialog.open
          ? dialog.contains(target)
          : !target.closest('.canvas-properties') || target.dataset.editing === 'true');
    const allowed =
      windowLease &&
      !dialog.open &&
      !transitions.busy &&
      editing &&
      view === 'document' &&
      !canvasHandle?.getState().composing;
    const timeline = current() && documentSession.existingHistory(current().id);
    globalThis.ivoNative.updateHistory({
      canGoBack: !dialog.open && !transitions.busy && canNavigate(workspace, 'back'),
      canGoForward: !dialog.open && !transitions.busy && canNavigate(workspace, 'forward'),
      canUndo: nativeField
        ? document.queryCommandEnabled('undo')
        : !!(allowed && timeline?.canUndo),
      canRedo: nativeField
        ? document.queryCommandEnabled('redo')
        : !!(allowed && timeline?.canRedo),
      undoLabel: nativeField ? '' : allowed ? timeline?.undoLabel || '' : '',
      redoLabel: nativeField ? '' : allowed ? timeline?.redoLabel || '' : '',
    });
  }
  for (const name of [
    'focusin',
    'focusout',
    'input',
    'change',
    'compositionstart',
    'compositionend',
  ])
    document.addEventListener(name, () => queueMicrotask(updateNativeHistory));
  function routeNativeCommand(name) {
    if (!initialized || !windowLease) {
      if (name === 'close-tab') return globalThis.ivoNative?.windows?.close?.();
      return;
    }
    const target = document.activeElement,
      field = target?.matches('input,textarea'),
      textCommand = ['undo', 'redo', 'select-all'].includes(name);
    if (dialog.open) {
      if (field && dialog.contains(target) && textCommand) {
        if (name === 'select-all') target.select();
        else document.execCommand(name);
      }
      return;
    }
    if (!titleComposing && !canvasHandle?.getState().composing) {
      if (
        typeof name === 'string' &&
        (name === 'workspaces' || name === 'restore-workspace' || name.startsWith('focus-pane-'))
      )
        return runAction(name);
    }
    if (transitions.busy || titleComposing || canvasHandle?.getState().composing) return;
    if (field && name === 'select-all') {
      target.select();
      return;
    }
    if (
      field &&
      textCommand &&
      (!target.closest('.canvas-properties') || target.dataset.editing === 'true')
    ) {
      document.execCommand(name);
      return;
    }
    if (typeof name === 'object' && name?.type === 'open-document') return openDocument(name.id);
    if (name === 'new-document') return runAction('new');
    if (name === 'new-document-right') return runAction('new-right');
    if (name === 'new-layout') return runAction('new-layout');
    if (
      [
        'new-tab',
        'close-tab',
        'reopen-tab',
        'next-tab',
        'previous-tab',
        'split-right',
        'split-down',
        'merge-pane',
        'next-pane',
        'previous-pane',
        'go-back',
        'go-forward',
      ].includes(name)
    )
      return runAction(name);
    if (name === 'quick-switcher') return quickSwitcher();
    if (name === 'export-pdf') return runAction(name);
    if (name === 'toggle-edit') return runAction(name);
    if (view === 'document') {
      if (name === 'link' && !editing) return runAction('insert-link');
      return Promise.resolve(canvasHandle?.command(name)).catch((error) => toast(error.message));
    }
    if (name.startsWith('fit-')) graphHandle?.fit();
  }
  globalThis.ivoNative?.onCommand?.(routeNativeCommand);
  globalThis.ivoNative?.onVaultsChanged?.(() => {
    if (vaultInfo.manager) renderVaultManager().catch((error) => toast(error.message));
  });

  /** A native vault has one focused-window editor lease. Passive views never write stale source. */
  globalThis.ivoNative?.onPrepareWindowRelease?.(async () => {
    if (!initialized || vaultInfo.manager) return false;
    passiveRefresh.invalidate();
    root.inert = true;
    tabBar.cancel();
    libraryDrag.cancel();
    sidebarController?.cancel();
    void showNavigationMenu([]);
    try {
      if (!(await flush())) return false;
      captureAllTabs();
      for (const pane of panes.values())
        if (pane.canvas) {
          const tab = workspace.tabs.find((tab) => tab.id === pane.tabId),
            bookmark = pane.canvas.deactivate();
          if (bookmark && tab) tab.textView = bookmark;
          pane.suspended = true;
        }
      windowLease = false;
      updateNativeHistory();
      return true;
    } finally {
      root.inert = !windowLease;
    }
  });
  async function receiveWindowState(state) {
    passiveRefresh.invalidate({ assetsReceived: !!state.assets });
    root.inert = true;
    windowRefreshing = true;
    try {
      if (!state.active) {
        windowLease = false;
        return;
      }
      if (state.documents) {
        captureAllTabs();
        const existing = new Map(allDocuments().map((doc) => [doc.id, doc])),
          changedIds = new Set();
        const incoming = state.documents.map((doc) => {
          const old = existing.get(doc.id);
          if (old && JSON.stringify(old) === JSON.stringify(doc)) return old;
          changedIds.add(doc.id);
          return doc;
        });
        receiveDocuments(incoming);
        if (state.assets) {
          assets = new Map(state.assets.map((asset) => [asset.id, asset]));
          await prepareVaultFonts([...assets.values()]);
        }
        for (const id of changedIds) documentSession.discardHistory(id);
        const available = new Set(docs.map((doc) => doc.id));
        if (workspace.tabs.some((tab) => tab.kind === 'document' && !available.has(tab.docId)))
          workspace = normalizeWorkspace(workspace, docs);
        for (const pane of panes.values())
          if (changedIds.has(pane.docId) || pane.graph) pane.key = null;
      }
      windowLease = true;
      if (initialized) {
        adoptTab();
        render();
      }
    } finally {
      windowRefreshing = false;
      root.inert = !windowLease;
    }
    if (windowLease && initialized) {
      const tab = activeTab(workspace);
      if (tab.textView && tab.editing) {
        canvasHandle?.restoreView(tab.textView);
        const pane = panes.get(workspace.active);
        if (pane) pane.suspended = false;
      }
    }
    if (initialized && !startupPresented) await afterStartupPaint();
  }
  globalThis.ivoNative?.onWindowState?.(receiveWindowState);
  globalThis.ivoNative?.onTabTransfer?.(async ({ phase, drop, tab }) => {
    if (
      !initialized ||
      vaultInfo.manager ||
      transitions.busy ||
      dialog.open ||
      titleComposing ||
      canvasHandle?.getState().composing ||
      ![drop?.x, drop?.y].every(Number.isFinite)
    )
      return false;
    const bar = [...root.querySelectorAll('.document-tabs')].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        drop.x >= rect.left && drop.x <= rect.right && drop.y >= rect.top && drop.y <= rect.bottom
      );
    });
    if (!bar || workspace.tabs.length >= 100) return false;
    if (phase === 'probe') return true;
    if (phase !== 'receive' || !windowLease) return false;
    return transitions.run(async () => {
      if (!(await flush())) return false;
      captureAllTabs();
      const groupId = bar.closest('[data-workspace-group]').dataset.workspaceGroup,
        buttons = [...bar.querySelectorAll('.document-tab')],
        before = buttons.findIndex((button) => {
          const rect = button.getBoundingClientRect();
          return drop.x < rect.left + rect.width / 2;
        }),
        next = receiveTab(workspace, tab, docs, groupId, before < 0 ? buttons.length : before);
      // Publish only after the destination workspace is safely stored. A refusal keeps
      // the source tab and its input session available in the original window.
      const persisted = normalizeWorkspace(next, docs);
      await putMeta('workspace:1', persisted);
      workspace = next;
      lastWorkspace = JSON.stringify(persisted);
      adoptTab();
      render();
      return true;
    });
  });
  const passiveRefresh = createPassiveRefresh({
    blocked: () => !initialized || windowLease || windowRefreshing,
    read: async ({ includeAssets, isCurrent }) => {
      const value = {
        documents: await loadDocuments(),
        assets: includeAssets ? await loadAssets() : null,
        library: normalizeLibraryMeta((await getMeta('library:1'))?.value),
      };
      if (value.assets && isCurrent()) await prepareVaultFonts(value.assets, { isCurrent });
      return value;
    },
    apply: (next) => {
      const existing = new Map(allDocuments().map((doc) => [doc.id, doc]));
      receiveDocuments(
        next.documents.map((doc) => {
          const old = existing.get(doc.id);
          if (old && JSON.stringify(old) === JSON.stringify(doc)) return old;
          documentSession.discardHistory(doc.id);
          return doc;
        }),
      );
      if (next.assets) {
        assets = new Map(next.assets.map((asset) => [asset.id, asset]));
      }
      libraryMeta = next.library;
      const available = new Set(docs.map((doc) => doc.id));
      if (workspace.tabs.some((tab) => tab.kind === 'document' && !available.has(tab.docId))) {
        workspace = normalizeWorkspace(workspace, docs);
        adoptTab();
        render();
      } else {
        for (const pane of panes.values()) pane.canvas?.refreshExternal();
        scheduleMirrors();
        metadataChanged();
      }
    },
    onError: (error) => toast('Could not refresh this view: ' + error.message),
  });
  globalThis.ivoNative?.onStoreChanged?.((change) => passiveRefresh.request(change));

  async function start() {
    try {
      await prepareTextFlowFonts();
      await initializePlatform({
        prepareForSuspend: async () => {
          await startup;
          return flush();
        },
      });
      if (globalThis.ivoNative?.vaults) {
        vaultInfo = await globalThis.ivoNative.vaults.info();
        if (vaultInfo.manager) {
          view = 'empty';
          await renderVaultManager();
          await presentStartup(root);
          startupPresented = true;
          return;
        }
      }
      if (globalThis.ivoNative?.windows) {
        windowInfo = await globalThis.ivoNative.windows.info();
        windowLease = windowInfo.active;
        document.body.classList.add('native-desktop');
        document.body.classList.toggle('native-main-window', windowInfo.main);
        root.inert = !windowLease;
      }
      workspacePreferences = createWorkspacePreferences({
        vaultId: vaultInfo.id || 'browser',
        windowId: windowInfo?.windowId || 'main',
      });
      try {
        applyChrome(workspacePreferences.readChrome());
      } catch (error) {
        toast(error.message);
      }
      fontLibrary = createInstalledFontLibrary({
        native: globalThis.ivoNative?.fonts,
        assets: () => [...assets.values()],
        persist: async (asset) => {
          await saveAsset(asset);
          assets.set(asset.id, asset);
          await prepareVaultFonts([...assets.values()]);
        },
      });
      const loaded = validateImport({
        schemaVersion: CURRENT_ARCHIVE_VERSION,
        documents: await loadDocuments(),
        assets: await loadAssets(),
      });
      receiveDocuments(loaded.documents);
      assets = new Map(loaded.assets.map((a) => [a.id, a]));
      await prepareVaultFonts([...assets.values()]);
      if (!loaded.documents.length && !(await getMeta('initialized')))
        await saveImport({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents: [], assets: [] });
      libraryMeta = normalizeLibraryMeta((await getMeta('library:1'))?.value);
      docs.forEach(cleanDocument);
      docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const saved = (await getMeta('workspace:1'))?.value;
      workspace = normalizeWorkspace(saved, docs);
      if (!saved && docs.length) replaceTab(workspace, 'document', docs[0].id);
      const requested = new URLSearchParams(location.hash.slice(1)).get('doc');
      if (requested && docs.some((doc) => doc.id === requested)) {
        const selected = activeTab(workspace);
        if (selected.kind !== 'document' || selected.docId !== requested) {
          const known = workspace.tabs.find(
            (tab) => tab.kind === 'document' && tab.docId === requested,
          );
          if (known) activateTab(workspace, known.id);
          else replaceTab(workspace, 'document', requested);
        }
      }
      initialized = true;
      adoptTab();
      render();
      await presentStartup(root);
      startupPresented = true;
      void fontLibrary
        .load()
        .then(() => {
          if (initialized) for (const pane of panes.values()) pane.canvas?.refreshFonts();
        })
        .catch((error) => toast(error.message));
      if (!globalThis.ivoNative && location.protocol !== 'file:' && 'serviceWorker' in navigator)
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    } catch (error) {
      initialized = false;
      windowLease = false;
      for (const pane of panes.values()) {
        pane.canvas?.destroy();
        pane.graph?.destroy();
      }
      panes.clear();
      paneGroups.clear();
      canvasHandle = graphHandle = null;
      layoutController?.destroy();
      sidebarController?.destroy();
      root.inert = false;
      root.innerHTML = `<main class="startup-error" role="alert"><h1>Unable to open vault</h1><p>${esc(error.message)}</p><p>Your vault files have been left in place.</p><button type="button" data-retry-startup>Retry</button></main>`;
      root.querySelector('[data-retry-startup]').addEventListener('click', () => location.reload());
      await presentStartup(root, { failed: true }).catch(() => {});
    }
  }
  const startup = start();

  return startup;
}
