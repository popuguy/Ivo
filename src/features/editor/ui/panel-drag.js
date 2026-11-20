import { panelDockTarget } from '../../../domain/workspace/panel-drag.js';

export function nativeDockHit(surface, groups, x, y, guide, preview) {
  const workspace = surface.getBoundingClientRect();
  const visible = [...groups.values()]
    .filter((element) => !element.hidden)
    .map((element) => {
      return {
        id: element.dataset.contextGroup,
        floating: element.dataset.floating === 'true',
        box: element.getBoundingClientRect(),
        header: element.querySelector('.context-panel-header').getBoundingClientRect(),
        tabs: [...element.querySelectorAll('[data-canvas-panel]:not([hidden])')].map((tab) => {
          const rect = tab.getBoundingClientRect();
          return { kind: tab.dataset.canvasPanel, left: rect.left, right: rect.right };
        }),
      };
    })
    .filter(({ box }) => box.width > 0 && box.height > 0);
  const target = panelDockTarget(x, y, workspace, visible);
  if (!target) return null;
  const group = visible.find((item) => item.id === target.id);
  if (preview) {
    const box = group?.box || workspace;
    let left = box.right - 4,
      top = box.top,
      width = 4,
      height = box.height;
    if (target.type === 'tabs') {
      left =
        group.tabs.find((tab) => tab.kind === target.before)?.left ??
        group.tabs.at(-1)?.right ??
        group.header.left;
      top = group.header.top;
      height = group.header.height;
    } else if (target.type !== 'edge') {
      left = box.left;
      width = box.width;
      height = 4;
      top = target.type === 'above' ? box.top : box.bottom - height;
    }
    Object.assign(guide.style, {
      left: left + 'px',
      top: top + 'px',
      width: width + 'px',
      height: height + 'px',
    });
    guide.hidden = false;
  }
  return target;
}

/** Show the actual controls while Electron creates the utility surface. Shadow DOM keeps duplicate control IDs out of the live inspector. */
export function createPanelDragPreview(template, panel) {
  const ghost = document.createElement('div');
  ghost.className = 'native-panel-drag-preview';
  ghost.inert = true;
  const shadow = ghost.attachShadow({ mode: 'closed' });
  for (const link of document.querySelectorAll('head link[rel="stylesheet"]'))
    shadow.append(link.cloneNode());
  const shell = document.createElement('section');
  shell.className = 'palette-surface context-panel-group';
  shell.style.height = '100%';
  const bar = template.querySelector('.canvas-panel-microbar').cloneNode(true);
  const header = template.querySelector('.context-panel-header').cloneNode(false);
  const tabs = template.querySelector('.canvas-panel-tabs').cloneNode(false);
  tabs.append(panel.tab.cloneNode(true));
  header.append(tabs);
  shell.append(bar, header, panel.content.cloneNode(true));
  shadow.append(shell);
  document.body.append(ghost);
  return ghost;
}
