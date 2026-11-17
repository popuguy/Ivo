import { installTabBar } from '../../../src/features/workspace/tabs.js';
import { showNavigationMenu } from '../../../src/features/workspace/menu.js';
import { tabMarkup } from '../../../src/features/workspace/views.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const host = document.querySelector('#host'),
  source = document.querySelector('#source'),
  calls = [],
  errors = [],
  tabs = { one: [{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }], two: [{ id: 'd' }] };
let permitted = true,
  denied = '',
  fail = false,
  controller;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
const bar = (group) => host.querySelector(`[data-workspace-group="${group}"] .document-tabs`),
  button = (id) => host.querySelector(`[data-tab-id="${id}"]`),
  order = (group) =>
    [...bar(group).querySelectorAll('[data-tab-id]')].map((node) => node.dataset.tabId).join('|');
function render() {
  const workspace = {
      active: tabs.one[0].id,
      tabs: Object.values(tabs)
        .flat()
        .map((tab) => ({ ...tab, kind: 'document', docId: tab.id })),
      groups: Object.entries(tabs).map(([id, list]) => ({
        id,
        active: list[0].id,
        tabIds: list.map((tab) => tab.id),
      })),
    },
    docs = workspace.tabs.map((tab) => ({ id: tab.docId, title: 'Document ' + tab.id }));
  host.innerHTML = Object.entries(tabs)
    .map(
      ([group]) =>
        `<section class="workspace-pane" data-workspace-group="${group}"><nav class="document-tabs">${tabMarkup({ group: workspace.groups.find((item) => item.id === group), workspace, docs })}</nav></section>`,
    )
    .join('');
}
function mount(detaching = true, nativeMenu) {
  controller = installTabBar(host, {
    nativeMenu,
    getTabs: (group) => tabs[group],
    allowed: () => permitted,
    canAction: (action) => action !== denied,
    getActions: () => [{ action: 'document-rename', label: 'Rename <document>…' }],
    onError: (error) => errors.push(error.message),
    onMove: (id, index, group) => calls.push(['move', id, index, group]),
    onPin: (id, pinned) => calls.push(['pin', id, pinned]),
    onClose: (id) => calls.push(['close', id]),
    onSplit: (id, axis) => calls.push(['split', id, axis]),
    onAction: (action, id) => {
      calls.push(['action', action, id]);
      if (action === 'new-tab') source.focus();
      if (fail) return Promise.reject(Error('Action rejected'));
    },
    onDetach: detaching ? (id, payload) => calls.push(['detach', id, payload]) : undefined,
    onDrag: (phase, payload) => calls.push(['drag', phase, payload]),
  });
}
function context(id, extra = {}) {
  button(id).dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: innerWidth - 2,
      clientY: innerHeight - 2,
      ...extra,
    }),
  );
  return document.querySelector('.tab-context-menu');
}
function key(target, key, extra = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  );
}
function pointer(type, target, x, y) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 45,
      pointerType: 'mouse',
      button: 0,
      buttons: ['pointerup', 'pointercancel'].includes(type) ? 0 : 1,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
    }),
  );
}
function begin(id = 'a') {
  const r = button(id).getBoundingClientRect();
  pointer('pointerdown', button(id), r.x + 12, r.y + 12);
  return r;
}
function choose(value) {
  const item = document.querySelector(`[data-tab-option="${value}"]`);
  assert(item && !item.disabled, 'Missing/disabled menu action ' + value);
  item.click();
}
async function testNativeTabMenus() {
  render();
  calls.length = 0;
  let request, resolveNative;
  mount(true, (items, options) => {
    request = { items, options };
    return new Promise((resolve) => (resolveNative = resolve));
  });
  context('b');
  assert(
    !document.querySelector('.tab-context-menu') && request.options.anchor === button('b'),
    'Native opt-in also opened HTML menu or lost anchor',
  );
  assert(
    request.items.find((item) => item.id === 'pin').checked === true &&
      request.items.find((item) => item.id === 'document-rename').label === 'Rename <document>…',
    'Native tab menu lost check/file action',
  );
  source.focus();
  resolveNative('document-rename');
  await tick();
  assert(
    calls.at(-1).join('|') === 'action|document-rename|b' && document.activeElement === source,
    'Native background tab action lost owner or stole source focus',
  );
  calls.length = 0;
  context('a');
  assert(
    request.items.find((item) => item.id === 'left').enabled === false,
    'Native disabled edge action enabled',
  );
  resolveNative('left');
  await tick();
  assert(!calls.length, 'Disabled native action executed');
  context('b');
  resolveNative('unknown-action');
  await tick();
  assert(!calls.length, 'Unknown native action executed');
  context('b');
  const stale = resolveNative;
  controller.cancel();
  stale('close');
  await tick();
  assert(!calls.length, 'Canceled native result executed');
  context('b');
  const blurred = resolveNative;
  window.dispatchEvent(new Event('blur'));
  blurred('close');
  await tick();
  assert(!calls.length, 'Blurred native result executed');
  context('a');
  const first = resolveNative;
  context('b');
  const second = resolveNative;
  first('close');
  second('pin');
  await tick();
  assert(
    calls.length === 1 && calls[0].join('|') === 'pin|b|false',
    'Replaced native result changed wrong tab',
  );
  calls.length = 0;
  context('b');
  denied = 'document-rename';
  resolveNative('document-rename');
  await tick();
  denied = '';
  assert(!calls.length, 'Changed native capability was ignored');
  context('b');
  permitted = false;
  resolveNative('close');
  await tick();
  permitted = true;
  assert(!calls.length, 'Native action executed after view became blocked');
  controller.destroy();
  mount(true, () => Promise.reject(Error('Native menu rejected')));
  context('b');
  await tick();
  assert(errors.includes('Native menu rejected'), 'Native menu failure was unhandled');
  controller.destroy();
  globalThis.ivoNative = {
    showNavigationMenu: async () => {
      throw Error('Bridge unavailable');
    },
  };
  mount(true, (items, options) => showNavigationMenu(items, options));
  calls.length = 0;
  context('b');
  await tick();
  const fallback = document.querySelector('[data-navigation-action="document-rename"]');
  assert(fallback, 'Native bridge fallback did not open');
  fallback.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  fallback.click();
  await tick();
  assert(
    calls.at(-1)?.join('|') === 'action|document-rename|b',
    'Native fallback pointer down invalidated valid selection',
  );
  controller.destroy();
  delete globalThis.ivoNative;
}

async function testNavigationMenus() {
  const items = [
    { type: 'separator' },
    { id: 'rename', label: 'Rename <source>…' },
    {
      label: 'Copy path',
      submenu: [
        { id: 'relative', label: 'Relative path' },
        { id: 'absolute', label: 'Absolute path' },
        { id: 'relative', label: 'Duplicate ID' },
      ],
    },
    { id: 'blocked', label: 'Unavailable', disabled: true },
    { type: 'separator' },
  ];
  let received;
  globalThis.ivoNative = {
    showNavigationMenu: async (values) => {
      received = values;
      return 'rename';
    },
  };
  assert((await showNavigationMenu(items)) === 'rename', 'Native selected action was lost');
  assert(
    received.length === 3 &&
      received[2].enabled === false &&
      received[1].submenu.length === 2 &&
      received[0].label === 'Rename <source>…',
    'Native menu normalization lost semantics',
  );
  globalThis.ivoNative.showNavigationMenu = async () => 'blocked';
  assert((await showNavigationMenu(items)) === null, 'Disabled native action was accepted');
  globalThis.ivoNative.showNavigationMenu = async () => 'unknown';
  assert((await showNavigationMenu(items)) === null, 'Unknown native action was accepted');
  globalThis.ivoNative.showNavigationMenu = async (values) => {
    received = values;
    return null;
  };
  await showNavigationMenu(
    Array.from({ length: 80 }, (_, i) => ({ id: 'action-' + i, label: 'Action ' + i })),
  );
  assert(received.length === 50, 'Native menu bound was not applied');
  let firstResolve, secondResolve;
  globalThis.ivoNative.showNavigationMenu = () =>
    new Promise((resolve) => {
      if (!firstResolve) firstResolve = resolve;
      else secondResolve = resolve;
    });
  const stale = showNavigationMenu(items),
    fresh = showNavigationMenu(items);
  firstResolve('rename');
  secondResolve('relative');
  assert(
    (await stale) === null && (await fresh) === 'relative',
    'Stale native result was accepted',
  );
  globalThis.ivoNative.showNavigationMenu = async () => {
    throw Error('Native unavailable');
  };
  let pending = showNavigationMenu(items, {
    anchor: button('a'),
    x: innerWidth - 1,
    y: innerHeight - 1,
  });
  await tick();
  let menu = document.querySelector('.navigation-context-menu');
  assert(
    menu &&
      menu.querySelector('button').textContent === 'Rename <source>…' &&
      !menu.querySelector('source'),
    'Native failure fallback/escaped labels incorrect',
  );
  assert(
    menu.getBoundingClientRect().right <= innerWidth &&
      menu.getBoundingClientRect().bottom <= innerHeight,
    'Navigation menu exceeds viewport',
  );
  key(document.activeElement, 'ArrowDown');
  const owner = document.activeElement;
  assert(
    owner.textContent === 'Copy path' && owner.getAttribute('aria-haspopup') === 'menu',
    'Submenu parent not keyboard reachable',
  );
  key(owner, 'ArrowRight');
  assert(
    document.querySelectorAll('.navigation-context-menu').length === 2 &&
      document.activeElement.dataset.navigationAction === 'relative' &&
      owner.getAttribute('aria-expanded') === 'true',
    'Right did not enter submenu',
  );
  key(document.activeElement, 'End');
  assert(document.activeElement.dataset.navigationAction === 'absolute', 'Submenu End failed');
  key(document.activeElement, 'ArrowLeft');
  assert(
    document.querySelectorAll('.navigation-context-menu').length === 1 &&
      document.activeElement === owner &&
      owner.getAttribute('aria-expanded') === 'false',
    'Left did not return to parent',
  );
  key(owner, 'ArrowRight');
  key(document.activeElement, 'Escape');
  assert(
    document.querySelectorAll('.navigation-context-menu').length === 1 &&
      document.activeElement === owner,
    'Submenu Escape closed entire menu',
  );
  key(owner, 'Escape');
  assert(
    (await pending) === null &&
      !document.querySelector('.navigation-context-menu') &&
      document.activeElement === button('a'),
    'Root Escape did not dismiss/restore owner',
  );
  delete globalThis.ivoNative;
  pending = showNavigationMenu(items, { anchor: button('a'), x: innerWidth - 1, y: 40 });
  await tick();
  menu = document.querySelector('.navigation-context-menu');
  const parent = [...menu.querySelectorAll('button')].find(
    (item) => item.textContent === 'Copy path',
  );
  parent.dispatchEvent(new PointerEvent('pointerenter'));
  await tick();
  const child = document.querySelectorAll('.navigation-context-menu')[1];
  assert(
    child &&
      child.getBoundingClientRect().right <= innerWidth &&
      child.getBoundingClientRect().left >= 0,
    'Hovered submenu does not fit viewport',
  );
  child.querySelector('[data-navigation-action="absolute"]').click();
  assert(
    (await pending) === 'absolute' && !document.querySelector('.navigation-context-menu'),
    'Submenu action ID missing',
  );
  pending = showNavigationMenu(items, { anchor: button('a') });
  await tick();
  source.focus();
  source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert(
    (await pending) === null && document.activeElement === source,
    'Outside dismissal stole new focus',
  );
  const removed = document.createElement('button');
  removed.textContent = 'Temporary owner';
  host.append(removed);
  pending = showNavigationMenu(items, { anchor: removed });
  await tick();
  removed.remove();
  key(document.activeElement, 'Escape');
  assert((await pending) === null, 'Detached owner prevented menu dismissal');
  const replaced = showNavigationMenu(items, { anchor: button('a') });
  await tick();
  pending = showNavigationMenu([{ id: 'next', label: 'Next menu' }], { anchor: button('b') });
  assert(
    (await replaced) === null && document.querySelectorAll('.navigation-context-menu').length === 1,
    'New menu did not settle previous one',
  );
  document.querySelector('[data-navigation-action="next"]').click();
  assert((await pending) === 'next', 'Replacement menu failed');
  pending = showNavigationMenu(items, { anchor: button('a') });
  await tick();
  window.dispatchEvent(new Event('blur'));
  assert(
    (await pending) === null && !document.querySelector('.navigation-context-menu'),
    'Blur retained menu',
  );
  assert(
    (await showNavigationMenu([{ id: 'none', label: 'Disabled only', enabled: false }])) === null &&
      !document.querySelector('.navigation-context-menu'),
    'Disabled-only menu opened',
  );
}

try {
  render();
  mount();
  await tick();
  let menu = context('b');
  assert(menu && menu.querySelectorAll('button').length === 15, 'Rich tab menu missing actions');
  assert(
    menu.querySelector('[data-tab-option="document-rename"]').textContent ===
      'Rename <document>…' && !menu.querySelector('document'),
    'Additional file menu text was interpreted as markup',
  );
  assert(
    menu.querySelector('[data-tab-option="pin"]').getAttribute('aria-checked') === 'true',
    'Pinned state incorrect',
  );
  assert(
    menu.getBoundingClientRect().right <= innerWidth &&
      menu.getBoundingClientRect().bottom <= innerHeight,
    'Menu is outside viewport',
  );
  choose('close-right');
  assert(calls.at(-1).join('|') === 'action|close-right|b', 'Menu lost its captured tab owner');
  for (const action of [
    'new-tab',
    'duplicate-view',
    'open-new-window',
    'close-others',
    'close-left',
    'close-all',
    'document-rename',
  ]) {
    context('b');
    choose(action);
    assert(calls.at(-1).join('|') === 'action|' + action + '|b', 'Wrong action/owner ' + action);
    if (action === 'new-tab')
      assert(document.activeElement === source, 'Menu stole focus after action callback');
  }
  context('b');
  choose('pin');
  assert(calls.at(-1).join('|') === 'pin|b|false', 'Unpin state not routed');
  context('b');
  choose('split-down');
  assert(calls.at(-1).join('|') === 'split|b|column', 'Split-down axis incorrect');
  context('b');
  choose('right');
  assert(calls.at(-1).slice(0, 3).join('|') === 'move|b|2', 'Move menu index incorrect');
  context('b');
  choose('close');
  assert(calls.at(-1).join('|') === 'close|b', 'Close menu owner incorrect');
  context('b');
  choose('detach');
  assert(calls.at(-1)[0] === 'detach' && calls.at(-1)[1] === 'b', 'Move-window menu did not route');
  menu = context('a');
  assert(
    menu.querySelector('[data-tab-option="close-left"]').disabled &&
      menu.querySelector('[data-tab-option="left"]').disabled,
    'Left-edge actions were enabled',
  );
  key(document.activeElement, 'End');
  assert(
    document.activeElement.dataset.tabOption === 'document-rename',
    'End did not focus final action',
  );
  key(document.activeElement, 'Escape');
  assert(
    !document.querySelector('.tab-context-menu') && document.activeElement === button('a'),
    'Escape lost tab focus',
  );
  key(button('d'), 'F10', { shiftKey: true });
  menu = document.querySelector('.tab-context-menu');
  assert(
    menu.querySelector('[data-tab-option="close-others"]').disabled &&
      menu.querySelector('[data-tab-option="close-right"]').disabled,
    'Single-tab close options enabled',
  );
  key(document.activeElement, 'Home');
  assert(document.activeElement.dataset.tabOption === 'new-tab', 'Home did not focus first action');
  key(document.activeElement, 'ArrowUp');
  assert(
    document.activeElement.dataset.tabOption === 'document-rename',
    'Arrow navigation did not wrap',
  );
  source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert(!document.querySelector('.tab-context-menu'), 'Outside pointer did not dismiss menu');
  denied = 'duplicate-view';
  menu = context('b');
  assert(
    menu.querySelector('[data-tab-option="duplicate-view"]').disabled,
    'Host capability did not disable action',
  );
  controller.cancel();
  denied = '';
  fail = true;
  context('b');
  choose('duplicate-view');
  await tick();
  assert(
    errors.join('|') === 'Action rejected' && !document.querySelector('.tab-context-menu'),
    'Async action error was unhandled',
  );
  fail = false;
  permitted = false;
  assert(!context('b'), 'Blocked menu opened');
  permitted = true;
  // Reordering retains source selection and only reports the completed final index.
  calls.length = 0;
  source.focus();
  getSelection().setBaseAndExtent(source.firstChild, 0, source.firstChild, 8);
  let r = begin(),
    last = button('c').getBoundingClientRect();
  pointer('pointermove', host, last.right - 1, last.y + 12);
  assert(
    order('one') === 'b|c|a' && document.querySelector('.tab-drag-ghost'),
    'Drag preview did not reorder',
  );
  pointer('pointerup', host, last.right - 1, last.y + 12);
  assert(
    calls.some(
      (call) => call[0] === 'move' && call[1] === 'a' && call[2] === 2 && call[3] === 'one',
    ),
    'Final reorder index missing',
  );
  assert(
    document.activeElement === source && getSelection().toString() === 'Retained',
    'Reorder lost source focus/selection',
  );
  assert(
    !document.querySelector('.tab-drag-ghost') && !host.querySelector('.tab-reordering'),
    'Drag chrome remained',
  );
  assert(
    !button('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    'Drag-release click was not consumed',
  );
  await tick();
  // Dropping inside the document, or canceling after crossing panes, restores the original DOM.
  render();
  calls.length = 0;
  r = begin();
  pointer('pointermove', host, r.x + 80, 200);
  let ghost = document.querySelector('.tab-drag-ghost');
  assert(
    Math.abs(
      parseFloat(ghost.style.top) -
        (200 - calls.find((call) => call[0] === 'drag' && call[1] === 'start')[2].grabOffsetY),
    ) < 1,
    'Detached ghost did not follow vertical movement',
  );
  pointer('pointerup', host, r.x + 80, 200);
  assert(
    order('one') === 'a|b|c' && !calls.some((call) => call[0] === 'move' || call[0] === 'detach'),
    'Inside-window nonbar drop committed',
  );
  assert(calls.at(-1)[1] === 'cancel', 'Canceled drop did not notify native preview');
  calls.length = 0;
  r = begin();
  let other = button('d').getBoundingClientRect();
  pointer('pointermove', host, other.right + 6, other.y + 12);
  assert(order('two') === 'd|a', 'Cross-pane preview missing');
  key(button('a'), 'Escape');
  assert(
    order('one') === 'a|b|c' && order('two') === 'd' && !document.querySelector('.tab-drag-ghost'),
    'Cross-pane Escape did not roll back',
  );
  calls.length = 0;
  r = begin();
  other = button('d').getBoundingClientRect();
  pointer('pointermove', host, other.right + 6, other.y + 12);
  pointer('pointerup', host, other.right + 6, other.y + 12);
  assert(
    calls.some(
      (call) => call[0] === 'move' && call[1] === 'a' && call[2] === 1 && call[3] === 'two',
    ),
    'Cross-pane transfer not reported',
  );
  // Outside release is distinct from a reorder and leaves source removal to the native owner.
  render();
  calls.length = 0;
  r = begin();
  pointer('pointermove', host, innerWidth + 40, r.y + 90);
  const started = calls.find((call) => call[0] === 'drag' && call[1] === 'start')[2];
  assert(
    started.tabId === 'a' &&
      started.label === 'Document a' &&
      started.grabOffsetX ===
        r.x + 12 - button('a').closest('.document-tab').getBoundingClientRect().x &&
      started.grabOffsetY ===
        r.y + 12 - button('a').closest('.document-tab').getBoundingClientRect().y &&
      started.outside,
    'Native drag payload incomplete ' + JSON.stringify(started),
  );
  pointer('pointerup', host, innerWidth + 45, r.y + 95);
  assert(
    order('one') === 'a|b|c' && order('two') === 'd',
    'Detach altered source ownership before host accepted it',
  );
  assert(
    calls.at(-2)[0] === 'drag' &&
      calls.at(-2)[1] === 'end' &&
      calls.at(-2)[2].disposition === 'detach' &&
      calls.at(-2)[2].detached &&
      calls.at(-1)[0] === 'detach',
    'Native preview did not end before detach',
  );
  assert(
    !calls.some((call) => call[0] === 'move') && !document.querySelector('.tab-drag-ghost'),
    'Detach also reordered or retained chrome',
  );
  assert(
    !controller.completeExternalDrop({
      ...started,
      screenX: window.screenX + innerWidth + 100,
      screenY: window.screenY + 200,
    }),
    'Late host release accepted after completion',
  );
  // Host fallback release must match the live drag, use finite outside coordinates, and be idempotent.
  calls.length = 0;
  r = begin();
  pointer('pointermove', host, r.x + 90, 200);
  const live = calls.find((call) => call[0] === 'drag' && call[1] === 'start')[2];
  assert(
    !controller.completeExternalDrop({
      ...live,
      dragId: live.dragId + 1,
      screenX: window.screenX + innerWidth + 30,
      screenY: window.screenY + 200,
    }),
    'Stale host drag accepted',
  );
  assert(
    !controller.completeExternalDrop({ ...live, screenX: NaN, screenY: 200 }),
    'Invalid host coordinate accepted',
  );
  assert(
    !controller.completeExternalDrop({
      ...live,
      screenX: window.screenX + 200,
      screenY: window.screenY + 200,
    }),
    'Inside-window host release detached',
  );
  assert(
    controller.completeExternalDrop({
      ...live,
      screenX: window.screenX + innerWidth + 30,
      screenY: window.screenY + 200,
    }),
    'Outside host release not completed',
  );
  assert(
    calls.at(-1)[0] === 'detach' && order('one') === 'a|b|c',
    'Host release lost source order',
  );
  calls.length = 0;
  r = begin();
  pointer('pointermove', host, innerWidth + 40, 200);
  window.dispatchEvent(new Event('blur'));
  assert(
    !calls.some((call) => call[0] === 'detach') &&
      calls.at(-1)[1] === 'cancel' &&
      !document.querySelector('.tab-drag-ghost'),
    'Focus loss detached or retained drag',
  );
  controller.destroy();
  render();
  mount(false);
  calls.length = 0;
  menu = context('a');
  assert(
    !menu.querySelector('[data-tab-option="detach"]') &&
      !menu.querySelector('[data-tab-option="open-new-window"]'),
    'Unsupported window commands were shown',
  );
  controller.cancel();
  r = begin();
  pointer('pointermove', host, innerWidth + 40, 200);
  pointer('pointerup', host, innerWidth + 40, 200);
  assert(
    !calls.some((call) => call[0] === 'move' || call[0] === 'detach') && order('one') === 'a|b|c',
    'Browser-only outside release changed ownership',
  );
  controller.destroy();
  assert(
    !document.querySelector('.tab-context-menu,.tab-drag-ghost'),
    'Destroy retained interaction chrome',
  );
  await testNativeTabMenus();
  await testNavigationMenus();
  console.log(
    'IVO_TAB_INTERACTION_RESULT:' +
      JSON.stringify({
        ok: true,
        richCapturedOwnerMenus: true,
        keyboardMenus: true,
        capabilitiesAndAsyncErrors: true,
        retainedSourceAndSelection: true,
        reorderAndCrossPane: true,
        canceledPreviewRollback: true,
        followPointerPreview: true,
        outsideReleaseToNativeOwner: true,
        hostReleaseSessionValidation: true,
        terminalBeforeDetach: true,
        unsupportedWindowsHidden: true,
        nativeTabMenus: true,
        nativeTabCancelGeneration: true,
        nativeNavigationMenus: true,
        keyboardSubmenus: true,
        sourceSafeMenuDismissal: true,
        staleNativeResultsRejected: true,
      }),
  );
} catch (error) {
  controller?.destroy();
  console.log(
    'IVO_TAB_INTERACTION_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
