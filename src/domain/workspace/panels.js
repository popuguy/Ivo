export const PANEL_LABELS = Object.freeze({
  properties: 'Properties',
  pages: 'Pages',
  layers: 'Layers',
  links: 'Links',
  'text-wrap': 'Text Wrap',
});
export const PANEL_KINDS = Object.keys(PANEL_LABELS);
export const DEFAULT_DOCK_WIDTH = 254;
const KINDS = PANEL_KINDS;
const number = (value, fallback, min, max) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function defaultPanels() {
  return {
    version: 3,
    closed: ['text-wrap'],
    dock: DEFAULT_DOCK_WIDTH,
    textFlow: null,
    groups: [
      {
        id: 'context-main',
        tabs: [...KINDS],
        active: 'properties',
        floating: false,
        collapsed: false,
        rect: {},
      },
    ],
  };
}
/** Device view state: each context panel occurs once, with no authored or input payloads. */
export function normalizePanels(input) {
  if (!input || typeof input !== 'object') return defaultPanels();
  const legacy = !Array.isArray(input.groups),
    raw = legacy
      ? [
          {
            ...input,
            id: 'context-main',
            tabs: KINDS.filter((kind) => kind !== 'text-wrap'),
            active: 'properties',
          },
        ]
      : input.groups;
  const used = new Set(),
    ids = new Set(),
    groups = [];
  for (const value of raw.slice(0, KINDS.length)) {
    if (!value || typeof value !== 'object') continue;
    const tabs = (Array.isArray(value.tabs) ? value.tabs : []).filter((kind) => {
      if (!KINDS.includes(kind) || used.has(kind)) return false;
      used.add(kind);
      return true;
    });
    if (!tabs.length) continue;
    let id =
      typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.id) && !ids.has(value.id)
        ? value.id
        : 'context-' + tabs[0];
    while (ids.has(id)) id += '-2';
    ids.add(id);
    const r = value.rect || {};
    groups.push({
      id,
      tabs,
      active: tabs.includes(value.active) ? value.active : tabs[0],
      floating: value.floating === true,
      collapsed: value.collapsed === true,
      rect: {
        x: number(r.x, 20, 0, 100000),
        y: number(r.y, 24, 0, 100000),
        w: number(r.w, 280, 200, 2000),
        h: number(r.h, 480, 160, 2000),
      },
    });
  }
  if (!groups.length) return defaultPanels();
  for (const kind of KINDS) if (!used.has(kind)) groups[0].tabs.push(kind);
  return {
    version: 3,
    closed: [
      ...new Set(
        [
          ...(Array.isArray(input.closed) ? input.closed : []),
          ...(!used.has('text-wrap') ? ['text-wrap'] : []),
        ].filter((kind) => KINDS.includes(kind)),
      ),
    ],
    dock: number(input.dock, DEFAULT_DOCK_WIDTH, 0, 480),
    textFlow: number(input.textFlow, null, 0, 10000),
    groups,
  };
}
export function movePanel(layout, kind, targetId, index, { floating = true, rect = {} } = {}) {
  const next = normalizePanels(layout),
    source = next.groups.find((group) => group.tabs.includes(kind));
  if (!source) throw new Error('Choose a context panel.');
  let target = next.groups.find((group) => group.id === targetId);
  if (!target) {
    target = { id: 'context-' + kind, tabs: [], active: kind, floating, collapsed: false, rect };
    // A one-tab group can be detached again without colliding with its own ID.
    if (next.groups.some((group) => group.id === target.id)) target.id += '-detached';
    next.groups.push(target);
  }
  source.tabs.splice(source.tabs.indexOf(kind), 1);
  if (source.active === kind) source.active = source.tabs[0];
  target.tabs.splice(
    Number.isInteger(index) ? Math.max(0, Math.min(index, target.tabs.length)) : target.tabs.length,
    0,
    kind,
  );
  target.active = kind;
  target.collapsed = false;
  next.groups = next.groups.filter((group) => group.tabs.length);
  return normalizePanels(next);
}
export function panelPreset(name) {
  const layout = defaultPanels();
  if (name === 'layout')
    layout.groups = [
      { ...layout.groups[0], tabs: ['properties'], active: 'properties' },
      {
        id: 'context-pages',
        tabs: ['pages', 'layers', 'links'],
        active: 'pages',
        floating: false,
        collapsed: false,
        rect: {},
      },
    ];
  else if (name === 'links') layout.groups[0].active = 'links';
  return normalizePanels(layout);
}
