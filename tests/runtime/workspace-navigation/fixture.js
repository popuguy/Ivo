import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { CURRENT_ARCHIVE_VERSION } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait = async (predicate, message = 'Workspace app timeout') => {
    for (let i = 0; i < 250; i++) {
      if (predicate()) return;
      await tick();
    }
    throw Error(message + ': ' + document.querySelector('#app').textContent.slice(0, 450));
  };
const reload = JSON.parse(sessionStorage.getItem('ivo-nav-reload') || 'null');
const make = (id, title, text) => {
  const d = createSceneDocument(title);
  d.id = id;
  const f = insertObject(d, 'text', d.pages[0].id, {
    x: 48,
    y: 48,
    w: 516,
    h: 696,
    html: `<p>${text}</p>`,
  });
  startTextFlow(d, f.id);
  return d;
};
const documents = new Map(
    (
      reload?.docs || [
        make('nav-a', 'Alpha', 'Alpha original notes.'),
        make('nav-b', 'Beta', 'Beta original notes.'),
        make('nav-c', 'Gamma', 'Gamma original notes.'),
      ]
    ).map((doc) => [doc.id, doc]),
  ),
  assets = new Map(reload?.assets || []),
  meta = new Map(reload?.meta || [['initialized', true]]);
let command,
  close,
  nativeHistory,
  holdAssets = false,
  assetHeld = false,
  releaseAsset;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
globalThis.ivoNative = {
  platform: 'macos',
  zoomFactor: () => 1,
  onCommand: (callback) => (command = callback),
  onPrepareClose: (callback) => (close = callback),
  updateHistory: (value) => (nativeHistory = value),
  store: {
    loadDocuments: async () => structuredClone([...documents.values()]),
    loadAssets: async () => structuredClone([...assets.values()]),
    loadAsset: async (id) => structuredClone(assets.get(id) || null),
    saveAsset: async (asset) => {
      if (holdAssets) {
        assetHeld = true;
        await new Promise((resolve) => (releaseAsset = resolve));
      }
      assets.set(asset.id, structuredClone(asset));
    },
    saveDocument: async (doc) => {
      validateImport({
        schemaVersion: CURRENT_ARCHIVE_VERSION,
        documents: [doc],
        assets: [...assets.values()],
      });
      documents.set(doc.id, structuredClone(doc));
    },
    getMeta: async (key) =>
      meta.has(key) ? { id: key, value: structuredClone(meta.get(key)) } : null,
    putMeta: async (key, value) => meta.set(key, structuredClone(value)),
    saveImport: async () => {},
  },
};
const panes = () => [...document.querySelectorAll('[data-workspace-group]')],
  active = () => document.querySelector('.workspace-pane.active'),
  source = () => active().querySelector('.canvas-flow-input'),
  title = () => active()?.querySelector('[data-document-title]')?.value,
  zoom = () => active().querySelector('.zoom-value').textContent;
function key(target, key, extra = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  );
}
function pointer(type, target, x, y, extra = {}) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      pointerId: 15,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  );
}
function activate(pane) {
  const el =
    pane.querySelector('.canvas-flow-input') || pane.querySelector('.canvas-viewport') || pane;
  const r = el.getBoundingClientRect();
  pointer('pointerdown', el, r.x + 14, r.y + 14);
  pointer('pointerup', el, r.x + 14, r.y + 14);
}
function checkSharedControls() {
  const shown = (selector) =>
    [...document.querySelectorAll(selector)].filter((element) => element.getClientRects().length);
  const tools = shown('.canvas-tools');
  const docks = shown('.canvas-panel-dock');
  assert(
    tools.length === 1 && docks.length === 1,
    `Expected one split toolbar and inspector; viewport ${innerWidth} × ${innerHeight}, tools ${tools.length}, docks ${docks.length}, active editor ${active()?.querySelector('.scene-editor')?.className}`,
  );
  const left = tools[0].getBoundingClientRect();
  const right = docks[0].getBoundingClientRect();
  const shell = document.querySelector('.page-workspace').getBoundingClientRect();
  assert(
    Math.abs(left.left - shell.left) < 1 &&
      Math.abs(right.right - shell.right) < 1 &&
      Math.abs(right.bottom - shell.bottom) < 1 &&
      Math.abs(left.top - right.top) < 1,
    'Tools and panels moved inside the active pane: ' + JSON.stringify({ left, right, shell }),
  );
  for (const element of [
    tools[0].querySelector('button'),
    docks[0].querySelector('[role=tab]:not([hidden])'),
  ]) {
    const box = element.getBoundingClientRect();
    assert(
      element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
      'Shared controls are covered',
    );
  }
  assert(active().contains(docks[0]), 'Visible inspector belongs to a passive editor');
  return right.x;
}
async function replaceText(value) {
  await command('document-text');
  await wait(() => source()?.isContentEditable);
  source().focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, value);
  await tick();
}
try {
  await import('../../../src/app/main.js');
  await wait(() => document.querySelector('.canvas-world'));
  await wait(() => document.hasFocus());
  if (reload) {
    assert(panes().length === 3, 'Split layout did not reopen');
    assert(title() === 'Beta', 'Active pane/document did not reopen');
    assert(
      active().querySelector('.canvas-flow-input')?.isContentEditable,
      'Active textFlow editor did not reopen',
    );
    assert(source().textContent === 'Beta edited in its pane.', 'Reopened source differs');
    assert(
      assets.size === 1 && documents.get('nav-a').blocks.some((block) => block.type === 'image'),
      'Owner-bound media did not reopen',
    );
    assert(
      document.querySelector('.workspace-split[data-axis=column]'),
      'Nested vertical split lost',
    );
    assert(
      Math.abs(
        Number(document.querySelector('.workspace-split').style.getPropertyValue('--split-ratio')) -
          0.65,
      ) < 0.001,
      'Saved divider ratio lost',
    );
    assert(
      document.querySelector('[data-action="go-back"]:not(:disabled)'),
      'Navigation history did not persist',
    );
    console.log('IVO_WORKSPACE_NARROW');
    await wait(() => window.ivoWorkspaceNarrow);
    await tick();
    assert(
      panes().filter((pane) => pane.getBoundingClientRect().width > 0).length === 1,
      'Narrow workspace did not focus one pane',
    );
    await command('next-pane');
    await tick();
    assert(
      active().getBoundingClientRect().width > 200 &&
        active().querySelector('.canvas-viewport,.ivo-graph-canvas').getBoundingClientRect().width >
          100,
      'Narrow pane switch mounted a zero-width editor',
    );
    await command('previous-pane');
    console.log('IVO_WORKSPACE_WIDE');
    await wait(() => window.ivoWorkspaceWide);
    await tick();
    const historyBefore = documents.get('nav-b').textFlows[0].html;
    await command('go-back');
    await tick();
    assert(title() === 'Gamma', 'Restored back stack points to wrong document');
    assert(
      documents.get('nav-b').textFlows[0].html === historyBefore,
      'Back navigation modified authored text',
    );
    await close();
    sessionStorage.removeItem('ivo-nav-reload');
    console.log(
      'IVO_WORKSPACE_NAVIGATION_RESULT:' +
        JSON.stringify({
          ok: true,
          nestedSplits: true,
          graphBesideLiveNote: true,
          graphCameraHistory: true,
          graphTracksLinksAndUndo: true,
          retainedNeighborDOM: true,
          sharedCanonicalTextAndUndo: true,
          inputPasteOwnership: true,
          latePassiveEventsRejected: true,
          compositionPaneGuard: true,
          paneKeyboardSelection: true,
          narrowFocusLayout: true,
          pendingMediaOwner: true,
          independentCameras: true,
          sharedControlsInHorizontalAndVerticalSplits: true,
          passiveScrollKeepsActiveDocument: true,
          compactInspectorFollowsActiveDocument: true,
          historyBranchAndViewRestoration: true,
          dividerPointerKeyboardCancellation: true,
          crossPaneTabTransfer: true,
          modifiedRightOpening: true,
          optionsAndNewRightCreation: true,
          modifiedViewToggleRight: true,
          quickSwitcherRightOpening: true,
          mergeAndReopen: true,
          workspaceAndMediaReopened: true,
        }),
    );
  } else {
    await command('toggle-edit');
    await command('document-text');
    await wait(() => source()?.isContentEditable);
    const first = active(),
      firstId = first.dataset.workspaceGroup,
      firstWorld = first.querySelector('.canvas-world'),
      firstSource = source();
    firstSource.focus();
    const node = firstSource.querySelector('p').firstChild;
    getSelection().setBaseAndExtent(node, 0, node, 5);
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    const initialZoom = zoom();
    document.querySelector('[data-action="options"]').click();
    await wait(() => document.querySelector('#dialog [data-action="split-right"]'));
    document.querySelector('#dialog [data-action="split-right"]').click();
    await wait(() => panes().length === 2);
    await tick();
    assert(
      !document.querySelector('#dialog').open,
      'Workspace action did not dismiss its options dialog',
    );
    assert(
      panes().length === 2 && active().dataset.workspaceGroup !== firstId,
      'Split right did not create a second pane',
    );
    assert(
      first.querySelector('.canvas-world') === firstWorld &&
        first.querySelector('.canvas-flow-input') === firstSource,
      'Splitting replaced neighboring source DOM',
    );
    assert(
      !firstSource.isContentEditable &&
        document.querySelectorAll('.canvas-flow-input[contenteditable=true]').length === 1,
      'Two panes retained live text write ownership',
    );
    assert(
      active().querySelector('.canvas-viewport').getBoundingClientRect().width >=
        active().querySelector('.scene-editor').getBoundingClientRect().width - 45,
      'Hidden context panel still reserves a blank grid column',
    );
    await replaceText('Alpha edited through the right view.');
    await wait(
      () => firstSource.textContent === 'Alpha edited through the right view.',
      'Peer text did not update',
    );
    await command('undo');
    await tick();
    assert(
      source().textContent === 'Alpha original notes.' &&
        firstSource.textContent === 'Alpha original notes.',
      'Shared undo did not update both views ' +
        JSON.stringify({
          current: source()?.innerHTML,
          peer: firstSource.innerHTML,
          nativeHistory,
          focused: document.activeElement.outerHTML.slice(0, 200),
          hasFocus: document.hasFocus(),
        }),
    );
    await command('redo');
    await tick();
    assert(
      firstSource.textContent === 'Alpha edited through the right view.',
      'Shared redo did not reach peer ' +
        JSON.stringify({
          current: source()?.innerHTML,
          peer: firstSource.innerHTML,
          nativeHistory,
          focused: document.activeElement.outerHTML.slice(0, 200),
          hasFocus: document.hasFocus(),
        }),
    );
    await command('undo');
    await tick();
    const right = active(),
      _rightId = right.dataset.workspaceGroup;
    document.querySelector('[data-open="nav-b"]').click();
    await wait(() => title() === 'Beta');
    assert(
      first.querySelector('.canvas-world') === firstWorld &&
        first.querySelector('.canvas-flow-input') === firstSource,
      'Navigating the right pane rebuilt its neighbor',
    );
    await command('toggle-edit');
    if (matchMedia('(min-width: 1051px)').matches) checkSharedControls();
    console.log('IVO_WORKSPACE_COMPACT');
    await wait(
      () => matchMedia('(min-width: 761px) and (max-width: 1050px)').matches,
      'Compact split viewport',
    );
    assert(
      ![...document.querySelectorAll('.canvas-panel-dock')].some(
        (dock) => dock.getClientRects().length,
      ),
      'Compact split should keep its inspector hidden until opened',
    );
    await command('show-panel-pages');
    const panelX = checkSharedControls();
    const addPage = active().querySelector(
      '.canvas-panel-content:not([hidden]) [data-canvas-command=add-page]',
    );
    assert(addPage?.getClientRects().length, 'Shared Pages inspector did not open');
    const alphaPages = documents.get('nav-a').pages.length;
    const betaPages = documents.get('nav-b').pages.length;
    addPage.click();
    await close();
    assert(
      documents.get('nav-b').pages.length === betaPages + 1 &&
        documents.get('nav-a').pages.length === alphaPages,
      'Shared Pages inspector edited the wrong document',
    );
    await command('undo');
    await wait(() => !right.querySelector('.scene-editor').inert);
    right.querySelector('[data-canvas-command=tool-direct]').click();
    assert(
      right.querySelector('.scene-editor').dataset.tool === 'direct',
      'Active direct selection was not chosen',
    );
    first.querySelector('.view-header').click();
    await tick();
    assert(
      first.querySelector('[data-canvas-command=tool-direct]').getAttribute('aria-pressed') ===
        'true',
      'Explicit drawing tool did not follow the active document',
    );
    first.querySelector('[data-canvas-command=tool-select]').click();
    assert(checkSharedControls() === panelX, 'Inspector jumped when the left pane was activated');
    key(document.body, 'Tab');
    await tick();
    right.querySelector('.view-header').click();
    assert(
      !right.querySelector('.canvas-tools').getClientRects().length &&
        !right.querySelector('.canvas-panel-dock').getClientRects().length,
      'Switching documents reopened tools hidden with Tab',
    );
    key(document.body, 'Tab');
    await tick();
    assert(checkSharedControls() === panelX, 'Tab did not restore the shared compact inspector');
    activate(right);
    await tick();
    await replaceText('Beta edited in its pane.');
    await close();
    assert(
      documents.get('nav-a').textFlows[0].html.includes('Alpha original notes.') &&
        documents.get('nav-b').textFlows[0].html.includes('Beta edited in its pane.'),
      'Editing the second document changed the first',
    );
    const passiveViewport = first.querySelector('.canvas-viewport');
    const previousTransform = firstWorld.style.transform;
    const focused = document.activeElement;
    passiveViewport.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 26 }),
    );
    await tick();
    assert(
      firstWorld.style.transform !== previousTransform &&
        active() === right &&
        focused === document.activeElement &&
        checkSharedControls() === panelX,
      'Scrolling the neighboring page stole the active inspector or input focus',
    );
    const viewport = active().querySelector('.canvas-viewport');
    viewport.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -25,
        clientX: 1000,
        clientY: 250,
      }),
    );
    await tick();
    const betaZoom = zoom();
    assert(betaZoom !== initialZoom, 'Pane camera did not zoom');
    assert(
      first.querySelector('.zoom-value').textContent === initialZoom,
      'Zoom leaked to neighboring pane ' +
        JSON.stringify({
          initialZoom,
          left: first.querySelector('.zoom-value').textContent,
          betaZoom,
        }),
    );
    document.querySelector('[data-open="nav-c"]').click();
    await wait(() => title() === 'Gamma');
    await command('go-back');
    await wait(() => title() === 'Beta');
    await tick();
    assert(
      zoom() === betaZoom && source()?.isContentEditable,
      'Back did not restore camera/editor state ' +
        JSON.stringify({
          zoom: zoom(),
          expected: betaZoom,
          editable: source()?.isContentEditable,
          text: source()?.textContent,
        }),
    );
    const betaText = source().querySelector('p')?.firstChild || source().firstChild;
    getSelection().setBaseAndExtent(betaText, 0, betaText, 4);
    document.dispatchEvent(new Event('selectionchange'));
    await command('go-forward');
    await wait(() => title() === 'Gamma');
    document.querySelector('[data-open="nav-b"]').click();
    await wait(() => title() === 'Beta');
    await command('toggle-edit');
    await command('document-text');
    active()
      .querySelector('.canvas-viewport')
      .dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -40,
          clientX: 1000,
          clientY: 250,
        }),
      );
    await tick();
    assert(zoom() !== betaZoom, 'Second Beta visit did not get independent view state');
    await command('go-back');
    await wait(() => title() === 'Gamma');
    await command('go-back');
    await wait(() => title() === 'Beta');
    await tick();
    assert(zoom() === betaZoom, 'History revisiting a document reused the wrong cached camera');
    // A delayed image save must remain with Alpha after the active pane changes to Beta.
    activate(first);
    await tick();
    assert(active() === first, 'Pointer focus did not activate the first pane');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const data = canvas.toDataURL(),
      bytes = Uint8Array.from(atob(data.split(',')[1]), (char) => char.charCodeAt(0)),
      file = new File([bytes], 'owned.png', { type: 'image/png' }),
      transfer = new DataTransfer();
    transfer.items.add(file);
    holdAssets = true;
    first
      .querySelector('.canvas-viewport')
      .dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    await wait(() => assetHeld, 'Image import did not reach delayed store');
    activate(right);
    await tick();
    assert(active() === right, 'Pane activation waited for unrelated pending media');
    holdAssets = false;
    releaseAsset();
    await close();
    assert(
      documents.get('nav-a').blocks.filter((block) => block.type === 'image').length === 1 &&
        !documents.get('nav-b').blocks.some((block) => block.type === 'image'),
      'Late media attached to wrong document',
    );
    // Native and DOM commands target the active pane. A body paste inserts once.
    await command('document-text');
    source().focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, 'Beta edited in its pane.');
    const originalAlpha = documents.get('nav-a').textFlows[0].html;
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', ' Pasted once.');
    source().dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
    );
    await tick();
    assert(
      (source().textContent.match(/Pasted once/g) || []).length === 1,
      'Several panes handled one paste',
    );
    await command('undo');
    await close();
    assert(
      source().textContent === 'Beta edited in its pane.' &&
        documents.get('nav-a').textFlows[0].html === originalAlpha,
      'Active-paste undo touched another document ' +
        JSON.stringify({
          beta: source()?.textContent,
          alpha: documents.get('nav-a').textFlows[0].html,
          originalAlpha,
          active: title(),
          hasFocus: document.hasFocus(),
          focused: document.activeElement.outerHTML.slice(0, 200),
        }),
    );
    // Late events/flush from a passive view cannot become another text writer.
    const betaBefore = source().textContent,
      alphaBefore = documents.get('nav-a').textFlows[0].html;
    firstSource.innerHTML = '<p>Stale inactive DOM must not save.</p>';
    const stale = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'x',
    });
    firstSource.dispatchEvent(stale);
    firstSource.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }),
    );
    await close();
    assert(
      stale.defaultPrevented &&
        documents.get('nav-a').textFlows[0].html === alphaBefore &&
        source().textContent === betaBefore,
      'Passive source accepted a late input/write',
    );
    firstSource.innerHTML = alphaBefore;
    // Composition owns its original pane until final source has committed.
    let liveComposition = source();
    liveComposition.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: 'é' }),
    );
    liveComposition.innerHTML = 'Beta edited in its pane. é';
    liveComposition.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: 'é',
        isComposing: true,
      }),
    );
    activate(first);
    assert(active() === right, 'Pane changed before composition completed');
    liveComposition.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'é' }),
    );
    await wait(() => active() === first, 'Queued pane activation did not resume after composition');
    await command('next-pane');
    await wait(() => active() === right && source()?.isContentEditable);
    assert(
      source().textContent === 'Beta edited in its pane. é',
      'Composition was assigned to another pane',
    );
    await command('undo');
    await tick();
    assert(
      source().textContent === betaBefore &&
        documents.get('nav-a').textFlows[0].html === alphaBefore,
      'Composition undo crossed document ownership',
    );
    const focusSource = source(),
      focusText =
        focusSource.firstChild?.nodeType === Node.TEXT_NODE
          ? focusSource.firstChild
          : focusSource.querySelector('p').firstChild;
    focusSource.focus();
    getSelection().setBaseAndExtent(focusText, 0, focusText, 4);
    document.dispatchEvent(new Event('selectionchange'));
    await command('next-pane');
    await command('next-pane');
    await tick();
    assert(
      active() === right &&
        getSelection().toString() === 'Beta' &&
        document.activeElement === source(),
      'Pane keyboard cycling lost source selection',
    );
    // Ratio changes preserve editor nodes and do not enter document undo.
    const divider = document.querySelector('.workspace-divider'),
      split = divider.parentElement,
      r = split.getBoundingClientRect(),
      live = source();
    pointer('pointerdown', divider, r.x + r.width * 0.5, r.y + 30);
    pointer('pointermove', divider, r.x + r.width * 0.65, r.y + 30);
    pointer('pointerup', divider, r.x + r.width * 0.65, r.y + 30);
    await tick();
    assert(
      Math.abs(Number(split.style.getPropertyValue('--split-ratio')) - 0.65) < 0.01 &&
        source() === live,
      'Divider resize replaced source or missed ratio',
    );
    const stableRatio = split.style.getPropertyValue('--split-ratio');
    pointer('pointerdown', divider, r.x + r.width * 0.65, r.y + 30);
    pointer('pointermove', divider, r.x + r.width * 0.3, r.y + 30);
    key(divider, 'Escape');
    assert(
      split.style.getPropertyValue('--split-ratio') === stableRatio,
      'Escape did not cancel divider',
    );
    key(divider, 'ArrowRight');
    key(divider, 'ArrowLeft');
    assert(
      split.style.getPropertyValue('--split-ratio') === stableRatio,
      'Keyboard divider changes did not round-trip',
    );
    // New tabs in one group do not affect its neighbor; tabs may transfer to another group.
    await command('new-tab');
    assert(
      active() === right &&
        right.querySelector('.empty-document-tab') &&
        first.querySelector('.canvas-world') === firstWorld,
      'New tab changed another pane',
    );
    const moved = right.querySelector('[data-tab-id][aria-selected=true]'),
      origin = moved.getBoundingClientRect(),
      target = first.querySelector('.document-tabs').getBoundingClientRect();
    pointer('pointerdown', moved, origin.x + 12, origin.y + 12);
    pointer('pointermove', document.querySelector('#app'), target.right - 12, target.y + 12);
    pointer('pointerup', document.querySelector('#app'), target.right - 12, target.y + 12);
    await tick();
    assert(
      active() === first && first.querySelector('.empty-document-tab'),
      'Cross-pane tab drop did not move its owner',
    );
    await command('close-tab');
    await tick();
    assert(panes().length === 2, 'Closing transferred tab closed an unrelated pane');
    // Cmd+Option-click and quick-switcher modifier opening make right-hand groups.
    document
      .querySelector('[data-open="nav-c"]')
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true, altKey: true }),
      );
    await wait(() => panes().length === 3 && title() === 'Gamma');
    await command('merge-pane');
    await tick();
    assert(panes().length === 2, 'Merging split lost layout');
    await command('quick-switcher');
    const search = document.querySelector('#quick-search');
    search.value = 'Beta';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    key(search, 'Enter', { metaKey: true, altKey: true });
    await wait(() => panes().length === 3 && title() === 'Beta');
    await command('merge-pane');
    await tick();
    assert(panes().length === 2, 'Second split merge failed');
    activate(right);
    await command('document-text');
    const originalTabId = right.querySelector('[data-tab-id][aria-selected=true]').dataset.tabId,
      originalMode = right.querySelector('.scene-editor').classList.contains('scene-editing'),
      viewScale = right.querySelector('.zoom-value').textContent,
      countBeforeView = documents.size;
    active()
      .querySelector('[data-action="toggle-edit"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    await wait(() => panes().length === 3 && active().querySelector('.scene-reading'));
    await tick();
    assert(
      originalMode &&
        right.querySelector('.scene-editing') &&
        documents.size === countBeforeView &&
        zoom() === viewScale,
      'Modified view switch did not preserve original mode/document/camera',
    );
    await command('merge-pane');
    await tick();
    right.querySelector(`[data-tab-id="${originalTabId}"]`).click();
    await wait(
      () =>
        right.querySelector(`[data-tab-id="${originalTabId}"]`).getAttribute('aria-selected') ===
          'true' && right.querySelector('.scene-editing'),
    );
    // A graph can remain beside a live note; its camera survives tab history and topology updates.
    activate(first);
    await tick();
    document.querySelector('[data-action="graph"]').click();
    await wait(() => active().querySelector('.ivo-graph-canvas'));
    const graphPane = active();
    await command('fit-graph');
    await close();
    const graphSaved = meta
      .get('workspace:1')
      .tabs.find(
        (tab) =>
          tab.id === graphPane.querySelector('[data-tab-id][aria-selected=true]').dataset.tabId,
      ).graphState;
    document.querySelector('[data-open="nav-c"]').click();
    await wait(() => title() === 'Gamma');
    await command('go-back');
    await wait(() => active().querySelector('.ivo-graph-canvas'));
    await close();
    const graphRestored = meta
      .get('workspace:1')
      .tabs.find(
        (tab) =>
          tab.id === graphPane.querySelector('[data-tab-id][aria-selected=true]').dataset.tabId,
      ).graphState;
    assert(
      Math.abs(graphSaved.scale - graphRestored.scale) < 1e-9 &&
        Math.abs(graphSaved.center.x - graphRestored.center.x) < 1e-7,
      'Graph history lost its camera',
    );
    activate(right);
    await tick();
    await command('document-text');
    await wait(() => source()?.isContentEditable);
    source().focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, 'Beta edited in its pane. [[Alpha]]');
    await wait(
      () => graphPane.querySelector('.graph-footer')?.textContent.includes('1 connections'),
      'Visible graph did not update after linking',
    );
    await command('undo');
    await wait(
      () => graphPane.querySelector('.graph-footer')?.textContent.includes('0 connections'),
      'Graph did not follow shared link undo',
    );
    assert(
      source().textContent === 'Beta edited in its pane.',
      'Graph refresh replaced neighboring live source',
    );
    if (new URLSearchParams(location.search).has('capture')) {
      await tick();
      console.log('IVO_WORKSPACE_CAPTURE');
      await wait(() => window.ivoWorkspaceCaptured);
    }
    const beforeCreation = documents.size;
    await command('new-document-right');
    await wait(() => panes().length === 3 && title() === 'Untitled');
    await tick();
    const titleInput = active().querySelector('[data-document-title]');
    assert(
      document.activeElement === titleInput &&
        titleInput.selectionStart === 0 &&
        titleInput.selectionEnd === 8,
      'New document to right did not select its title',
    );
    await command('close-tab');
    await tick();
    assert(
      panes().length === 2 && documents.size === beforeCreation + 1,
      'Closing new right pane deleted its note or another pane',
    );
    // Finish on a nested split; persisted history and canonical sources reopen together.
    document.querySelector('[data-open="nav-c"]').click();
    await wait(() => title() === 'Gamma');
    document.querySelector('[data-open="nav-b"]').click();
    await wait(() => title() === 'Beta');
    await command('toggle-edit');
    await command('document-text');
    await command('split-down');
    await tick();
    assert(
      panes().length === 3 && document.querySelector('.workspace-split[data-axis=column]'),
      'Nested split down failed',
    );
    checkSharedControls();
    await command('go-back');
    await tick();
    assert(title() === 'Beta', 'Fresh split unexpectedly inherited navigation history');
    // Seed a useful independent history in the final split and return to Beta in editing mode.
    document.querySelector('[data-open="nav-c"]').click();
    await wait(() => title() === 'Gamma');
    document.querySelector('[data-open="nav-b"]').click();
    await wait(() => title() === 'Beta');
    await command('toggle-edit');
    await command('document-text');
    await close();
    const saved = meta.get('workspace:1');
    assert(
      saved.groups.length === 3 && saved.layout.type === 'split',
      'Workspace did not save split groups',
    );
    assert(
      !JSON.stringify(saved).includes('Beta edited in its pane.'),
      'Workspace serialized source text',
    );
    sessionStorage.setItem(
      'ivo-nav-reload',
      JSON.stringify({
        docs: [...documents.values()],
        assets: [...assets.entries()],
        meta: [...meta.entries()],
      }),
    );
    location.reload();
  }
} catch (error) {
  console.log(
    'IVO_WORKSPACE_NAVIGATION_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
