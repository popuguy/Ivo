import { escapeHTML as esc } from '../../shared/html/sanitize.js';
import { icon } from '../../shared/ui/icons.js';
import { libraryInfo, isTrashed, folderPaths } from '../../domain/documents/library.js';
import { isTemplate } from '../../domain/documents/copy.js';
import { isSceneDocument } from '../../domain/documents/scene.js';
import { buildIndex, filterDocuments } from '../../domain/knowledge/index.js';
import { activeGroup, groupTabs } from '../../domain/workspace/state.js';
import { actionButton as button } from '../../shared/ui/controls.js';
/** Pure markup. Workspace commands and native lifecycle belong to the application. */
export function docList(list, { activeId, view }) {
  return list.length
    ? list
        .map(
          (d) =>
            `<button class="document-row ${d.id === activeId && view === 'document' ? 'active' : ''}" draggable="${!isTrashed(d)}" data-${isTrashed(d) ? 'trash-document' : 'open'}="${esc(d.id)}" title="${esc(libraryInfo(d).folder ? libraryInfo(d).folder + '/' + d.title : d.title)}">${icon('document')}<span>${esc(d.title || 'Untitled')}</span>${libraryInfo(d).bookmarked ? icon('bookmark') : ''}${isTemplate(d) ? '<small class="template-marker">Template</small>' : ''}</button>`,
        )
        .join('')
    : '<p class="sidebar-empty">No documents.</p>';
}
export function fileTree({
  list,
  sidebarMode,
  query,
  tag,
  docs,
  libraryMeta,
  collapsedFolders,
  activeId,
  view,
}) {
  if (sidebarMode !== 'files' || query || tag) return docList(list, { activeId, view });
  const paths = folderPaths(docs, libraryMeta);
  function branch(path) {
    const prefix = path ? path + '/' : '',
      children = paths.filter(
        (name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'),
      );
    return (
      children
        .map(
          (name) =>
            `<details class="document-folder" data-folder="${esc(name)}" ${collapsedFolders.has(name) ? '' : 'open'}><summary draggable="true" data-folder-path="${esc(name)}">${icon('chevron-right')}${icon('folder')}<span>${esc(name.slice(prefix.length))}</span></summary><div>${branch(name)}</div></details>`,
        )
        .join('') +
      docList(
        list.filter((doc) => libraryInfo(doc).folder === path),
        { activeId, view },
      ).replace('<p class="sidebar-empty">No documents.</p>', '')
    );
  }
  return branch('') || '<p class="sidebar-empty">No documents.</p>';
}
export function windowHeader() {
  // A root grid peer keeps the no-drag control above every sibling drag surface.
  // Nesting it inside the underlay lets later sidebar/tab regions cover its native hit area.
  return `<header class="workspace-window-header" aria-label="Window header"><div class="workspace-native-control-space" aria-hidden="true"></div></header><div class="workspace-header-toggle-slot"><button class="workspace-sidebar-toggle" data-action="menu" aria-label="Toggle left sidebar" title="Toggle left sidebar"><span class="workspace-toggle-hover">${icon('panel-left')}</span></button></div>`;
}
export function ribbon() {
  return `<nav class="workspace-ribbon" aria-label="Workspace"><div class="ribbon-top">${button('quick-switcher', 'Open quick switcher (⌘O)', 'document', 'icon-button')}${button('sidebar-search', 'Search documents', 'search', 'icon-button')}${button('graph', 'Graph view', 'graph', 'icon-button')}${button('sidebar-bookmarks', 'Bookmarks', 'bookmark', 'icon-button')}${button('sidebar-trash', 'Trash', 'delete', 'icon-button')}</div><div class="ribbon-bottom">${button('options', 'Vault options', 'settings', 'icon-button')}</div></nav>`;
}
export function sidebar({ sidebarMode, query, tag, docs, vaultInfo, tree, hidden = false }) {
  return `<aside id="vault-navigation" class="sidebar" aria-label="Vault navigation" ${hidden ? 'inert' : ''}><nav class="sidebar-tabs" aria-label="Navigation panels">${[
    ['files', 'Documents', 'folder'],
    ['search', 'Search', 'search'],
    ['bookmarks', 'Bookmarks', 'bookmark'],
  ]
    .map(
      ([mode, label, name]) =>
        `<button class="${sidebarMode === mode ? 'active' : ''}" data-action="sidebar-${mode}" aria-label="${label}" title="${label}" aria-pressed="${sidebarMode === mode}">${icon(name)}</button>`,
    )
    .join(
      '',
    )}</nav><div class="sidebar-tab-panels"><div class="sidebar-tools" aria-label="Document actions">${button('new', 'New document', 'edit', 'icon-button')}${button('new-folder', 'New folder', 'folder-plus', 'icon-button')}${button('sort-documents', 'Change sort order', 'sort-asc', 'icon-button')}${button('collapse-folders', 'Collapse or expand folders', 'chevron-down', 'icon-button')}</div><div class="sidebar-search" ${['search', 'bookmarks'].includes(sidebarMode) ? '' : 'hidden'}><label class="searchbox">${icon('search')}<input id="search" placeholder="${sidebarMode === 'bookmarks' ? 'Search bookmarks' : 'Search documents'}" aria-label="${sidebarMode === 'bookmarks' ? 'Search bookmarks' : 'Search documents'}" value="${esc(query)}"></label></div>${sidebarMode === 'trash' ? '<div class="sidebar-status">Trash · originals retained. Right-click to restore.</div>' : ''}<nav id="document-list" aria-label="Documents">${tree}</nav><details class="sidebar-tags" ${tag ? 'open' : ''}><summary>Tags</summary><div class="tag-list">${Object.entries(
    buildIndex(docs).tagCounts,
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, count]) =>
        `<button class="tag-row ${tag === name ? 'active' : ''}" data-tag="${esc(name)}"><span># ${esc(name)}</span><small>${count}</small></button>`,
    )
    .join(
      '',
    )}${tag ? button('clear-tag', 'Clear filter') : ''}</div></details></div><div class="sidebar-bottom"><button class="vault-switcher" data-action="vault-menu" title="${esc(vaultInfo.directory || 'Local vault')}" aria-label="Switch vault">${icon('chevron-down')}<span>${esc(vaultInfo.name)}</span></button>${button('options', 'Vault options', 'settings', 'icon-button')}</div></aside>`;
}
export function toolbar({ group, workspace, docs }) {
  const tab = workspace.tabs.find((tab) => tab.id === group.active),
    doc = docs.find((doc) => doc.id === tab.docId),
    isDocument = tab.kind === 'document';
  return `<header class="view-header"><nav class="workspace-history" aria-label="Navigation history"><button data-action="go-back" class="icon-button navigation-back" aria-label="Back (⌘[)" title="Back (⌘[)" ${tab.navigation?.back.length ? '' : 'disabled'}>${icon('chevron-right')}</button><button data-action="go-forward" class="icon-button" aria-label="Forward (⌘])" title="Forward (⌘])" ${tab.navigation?.forward.length ? '' : 'disabled'}>${icon('chevron-right')}</button></nav><div class="workspace-title">${isDocument ? `<input class="workspace-title-input" data-document-title="${esc(doc?.id || '')}" aria-label="Document title" maxlength="180" value="${esc(doc?.title || 'Untitled')}">` : esc(tab.kind === 'backlinks' ? 'Backlinks' : tab.kind === 'graph' ? (tab.linkedTo ? 'Local graph' : 'Graph view') : tab.kind === 'empty' ? 'New tab' : 'Documents')}</div><div class="view-header-actions">${workspace.groups.length > 1 ? button('next-pane', 'Next pane', 'panel-right', 'icon-button pane-cycle') : ''}${isDocument ? button('toggle-edit', tab.editing ? 'Current view: editing. Switch to reading (⌘E)' : 'Current view: reading. Switch to editing (⌘E)', tab.editing ? 'reading' : 'edit', 'icon-button') : ''}${button('view-options', 'View options', 'dots', 'icon-button')}</div></header>`;
}
export function renderLibrary({ docs, query, tag }) {
  return `<main class="document-library"><div class="library-heading"><h1>Documents</h1>${button('new', 'New document', 'plus', 'button-outline')}</div><div class="library-rows">${
    filterDocuments(docs, query, tag)
      .map(
        (d) =>
          `<button data-open="${esc(d.id)}"><span>${esc(d.title)}</span><small>${isTemplate(d) ? 'Template · ' : ''}${isSceneDocument(d) ? d.pages.length + ' page' + (d.pages.length === 1 ? '' : 's') : 'Legacy document'}</small><time>${new Date(d.updatedAt).toLocaleDateString()}</time></button>`,
      )
      .join('') || '<p>No documents.</p>'
  }</div></main>`;
}
export function renderGraph({ docs, graphScope, graphDepth, showTags, linked = false }) {
  return `<main class="graph-view"><div class="graph-toolbar">${linked ? '<span class="linked-view-label">Linked local graph</span>' : `<div class="segmented"><button data-scope="global" class="${graphScope === 'global' ? 'active' : ''}">All documents</button><button data-scope="local" class="${graphScope === 'local' ? 'active' : ''}">Local graph</button></div>`}${graphScope === 'local' ? `<label>Depth <select id="graph-depth">${[1, 2, 3].map((n) => `<option ${graphDepth === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}<label><input type="checkbox" id="show-tags" ${showTags ? 'checked' : ''}> Tags</label>${button('fit-graph', 'Fit view', '', 'text-button')}</div><div id="graph-stage" class="graph-stage" aria-label="Interactive knowledge graph"></div><div class="graph-footer"><span>${docs.length} documents · ${buildIndex(docs).edges.length} connections</span><span>Drag to arrange · Scroll to zoom</span></div><details class="graph-directory"><summary>Documents</summary><div>${docs.map((d) => `<button data-open="${esc(d.id)}">${esc(d.title)}</button>`).join('')}</div></details></main>`;
}
export function paneContentId(group, workspace) {
  return group.id === activeGroup(workspace).id
    ? 'document-tab-content'
    : 'pane-content-' + group.id;
}
export function tabMarkup({ group, workspace, docs }) {
  return (
    groupTabs(workspace, group.id)
      .map((tab) => {
        const title = tabTitle(tab, docs);
        return `<div class="document-tab ${tab.pinned ? 'pinned' : ''} ${tab.id === group.active ? 'active' : ''}" role="presentation" data-tab-kind="${esc(tab.kind)}"><div class="document-tab-inner"><button role="tab" id="${esc(tab.id)}" data-tab-id="${esc(tab.id)}" aria-selected="${tab.id === group.active}" tabindex="${tab.id === group.active ? 0 : -1}" aria-controls="${paneContentId(group, workspace)}" title="${esc(title + (tab.pinned ? ' (pinned)' : ''))}">${tab.pinned ? icon('pin') : ''}${tab.kind === 'document' ? icon('document') : ''}<span>${esc(title)}</span></button><button class="document-tab-close" data-close-tab="${esc(tab.id)}" aria-label="Close ${esc(title)}" tabindex="-1">${icon('tab-close')}</button></div></div>`;
      })
      .join('') + button('new-tab', 'New tab (⌘T)', 'plus', 'document-tab-plus')
  );
}
export function renderEmpty() {
  return `<main class="empty-document-tab"><div>${button('new', 'New document', 'document')}${button('quick-switcher', 'Open document…', 'search')}${button('new-layout', 'New layout or template…', 'plus')}</div></main>`;
}

export function renderBacklinks({ docs, tab }) {
  const index = buildIndex(docs),
    doc = docs.find((doc) => doc.id === tab.docId),
    links = index.backlinks[tab.docId] || [];
  return `<main class="linked-backlinks"><h2>${doc ? esc(doc.title) : 'No document'}</h2><p>${tab.linkedTo ? 'Linked backlinks' : 'Backlinks'} · ${links.length}</p><div>${links.map((link) => `<button data-open="${esc(link.source)}">${icon('document')}<span>${esc(link.title)}</span><small>${link.count}</small></button>`).join('') || '<p>No backlinks found.</p>'}</div></main>`;
}

export function tabTitle(tab, docs) {
  return tab.kind === 'document'
    ? docs.find((doc) => doc.id === tab.docId)?.title || 'Untitled'
    : tab.kind === 'empty'
      ? 'New tab'
      : tab.kind === 'backlinks'
        ? 'Backlinks'
        : tab.kind === 'graph'
          ? tab.linkedTo
            ? 'Local graph'
            : 'Graph view'
          : 'Documents';
}
