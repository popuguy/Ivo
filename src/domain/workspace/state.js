import { uid } from '../documents/model.js';
export const isDrawingTool = (value) =>
  ['select', 'direct', 'text', 'rectangle', 'polygon', 'hand'].includes(value);
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function emptyTab() {
  return { id: uid('tab-'), kind: 'empty', docId: null, editing: false };
}
export function createWorkspace() {
  const tab = emptyTab(),
    group = { id: uid('group-'), tabIds: [tab.id], active: tab.id };
  return {
    version: 1,
    tabs: [tab],
    active: tab.id,
    groups: [group],
    layout: { type: 'group', id: group.id },
    closed: [],
  };
}
/** Only bounded view state enters the vault workspace. No source, assets or document undo snapshots. */
export function normalizeWorkspace(value, documents) {
  if (!value || value.version !== 1 || !Array.isArray(value.tabs)) return createWorkspace();
  const ids = documents && new Set(documents.map((doc) => doc.id)),
    used = new Set();
  let selectionBudget = 1000,
    historyBudget = 128;
  function view(input) {
    if (!input || !['document', 'empty', 'graph', 'library', 'backlinks'].includes(input.kind))
      return null;
    if (input.kind === 'document' && (!safeId(input.docId) || (ids && !ids.has(input.docId))))
      return null;
    const result = {
        kind: input.kind,
        docId: safeId(input.docId) && (!ids || ids.has(input.docId)) ? input.docId : null,
        editing: input.kind === 'document' && input.editing === true,
      },
      state = input.canvasState;
    if (input.kind === 'graph' && ['local', 'global'].includes(input.graphScope))
      result.graphScope = input.graphScope;
    if (state && typeof state === 'object') {
      const next = {};
      for (const key of ['activePage', 'inside', 'activeTextId'])
        if (safeId(state[key])) next[key] = state[key];
      if (Array.isArray(state.selection)) {
        next.selection = [...new Set(state.selection.filter(safeId))].slice(
          0,
          Math.min(128, selectionBudget),
        );
        selectionBudget -= next.selection.length;
      }
      if (isDrawingTool(state.tool)) next.tool = state.tool;
      const c = state.camera;
      if (
        c &&
        [c.x, c.y, c.zoom].every(Number.isFinite) &&
        Math.abs(c.x) <= 1e9 &&
        Math.abs(c.y) <= 1e9 &&
        c.zoom >= 0.0001 &&
        c.zoom <= 8
      )
        next.camera = { x: c.x, y: c.y, zoom: c.zoom };
      result.canvasState = next;
    }
    const graph = input.graphState;
    if (
      graph?.center &&
      [graph.center.x, graph.center.y, graph.scale].every(Number.isFinite) &&
      Math.abs(graph.center.x) <= 1e9 &&
      Math.abs(graph.center.y) <= 1e9 &&
      graph.scale >= 0.08 &&
      graph.scale <= 4
    )
      result.graphState = { center: { x: graph.center.x, y: graph.center.y }, scale: graph.scale };
    return result;
  }
  const tabs = [];
  for (const input of value.tabs.slice(0, 100)) {
    const current = view(input);
    if (!current) continue;
    const id = safeId(input.id) && !used.has(input.id) ? input.id : uid('tab-');
    used.add(id);
    const tab = { id, ...current };
    if (input.pinned === true) tab.pinned = true;
    if (['graph', 'backlinks'].includes(tab.kind) && safeId(input.linkedTo))
      tab.linkedTo = input.linkedTo;
    tabs.push(tab);
  }
  if (!tabs.length) tabs.push(emptyTab());
  const linkSources = new Set(tabs.filter((tab) => !tab.linkedTo).map((tab) => tab.id));
  for (const tab of tabs)
    if (tab.linkedTo && (!linkSources.has(tab.linkedTo) || tab.linkedTo === tab.id))
      delete tab.linkedTo;
  for (const tab of [...tabs].sort(
    (a, b) => Number(b.id === value.active) - Number(a.id === value.active),
  )) {
    const input = value.tabs.find((item) => item?.id === tab.id);
    if (!input?.navigation) continue;
    const navigation = { back: [], forward: [] };
    for (const direction of ['back', 'forward'])
      for (const entry of (Array.isArray(input.navigation[direction])
        ? input.navigation[direction]
        : []
      ).slice(-20)) {
        if (!historyBudget) break;
        const normalized = view(entry);
        if (normalized) {
          navigation[direction].push(normalized);
          historyBudget--;
        }
      }
    if (navigation.back.length || navigation.forward.length) tab.navigation = navigation;
  }
  const tabIds = new Set(tabs.map((tab) => tab.id)),
    assigned = new Set(),
    groupIds = new Set(),
    groups = [];
  for (const raw of (Array.isArray(value.groups) ? value.groups : []).slice(0, 8)) {
    if (!raw || !Array.isArray(raw.tabIds)) continue;
    const members = raw.tabIds.filter((id) => {
      if (!tabIds.has(id) || assigned.has(id)) return false;
      assigned.add(id);
      return true;
    });
    if (!members.length) continue;
    const id = safeId(raw.id) && !groupIds.has(raw.id) ? raw.id : uid('group-');
    groupIds.add(id);
    groups.push({
      id,
      tabIds: members,
      active: members.includes(raw.active) ? raw.active : members[0],
      ...(raw.stacked === true ? { stacked: true } : {}),
    });
  }
  if (!groups.length) groups.push({ id: uid('group-'), tabIds: [], active: null });
  for (const tab of tabs) if (!assigned.has(tab.id)) groups[0].tabIds.push(tab.id);
  for (const group of groups)
    if (!group.tabIds.includes(group.active)) group.active = group.tabIds[0];
  const active = tabs.some((tab) => tab.id === value.active) ? value.active : groups[0].active;
  groups.find((group) => group.tabIds.includes(active)).active = active;
  const layoutGroups = new Set(),
    splitIds = new Set();
  let nodes = 0;
  function tree(node, depth = 0) {
    if (!node || depth > 8 || ++nodes > 32) return null;
    if (node.type === 'group') {
      if (!groups.some((group) => group.id === node.id) || layoutGroups.has(node.id)) return null;
      layoutGroups.add(node.id);
      return { type: 'group', id: node.id };
    }
    if (node.type !== 'split') return null;
    const first = tree(node.first, depth + 1),
      second = tree(node.second, depth + 1);
    if (!first) return second;
    if (!second) return first;
    const id = safeId(node.id) && !splitIds.has(node.id) ? node.id : uid('split-');
    splitIds.add(id);
    return {
      type: 'split',
      id,
      axis: node.axis === 'column' ? 'column' : 'row',
      ratio: Number.isFinite(node.ratio) ? clamp(node.ratio, 0.1, 0.9) : 0.5,
      first,
      second,
    };
  }
  let layout = tree(value.layout);
  for (const group of groups)
    if (!layoutGroups.has(group.id)) {
      const leaf = { type: 'group', id: group.id };
      layout = layout
        ? { type: 'split', id: uid('split-'), axis: 'row', ratio: 0.5, first: layout, second: leaf }
        : leaf;
    }
  const result = { version: 1, tabs, active, groups, layout, closed: [] };
  // Leave room below the native 250KB envelope even for maximal IDs and many remembered views.
  const priorities = [
    ...tabs.filter((tab) => tab.id !== active),
    ...tabs.filter((tab) => tab.id === active),
  ];
  let bytes = JSON.stringify(result).length;
  for (const tab of priorities) {
    while (bytes > 240000 && (tab.navigation?.back.length || tab.navigation?.forward.length)) {
      const list = tab.navigation.back.length ? tab.navigation.back : tab.navigation.forward;
      list.shift();
      bytes = JSON.stringify(result).length;
    }
    if (bytes <= 240000) break;
  }
  for (const tab of priorities) {
    if (bytes <= 240000) break;
    if (tab.canvasState?.selection?.length) {
      tab.canvasState.selection = [];
      bytes = JSON.stringify(result).length;
    }
  }
  return result;
}
export const activeTab = (workspace) =>
  workspace.tabs.find((tab) => tab.id === workspace.active) || workspace.tabs[0];
export const groupForTab = (workspace, id) =>
  workspace.groups.find((group) => group.tabIds.includes(id));
export const activeGroup = (workspace) =>
  groupForTab(workspace, workspace.active) || workspace.groups[0];
export function groupTabs(workspace, id = activeGroup(workspace).id) {
  const group = workspace.groups.find((group) => group.id === id);
  return (
    group?.tabIds.map((id) => workspace.tabs.find((tab) => tab.id === id)).filter(Boolean) || []
  );
}
export function activateTab(workspace, id) {
  const group = groupForTab(workspace, id);
  if (!group) return false;
  group.active = id;
  workspace.active = id;
  return true;
}
function orderTabs(workspace) {
  const byId = new Map(workspace.tabs.map((tab) => [tab.id, tab]));
  workspace.tabs = workspace.groups.flatMap((group) =>
    group.tabIds.map((id) => byId.get(id)).filter(Boolean),
  );
}
function snapshotTab(tab) {
  return structuredClone(
    Object.fromEntries(
      [
        'kind',
        'docId',
        'editing',
        'canvasState',
        'textView',
        'graphState',
        'graphScope',
        'linkedTo',
      ]
        .filter((key) => tab[key] !== undefined)
        .map((key) => [key, tab[key]]),
    ),
  );
}
function applyView(tab, value) {
  for (const key of ['canvasState', 'textView', 'graphState', 'graphScope', 'linkedTo'])
    delete tab[key];
  Object.assign(tab, structuredClone(value));
}

/** Linked auxiliary views follow a stable tab, including its back/forward navigation. */
export function syncLinkedViews(workspace) {
  for (const tab of workspace.tabs) {
    if (!tab.linkedTo) continue;
    if (tab.kind === 'graph') tab.graphScope = 'local';
    const source = workspace.tabs.find((candidate) => candidate.id === tab.linkedTo);
    if (!source) {
      delete tab.linkedTo;
      continue;
    }
    tab.docId = source.kind === 'document' ? source.docId : null;
  }
}
export function addTab(
  workspace,
  {
    kind = 'empty',
    docId = null,
    editing = false,
    reuseEmpty = false,
    atEnd = false,
    groupId = activeGroup(workspace).id,
  } = {},
) {
  const group = workspace.groups.find((group) => group.id === groupId);
  if (!group) throw new Error('Choose an existing pane.');
  const current = workspace.tabs.find((tab) => tab.id === group.active);
  if (reuseEmpty && current?.kind === 'empty' && !current.pinned) {
    applyView(current, { kind, docId, editing });
    activateTab(workspace, current.id);
    return current;
  }
  if (workspace.tabs.length >= 100) throw new Error('Close a tab before opening more.');
  const tab = { ...emptyTab(), kind, docId, editing };
  workspace.tabs.push(tab);
  group.tabIds.splice(
    atEnd ? group.tabIds.length : group.tabIds.indexOf(group.active) + 1,
    0,
    tab.id,
  );
  activateTab(workspace, tab.id);
  orderTabs(workspace);
  return tab;
}
export function replaceTab(workspace, kind, docId = null, editing = false) {
  const tab = activeTab(workspace);
  if (tab.kind === kind && tab.docId === docId) return tab;
  if (tab.kind === 'empty' && !tab.pinned) {
    applyView(tab, { kind, docId, editing });
    return tab;
  }
  if (tab.pinned) {
    const existing = groupTabs(workspace).find(
      (item) => item.kind === kind && item.docId === docId,
    );
    if (existing) {
      activateTab(workspace, existing.id);
      return existing;
    }
    return addTab(workspace, { kind, docId, editing });
  }
  const navigation = tab.navigation || { back: [], forward: [] };
  navigation.back.push(snapshotTab(tab));
  navigation.back = navigation.back.slice(-40);
  navigation.forward = [];
  applyView(tab, { kind, docId, editing });
  tab.navigation = navigation;
  return tab;
}
export function canNavigate(workspace, direction) {
  return !!activeTab(workspace)?.navigation?.[direction]?.length;
}
export function navigateHistory(workspace, direction) {
  if (!['back', 'forward'].includes(direction)) return false;
  const tab = activeTab(workspace),
    navigation = tab.navigation,
    entry = navigation?.[direction]?.pop();
  if (!entry) return false;
  const opposite = direction === 'back' ? 'forward' : 'back';
  navigation[opposite].push(snapshotTab(tab));
  navigation[opposite] = navigation[opposite].slice(-40);
  applyView(tab, entry);
  return true;
}
/** View-only commands preserve tab identity, source ownership and document undo histories. */
export function moveTab(workspace, id, index) {
  const group = groupForTab(workspace, id),
    current = group?.tabIds.indexOf(id);
  if (
    !group ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= group.tabIds.length ||
    index === current
  )
    return false;
  group.tabIds.splice(current, 1);
  group.tabIds.splice(index, 0, id);
  orderTabs(workspace);
  return true;
}
export function pinTab(workspace, id, pinned = true) {
  const tab = workspace.tabs.find((tab) => tab.id === id);
  if (!tab) return false;
  if (pinned) tab.pinned = true;
  else delete tab.pinned;
  return true;
}
function removeLeaf(tree, id) {
  if (tree.type === 'group') return tree.id === id ? null : tree;
  const first = removeLeaf(tree.first, id),
    second = removeLeaf(tree.second, id);
  return !first ? second : !second ? first : { ...tree, first, second };
}
function removeGroup(workspace, group) {
  workspace.groups = workspace.groups.filter((item) => item !== group);
  workspace.layout = removeLeaf(workspace.layout, group.id);
}
export function closeTab(workspace, id = workspace.active) {
  const group = groupForTab(workspace, id),
    tab = workspace.tabs.find((item) => item.id === id);
  if (!group || !tab) return;
  const index = group.tabIds.indexOf(id);
  workspace.closed.unshift({ tab, index, groupId: group.id });
  workspace.closed.length = Math.min(20, workspace.closed.length);
  workspace.tabs = workspace.tabs.filter((item) => item !== tab);
  group.tabIds.splice(index, 1);
  if (!group.tabIds.length) {
    if (workspace.groups.length > 1) removeGroup(workspace, group);
    else {
      const empty = emptyTab();
      workspace.tabs.push(empty);
      group.tabIds.push(empty.id);
      group.active = empty.id;
    }
  }
  if (group.active === id) group.active = group.tabIds[Math.min(index, group.tabIds.length - 1)];
  if (workspace.active === id)
    workspace.active = workspace.groups.includes(group) ? group.active : workspace.groups[0].active;
  orderTabs(workspace);
}
export function reopenTab(workspace) {
  if (workspace.tabs.length >= 100) return null;
  const item = workspace.closed.shift();
  if (!item) return null;
  const group =
    workspace.groups.find((group) => group.id === item.groupId) || activeGroup(workspace);
  if (group.tabIds.length === 1) {
    const only = workspace.tabs.find((tab) => tab.id === group.tabIds[0]);
    if (only.kind === 'empty' && !only.pinned) {
      group.tabIds.length = 0;
      workspace.tabs = workspace.tabs.filter((tab) => tab !== only);
    }
  }
  workspace.tabs.push(item.tab);
  group.tabIds.splice(Math.min(item.index, group.tabIds.length), 0, item.tab.id);
  activateTab(workspace, item.tab.id);
  orderTabs(workspace);
  return item.tab;
}
function replaceLeaf(tree, id, replacement) {
  if (tree.type === 'group') return tree.id === id ? replacement : tree;
  return {
    ...tree,
    first: replaceLeaf(tree.first, id, replacement),
    second: replaceLeaf(tree.second, id, replacement),
  };
}
export function splitGroup(workspace, axis = 'row', { kind, docId, editing } = {}) {
  if (workspace.groups.length >= 8) throw new Error('Use up to eight panes in one window.');
  if (workspace.tabs.length >= 100) throw new Error('Close a tab before opening more.');
  const previous = activeGroup(workspace),
    source = activeTab(workspace),
    tab = { id: uid('tab-'), ...snapshotTab(source) },
    group = { id: uid('group-'), tabIds: [tab.id], active: tab.id };
  if (kind) {
    if (kind === source.kind && docId === source.docId) {
      tab.editing = editing === true;
    } else applyView(tab, { kind, docId: docId ?? null, editing: editing === true });
  } else if (editing !== undefined) tab.editing = editing === true;
  workspace.tabs.push(tab);
  workspace.groups.splice(workspace.groups.indexOf(previous) + 1, 0, group);
  workspace.layout = replaceLeaf(workspace.layout, previous.id, {
    type: 'split',
    id: uid('split-'),
    axis: axis === 'column' ? 'column' : 'row',
    ratio: 0.5,
    first: { type: 'group', id: previous.id },
    second: { type: 'group', id: group.id },
  });
  workspace.active = tab.id;
  orderTabs(workspace);
  return group;
}
export function mergeGroup(workspace, id = activeGroup(workspace).id) {
  const group = workspace.groups.find((group) => group.id === id);
  if (!group || workspace.groups.length === 1) return false;
  const index = workspace.groups.indexOf(group),
    target = workspace.groups[index ? index - 1 : 1];
  target.tabIds.push(...group.tabIds);
  if (group.tabIds.includes(workspace.active)) target.active = workspace.active;
  removeGroup(workspace, group);
  orderTabs(workspace);
  return true;
}
export function moveTabToGroup(workspace, id, targetId, index) {
  const source = groupForTab(workspace, id),
    target = workspace.groups.find((group) => group.id === targetId);
  if (!source || !target) return false;
  if (source === target)
    return moveTab(
      workspace,
      id,
      clamp(index ?? target.tabIds.length - 1, 0, target.tabIds.length - 1),
    );
  source.tabIds.splice(source.tabIds.indexOf(id), 1);
  target.tabIds.splice(clamp(index ?? target.tabIds.length, 0, target.tabIds.length), 0, id);
  if (source.active === id) source.active = source.tabIds[0];
  if (!source.tabIds.length) removeGroup(workspace, source);
  activateTab(workspace, id);
  orderTabs(workspace);
  return true;
}
export function setSplitRatio(workspace, id, value) {
  const visit = (node) =>
      node.type === 'split'
        ? node.id === id
          ? node
          : visit(node.first) || visit(node.second)
        : null,
    node = visit(workspace.layout);
  if (!node || !Number.isFinite(value)) return false;
  node.ratio = clamp(value, 0.1, 0.9);
  return true;
}
export function untitledName(documents) {
  const names = new Set(documents.map((doc) => doc.title.toLocaleLowerCase('en-US')));
  let suffix = 0;
  while (names.has(('Untitled' + (suffix ? ' ' + suffix : '')).toLocaleLowerCase('en-US')))
    suffix++;
  return 'Untitled' + (suffix ? ' ' + suffix : '');
}

/** Native window geometry/reopen references, never source or filesystem paths. */
export function normalizeWindowDescriptors(value) {
  if (!Array.isArray(value)) throw new Error('Invalid workspace window list.');
  const seen = new Set(),
    result = [];
  for (const input of value.slice(0, 8)) {
    if (!input || !safeId(input.id) || seen.has(input.id)) continue;
    seen.add(input.id);
    const b = input.bounds || {},
      bounds = {};
    for (const key of ['x', 'y'])
      if (Number.isFinite(b[key])) bounds[key] = Math.round(clamp(b[key], -100000, 100000));
    bounds.width = Math.round(clamp(Number.isFinite(b.width) ? b.width : 1200, 400, 12000));
    bounds.height = Math.round(clamp(Number.isFinite(b.height) ? b.height : 850, 300, 12000));
    result.push({ id: input.id, bounds, open: input.open === true });
  }
  return result;
}
