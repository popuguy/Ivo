import { PANEL_LABELS } from '../../domain/workspace/panels.js';
import { reflectPropertyFormatting } from './ui/publishing-properties.js';
import { globalIndex as flowIndexAtPoint } from '../../rendering/text/flow-source.js';
import { patchComposedFrame } from './text/composed-frame.js';
import { ARRANGE_COMMANDS } from '../../domain/documents/arrange.js';
import { textClipboardHTML } from './text/clipboard.js';
import { ensureTextWrapFlows } from '../../domain/documents/text-wrap.js';
import { reflectTextWrapControls } from './ui/text-wrap-properties.js';
import { statusBarMarkup } from './ui/status-bar.js';
import { handleFieldTab } from '../../shared/ui/keyboard-fields.js';
import { caretInterval } from '../../domain/text/flow-selection.js';
import { installFlowSelection } from './text/flow-selection.js';
import { createNativeInputAnchor } from './text/native-input-anchor.js';
import { hitNativeColumn } from './text/native-composition-geometry.js';
import { createCompositionSession, compositionLayoutKey } from './text/composition-session.js';
import {
  composeNativeTextFlows,
  validateNativeFlowSource,
  nativeFlowColumns,
} from '../../rendering/text/native-flow-layout.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
  OBJECT_CLIPBOARD_TYPE,
  MAX_OBJECT_CLIPBOARD,
} from '../../domain/documents/clipboard.js';
import { validateImport } from '../../domain/documents/schema.js';
import { fontChoices, SYSTEM_FONT_PREFIX } from '../../domain/text/font-catalog.js';
import {
  flowInputHTML,
  projectFlowInput,
  revealFlowEditRange,
  inputColumn,
} from '../../rendering/text/flow-input.js';
import { createContextualBar } from './ui/contextual-bar.js';
import {
  summarizeTextStyle,
  reflectTextStyle,
  textStyleReader,
} from '../../rendering/text/selection-style.js';
import { clearRangeOverrides } from '../../rendering/text/overrides.js';
import { editReferenceRect } from '../../domain/geometry/transform-reference.js';
import { openParentEditor } from './ui/parent-editor.js';
import {
  CURRENT_ARCHIVE_VERSION,
  markTypographyVersion,
  hasNativeParagraphSettings,
} from '../../domain/documents/capabilities.js';
import {
  enablePublishing,
  effectiveTextStyle,
  layerFor,
  objectAvailable,
  orderedPageObjects,
  parentObjects,
} from '../../domain/documents/publishing.js';
import { installPublishingControls } from './ui/publishing-controller.js';
import { applyNamedTextStyles } from '../../rendering/text/styles.js';
import { applyDocumentInput } from '../../rendering/text/document-input.js';
import { moveSingleFrameSelection } from '../../rendering/text/single-frame-navigation.js';
import {
  textDeletionShortcut,
  textNavigationShortcut,
  typeShortcut,
} from '../../domain/text/editing-shortcuts.js';
import { inheritEmptyParagraphTypography } from '../../rendering/text/insertion.js';
import { wordSpacingSettings } from '../../domain/text/word-spacing.js';
import { readImageFile } from './assets/image-import.js';
import { propertiesContent } from './ui/properties.js';
import { documentContent } from '../../domain/history/document-history.js';
import {
  startTextFlow,
  textFlowForFrame,
  frameTextSettings,
  threadFrame,
  enableNativeComposition,
} from '../../domain/documents/text-flows.js';
import { layoutDocumentTextFlows, prepareTextFlowFonts } from '../../rendering/text/flow-layout.js';
import { sceneObjectHTML, applySceneTypography } from '../../rendering/page-content.js';
import {
  selectionRoots,
  selectionBounds,
  sceneRect,
  marqueeSelection,
  toggleSelection,
  transformSelection,
} from '../../domain/geometry/selection.js';
import {
  placeTextCaret,
  captureTextSelection,
  restoreTextSelection,
  rangeFromBookmark,
  bookmarkForRange,
  textIndexMap,
  textIndexAt,
  selectCaretWord,
} from '../../shared/dom/text-selection.js';
import {
  CHARACTER_FIELDS,
  PARAGRAPH_FIELDS,
  validTextAttribute,
} from '../../domain/text/typography.js';
import {
  applyFrameTypography,
  formatRange,
  formatParagraphs,
  rangeUsesFormat,
} from '../../rendering/text/format.js';
import { setTextAttribute } from '../../shared/dom/text-attributes.js';
import { installTooltips } from '../../shared/ui/tooltips.js';
import { installDocumentPreviews } from '../links/previews.js';
import { installWorkspacePanels } from './ui/panels.js';
import { applyPageCamera } from '../../rendering/page-camera.js';
import { icon as svg, cursor, installReferenceCursors } from '../../shared/ui/icons.js';
import { uid } from '../../domain/documents/model.js';
import {
  addPage,
  pagePositions,
  sceneObject,
  childrenOf,
  descendantsOf,
  worldRect,
  insertObject,
  moveVertex,
  transformObject,
  duplicateObjects,
  removeObject,
  removePage,
  releaseMask,
  reorderPage,
  pageAtPoint,
  moveObjectToPage,
  transferObjectsAtDrop,
} from '../../domain/documents/scene.js';
import {
  screenToWorld,
  worldToScreen,
  zoomAt,
  fitCamera,
  wheelDelta,
  panBy,
  pinchWheelScale,
} from '../../domain/geometry/viewport.js';
import { alignmentRectTargets, transformBlock } from '../../domain/geometry/layout.js';
import { escapeHTML as esc, cleanHTML, readableHTML } from '../../shared/html/sanitize.js';
import { scaledPointType } from '../../domain/text/metrics.js';
import { applyTextLayout, preserveTextLines, textIsOverset } from '../../rendering/text/layout.js';
import { clipboardImages, prepareImages } from './assets/image-import.js';
const handles = [
  ['nw', 0, 0],
  ['n', 50, 0],
  ['ne', 100, 0],
  ['e', 100, 50],
  ['se', 100, 100],
  ['s', 50, 100],
  ['sw', 0, 100],
  ['w', 0, 50],
];
const control = (cmd, label, icon = cmd, extra = '') =>
  `<button type="button" data-canvas-command="${cmd}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${svg(icon)}</button>`;
const typing = (target) => target.isContentEditable || !!target.closest('input,textarea,select');
const sessions = new Map();
let snapEnabled = true;
try {
  snapEnabled = localStorage.getItem('ivo:snapping') !== 'false';
} catch {}

/** Renderer owns transient camera/selection/gesture state; document mutations use scene commands. */
export function mountCanvasEditor(host, options) {
  const {
    getDocument,
    onCommit,
    onChange,
    onOpen,
    source,
    onAsset,
    onUndo,
    onRedo,
    onLink,
    onRequestEdit,
  } = options;
  const documentId = getDocument().id,
    initialDocument = structuredClone(getDocument());
  const sessionId = (options.sessionId || 'default') + ':' + documentId;
  const state = {
    ...{
      selected: null,
      activePage: getDocument().pages[0].id,
      tool: 'select',
      inside: null,
      snap: true,
      camera: null,
      target: null,
      panel: 'properties',
    },
    ...structuredClone(sessions.get(sessionId) || {}),
    ...structuredClone(options.initialState || {}),
  };
  if (options.initialState?.camera) state.target = { ...state.camera };
  state.selection = state.selection || (state.selected ? [state.selected] : []);
  state.snap = snapEnabled;
  sessions.set(sessionId, state);
  let flowPlan = { fragments: new Map(), status: new Map() },
    flowSignature = '',
    flowPreviewDirty = true,
    threadFrom = null,
    sceneRevision = 0;
  const flowRenderCache = new Map(),
    panelHTML = new WeakMap();
  let alive = true,
    raf = 0,
    gesture = null,
    space = false,
    pendingFiles = Promise.resolve(),
    pendingCount = 0,
    textBefore = null,
    draft = null,
    activeTextId = null,
    composing = false,
    busy = false,
    textViewBefore = null,
    inputType = '',
    applyingText = false,
    restoring = false,
    savedTextSelection = null,
    pendingMarks = {},
    pendingTextPosition = null,
    flowSelection,
    nativeSession,
    inputAnchor,
    compositionNotice;
  let nativePlan = { fragments: new Map(), status: new Map() },
    nativePlanKey = '',
    nativeError = '';
  const compositionWaiters = [];
  const pointers = new Map();
  let pinch = null,
    selectionDirty = true,
    selectionFrame = null,
    selectionRect = null,
    lastDraftToken = '',
    selectionMembers = [],
    touchBeforeIds = [];
  let parentEditor = null;
  let textSummary = null;
  const ownsInput = () => options.isActive?.() !== false && !parentEditor;
  const canWrite = () => options.canWrite?.() !== false;
  const flowLayoutKey = () => compositionLayoutKey(doc()) + ':' + canWrite();
  const nativeGeometryReady = (event) => {
    const target =
        event?.target instanceof Element
          ? event.target.closest('[data-flow-frame],.canvas-flow-input')
          : null,
      flow = target
        ? textFlowForFrame(doc(), target.dataset.flowFrame || target.dataset.sceneText)
        : sourceTextFlow();
    return !flow?.composition || nativePlanKey === compositionLayoutKey(doc());
  };
  const doc = () => getDocument();
  const objects = () => selectionRoots(doc(), state.selection);
  const object = () => {
    const items = objects();
    return items.length === 1 ? items[0] : null;
  };
  const page = () => doc().pages.find((p) => p.id === state.activePage) || doc().pages[0];
  host.innerHTML = `<div class="scene-editor ${options.editing ? 'scene-editing' : 'scene-reading'}"><nav class="canvas-tools" aria-label="Drawing tools">${[
    ['select', 'Selection (V)'],
    ['direct', 'Direct Selection (A)'],
    ['text', 'Type (T)'],
    ['rectangle', 'Rectangle (M)'],
    ['polygon', 'Polygon (P)'],
    ['hand', 'Hand (H)'],
  ]
    .map(([name, label]) => control('tool-' + name, label, name))
    .join(
      '',
    )}<span class="tool-divider"></span>${control('image', 'Place image', 'image')}${control('inside', 'Draw inside', 'inside')}</nav><div class="canvas-center"><div class="canvas-viewport" tabindex="0" role="region" aria-label="Page workspace"><div class="canvas-world"></div><div class="canvas-input-world" hidden><div class="canvas-flow-clip"><div class="rich-text canvas-text canvas-flow-input"></div></div></div><div class="canvas-guides" aria-hidden="true"></div><div class="canvas-selection"></div><svg class="canvas-draft" aria-hidden="true"></svg><div class="canvas-marquee" hidden aria-hidden="true"></div></div>${statusBarMarkup(control)}</div><aside class="canvas-properties" aria-label="Pages and properties"><div class="canvas-panel-microbar" data-tooltip="Drag to float or dock panels. Double-click to toggle."><button data-canvas-command="close-panel-group" aria-label="Close panel group" data-tooltip="Close tab group">${svg('close')}</button><button data-canvas-command="collapse-properties" aria-label="Collapse panel" data-tooltip="Collapse panel">${svg('panel-collapse')}</button></div><div class="context-panel-header"><nav class="canvas-panel-tabs" role="tablist" aria-label="Context panels">${Object.entries(
    PANEL_LABELS,
  )
    .map(
      ([kind, label]) =>
        `<button role="tab" data-canvas-panel="${kind}" data-tooltip="${label}">${label}</button>`,
    )
    .join(
      '',
    )}</nav><button type="button" data-panel-menu aria-haspopup="menu" aria-expanded="false" aria-label="Panel menu" data-tooltip="Panel menu">${svg('menu')}</button></div><div class="canvas-panel-content"></div></aside><input class="canvas-font-input" type="file" accept=".ttf,.otf" multiple hidden><input class="canvas-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden></div>`;
  const editor = host.firstElementChild,
    viewport = host.querySelector('.canvas-viewport'),
    world = host.querySelector('.canvas-world'),
    selection = host.querySelector('.canvas-selection'),
    guides = host.querySelector('.canvas-guides'),
    draftSVG = host.querySelector('.canvas-draft');
  installReferenceCursors(editor);
  const previews = installDocumentPreviews(editor, {
      getDocument: (id) => options.documents.find((doc) => doc.id === id),
      source,
      onOpen,
      onError: (error) => options.onNotify?.(error.message),
      enabled: () => !options.editing && !busy && !dialogOpen(),
    }),
    tooltips = installTooltips(editor),
    marqueeElement = host.querySelector('.canvas-marquee');
  const workspacePanels = installWorkspacePanels(editor, {
    prepare() {
      finishGesture();
      finishText();
    },
    allowed: () => !busy && !composing && !dialogOpen(),
    initialState: options.panelLayout,
    onCommand: (name) => command(name),
    wrapOptionsShown: () => state.propertyDisclosures?.wrapPanel !== false,
    commandEnabled: (name) => {
      if (name === 'new-parent') return !options.parentMode;
      if (name === 'override-parent') return !options.parentMode && !!page().parentPageId;
      if (name === 'restore-parent') return !options.parentMode && !!page().parentOverrides?.length;
      return true;
    },
    editing: () => options.editing,
    presets: options.panelPresets,
    onError: (error) => options.onNotify?.(error.message),
    onChange: (layout) => options.onPanelLayout?.(layout),
    onSelect: (kind) => {
      state.panel = kind;
    },
    onRender: () => renderPanel(),
  });
  let selectedVertex = null;
  function setSelectionState(ids) {
    const values = typeof ids === 'string' ? [ids] : ids || [];
    const next = selectionRoots(doc(), values).map((item) => item.id);
    if (next.join('|') !== state.selection.join('|')) {
      selectionDirty = true;
      selectedVertex = null;
    }
    state.selection = next;
    state.selected = next.at(-1) || null;
    options.onViewChange?.();
  }
  setSelectionState(state.selection);
  function positions() {
    return pagePositions(doc().pages);
  }
  function pagePosition(id) {
    return positions().find((p) => p.id === id) || positions()[0];
  }
  function objectWorld(item) {
    const rect = worldRect(doc(), item),
      p = pagePosition(item.pageId);
    return { ...rect, x: rect.x + p.x, y: rect.y + p.y };
  }
  function pointer(event) {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function pointOnPage(event, id = state.activePage) {
    const value = screenToWorld(pointer(event), state.camera),
      p = pagePosition(id);
    return { x: value.x - p.x, y: value.y - p.y };
  }
  function requestFrame() {
    if (!raf && alive) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    if (!alive) return;
    applyPageCamera(world, state.camera);
    applyPageCamera(host.querySelector('.canvas-input-world'), state.camera);
    const label = (state.camera.zoom * 100).toFixed(2) + '%';
    const zoomLabel = host.querySelector('.zoom-value');
    if (zoomLabel.textContent !== label) zoomLabel.textContent = label;
    renderPageNavigation();
    renderSelection();
    flowSelection?.sync();
  }
  // Input owns the camera immediately. RAF only coalesces painting to the next display frame.
  function cameraTo(value) {
    state.camera = { ...value };
    state.target = { ...value };
    requestFrame();
  }
  function scrollTextView(unit, forward) {
    const pages = positions(),
      last = pages.at(-1);
    if (!last) return;
    const height = viewport.clientHeight,
      camera = state.camera;
    const top = 24 - pages[0].y * camera.zoom;
    const bottom = Math.min(top, height - 24 - (last.y + last.height) * camera.zoom);
    const y =
      unit === 'scroll-edge' ? (forward ? bottom : top) : camera.y + (forward ? -height : height);
    cameraTo({ ...camera, y: Math.max(bottom, Math.min(top, y)) });
  }
  function fit(all = false) {
    finishGesture();
    const pages = positions(),
      p = all
        ? {
            x: 0,
            y: 0,
            w: Math.max(...pages.map((p) => p.width)),
            h: pages.at(-1).y + pages.at(-1).height,
          }
        : { ...pagePosition(page().id), w: page().width, h: page().height };
    cameraTo(fitCamera(p, { width: viewport.clientWidth, height: viewport.clientHeight }, 48));
  }
  function zoom(factor, anchor = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    finishGesture();
    cameraTo(zoomAt(state.target, anchor, state.target.zoom * factor));
  }
  function tool(name) {
    threadFrom = null;
    finishGesture();
    endTextEditing();
    draft = null;
    const hadVertex = !!selectedVertex;
    selectedVertex = null;
    state.tool = name;
    if (hadVertex) renderPanel();
    editor.dataset.tool = name;
    renderTools();
    renderSelection(true);
  }
  let pageNavigationKey = '';
  function renderPageNavigation() {
    const select = host.querySelector('[data-active-page]'),
      key = JSON.stringify(doc().pages.map(({ id, name }) => [id, name]));
    if (key !== pageNavigationKey) {
      select.innerHTML = doc()
        .pages.map(
          (page, index) =>
            `<option value="${esc(page.id)}">${index + 1} · ${esc(page.name)}</option>`,
        )
        .join('');
      pageNavigationKey = key;
    }
    select.value = state.activePage;
    const index = doc().pages.findIndex((page) => page.id === state.activePage);
    host.querySelector('[data-canvas-command="previous-page"]').disabled = index <= 0;
    host.querySelector('[data-canvas-command="next-page"]').disabled =
      index >= doc().pages.length - 1;
  }
  function renderTools() {
    editor.dataset.tool = state.tool;
    host.querySelectorAll('[data-canvas-command^="tool-"]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.canvasCommand === 'tool-' + state.tool),
      );
      button.disabled = !options.editing && button.dataset.canvasCommand !== 'tool-hand';
    });
    host
      .querySelector('[data-canvas-command="inside"]')
      .setAttribute('aria-pressed', String(!!state.inside));
    editor.dataset.toolLabel = state.inside
      ? 'Draw inside'
      : {
          select: 'Selection',
          direct: 'Direct Selection',
          text: 'Type',
          rectangle: 'Rectangle',
          polygon: 'Polygon',
          hand: 'Hand',
        }[state.tool];
  }
  function select(id) {
    endTextEditing();
    setSelectionState(id);
    const item = object();
    if (item) state.activePage = item.pageId;
    renderPanel();
    renderSelection(true);
  }
  function mutate(callback, label = 'Edit', lockButton = null) {
    finishGesture();
    const viewBefore = captureView();
    if (activeTextId) endTextEditing();
    const before = structuredClone(doc());
    const lockOnly = lockButton && before.publishing;
    try {
      callback();
      // Publishing adoption assigns real layer IDs. Give that first edit the normal rebuild.
      if (lockOnly) updateLock(lockButton, viewBefore);
      else {
        ensureTextWrapFlows(doc());
        validateNativeSources();
        updateFlowPlan();
      }
    } catch (error) {
      const current = doc();
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, before);
      paint();
      throw error;
    }
    onCommit(before, { label, viewBefore, viewAfter: captureView() });
    if (!lockOnly) paint();
    // Locking an automatic continuation is also an authored ownership change.
    // The commit hook can promote that frame; recheck before a pending result lands.
    else if (before.textFlows?.some((flow) => flow.autoPages?.length)) refreshFlowPreview();
  }
  function updateLock(button, viewBefore) {
    const layer = doc().publishing.layers.find((value) => value.id === button.dataset.layerId);
    const target = layer || sceneObject(doc(), button.dataset.objectId);
    button.setAttribute('aria-pressed', String(!!target.locked));
    button.setAttribute(
      'aria-label',
      (target.locked ? 'Unlock ' : 'Lock ') + (layer?.name || 'object'),
    );
    button.dataset.tooltip = button.getAttribute('aria-label');
    // Nested masks and children inherit a parent's or layer's editability.
    const blocks = new Map(doc().blocks.map((item) => [item.id, item]));
    for (const node of world.querySelectorAll('[data-object]')) {
      const item = blocks.get(node.dataset.object);
      if (item) node.style.pointerEvents = objectAvailable(doc(), item) ? '' : 'none';
    }
    setSelectionState(state.selection);
    if (viewBefore.activeTextId || viewBefore.selection.length !== state.selection.length) {
      renderPanel();
      renderSelection(true);
    } else if (layer) {
      for (const row of editor.querySelectorAll('[data-layer-row]'))
        row.classList.toggle('active', row.dataset.layerRow === layer.id);
    }
    requestFrame();
  }
  function validateNativeSources() {
    if (hasNativeParagraphSettings(doc())) {
      const legacy = [
        ...(doc().textFlows || [])
          .filter((flow) => !flow.composition)
          .map((flow) => ({ html: flow.html, settings: flow.style })),
        ...[
          ...doc().blocks,
          ...(doc().publishing?.parents || []).flatMap((parent) => parent.blocks),
        ]
          .filter((block) => ['text', 'quote'].includes(block.type) && !block.textFlowId)
          .map((block) => ({ html: block.html, settings: block })),
      ];
      for (const owner of legacy) validateLegacyParagraphSettings(owner.html, owner.settings);
    }
    for (const flow of doc().textFlows || [])
      if (flow.composition) {
        validateNativeFlowSource(doc(), flow, options.assets?.() || options.fonts?.() || []);
        nativeFlowColumns(doc(), flow);
      }
  }
  function validateLegacyParagraphSettings(html, settings) {
    const root = document.createElement('div');
    root.innerHTML = html || '';
    const summary = summarizeTextStyle(root, doc(), effectiveTextStyle(doc(), settings));
    if (
      (summary.values.paragraphStart && summary.values.paragraphStart !== 'anywhere') ||
      summary.values.keepWithPrevious ||
      summary.values.keepNextLines > 1 ||
      summary.mixed.some((key) =>
        ['keepWithPrevious', 'keepNextLines', 'paragraphStart'].includes(key),
      )
    )
      throw Error(
        'Extended paragraph keeps require native composition in every text flow using this paragraph style.',
      );
    if (summary.mixed.includes('wordSpacing') || wordSpacingSettings(summary.values.wordSpacing))
      throw Error(
        'Word spacing requires native composition in every text flow using this paragraph style.',
      );
  }
  function polygonPoints(item, local = false) {
    return item.points
      .map((p) => `${p.x * (local ? item.w : 100)},${p.y * (local ? item.h : 100)}`)
      .join(' ');
  }
  function objectHTML(item) {
    return sceneObjectHTML(item, {
      document: doc(),
      source,
      flow: flowPlan,
      editing: options.editing,
      editableId: options.editing && state.tool === 'text' ? activeTextId : null,
      textHTML: (item) =>
        options.editing
          ? cleanHTML(item.html)
          : readableHTML(item.html, options.documents, doc().id),
    });
  }
  function pageObjectsHTML(p) {
    const inherited = parentObjects(doc(), p),
      renderDoc = { ...doc(), blocks: [...inherited, ...doc().blocks] };
    const inheritedIds = new Set(inherited.map((b) => b.id));
    return orderedPageObjects(renderDoc, p.id)
      .map((item) =>
        inheritedIds.has(item.id)
          ? `<div class="canvas-parent-art" aria-hidden="true">${sceneObjectHTML(item, { document: renderDoc, source, textHTML: (item) => cleanHTML(item.html) })}</div>`
          : objectHTML(item),
      )
      .join('');
  }
  function renderingDocument() {
    return {
      ...doc(),
      blocks: [...doc().pages.flatMap((p) => parentObjects(doc(), p)), ...doc().blocks],
    };
  }
  function paint() {
    sceneRevision++;
    updateFlowPlan();
    setSelectionState(state.selection);
    selectionDirty = true;
    world.innerHTML = positions()
      .map(
        (p) =>
          `<section class="canvas-page ${p.id === state.activePage ? 'active' : ''}" data-page="${esc(p.id)}" aria-label="${esc(p.name)}" style="left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px"><div class="canvas-page-label">${esc(p.name)}</div>${pageObjectsHTML(p)}</section>`,
      )
      .join('');
    applySceneTypography(world, renderingDocument());
    if (doc().textFlows?.length) {
      flowPreviewDirty = true;
      refreshFlowPreview();
    }
    renderTools();
    renderPanel();
    requestFrame();
  }
  function updateObject(item) {
    selectionDirty = true;
    const element = world.querySelector(`[data-object="${CSS.escape(item.id)}"]`);
    if (!element) return;
    for (const [name, value] of Object.entries({
      left: item.x,
      top: item.y,
      width: item.w,
      height: item.h,
    }))
      element.style[name] = value + 'px';
    const polygon = element.querySelector(':scope > .canvas-polygon polygon');
    if (polygon) {
      polygon.parentElement.setAttribute('viewBox', `0 0 ${item.w} ${item.h}`);
      polygon.setAttribute('points', polygonPoints(item, true));
      polygon.setAttribute('stroke-width', item.strokeWidth);
      const clip = element.querySelector(':scope > .canvas-clip');
      if (clip)
        clip.style.clipPath = `polygon(${item.points.map((p) => `${p.x * 100}% ${p.y * 100}%`).join(',')})`;
    }
    const text = element.querySelector(':scope > .canvas-text');
    if (text) {
      applyFrameTypography(text, effectiveTextStyle(doc(), frameTextSettings(doc(), item)));
      applyTextLayout(text, item);
    }
    for (const child of childrenOf(doc(), item.id)) updateObject(child);
  }
  function renderSelection(force = false) {
    if (force) selectionDirty = true;
    if (selectionDirty) {
      const item = object(),
        items = objects();
      editor.style.setProperty('--selection', item ? layerFor(doc(), item).color : '#4268d4');
      selection.replaceChildren();
      selectionFrame = null;
      selectionRect = null;
      selectionMembers = [];
      if (items.length && options.editing) {
        const rect = selectionBounds(doc(), state.selection);
        const frame = document.createElement('div');
        selectionFrame = frame;
        selectionRect = rect;
        frame.className =
          'canvas-object-frame' +
          (state.tool === 'direct' && item?.type === 'polygon' ? ' direct-frame' : '');
        if (state.tool === 'direct' && item?.type === 'polygon') {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          path.setAttribute('viewBox', '0 0 100 100');
          path.setAttribute('preserveAspectRatio', 'none');
          path.innerHTML = `<polygon points="${polygonPoints(item)}" vector-effect="non-scaling-stroke"/>`;
          frame.append(path);
          for (const point of item.points) {
            const handle = document.createElement('button');
            handle.className = 'canvas-vertex';
            handle.dataset.vertex = point.id;
            handle.setAttribute('aria-label', 'Move polygon point');
            handle.style.left = point.x * 100 + '%';
            handle.style.top = point.y * 100 + '%';
            frame.append(handle);
          }
        } else if (!activeTextId)
          for (const [direction, x, y] of handles) {
            const handle = document.createElement('button');
            handle.className = 'canvas-resize ' + direction;
            handle.dataset.resize = direction;
            handle.setAttribute('aria-label', 'Resize ' + direction);
            handle.style.left = x + '%';
            handle.style.top = y + '%';
            frame.append(handle);
          }
        if (item && !item.textFlowId && !activeTextId && ['text', 'quote'].includes(item.type)) {
          const circle = document.createElement('button');
          circle.className = 'canvas-type-circle ' + (item.textKind || 'area');
          circle.dataset.typeCircle = item.id;
          circle.title =
            'Double-click to convert to ' +
            (item.textKind === 'point' ? 'area' : 'point') +
            ' type';
          circle.setAttribute(
            'aria-label',
            item.textKind === 'point' ? 'Convert to area type' : 'Convert to point type',
          );
          frame.append(circle);
          const text = world.querySelector(`[data-scene-text="${CSS.escape(item.id)}"]`);
          if (text && textIsOverset(text)) {
            const marker = document.createElement('span');
            marker.className = 'canvas-overset';
            marker.textContent = '+';
            marker.title = 'Text overflow';
            frame.append(marker);
          }
        }
        if (items.length > 1)
          for (const member of items) {
            const element = document.createElement('div');
            element.className = 'canvas-selection-member';
            selection.append(element);
            selectionMembers.push({ element, rect: sceneRect(doc(), member) });
          }
        selection.append(frame);
      }
      if (
        item &&
        ['text', 'quote'].includes(item.type) &&
        item.textKind !== 'point' &&
        selectionFrame
      ) {
        const textFlow = textFlowForFrame(doc(), item),
          index = textFlow?.frameIds.indexOf(item.id) ?? 0;
        if (!textFlow) {
          const more = document.createElement('button');
          more.className = 'canvas-type-options';
          more.dataset.canvasCommand = 'type-options';
          more.setAttribute('aria-label', 'Open explore more type options');
          more.dataset.tooltip = 'Open explore more type options';
          more.innerHTML = svg('opentype');
          selectionFrame.append(more);
        }
        for (const direction of ['previous', 'next']) {
          const port = document.createElement('button');
          port.className = 'canvas-flow-port ' + direction;
          port.dataset.flowPort = direction;
          port.dataset.canvasCommand = 'flow-' + direction;
          port.setAttribute(
            'aria-label',
            direction === 'previous'
              ? 'Previous text frame'
              : index < (textFlow?.frameIds.length || 1) - 1
                ? 'Next text frame'
                : 'Continue text flow',
          );
          port.dataset.tooltip = port.getAttribute('aria-label');
          port.classList.toggle(
            'linked',
            direction === 'previous' ? index > 0 : index < (textFlow?.frameIds.length || 1) - 1,
          );
          if (
            direction === 'next' &&
            index === (textFlow?.frameIds.length || 1) - 1 &&
            (textFlow
              ? flowPlan.status.get(textFlow.id)?.overset
              : (() => {
                  const el = world.querySelector(`[data-scene-text="${CSS.escape(item.id)}"]`);
                  return el && textIsOverset(el);
                })())
          ) {
            port.textContent = '+';
            port.classList.add('overset');
          }
          selectionFrame.append(port);
        }
      }
      selectionDirty = false;
    }
    if (selectionFrame) {
      const p = worldToScreen(selectionRect, state.camera),
        z = state.camera.zoom;
      selectionFrame.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      const w = selectionRect.w * z + 'px',
        h = selectionRect.h * z + 'px';
      if (selectionFrame.style.width !== w) selectionFrame.style.width = w;
      if (selectionFrame.style.height !== h) selectionFrame.style.height = h;
    }
    for (const member of selectionMembers) {
      const p = worldToScreen(member.rect, state.camera);
      Object.assign(member.element.style, {
        transform: `translate3d(${p.x}px,${p.y}px,0)`,
        width: member.rect.w * state.camera.zoom + 'px',
        height: member.rect.h * state.camera.zoom + 'px',
      });
    }
    contextualBar.layout(
      selectionFrame
        ? {
            x: selectionRect.x * state.camera.zoom + state.camera.x,
            y: selectionRect.y * state.camera.zoom + state.camera.y,
            w: selectionRect.w * state.camera.zoom,
            h: selectionRect.h * state.camera.zoom,
          }
        : null,
    );
    const token = draft ? JSON.stringify([state.camera, draft]) : '';
    if (token === lastDraftToken) return;
    lastDraftToken = token;
    draftSVG.replaceChildren();
    if (draft) {
      const p = pagePosition(draft.pageId),
        points = [...draft.points, ...(draft.hover ? [draft.hover] : [])].map((v) =>
          worldToScreen({ x: v.x + p.x, y: v.y + p.y }, state.camera),
        );
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', points.map((v) => `${v.x},${v.y}`).join(' '));
      draftSVG.append(poly);
      for (const point of points.slice(0, draft.points.length)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        node.setAttribute('x', point.x - 3);
        node.setAttribute('y', point.y - 3);
        node.setAttribute('width', 6);
        node.setAttribute('height', 6);
        draftSVG.append(node);
      }
    }
  }
  function renderPanel({ visibleOnly = false } = {}) {
    textSummary = readSelectedTextStyle();
    workspacePanels.select(state.panel);
    const selectedObjects = objects(),
      panelEntries = workspacePanels
        .entries()
        .filter(({ content }) => !visibleOnly || !content.hidden),
      index = panelEntries.some(({ kind }) => kind === 'links') ? options.index?.() : undefined;
    for (const { kind, content } of panelEntries) {
      if (kind === 'text-wrap' && content.hidden) {
        content.replaceChildren();
        panelHTML.delete(content);
        continue;
      }
      const html = propertiesContent({
        document: doc(),
        documents: options.documents,
        state: { ...state, panel: kind },
        selectedObjects,
        selectedVertex,
        selectionRect: selectionBounds(doc(), state.selection),
        activePage: page(),
        editing: options.editing,
        parentMode: options.parentMode,
        index,
        flowStatus: flowPlan.status,
        fonts: options.fonts?.() || [],
        systemFonts: options.systemFonts?.() || [],
        textSummary,
        nativeComposition: !!options.textComposition,
      });
      if (!visibleOnly || panelHTML.get(content) !== html) {
        content.innerHTML = html;
        panelHTML.set(content, html);
      }
    }
    reflectTextStyle(editor, textSummary);
    reflectPropertyFormatting(editor, textSummary, options);
    reflectTextWrapControls(editor);
  }
  function readSelectedTextStyle() {
    const item = object();
    if (!item || !['text', 'quote'].includes(item.type)) return null;
    const flow = textFlowForFrame(doc(), item),
      settings = effectiveTextStyle(doc(), frameTextSettings(doc(), item)),
      live = activeTextId === item.id ? activeText() : null,
      root = live || document.createElement('div');
    if (!live) root.innerHTML = flow?.html ?? item.html;
    const fragment = !live && flow && flowPlan.fragments.get(item.id),
      point = (index, affinity) => ({ path: [], offset: 0, index, kind: 'text', affinity }),
      frameRange =
        fragment &&
        rangeFromBookmark(root, {
          anchor: point(fragment.start, 'forward'),
          focus: point(fragment.end, 'backward'),
        });
    return summarizeTextStyle(root, doc(), settings, {
      range: live ? preserveRange() : frameRange || null,
      pending: live ? pendingMarks : {},
    });
  }
  function syncTextStyle() {
    textSummary = readSelectedTextStyle();
    reflectTextStyle(editor, textSummary);
    reflectPropertyFormatting(editor, textSummary, options);
    publishingControls.refreshTextState();
  }
  function rebasePendingMarks() {
    if (pendingTextPosition === null) return;
    const element = activeText(),
      current = element && captureTextSelection(element);
    if (
      current &&
      (current.anchor.index !== current.focus.index || current.focus.index !== pendingTextPosition)
    ) {
      pendingMarks = {};
      pendingTextPosition = null;
    }
  }
  function refreshTextControls() {
    rebasePendingMarks();
    const element = activeText();
    if (element && document.activeElement === element) syncTextStyle();
  }

  async function setFlowComposer(composer) {
    finishText();
    const flow = textFlowForFrame(doc(), object());
    if (!flow || !ownsInput() || !options.editing) return;
    if (composer === 'browser') {
      if (hasNativeParagraphSettings(doc())) {
        try {
          validateLegacyParagraphSettings(flow.html, flow.style);
        } catch (error) {
          options.onNotify?.(error.message);
          renderPanel();
          return;
        }
      }
      mutate(() => {
        delete flow.composition;
      }, 'Change text composer');
      nativeError = '';
      if (compositionNotice) compositionNotice.hidden = true;
      delete editor.dataset.compositionError;
      return;
    }
    const key = compositionLayoutKey(doc()),
      candidate = structuredClone(doc()),
      target = candidate.textFlows.find((f) => f.id === flow.id);
    try {
      if (!options.textComposition) throw Error('This composer requires the native app.');
      enableNativeComposition(candidate, target, composer);
      await composeNativeTextFlows(candidate, {
        compose: options.textComposition.compose,
        allowPages: false,
        assets: options.assets?.() || options.fonts?.() || [],
      });
      if (!alive || key !== compositionLayoutKey(doc())) return;
      mutate(() => enableNativeComposition(doc(), flow, composer), 'Change text composer');
    } catch (error) {
      if (alive && compositionLayoutKey(doc()) === key) {
        options.onNotify?.(error.message);
        renderPanel();
      }
    }
  }

  function updateFlowPlan() {
    const key = flowLayoutKey();
    if (key === flowSignature) return false;
    flowPlan = layoutDocumentTextFlows(doc(), { allowPages: canWrite() });
    for (const flow of doc().textFlows || [])
      if (flow.composition) {
        for (const id of flow.frameIds)
          if (nativePlan.fragments.has(id))
            flowPlan.fragments.set(id, nativePlan.fragments.get(id));
        if (nativePlan.status.has(flow.id))
          flowPlan.status.set(flow.id, nativePlan.status.get(flow.id));
      }
    flowSignature = flowLayoutKey();
    if (doc().textFlows?.some((flow) => flow.composition))
      nativeSession?.request(doc(), {
        assets: options.assets?.() || options.fonts?.() || [],
        allowPages: canWrite(),
      });
    else if (compositionNotice) compositionNotice.hidden = true;
    flowPreviewDirty = true;
    return true;
  }
  function refreshFlowPreview() {
    updateFlowPlan();
    if (!flowPreviewDirty) return;
    flowPreviewDirty = false;
    const ids = new Set(doc().pages.map((p) => p.id)),
      frames = doc().blocks.filter((b) => b.textFlowId),
      frameIds = new Set(frames.map((frame) => frame.id));
    for (const id of flowRenderCache.keys()) if (!frameIds.has(id)) flowRenderCache.delete(id);
    for (const element of world.querySelectorAll('[data-page]'))
      if (!ids.has(element.dataset.page)) element.remove();
    for (const p of positions()) {
      let section = world.querySelector(`[data-page="${CSS.escape(p.id)}"]`);
      if (!section) {
        section = document.createElement('section');
        section.className = 'canvas-page';
        section.dataset.page = p.id;
        section.setAttribute('aria-label', p.name);
        section.innerHTML = `<div class="canvas-page-label">${esc(p.name)}</div>${pageObjectsHTML(p)}`;
        world.append(section);
      }
      Object.assign(section.style, {
        left: p.x + 'px',
        top: p.y + 'px',
        width: p.width + 'px',
        height: p.height + 'px',
      });
    }
    for (const item of frames) {
      const element = world.querySelector(`[data-flow-frame="${CSS.escape(item.id)}"]`);
      if (!element) continue;
      const part = flowPlan.fragments.get(item.id),
        sourceHTML = part?.html || '',
        cached = flowRenderCache.get(item.id);
      element.toggleAttribute('data-native-flow', !!textFlowForFrame(doc(), item)?.composition);
      if (
        cached?.element === element &&
        (cached.part === part || (!part?.native && cached.sourceHTML === sourceHTML))
      )
        continue;
      const html = part?.native
        ? sourceHTML
        : cached?.sourceHTML === sourceHTML
          ? cached.html
          : readableHTML(sourceHTML, options.documents, doc().id, {
              preserveWikiText: true,
              trustedFlow: true,
            });
      if (!(cached?.element === element && patchComposedFrame(element, cached.part, part)))
        element.innerHTML = html;
      flowRenderCache.set(item.id, { sourceHTML, html, element, part });
    }
    applySceneTypography(world, renderingDocument());
    selectionDirty = true;
    requestFrame();
  }
  function sourceCaretIndex() {
    const element = activeText(),
      selection = window.getSelection();
    if (!element || !selection.rangeCount || !element.contains(selection.focusNode)) return null;
    // Keep a cross-frame range anchored in its first physical column. Hiding its
    // selected prefix makes Chromium collapse the native range during reflow.
    const range = selection.getRangeAt(0);
    return textIndexAt(textIndexMap(element), range.startContainer, range.startOffset);
  }
  function sourceTextFlow(element = activeText()) {
    return element?.dataset.textFlow
      ? doc().textFlows?.find((textFlow) => textFlow.id === element.dataset.textFlow)
      : null;
  }
  let lastFlowPosition = null;
  function hideFlowInput() {
    lastFlowPosition = null;
    inputAnchor?.reset();
    host.querySelector('.canvas-input-world').hidden = true;
    host.querySelector('.canvas-input-world').classList.remove('flow-range-active');
    for (const preview of world.querySelectorAll('[data-flow-editing]'))
      delete preview.dataset.flowEditing;
  }
  function positionFlowInput(
    item,
    offset,
    affinity = flowSelection?.selection()?.focus.affinity ||
      captureTextSelection(activeText())?.focus.affinity ||
      'forward',
  ) {
    if (!item) return;
    const element = host.querySelector('.canvas-flow-input'),
      layer = host.querySelector('.canvas-input-world'),
      clip = layer.querySelector('.canvas-flow-clip'),
      fragment = flowPlan.fragments.get(item.id),
      column = inputColumn(fragment, item, offset, affinity),
      position = objectWorld(item),
      sx = item.textScale?.x || 1,
      sy = item.textScale?.y || 1;
    const native = !!sourceTextFlow(element)?.composition,
      wrapped = !!column.wrap;
    const positionKey = [
      item.id,
      column.index,
      position.x,
      position.y,
      column.left,
      column.top,
      column.width,
      column.height,
      sx,
      sy,
      item.w,
      item.h,
      item.rotation,
      state.camera.x,
      state.camera.y,
      state.camera.zoom,
    ].join('/');
    if (native && positionKey === lastFlowPosition && element.dataset.projectedStart === '0')
      return;
    lastFlowPosition = native ? positionKey : null;
    element.toggleAttribute('data-flow-wrap', wrapped);
    element.classList.toggle('wrapped-composition-input', wrapped);
    element.classList.toggle('native-composition-input', native);
    if (!native && !wrapped) inputAnchor?.reset();
    for (const preview of world.querySelectorAll('[data-flow-editing]'))
      delete preview.dataset.flowEditing;
    const preview = world.querySelector(`[data-flow-frame="${CSS.escape(item.id)}"]`),
      physical = preview?.querySelectorAll('.flow-column')[column.index || 0] || preview;
    if (physical && !native && !wrapped) physical.dataset.flowEditing = '';
    Object.assign(clip.style, {
      left: position.x + column.left * sx + 'px',
      top: position.y + column.top * sy + 'px',
      width: column.width * sx + 'px',
      height: column.height * sy + 'px',
      transform: `rotate(${item.rotation || 0}deg)`,
      transformOrigin: `${item.w / 2 - column.left * sx}px ${item.h / 2 - column.top * sy}px`,
    });
    Object.assign(element.style, {
      width: column.width + 'px',
      height: column.height + 'px',
      columnWidth: column.width + 'px',
      columnGap: '0px',
      columnFill: 'auto',
      columnCount: 'auto',
      transform: `scale(${sx},${sy})`,
    });
    projectFlowInput(element, native ? 0 : column.start);
    // Native selection scrolling must not move the input independently of its page.
    element.scrollTop = element.scrollLeft = clip.scrollTop = clip.scrollLeft = 0;
    applyPageCamera(layer, state.camera);
    // Moving the retained input between exclusion segments changes its native
    // caret query even when the painted fragment/source generation is unchanged.
    if (native || wrapped) flowSelection?.sync({ force: true });
  }
  function followTextFlowCaret() {
    const element = activeText(),
      textFlow = sourceTextFlow(element);
    if (!textFlow || !element?.classList.contains('canvas-flow-input')) return;
    if (textFlow.composition && !nativeGeometryReady()) {
      flowSelection?.sync();
      inputAnchor?.reset();
      return;
    }
    const offset = sourceCaretIndex();
    if (
      offset === null ||
      flowSelection?.dragging ||
      flowSelection?.selection()?.collapsed === false
    )
      return;
    const affinity =
        flowSelection?.selection()?.focus.affinity ||
        captureTextSelection(element)?.focus.affinity ||
        'forward',
      owner = caretInterval(
        { index: offset, affinity },
        textFlow.frameIds
          .map((id) => ({ ...flowPlan.fragments.get(id), frameId: id }))
          .filter((part) => part.start !== undefined),
      );
    let id =
      owner?.frameId ||
      textFlow.frameIds.find((id) => {
        const f = flowPlan.fragments.get(id);
        return f && offset >= f.start && offset < f.end;
      }) ||
      [...textFlow.frameIds].reverse().find((id) => {
        const f = flowPlan.fragments.get(id);
        return f && f.end === offset && f.end > f.start;
      }) ||
      textFlow.frameIds[0];
    positionFlowInput(sceneObject(doc(), id), offset, affinity);
    if (id === activeTextId) return;
    // The canonical input and its character offsets survive a move to a new frame.
    // An inspector field can own focus here, so the browser cannot resample the caret.
    if (savedTextSelection?.id === activeTextId)
      savedTextSelection = { id, bookmark: savedTextSelection.bookmark };
    activeTextId = id;
    element.dataset.sceneText = id;
    setSelectionState(id);
    state.activePage = sceneObject(doc(), id).pageId;
    rememberTextSelection();
    renderPanel();
    const p = objectWorld(sceneObject(doc(), id)),
      top = worldToScreen(p, state.camera);
    if (top.y < 20 || top.y > viewport.clientHeight - 60)
      cameraTo({ ...state.camera, y: state.camera.y + 20 - top.y });
    selectionDirty = true;
    requestFrame();
  }
  function openTextFlowEditor(item, event, word, { focus = true } = {}) {
    const textFlow = textFlowForFrame(doc(), item);
    if (!textFlow) return;
    if (event && textFlow.composition && nativePlanKey !== compositionLayoutKey(doc())) return;
    const preview = world.querySelector(`[data-flow-frame="${CSS.escape(item.id)}"]`);
    const fragment = flowPlan.fragments.get(item.id);
    let index = fragment?.start || 0,
      nativeHit = null;
    if (textFlow.composition) {
      const elements = [...(preview?.querySelectorAll(':scope > .flow-column') || [])],
        columns = (fragment?.columns || []).map((column, i) => ({
          ...column,
          frameId: item.id,
          element: elements[i],
        }));
      if (event) {
        const point = { x: event.clientX, y: event.clientY },
          closest = columns
            .map((column) => {
              const matrix = column.element
                ?.querySelector('svg[data-composed-text]')
                ?.getScreenCTM();
              if (!matrix || !column.native?.lines.length) return null;
              const local = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse()),
                dx = Math.max(0, -local.x, local.x - column.width),
                dy = Math.max(0, -local.y, local.y - column.height);
              return { column, distance: dx * dx + dy * dy };
            })
            .filter(Boolean)
            .sort((a, b) => a.distance - b.distance)[0];
        if (closest) nativeHit = hitNativeColumn(closest.column, point);
      } else {
        const column = columns.find((part) => part.native?.lines.length);
        if (column)
          nativeHit = hitNativeColumn(
            column,
            { x: 0, y: column.native.lines[0].baseline },
            { coordinateSpace: 'column' },
          );
      }
      if (nativeHit) index = nativeHit.index;
    } else if (event) {
      const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY),
        marker = caret?.startContainer.parentElement?.closest('[data-flow-text]');
      if (marker && preview?.contains(marker))
        index = flowIndexAtPoint(
          { node: caret.startContainer, offset: caret.startOffset },
          Number(marker.dataset.flowText),
        );
    }
    const pane = host.querySelector('.canvas-input-world'),
      element = pane.querySelector('.canvas-flow-input');
    pane.hidden = false;
    if (element.dataset.textFlow !== textFlow.id || flowInputHTML(element) !== textFlow.html)
      element.innerHTML = cleanHTML(textFlow.html);
    element.dataset.textFlow = textFlow.id;
    element.dataset.sceneText = item.id;
    element.dataset.textKind = 'area';
    applyFrameTypography(element, effectiveTextStyle(doc(), textFlow.style));
    applyNamedTextStyles(element, doc());
    delete element.dataset.projectedStart;
    positionFlowInput(item, index, nativeHit?.affinity || 'forward');
    element.contentEditable = 'true';
    element.removeAttribute('aria-readonly');
    element.setAttribute('role', 'textbox');
    element.setAttribute('aria-label', 'Edit text frame');
    activeTextId = item.id;
    state.tool = 'text';
    setSelectionState(item.id);
    state.activePage = item.pageId;
    if (!focus) {
      hideFlowInput();
      element.contentEditable = 'false';
      element.setAttribute('aria-readonly', 'true');
      activeTextId = null;
      renderTools();
      renderPanel();
      renderSelection(true);
      return;
    }
    const map = textIndexMap(element),
      part =
        map.segments.find((p) => index >= p.start && index < p.end) ||
        map.segments.find((p) => p.start > index) ||
        map.segments.at(-1);
    element.focus({ preventScroll: true });
    let range;
    if (textFlow.composition) {
      const position = {
        path: [],
        offset: 0,
        index,
        kind: 'text',
        affinity: nativeHit?.affinity || 'forward',
      };
      restoreTextSelection(element, { anchor: position, focus: position }, { focus: true });
      range = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
    } else {
      range = document.createRange();
      if (part)
        range.setStart(part.node, Math.max(0, Math.min(part.node.length, index - part.start)));
      else range.selectNodeContents(element);
      range.collapse(!part);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
    if (word && range) selectCaretWord(element, range);
    rememberTextSelection();
    renderTools();
    renderPanel();
    renderSelection(true);
  }
  function writeText(item, html, element) {
    const textFlow = (element && sourceTextFlow(element)) || textFlowForFrame(doc(), item);
    const canonical = element?.classList.contains('canvas-flow-input')
      ? flowInputHTML(element)
      : cleanHTML(html);
    if (textFlow?.composition) {
      validateNativeFlowSource(
        doc(),
        { ...textFlow, html: canonical },
        options.assets?.() || options.fonts?.() || [],
      );
    } else if (
      hasNativeParagraphSettings(doc()) ||
      /\bdata-ivo-(?:wordspace|nextlines|previous|pstart)\s*=/i.test(canonical)
    )
      validateLegacyParagraphSettings(canonical, textFlow?.style || item);
    if (element?.classList.contains('canvas-flow-input') && !textFlow?.composition)
      delete element.dataset.projectedStart;
    if (textFlow) textFlow.html = canonical;
    else if (item) item.html = canonical;
    if (hasNativeParagraphSettings(doc())) markTypographyVersion(doc());
  }
  function activeText() {
    return activeTextId
      ? host.querySelector(`[data-scene-text="${CSS.escape(activeTextId)}"]`)
      : null;
  }
  function captureView() {
    const element = activeText(),
      selection =
        element && document.activeElement === element && captureOwnedTextSelection(element);
    return {
      selection: state.selection.slice(),
      activePage: state.activePage,
      inside: state.inside,
      tool: state.tool,
      activeTextId,
      textSelection:
        selection || (savedTextSelection?.id === activeTextId ? savedTextSelection.bookmark : null),
      pendingMarks: structuredClone(pendingMarks),
    };
  }
  function rememberTextSelection() {
    const element = activeText(),
      bookmark =
        element && document.activeElement === element && captureOwnedTextSelection(element);
    if (bookmark) savedTextSelection = { id: activeTextId, bookmark };
    return bookmark;
  }
  function captureOwnedTextSelection(element) {
    const bookmark = captureTextSelection(element),
      owned = flowSelection?.selection();
    if (
      bookmark &&
      owned &&
      bookmark.anchor.index === owned.anchor.index &&
      bookmark.focus.index === owned.focus.index
    )
      for (const key of ['anchor', 'focus']) bookmark[key].affinity = owned[key].affinity;
    return bookmark;
  }
  function beginTextInput(type = 'insertText') {
    if (!textBefore) {
      textBefore = structuredClone(doc());
      textViewBefore = captureView();
    }
    inputType = type;
  }
  function syncText(element) {
    if (!ownsInput()) return;
    const item = sceneObject(doc(), element.dataset.sceneText),
      textFlow = sourceTextFlow(element);
    if (!item && !textFlow) return;
    const rollback = textBefore || structuredClone(doc()),
      view = textViewBefore || captureView();
    try {
      writeText(item, element.innerHTML, element);
      if (!composing) applyNamedTextStyles(element, doc());
      if (textFlow && !composing) {
        refreshFlowPreview();
        followTextFlowCaret();
      }
      if (item) measureText(item, element);
    } catch (error) {
      restoreGestureDocument(rollback);
      textBefore = textViewBefore = null;
      inputType = '';
      flowSignature = '';
      restoreView(view);
      options.onNotify?.(error.message);
      return false;
    }
    selectionDirty = true;
    rememberTextSelection();
    requestFrame();
    return true;
  }
  function finishText({ synchronized = false } = {}) {
    if (!ownsInput() || composing || restoring || applyingText) return;
    const element = activeText();
    if (
      !synchronized &&
      element &&
      cleanHTML(sourceTextFlow(element)?.html ?? sceneObject(doc(), activeTextId)?.html) !==
        (sourceTextFlow(element) ? flowInputHTML(element) : cleanHTML(element.innerHTML))
    ) {
      // Loading/painting allowlisted typography can normalize attribute order
      // and project equivalent CSS. That alone is not an authored text edit.
      beginTextInput();
      syncText(element);
    }
    if (!synchronized && activeText()?.classList.contains('canvas-flow-input')) {
      refreshFlowPreview();
      followTextFlowCaret();
    }
    if (!textBefore) return;
    const before = textBefore,
      viewBefore = textViewBefore;
    const kind = inputType;
    textBefore = null;
    textViewBefore = null;
    inputType = '';
    if (documentContent(before) !== documentContent(doc()))
      onCommit(before, {
        label: kind.startsWith('delete') ? 'Delete text' : 'Typing',
        mergeKey: ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(kind)
          ? kind + ':' + (sourceTextFlow(element)?.id || activeTextId)
          : null,
        viewBefore,
        viewAfter: captureView(),
      });
  }
  function measureText(item, element) {
    if (item.textFlowId || item.textKind !== 'point') return;
    const rect = element.getBoundingClientRect();
    item.w = Math.max(0.01, rect.width / state.camera.zoom);
    item.h = Math.max(0.01, rect.height / state.camera.zoom);
    updateObject(item);
  }
  function endTextEditing() {
    flowSelection?.cancel();
    const element = activeText();
    if (element && document.activeElement === element) element.blur();
    finishText();
    if (composing) return false;
    if (element) {
      element.contentEditable = 'false';
      element.removeAttribute('role');
      element.removeAttribute('aria-label');
    }
    if (element?.classList.contains('canvas-flow-input')) hideFlowInput();
    activeTextId = null;
    savedTextSelection = null;
    pendingMarks = {};
    flowSelection?.sync();
    selectionDirty = true;
    options.onViewChange?.();
    return true;
  }
  function focusText(id, event, word = false) {
    const item = sceneObject(doc(), id);
    if (item?.textFlowId) {
      if (endTextEditing() === false) return;
      openTextFlowEditor(item, event, word);
      return;
    }
    const element = world.querySelector(`[data-scene-text="${CSS.escape(id)}"]`);
    if (!element) return;
    if (activeTextId === id && element.isContentEditable) return;
    if (endTextEditing() === false) return;
    state.tool = 'text';
    activeTextId = id;
    setSelectionState(id);
    state.activePage = sceneObject(doc(), id).pageId;
    element.contentEditable = 'true';
    element.removeAttribute('aria-readonly');
    element.setAttribute('role', 'textbox');
    element.setAttribute('aria-label', 'Edit text object');
    renderTools();
    renderPanel();
    renderSelection(true);
    if (event) placeTextCaret(element, event.clientX, event.clientY, { word });
    else {
      element.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    rememberTextSelection();
  }
  function restoreView(view = {}, { focus = true } = {}) {
    selectedVertex = null;
    restoring = true;
    hideFlowInput();
    textBefore = null;
    textViewBefore = null;
    const old = activeText();
    if (old) {
      old.contentEditable = 'false';
      old.blur();
    }
    activeTextId =
      view.activeTextId && sceneObject(doc(), view.activeTextId) ? view.activeTextId : null;
    setSelectionState(view.selection || state.selection);
    state.activePage = doc().pages.some((p) => p.id === view.activePage)
      ? view.activePage
      : doc().pages[0].id;
    state.inside = sceneObject(doc(), view.inside) ? view.inside : null;
    state.tool = activeTextId ? 'text' : view.tool || 'select';
    pendingMarks = view.pendingMarks || {};
    pendingTextPosition = Object.keys(pendingMarks).length
      ? (view.textSelection?.focus.index ?? null)
      : null;
    savedTextSelection =
      activeTextId && view.textSelection
        ? { id: activeTextId, bookmark: view.textSelection }
        : null;
    paint();
    if (activeTextId && textFlowForFrame(doc(), activeTextId))
      openTextFlowEditor(sceneObject(doc(), activeTextId), undefined, false, { focus });
    if (activeTextId && focus) {
      const element = activeText();
      if (!restoreTextSelection(element, view.textSelection)) {
        element.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      rememberTextSelection();
    } else if (focus) viewport.focus({ preventScroll: true });
    if (!focus && activeTextId) {
      const element = activeText();
      if (element) {
        element.contentEditable = 'false';
        element.setAttribute('aria-readonly', 'true');
      }
      activeTextId = null;
      savedTextSelection = null;
    }
    restoring = false;
    publishingControls.prepareLegacyFonts();
  }
  function deactivate() {
    flowSelection?.cancel();
    if (composing) return false;
    finishGesture(true);
    finishText();
    const view = captureView(),
      element = activeText();
    if (element) {
      element.contentEditable = 'false';
      element.setAttribute('aria-readonly', 'true');
      if (document.activeElement === element) element.blur();
    }
    hideFlowInput();
    activeTextId = null;
    textBefore = null;
    textViewBefore = null;
    inputType = '';
    savedTextSelection = null;
    pendingMarks = {};
    draft = null;
    threadFrom = null;
    pointers.clear();
    pinch = null;
    space = false;
    viewport.classList.remove('space-pan');
    previews.hide();
    closeContextMenu();
    selectionDirty = true;
    requestFrame();
    return view;
  }
  function refreshExternal() {
    if (ownsInput() && activeTextId) return;
    if (!ownsInput()) {
      activeTextId = null;
      textBefore = null;
      textViewBefore = null;
      savedTextSelection = null;
    }
    const pane = host.querySelector('.canvas-input-world'),
      element = pane.querySelector('.canvas-flow-input'),
      textFlow = doc().textFlows?.find((value) => value.id === element.dataset.textFlow);
    paint();
    if (textFlow) {
      element.innerHTML = cleanHTML(textFlow.html);
      delete element.dataset.projectedStart;
      applyFrameTypography(element, effectiveTextStyle(doc(), textFlow.style));
      applyNamedTextStyles(element, doc());
      element.contentEditable = 'false';
      element.setAttribute('aria-readonly', 'true');
    }
    hideFlowInput();
  }
  function prepareHistory() {
    if (composing || pendingCount || busy) return false;
    finishGesture(true);
    finishText();
    pointers.clear();
    pinch = null;
    space = false;
    viewport.classList.remove('space-pan');
    delete editor.dataset.gesture;
    return true;
  }
  function applyTextProperty(field, value, { commit = true, adjust } = {}) {
    const flow = textFlowForFrame(doc(), object());
    if (!flow?.composition) {
      const settings =
        field === 'paragraphStyle'
          ? effectiveTextStyle(doc(), { paragraphStyle: value })
          : { [field]: value };
      let message;
      if (
        settings.keepWithPrevious ||
        settings.keepNextLines > 1 ||
        (settings.paragraphStart && settings.paragraphStart !== 'anywhere')
      )
        message =
          'Choose native composition for this text flow before applying extended paragraph keeps.';
      if (wordSpacingSettings(settings.wordSpacing ?? 'normal'))
        message = 'Choose native text composition for this text flow before applying word spacing.';
      if (message) {
        if (!commit) throw Error(message);
        options.onNotify?.(message);
        return false;
      }
    }
    if (!flow?.composition && !flowPlan.status.get(flow?.id)?.wrapped)
      return applyTextPropertyValue(field, value, { commit, adjust });
    finishText();
    const before = structuredClone(doc()),
      view = captureView(),
      marks = { ...pendingMarks };
    try {
      const result = applyTextPropertyValue(field, value, { commit: false, adjust });
      validateNativeSources();
      // Validate pending insertion formatting as well as existing source runs.
      if (flow.composition && Object.keys(pendingMarks).length) {
        const probe = structuredClone(flow);
        probe.style = { ...probe.style, ...readSelectedTextStyle()?.values, ...pendingMarks };
        validateNativeFlowSource(doc(), probe, options.assets?.() || options.fonts?.() || []);
      }
      if (commit && documentContent(before) !== documentContent(doc()))
        onCommit(before, { label: 'Text formatting', viewBefore: view, viewAfter: captureView() });
      return result;
    } catch (error) {
      for (const key of Object.keys(doc())) delete doc()[key];
      Object.assign(doc(), before);
      pendingMarks = marks;
      flowSignature = '';
      restoreView(view);
      if (!commit) throw error;
      options.onNotify?.(error.message);
      return false;
    }
  }
  function applyTextPropertyValue(field, value, { commit = true, adjust } = {}) {
    const item = object();
    if (!item || !['text', 'quote'].includes(item.type)) return false;
    finishText();
    const textFlow = textFlowForFrame(doc(), item);
    const fontFace =
      field === 'textStyle' ? options.fonts?.().find((asset) => asset.id === value)?.font : null;
    const faceDefaults = fontFace ? { bold: fontFace.weight >= 600, italic: fontFace.italic } : {};
    function rangeValue(root) {
      if (!adjust) return value;
      const style = textStyleReader(
        root,
        doc(),
        effectiveTextStyle(doc(), frameTextSettings(doc(), item)),
      );
      return (node) => adjust(style(node)[field]);
    }
    if (activeTextId !== item.id) {
      const before = structuredClone(doc()),
        viewBefore = captureView(),
        settings = textFlow?.style || item,
        root = document.createElement('div');
      root.innerHTML = cleanHTML(textFlow?.html ?? item.html);
      const all = document.createRange();
      all.selectNodeContents(root);
      if (CHARACTER_FIELDS[field]) {
        const next = rangeValue(root);
        formatRange(root, all, field, next);
        for (const [key, setting] of Object.entries(faceDefaults))
          formatRange(root, all, key, setting);
        if (!adjust)
          for (const blank of root.querySelectorAll('p,div,li'))
            if (!blank.textContent && !blank.querySelector('p,div,li'))
              setTextAttribute(blank, CHARACTER_FIELDS[field], value);
      } else formatParagraphs(root, all, field, value);
      settings[field] = value;
      Object.assign(settings, faceDefaults);
      if (
        (settings.paragraphStyle || settings.characterStyle) &&
        !['paragraphStyle', 'characterStyle'].includes(field)
      )
        Object.assign((settings.textOverrides ||= {}), { [field]: value, ...faceDefaults });
      writeText(item, root.innerHTML);
      if (value === 'geist') enablePublishing(doc());
      markTypographyVersion(doc());
      if (textFlow) refreshFlowPreview();
      else {
        const text = world.querySelector(`[data-scene-text="${CSS.escape(item.id)}"]`);
        if (text) text.innerHTML = cleanHTML(item.html);
        updateObject(item);
        if (text) {
          applyNamedTextStyles(text, doc());
          measureText(item, text);
        }
      }
      syncTextStyle();
      selectionDirty = true;
      if (commit)
        onCommit(before, { label: 'Text formatting', viewBefore, viewAfter: captureView() });
      requestFrame();
      return true;
    }
    const element =
        activeTextId === item.id
          ? activeText()
          : textFlow
            ? document.createElement('div')
            : world.querySelector(`[data-scene-text="${CSS.escape(item.id)}"]`),
      range = preserveRange();
    if (textFlow && activeTextId !== item.id) {
      element.innerHTML = cleanHTML(textFlow.html);
      applyFrameTypography(element, effectiveTextStyle(doc(), textFlow.style));
    }
    if (activeTextId === item.id && CHARACTER_FIELDS[field] && range?.collapsed) {
      pendingMarks[field] = value;
      pendingTextPosition = bookmarkForRange(element, range)?.focus.index ?? null;
      Object.assign(pendingMarks, faceDefaults);
      syncTextStyle();
      requestFrame();
      return true;
    }
    if (
      activeTextId === item.id &&
      range &&
      !range.collapsed &&
      CHARACTER_FIELDS[field] &&
      !adjust &&
      rangeUsesFormat(element, range, field, value)
    )
      return true;
    const before = structuredClone(doc()),
      viewBefore = captureView();
    if (activeTextId === item.id && range && !range.collapsed && CHARACTER_FIELDS[field]) {
      const selected = captureTextSelection(element);
      formatRange(element, range, field, rangeValue(element));
      for (const [key, setting] of Object.entries(faceDefaults))
        formatRange(element, range, key, setting);
      savedTextSelection = { id: item.id, bookmark: selected || bookmarkForRange(element, range) };
      restoreTextSelection(element, savedTextSelection.bookmark, { focus: false });
      writeText(item, element.innerHTML, element);
    } else if (
      activeTextId === item.id &&
      range &&
      PARAGRAPH_FIELDS[field] &&
      formatParagraphs(element, range, field, value, {
        requireStructuralParagraphs: !!textFlow?.composition,
      })
    ) {
      writeText(item, element.innerHTML, element);
      savedTextSelection = { id: item.id, bookmark: bookmarkForRange(element, range) };
      restoreTextSelection(element, savedTextSelection.bookmark, { focus: false });
    } else if (
      ['bold', 'italic', 'underline', 'highlight', 'strikethrough', 'characterStyle'].includes(
        field,
      )
    ) {
      const all = document.createRange();
      all.selectNodeContents(element);
      formatRange(element, all, field, value);
      writeText(item, element.innerHTML, element);
    } else {
      const textFlow = textFlowForFrame(doc(), item);
      if (textFlow) {
        textFlow.style[field] = value;
        Object.assign(textFlow.style, faceDefaults);
        if (
          (textFlow.style.paragraphStyle || textFlow.style.characterStyle) &&
          !['paragraphStyle', 'characterStyle'].includes(field)
        )
          Object.assign((textFlow.style.textOverrides ||= {}), { [field]: value, ...faceDefaults });
        applyFrameTypography(element, effectiveTextStyle(doc(), textFlow.style));
        applyNamedTextStyles(element, doc());
      } else {
        item[field] = value;
        Object.assign(item, faceDefaults);
        if (
          (item.paragraphStyle || item.characterStyle) &&
          !['paragraphStyle', 'characterStyle'].includes(field)
        )
          Object.assign((item.textOverrides ||= {}), { [field]: value, ...faceDefaults });
        applyFrameTypography(element, effectiveTextStyle(doc(), item));
      }
    }
    if (CHARACTER_FIELDS[field] || PARAGRAPH_FIELDS[field]) {
      const all = Object.keys({ ...CHARACTER_FIELDS, ...PARAGRAPH_FIELDS });
      if (
        (all.includes(field) &&
          ![
            'textStyle',
            'fontSize',
            'align',
            'leading',
            'tracking',
            'textColor',
            'paragraphBefore',
            'paragraphAfter',
            'bold',
            'italic',
            'underline',
          ].includes(field)) ||
        /^(font-|geist$)/.test(String(value))
      )
        enablePublishing(doc());
      applyNamedTextStyles(element, doc());
    }
    if (item.textFlowId) {
      refreshFlowPreview();
      followTextFlowCaret();
    }
    measureText(item, element);
    selectionDirty = true;
    if (commit)
      onCommit(before, { label: 'Text formatting', viewBefore, viewAfter: captureView() });
    syncTextStyle();
    requestFrame();
    return true;
  }
  function clearTextOverrides() {
    const item = object();
    if (!item || !['text', 'quote'].includes(item.type)) return;
    finishText();
    const before = structuredClone(doc()),
      viewBefore = captureView(),
      flow = textFlowForFrame(doc(), item),
      live = activeTextId === item.id ? activeText() : null;
    const element = live || document.createElement('div');
    if (!live) element.innerHTML = cleanHTML(flow ? flow.html : item.html);
    const range = live ? preserveRange() : document.createRange();
    if (!range) return;
    if (!live) range.selectNodeContents(element);
    const bookmark = live ? bookmarkForRange(element, range) : null;
    clearRangeOverrides(element, range);
    writeText(item, element.innerHTML, element);
    if (!live) delete (flow?.style || item).textOverrides;
    pendingMarks = {};
    if (live && bookmark) {
      savedTextSelection = { id: item.id, bookmark };
      restoreTextSelection(element, bookmark);
      applyNamedTextStyles(element, doc());
    }
    refreshFlowPreview();
    onCommit(before, { label: 'Clear text overrides', viewBefore, viewAfter: captureView() });
    syncTextStyle();
    selectionDirty = true;
    requestFrame();
  }
  function parentOffset(item, document = doc()) {
    return item.parentId
      ? worldRect(document, sceneObject(document, item.parentId))
      : { x: 0, y: 0 };
  }
  function insertionContext(pageId = state.activePage) {
    const parent = sceneObject(doc(), state.inside);
    return {
      pageId: parent?.pageId || pageId,
      parentId: parent?.id,
      layerId:
        parent?.layerId ||
        doc().publishing?.layers.find((l) => l.id === state.activeLayer && l.visible && !l.locked)
          ?.id,
    };
  }
  function createAt(type, rect) {
    const context = insertionContext(),
      parent = context.parentId
        ? worldRect(doc(), sceneObject(doc(), context.parentId))
        : { x: 0, y: 0 };
    let created;
    mutate(() => {
      created = insertObject(doc(), type, context.pageId, {
        ...rect,
        x: rect.x - parent.x,
        y: rect.y - parent.y,
        parentId: context.parentId,
        layerId: context.layerId,
      });
      setSelectionState(created.id);
    });
    return created;
  }
  function finishPolygon() {
    if (!draft || draft.points.length < 3) {
      draft = null;
      renderSelection();
      return;
    }
    const { points, pageId } = draft;
    state.activePage = pageId;
    const x = Math.min(...points.map((p) => p.x)),
      y = Math.min(...points.map((p) => p.y)),
      w = Math.max(0.01, Math.max(...points.map((p) => p.x)) - x),
      h = Math.max(0.01, Math.max(...points.map((p) => p.y)) - y);
    draft = null;
    mutate(() => {
      const context = insertionContext(pageId),
        parent = context.parentId
          ? worldRect(doc(), sceneObject(doc(), context.parentId))
          : { x: 0, y: 0 };
      const item = insertObject(doc(), 'polygon', context.pageId, {
        parentId: context.parentId,
        layerId: context.layerId,
        x: x - parent.x,
        y: y - parent.y,
        w,
        h,
      });
      item.points = points.map((p) => ({ id: uid('vertex-'), x: (p.x - x) / w, y: (p.y - y) / h }));
      setSelectionState(item.id);
    });
    tool('direct');
  }
  function renderGuides(values, pageId) {
    guides.replaceChildren();
    const p = pageId ? pagePosition(pageId) : { x: 0, y: 0 },
      z = state.camera.zoom;
    for (const guide of values) {
      const line = document.createElement('div');
      line.className = 'canvas-guide ' + guide.axis;
      const start = worldToScreen(
        {
          x: (guide.axis === 'x' ? guide.position : guide.start) + p.x,
          y: (guide.axis === 'y' ? guide.position : guide.start) + p.y,
        },
        state.camera,
      );
      Object.assign(line.style, {
        left: start.x + 'px',
        top: start.y + 'px',
        width: (guide.axis === 'y' ? (guide.end - guide.start) * z : 1) + 'px',
        height: (guide.axis === 'x' ? (guide.end - guide.start) * z : 1) + 'px',
      });
      guides.append(line);
    }
  }
  function restoreGestureDocument(before) {
    const current = doc(),
      existing = new Map(current.blocks.map((item) => [item.id, item]));
    for (const key of Object.keys(current)) if (!Object.hasOwn(before, key)) delete current[key];
    for (const [key, value] of Object.entries(before))
      if (key !== 'blocks') current[key] = structuredClone(value);
    current.blocks = before.blocks.map((original) => {
      const item = existing.get(original.id) || {};
      for (const key of Object.keys(item)) if (!Object.hasOwn(original, key)) delete item[key];
      return Object.assign(item, structuredClone(original));
    });
  }
  function moveMode(g, copying) {
    if (g.copying === copying) return true;
    restoreGestureDocument(g.before);
    g.ids = g.sourceIds.slice();
    g.copying = false;
    if (copying)
      try {
        g.ids = duplicateObjects(doc(), g.sourceIds, { offset: { x: 0, y: 0 } }).map(
          (item) => item.id,
        );
        g.copying = true;
      } catch (error) {
        options.onNotify?.(error.message);
        finishGesture(true);
        return false;
      }
    g.id = g.ids[0];
    g.baseline = structuredClone(doc());
    g.original =
      g.ids.length > 1
        ? selectionBounds(g.baseline, g.ids)
        : worldRect(g.baseline, sceneObject(g.baseline, g.id));
    setSelectionState(g.ids);
    paint();
    return true;
  }
  function replayMoveModifiers(event) {
    const g = gesture;
    if (g?.kind !== 'move' || !g.lastInput) return false;
    pointerMove({ ...g.lastInput, altKey: event.altKey, shiftKey: event.shiftKey, buttons: 1 });
    return true;
  }
  function finishGesture(cancel = false) {
    if (!gesture) return;
    const old = gesture;
    gesture = null;
    if (old.clickToggle && !old.moved) {
      setSelectionState(
        cancel
          ? old.clickToggle.beforeIds
          : toggleSelection(old.clickToggle.beforeIds, [old.clickToggle.hit]),
      );
      renderPanel();
      renderSelection(true);
    }
    if (old.kind === 'marquee') {
      marqueeElement.hidden = true;
      if (cancel) setSelectionState(old.beforeIds);
      else if (!old.moved) setSelectionState(old.additive ? old.beforeIds : []);
      renderPanel();
      renderSelection(true);
    }
    delete editor.dataset.gesture;
    delete editor.dataset.copying;
    guides.replaceChildren();
    editor.classList.remove('is-dragging');
    for (const el of world.querySelectorAll('.canvas-page')) el.style.zIndex = '';
    try {
      viewport.releasePointerCapture(old.pointerId);
    } catch {}
    if (old.before) {
      if (cancel) {
        restoreGestureDocument(old.before);
        if (old.sourceIds) setSelectionState(old.sourceIds);
        paint();
      } else if (JSON.stringify(old.before.blocks) !== JSON.stringify(doc().blocks)) {
        const transferred =
          old.kind === 'move' && transferObjectsAtDrop(doc(), old.ids || [old.id]);
        if (transferred) {
          state.activePage = sceneObject(doc(), old.id)?.pageId || state.activePage;
          state.inside = null;
        }
        try {
          const adopted = ensureTextWrapFlows(doc());
          validateNativeSources();
          if (transferred || adopted.length) paint();
          else if (doc().textFlows?.length) refreshFlowPreview();
        } catch (error) {
          restoreGestureDocument(old.before);
          if (old.sourceIds) setSelectionState(old.sourceIds);
          paint();
          options.onNotify?.(error.message);
          return;
        }
        onCommit(old.before, {
          label: old.copying
            ? 'Duplicate and move'
            : old.kind === 'resize'
              ? 'Resize'
              : old.kind === 'vertex'
                ? 'Edit point'
                : 'Move',
          viewBefore: old.viewBefore,
          viewAfter: captureView(),
        });
        renderPanel();
      }
    }
    if (old.kind === 'draw' && cancel) {
      draft = null;
      renderSelection();
    }
    if (old.kind === 'draw' && !cancel) {
      const p = old.last || old.start,
        w = Math.abs(p.x - old.start.x),
        h = Math.abs(p.y - old.start.y);
      draft = null;
      if (w > 2 && h > 2) {
        const item = createAt(old.type, {
          x: Math.min(p.x, old.start.x),
          y: Math.min(p.y, old.start.y),
          w,
          h,
          ...(old.type === 'text' ? { textKind: 'area' } : {}),
        });
        if (old.type === 'text') focusText(item.id);
        else tool('select');
      } else if (old.type === 'text') {
        const item = createAt('text', { x: p.x, y: p.y, w: 160, h: 24, textKind: 'point' });
        focusText(item.id);
      }
      renderSelection();
    }
  }
  function startGesture(event, kind, extra = {}) {
    finishGesture();
    finishText();
    cameraTo({ ...state.camera }, true);
    gesture = {
      kind,
      viewBefore: captureView(),
      pointerId: event.pointerId,
      start: pointer(event),
      camera: { ...state.camera },
      ...extra,
    };
    editor.dataset.gesture = kind;
    if (kind === 'move')
      for (const item of objects()) {
        const el = world.querySelector(`[data-page="${CSS.escape(item.pageId)}"]`);
        if (el) el.style.zIndex = '2';
      }
    if (kind === 'resize')
      editor.style.setProperty(
        '--active-resize-cursor',
        cursor(
          {
            n: 'resize-vertical',
            s: 'resize-vertical',
            e: 'resize-horizontal',
            w: 'resize-horizontal',
            nw: 'resize-tlbr',
            se: 'resize-tlbr',
            ne: 'resize-trbl',
            sw: 'resize-trbl',
          }[extra.handle],
        ),
      );
    viewport.setPointerCapture(event.pointerId);
    viewport.focus({ preventScroll: true });
  }
  let lastHit = null;
  function pointerDown(event) {
    if (!ownsInput() || busy || dialogOpen() || (event.button !== 0 && event.button !== 1)) return;
    if (
      !space &&
      event.button === 0 &&
      event.target.closest('[data-type-circle],[data-flow-port],[data-canvas-command]')
    ) {
      // Frame adornments own this click; they must not start a blank-canvas selection gesture.
      event.preventDefault();
      return;
    }
    editor.dataset.option = String(event.altKey);
    const position = pointer(event);
    if (event.pointerType === 'touch' && !pointers.size) touchBeforeIds = state.selection.slice();
    if (event.pointerType === 'touch') pointers.set(event.pointerId, position);
    if (event.pointerType === 'touch' && pointers.size === 2) {
      finishGesture(true);
      setSelectionState(touchBeforeIds);
      const [a, b] = [...pointers.values()];
      editor.dataset.gesture = 'pan';
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        camera: { ...state.camera },
      };
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const text = event.target.closest('[data-scene-text],[data-flow-frame]');
    if (activeTextId && text?.dataset.sceneText === activeTextId && !space) return;
    if (
      activeTextId &&
      text?.dataset.flowFrame &&
      !space &&
      state.tool === 'text' &&
      textFlowForFrame(doc(), text.dataset.flowFrame)?.id === sourceTextFlow()?.id
    ) {
      event.preventDefault();
      finishText();
      openTextFlowEditor(sceneObject(doc(), text.dataset.flowFrame), event, false);
      return;
    }
    if (activeTextId && !space) {
      if (endTextEditing() === false) {
        event.preventDefault();
        return;
      }
      if (state.tool === 'text' && !text) {
        event.preventDefault();
        select(null);
        viewport.focus({ preventScroll: true });
        return;
      }
    }
    if (!options.editing && text && !space) return;
    event.preventDefault();
    const pageElement = event.target.closest('[data-page]');
    if (pageElement) {
      state.activePage = pageElement.dataset.page;
      if (sceneObject(doc(), state.inside)?.pageId !== state.activePage) state.inside = null;
    }
    if (
      space ||
      state.tool === 'hand' ||
      event.button === 1 ||
      (!options.editing && !event.target.closest('a'))
    ) {
      startGesture(event, 'pan');
      return;
    }
    if (!options.editing) return;
    if (
      ['text', 'rectangle', 'polygon'].includes(state.tool) &&
      doc().publishing &&
      !doc().publishing.layers.some((l) => l.visible && !l.locked)
    ) {
      options.onNotify?.('Choose an unlocked visible layer before adding an object.');
      return;
    }
    let hit = event.target.closest('[data-object]')?.dataset.object;
    if (hit && !objectAvailable(doc(), sceneObject(doc(), hit))) hit = null;
    lastHit = hit;
    if (hit && state.tool === 'select' && !state.inside) {
      let item = sceneObject(doc(), hit);
      while (item?.parentId) {
        hit = item.parentId;
        item = sceneObject(doc(), hit);
      }
    }
    const vertex = event.target.closest('[data-vertex]'),
      resize = event.target.closest('[data-resize]');
    if (selectedVertex !== (vertex?.dataset.vertex || null)) {
      selectedVertex = vertex?.dataset.vertex || null;
      renderPanel();
    }
    if (vertex || resize) {
      const items = objects();
      if (!items.length || (vertex && items.length !== 1)) return;
      const item = items[0],
        multiple = items.length > 1;
      startGesture(event, vertex ? 'vertex' : 'resize', {
        id: item.id,
        ids: state.selection.slice(),
        before: structuredClone(doc()),
        original: multiple ? selectionBounds(doc(), state.selection) : worldRect(doc(), item),
        vertex: vertex?.dataset.vertex,
        handle: resize?.dataset.resize,
        pageId: item.pageId,
      });
      return;
    }
    if (threadFrom && !hit) {
      threadFrom = null;
      renderTools();
      return;
    }
    if (threadFrom && hit) {
      const from = threadFrom;
      threadFrom = null;
      try {
        mutate(() => threadFrame(doc(), from, hit), 'Thread text frames');
        select(hit);
      } catch (error) {
        options.onNotify?.(error.message);
      }
      return;
    }
    const p = pointOnPage(event);
    if (state.tool === 'polygon') {
      if (!draft) draft = { pageId: state.activePage, points: [] };
      if (event.detail < 2 && draft.points.length < 256) draft.points.push(p);
      draft.hover = p;
      renderSelection();
      return;
    }
    if (['rectangle', 'text'].includes(state.tool)) {
      if (
        state.tool === 'text' &&
        hit &&
        ['text', 'quote'].includes(sceneObject(doc(), hit)?.type)
      ) {
        focusText(hit, event);
        return;
      }
      startGesture(event, 'draw', {
        type: state.tool === 'text' ? 'text' : 'polygon',
        start: p,
        pageId: state.activePage,
      });
      draft = { pageId: state.activePage, points: [p], hover: p };
      return;
    }
    if (!hit) {
      const beforeIds = state.selection.slice();
      startGesture(event, 'marquee', { beforeIds, additive: event.shiftKey, enclosed: false });
      marqueeElement.hidden = false;
      Object.assign(marqueeElement.style, {
        left: position.x + 'px',
        top: position.y + 'px',
        width: '0px',
        height: '0px',
      });
      renderSelection();
      return;
    }
    const clickToggle =
      event.shiftKey && !event.altKey ? { beforeIds: state.selection.slice(), hit } : null;
    if (!state.selection.includes(hit)) select(clickToggle ? [...state.selection, hit] : hit);
    const items = objects(),
      item = items[0],
      before = structuredClone(doc());
    startGesture(event, 'move', {
      id: item.id,
      ids: state.selection.slice(),
      sourceIds: state.selection.slice(),
      clickToggle,
      copying: false,
      before,
      baseline: before,
      original: items.length > 1 ? selectionBounds(doc(), state.selection) : worldRect(doc(), item),
      pageId: item.pageId,
    });
  }
  function pointerMove(event) {
    editor.dataset.option = String(event.altKey);
    const pos = pointer(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, pos);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      const next = zoomAt(
        pinch.camera,
        pinch.center,
        (pinch.camera.zoom * distance) / Math.max(1, pinch.distance),
      );
      next.x += center.x - pinch.center.x;
      next.y += center.y - pinch.center.y;
      cameraTo(next, true);
      return;
    }
    // A native popup or focus transfer can consume mouse-up; later hover must never continue a transform.
    if (gesture && event.pointerType !== 'touch' && event.buttons === 0) {
      finishGesture();
      return;
    }
    if (!gesture) {
      if (draft) {
        draft.hover = pointOnPage(event, draft.pageId);
        requestFrame();
      }
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    const g = gesture;
    if (g.kind === 'marquee') {
      g.lastClient = { x: event.clientX, y: event.clientY };
      const x = Math.min(pos.x, g.start.x),
        y = Math.min(pos.y, g.start.y),
        w = Math.abs(pos.x - g.start.x),
        h = Math.abs(pos.y - g.start.y);
      g.moved = Math.hypot(w, h) >= 3;
      Object.assign(marqueeElement.style, {
        left: x + 'px',
        top: y + 'px',
        width: w + 'px',
        height: h + 'px',
      });
      const origin = screenToWorld({ x, y }, state.camera),
        hits = g.moved
          ? marqueeSelection(
              doc(),
              { ...origin, w: w / state.camera.zoom, h: h / state.camera.zoom },
              { parentId: state.inside, enclosed: g.enclosed },
            )
          : [];
      setSelectionState(g.additive ? toggleSelection(g.beforeIds, hits) : hits);
      requestFrame();
      return;
    }
    if (g.kind === 'pan') {
      cameraTo(
        { ...g.camera, x: g.camera.x + pos.x - g.start.x, y: g.camera.y + pos.y - g.start.y },
        true,
      );
      return;
    }
    if (g.kind === 'draw') {
      g.last = pointOnPage(event, g.pageId);
      draft.points = [
        g.start,
        { x: g.last.x, y: g.start.y },
        g.last,
        { x: g.start.x, y: g.last.y },
        g.start,
      ];
      draft.hover = null;
      requestFrame();
      return;
    }
    g.lastInput = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    const dx = (pos.x - g.start.x) / state.camera.zoom,
      dy = (pos.y - g.start.y) / state.camera.zoom;
    if (!g.moved && Math.hypot(pos.x - g.start.x, pos.y - g.start.y) < 3) return;
    g.moved = true;
    editor.classList.add('is-dragging');
    if (g.kind === 'move') {
      if (!moveMode(g, !!event.altKey)) return;
      editor.dataset.copying = String(g.copying);
    }
    const baseline = g.baseline || g.before;
    if (g.ids?.length > 1) {
      const selected = selectionRoots(baseline, g.ids),
        excluded = new Set(
          selected.flatMap((item) => [
            item.id,
            ...descendantsOf(baseline, item.id).map((child) => child.id),
          ]),
        );
      const targets = alignmentRectTargets(
        doc()
          .blocks.filter((item) => !item.parentId && !excluded.has(item.id))
          .map((item) => ({ id: item.id, ...sceneRect(doc(), item) })),
        page().width,
        page().height,
        { artboardEdges: false },
      );
      const result = transformBlock(
        g.original,
        { x: dx, y: dy },
        {
          pageWidth: page().width,
          targets,
          snap: state.snap && (g.kind === 'move' || !event.altKey),
          viewScale: state.camera.zoom,
          resize: g.kind === 'resize' ? g.handle : false,
          constrain: g.kind === 'move' && event.shiftKey,
          proportional: event.shiftKey,
          fromCenter: event.altKey,
          unbounded: true,
        },
      );
      transformSelection(doc(), g.ids, result.rect, baseline);
      for (const item of selected) updateObject(sceneObject(doc(), item.id));
      renderGuides(result.guides, null);
      requestFrame();
      return;
    }
    const item = sceneObject(doc(), g.id),
      original = sceneObject(baseline, g.id),
      offset = parentOffset(original, baseline);
    const ids = new Set([item.id, ...descendantsOf(baseline, item.id).map((v) => v.id)]);
    for (const old of baseline.blocks.filter((v) => ids.has(v.id)))
      Object.assign(sceneObject(doc(), old.id), structuredClone(old));
    if (g.kind === 'vertex') {
      const vertex = original.points.find((v) => v.id === g.vertex);
      moveVertex(doc(), item.id, g.vertex, {
        x: original.x + vertex.x * original.w + dx,
        y: original.y + vertex.y * original.h + dy,
      });
      guides.replaceChildren();
    } else {
      const sourcePage = pagePosition(g.pageId),
        p =
          g.kind === 'move' && !item.parentId
            ? pageAtPoint(doc(), {
                x: sourcePage.x + g.original.x + dx + g.original.w / 2,
                y: sourcePage.y + g.original.y + dy + g.original.h / 2,
              }) || sourcePage
            : sourcePage,
        origin = { x: p.x - sourcePage.x, y: p.y - sourcePage.y },
        rectangles = doc()
          .blocks.filter((v) => v.pageId === p.id && !ids.has(v.id) && v.id !== item.parentId)
          .map((v) => {
            const rect = worldRect(doc(), v);
            return { id: v.id, ...rect, x: rect.x + origin.x, y: rect.y + origin.y };
          });
      const result = transformBlock(
        g.original,
        { x: dx, y: dy },
        {
          pageWidth: p.width,
          targets: alignmentRectTargets(rectangles, p.width, p.height, { artboardOrigin: origin }),
          snap: state.snap && (g.kind === 'move' || !event.altKey),
          viewScale: state.camera.zoom * (globalThis.ivoNative?.zoomFactor?.() || 1),
          resize: g.kind === 'resize' ? g.handle : false,
          constrain: g.kind === 'move' && event.shiftKey,
          proportional: event.shiftKey,
          fromCenter: event.altKey,
          unbounded: true,
        },
      );
      transformObject(
        doc(),
        item.id,
        { ...result.rect, x: result.rect.x - offset.x, y: result.rect.y - offset.y },
        baseline,
      );
      if (item.textKind === 'point' && g.kind === 'resize')
        Object.assign(
          item,
          scaledPointType(original, item.w / original.w, item.h / original.h, {
            min: 1,
            max: 2000,
            baseSize: effectiveTextStyle(baseline, original).fontSize,
          }),
        );
      renderGuides(result.guides, g.pageId);
    }
    updateObject(item);
    requestFrame();
  }
  function pointerUp(event) {
    pointers.delete(event.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        delete editor.dataset.gesture;
      }
      return;
    }
    if (gesture?.pointerId === event.pointerId) {
      if (event.type !== 'pointercancel' && gesture.kind === 'move' && gesture.moved)
        pointerMove({
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          buttons: 1,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        });
      finishGesture(event.type === 'pointercancel');
    }
  }
  function convertText() {
    const item = object();
    if (!item || item.textFlowId || !['text', 'quote'].includes(item.type)) return;
    finishText();
    const element = world.querySelector(`[data-scene-text="${CSS.escape(item.id)}"]`);
    mutate(() => {
      if (item.textKind !== 'point') {
        preserveTextLines(element);
        writeText(item, element.innerHTML, element);
        item.textKind = 'point';
        applyTextLayout(element, item);
        measureText(item, element);
      } else item.textKind = 'area';
    });
  }
  let replaceId = null,
    contextMenu = null;
  function preserveRange() {
    const element = activeText();
    if (!element) {
      savedTextSelection = null;
      return null;
    }
    const bookmark = document.activeElement === element && captureTextSelection(element);
    if (bookmark) savedTextSelection = { id: activeTextId, bookmark };
    return savedTextSelection?.id === activeTextId
      ? rangeFromBookmark(element, savedTextSelection.bookmark)
      : null;
  }
  async function command(name, { anchor } = {}) {
    if (!ownsInput() || busy || dialogOpen() || composing) return;
    if (
      options.parentMode &&
      [
        'start-flow',
        'thread',
        'new-parent',
        'add-page',
        'delete-page',
        'override-parent',
        'restore-parent',
      ].includes(name)
    ) {
      options.onNotify?.('Parent frames are independent text containers.');
      return;
    }
    if (name === 'show-contextual') {
      editor.classList.remove('panels-hidden', 'tools-hidden');
      state.contextBarHidden = false;
      selectionDirty = true;
      requestFrame();
      return;
    }
    if (name === 'toggle-smart-guides') {
      state.snap = snapEnabled = !snapEnabled;
      try {
        localStorage.setItem('ivo:snapping', String(state.snap));
      } catch {}
      window.dispatchEvent(new Event('ivo:smart-guides-changed'));
      return;
    }
    if (name === 'toggle-panels' || name === 'toggle-side-panels') {
      finishGesture();
      const hidden = !editor.classList.contains('panels-hidden');
      editor.classList.toggle('panels-hidden', hidden);
      editor.classList.toggle('tools-hidden', hidden && name === 'toggle-panels');
      viewport.focus({ preventScroll: true });
      requestFrame();
      return;
    }
    if (name.startsWith('show-panel-') || name === 'show-contextual') {
      editor.classList.remove('panels-hidden', 'tools-hidden');
    }
    if (
      Object.hasOwn(ARRANGE_COMMANDS, name) &&
      (!options.editing ||
        !canWrite() ||
        activeTextId ||
        typing(document.activeElement) ||
        !objects().length)
    )
      return;
    if (publishingControls.command(name, { anchor })) return;
    if (['document-text', 'start-flow', 'thread'].includes(name) && !options.editing) return;
    if (name === 'flow-previous' || name === 'flow-next') {
      const item = object(),
        textFlow = textFlowForFrame(doc(), item);
      if (!textFlow) {
        if (name === 'flow-next' && item) {
          threadFrom = item.id;
          endTextEditing();
          state.tool = 'select';
          renderTools();
        }
        return;
      }
      const index = textFlow.frameIds.indexOf(item.id),
        id = textFlow.frameIds[index + (name === 'flow-next' ? 1 : -1)];
      if (id) {
        select(id);
        fit();
      } else if (name === 'flow-next') {
        threadFrom = item.id;
        endTextEditing();
        state.tool = 'select';
        renderTools();
        options.onNotify?.('Choose an empty text frame');
      }
      return;
    }
    if (name === 'document-text') {
      const selected = object(),
        item = selected?.textFlowId
          ? selected
          : doc().blocks.find((b) => b.textFlowId) ||
            (['text', 'quote'].includes(selected?.type) ? selected : null);
      if (item) focusText(item.id);
      return;
    }
    if (name === 'thread' && object()) {
      endTextEditing();
      threadFrom = object().id;
      state.tool = 'select';
      renderTools();
      options.onNotify?.('Choose an empty text frame');
      return;
    }
    if (name === 'start-flow' && object()) {
      await prepareTextFlowFonts();
      if (!alive || busy) return;
      const id = object().id;
      mutate(() => startTextFlow(doc(), id), 'Start text flow');
      focusText(id);
      return;
    }
    if (name === 'toggle-panel-floating') return workspacePanels.toggleFloating();
    if (name === 'collapse-properties') return workspacePanels.setCollapsed(true);
    if (name === 'toggle-properties') {
      if (
        (editor.classList.contains('show-properties') ||
          editor.classList.contains('panel-floating')) &&
        !editor.classList.contains('panel-collapsed')
      ) {
        workspacePanels.setCollapsed(true);
        editor.classList.remove('show-properties');
        return;
      }
      workspacePanels.show();
      return;
    }
    if (name.startsWith('tool-')) {
      tool(name.slice(5));
      paint();
      return;
    }
    if (name === 'previous-page' || name === 'next-page') {
      if (endTextEditing() === false) return;
      const index = doc().pages.findIndex((page) => page.id === state.activePage),
        next = doc().pages[index + (name === 'next-page' ? 1 : -1)];
      if (next) {
        state.activePage = next.id;
        fit();
      }
      return;
    }
    if (name === 'zoom-in') return zoom(1.25);
    if (name === 'zoom-out') return zoom(0.8);
    if (name === 'zoom-100')
      return cameraTo(
        zoomAt(state.target, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }, 1),
      );
    if (name === 'fit-page' || name === 'fit-all') return fit(name === 'fit-all');
    if (name === 'select-all') {
      if (document.activeElement?.matches('input,textarea')) {
        document.activeElement.select();
        return;
      }
      if (document.activeElement?.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(document.activeElement);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        return;
      }
      select(
        doc()
          .blocks.filter((item) => (item.parentId || null) === (state.inside || null))
          .map((item) => item.id),
      );
      return;
    }
    if (name === 'deselect') return select(null);
    if (!options.editing) return;
    if (name === 'undo' || name === 'redo') {
      if (
        document.activeElement?.matches('input,textarea') &&
        document.activeElement.dataset.editing === 'true'
      ) {
        document.execCommand(name);
        return;
      }
      if (!prepareHistory()) return;
      return name === 'undo' ? onUndo() : onRedo();
    }
    if (name === 'inside') {
      const item = object();
      if (state.inside) {
        state.inside = null;
        renderTools();
        renderPanel();
        return;
      }
      if (item?.type !== 'polygon') {
        options.onNotify?.('Select a polygon to draw inside.');
        return;
      }
      state.inside = item.id;
      renderTools();
      renderPanel();
      return;
    }
    if (name === 'add-page') {
      if (doc().pages.length >= 128) return;
      mutate(() => {
        state.activePage = addPage(doc(), page().id).id;
        setSelectionState(null);
        state.inside = null;
        state.panel = 'pages';
      });
      fit();
      return;
    }
    if (name === 'delete-page') {
      if (doc().pages.length === 1) return;
      mutate(() => {
        removePage(doc(), page().id);
        state.activePage = doc().pages[0].id;
        setSelectionState(null);
        state.inside = null;
      });
      fit();
      return;
    }
    if (name === 'delete' && objects().length)
      return mutate(() => {
        for (const item of objects()) removeObject(doc(), item.id);
        setSelectionState(null);
        state.inside = null;
      });
    if (name === 'duplicate' && objects().length)
      return mutate(() => {
        const copies = duplicateObjects(doc(), state.selection);
        setSelectionState(copies.map((item) => item.id));
      });
    if (name === 'select-mask' && object()?.parentId) return select(object().parentId);
    if (name === 'release-mask' && object()?.clip)
      return mutate(() => {
        releaseMask(doc(), object().id);
        state.inside = null;
      });
    if (name === 'image' || name === 'replace') {
      replaceId = name === 'replace' ? object()?.id : null;
      host.querySelector('.canvas-file-input').click();
      return;
    }
    if (name === 'fit-text' && object()) {
      finishText();
      const item = object(),
        el = world.querySelector(`[data-scene-text="${CSS.escape(item.id)}"]`);
      if (el) {
        const before = structuredClone(doc()),
          viewBefore = captureView(),
          oldHeight = el.style.height;
        el.style.height = 'auto';
        const height = el.getBoundingClientRect().height / state.camera.zoom;
        el.style.height = oldHeight;
        item.h = Math.max(0.01, height);
        updateObject(item);
        onCommit(before, { label: 'Fit text frame', viewBefore, viewAfter: captureView() });
        renderPanel();
        requestFrame();
      }
      return;
    }
    if (['bold', 'italic', 'underline'].includes(name)) {
      const range = preserveRange(),
        element = activeText();
      if (element && range) {
        const node =
            range.startContainer.nodeType === Node.ELEMENT_NODE
              ? range.startContainer
              : range.startContainer.parentElement,
          style = getComputedStyle(node),
          atCaret =
            name === 'bold'
              ? Number(style.fontWeight) >= 600
              : name === 'italic'
                ? style.fontStyle === 'italic'
                : style.textDecorationLine.includes('underline');
        const enabled = range.collapsed
          ? (pendingMarks[name] ?? atCaret)
          : rangeUsesFormat(element, range, name, true);
        if (!publishingControls.variant(name, !enabled)) applyTextProperty(name, !enabled);
      } else if (object() && ['text', 'quote'].includes(object().type)) {
        if (object().textFlowId) {
          focusText(object().id);
          const range = document.createRange();
          range.selectNodeContents(activeText());
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          rememberTextSelection();
        }
        const el =
            activeTextId === object().id
              ? activeText()
              : world.querySelector(`[data-scene-text="${CSS.escape(object().id)}"]`),
          all = document.createRange();
        all.selectNodeContents(el);
        const value = !rangeUsesFormat(el, all, name, true);
        if (!publishingControls.variant(name, value)) applyTextProperty(name, value);
      }
      return;
    }

    if (name === 'link') {
      const range = preserveRange(),
        owner = doc().id,
        element = activeText(),
        viewBefore = captureView(),
        bookmark = range && bookmarkForRange(element, range),
        id = await onLink?.();
      if (!id || !alive || doc().id !== owner) return;
      const target = options.documents.find((v) => v.id === id);
      if (!target) return;
      if (element?.isConnected && activeTextId === element.dataset.sceneText && bookmark) {
        finishText();
        const before = structuredClone(doc()),
          currentRange = rangeFromBookmark(element, bookmark);
        if (!currentRange) return;
        const anchor = document.createElement('a');
        anchor.dataset.docId = id;
        anchor.href = '#doc=' + id;
        if (currentRange.collapsed) anchor.textContent = target.title;
        else anchor.append(currentRange.extractContents());
        currentRange.insertNode(anchor);
        currentRange.selectNodeContents(anchor);
        writeText(sceneObject(doc(), activeTextId), element.innerHTML, element);
        if (textFlowForFrame(doc(), activeTextId)) refreshFlowPreview();
        savedTextSelection = {
          id: activeTextId,
          bookmark: bookmarkForRange(element, currentRange),
        };
        restoreTextSelection(element, savedTextSelection.bookmark);
        measureText(sceneObject(doc(), activeTextId), element);
        onCommit(before, { label: 'Insert link', viewBefore, viewAfter: captureView() });
        selectionDirty = true;
        requestFrame();
        return;
      }
      mutate(() => {
        const existing = object();
        if (existing && ['text', 'quote'].includes(existing.type)) {
          const textFlow = textFlowForFrame(doc(), existing);
          if (textFlow) {
            textFlow.html += `<p><a data-doc-id="${esc(id)}" href="#doc=${esc(id)}">${esc(target.title)}</a></p>`;
            return;
          }
          existing.html += `<p><a data-doc-id="${esc(id)}" href="#doc=${esc(id)}">${esc(target.title)}</a></p>`;
          return;
        }
        const context = insertionContext();
        insertObject(doc(), 'text', context.pageId, {
          parentId: context.parentId,
          layerId: context.layerId,
          html: `<p><a data-doc-id="${esc(id)}" href="#doc=${esc(id)}">${esc(target.title)}</a></p>`,
        });
      }, 'Insert link');
    }
  }
  function pasteObjects(value) {
    if (!options.editing || !ownsInput() || busy || composing) return Promise.resolve(false);
    endTextEditing();
    finishGesture();
    const context = insertionContext(),
      before = documentContent(doc());
    pendingCount++;
    pendingFiles = pendingFiles
      .then(async () => {
        if (!alive || !ownsInput() || documentContent(doc()) !== before)
          throw new Error('The document changed before the objects could be pasted. Paste again.');
        const archive = readObjectClipboard(value),
          planned = structuredClone(doc()),
          roots = pasteObjectSelection(planned, archive, context),
          existing = options.assets?.() || options.fonts?.() || [],
          resources = new Map(existing.map((asset) => [asset.id, asset]));
        ensureTextWrapFlows(planned);
        for (const asset of archive.assets) {
          const prior = resources.get(asset.id);
          if (prior && (prior.data !== asset.data || prior.mimeType !== asset.mimeType))
            throw new Error(
              'A clipboard resource conflicts with a resource already in this vault.',
            );
          resources.set(asset.id, asset);
        }
        validateImport({
          schemaVersion: CURRENT_ARCHIVE_VERSION,
          documents: [planned],
          assets: [...resources.values()],
        });
        for (const asset of archive.assets)
          if (!existing.some((a) => a.id === asset.id)) await onAsset(asset);
        if (!alive || !ownsInput() || busy || documentContent(doc()) !== before)
          throw new Error('The document changed before the objects could be pasted. Paste again.');
        mutate(() => {
          Object.assign(doc(), planned);
          setSelectionState(roots.map((item) => item.id));
          state.tool = 'select';
        }, 'Paste objects');
        publishingControls.prepareLegacyFonts();
        return true;
      })
      .catch((error) => {
        options.onNotify?.(error.message);
        return false;
      })
      .finally(() => pendingCount--);
    return pendingFiles;
  }
  function copyObjects(event) {
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (
      !ownsInput() ||
      busy ||
      dialogOpen() ||
      composing ||
      !options.editing ||
      activeTextId ||
      target?.closest('input,textarea,select,[contenteditable="true"]') ||
      !objects().length
    )
      return;
    try {
      finishGesture();
      const payload = copyObjectSelection(
        doc(),
        state.selection,
        options.assets?.() || options.fonts?.() || [],
      );
      if (!payload || !event.clipboardData) return;
      const value = JSON.stringify(payload);
      if (value.length > MAX_OBJECT_CLIPBOARD)
        throw new Error('The selected objects are too large for the clipboard.');
      const text = document.createElement('div');
      text.innerHTML = cleanHTML(
        [
          ...payload.archive.documents[0].blocks.map((b) => b.html),
          ...(payload.archive.documents[0].textFlows || []).map((f) => f.html),
        ].join('<br>'),
      );
      event.clipboardData.setData(OBJECT_CLIPBOARD_TYPE, value);
      event.clipboardData.setData('text/html', text.innerHTML);
      event.clipboardData.setData('text/plain', text.textContent || 'Ivo objects');
      event.preventDefault();
      if (event.type === 'cut')
        mutate(() => {
          for (const item of objects()) removeObject(doc(), item.id);
          setSelectionState(null);
          state.inside = null;
        }, 'Cut objects');
    } catch (error) {
      event.preventDefault();
      options.onNotify?.(error.message);
    }
  }
  function addFiles(files) {
    pendingCount++;
    const context = insertionContext(),
      replace = replaceId;
    replaceId = null;
    pendingFiles = pendingFiles
      .then(async () => {
        if (files.some((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)))
          throw new Error('PDF placement has been removed. Place an image file instead.');
        if (!files.length) return;
        const prepared = await prepareImages(files, { readFile: readImageFile });
        for (const value of prepared) await onAsset(value.asset);
        if (!alive) return;
        mutate(() => {
          for (const [i, { asset, size }] of prepared.entries()) {
            let item = replace && sceneObject(doc(), replace);
            if (!item) {
              const parent = context.parentId && sceneObject(doc(), context.parentId),
                scale = Math.min(1, 360 / size.width, 480 / size.height);
              item = insertObject(doc(), 'image', context.pageId, {
                parentId: parent?.id,
                layerId: context.layerId,
                ...(!parent
                  ? {
                      x: 48 + i * 16,
                      y: 48 + i * 16,
                      w: size.width * scale,
                      h: size.height * scale,
                    }
                  : {}),
              });
            }
            item.type = 'image';
            item.src = 'asset:' + asset.id;
            item.alt = asset.name;
            setSelectionState(item.id);
          }
          state.tool = 'select';
        });
      })
      .catch((error) => options.onNotify?.(error.message))
      .finally(() => pendingCount--);
    return pendingFiles;
  }

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }
  function showContextMenu(event) {
    if (!options.editing || busy || dialogOpen() || composing) return;
    event.preventDefault();
    finishGesture();
    preserveRange();
    let hit = event.target.closest('[data-object]')?.dataset.object;
    if (hit && state.tool === 'select' && !state.inside) {
      let item = sceneObject(doc(), hit);
      while (item?.parentId) {
        hit = item.parentId;
        item = sceneObject(doc(), hit);
      }
    }
    if (hit && !state.selection.includes(hit) && !activeTextId) select(hit);
    const context = { selected: objects().length > 0, textEditing: !!activeTextId };
    if (options.nativeContextMenu !== false && globalThis.ivoNative?.showContextMenu) {
      globalThis.ivoNative
        .showContextMenu(context)
        .catch((error) => options.onNotify?.(error.message));
      return;
    }
    closeContextMenu();
    contextMenu = document.createElement('div');
    contextMenu.className = 'canvas-context-menu';
    contextMenu.setAttribute('role', 'menu');
    contextMenu.innerHTML = `<button role="menuitem" data-canvas-command="link">Insert document link…</button><div class="menu-separator"></div><button role="menuitem" data-canvas-command="duplicate" ${context.selected ? '' : 'disabled'}>Duplicate</button><button role="menuitem" data-canvas-command="delete" ${context.selected ? '' : 'disabled'}>Delete</button><div class="menu-separator"></div><button role="menuitem" data-canvas-command="select-all">Select all</button><button role="menuitem" data-canvas-command="deselect">Deselect</button>`;
    editor.append(contextMenu);
    const bounds = editor.getBoundingClientRect();
    contextMenu.style.left =
      Math.min(event.clientX - bounds.left, editor.clientWidth - contextMenu.offsetWidth - 4) +
      'px';
    contextMenu.style.top =
      Math.min(event.clientY - bounds.top, editor.clientHeight - contextMenu.offsetHeight - 4) +
      'px';
    contextMenu.querySelector('button').focus({ preventScroll: true });
  }
  const controller = new AbortController(),
    listen = (target, event, callback, extra = {}) =>
      target.addEventListener(
        event,
        (value) => {
          if (
            target === host &&
            value.target instanceof Element &&
            value.target.closest('.scene-editor') !== editor
          )
            return;
          callback(value);
        },
        { signal: controller.signal, ...extra },
      );
  listen(host, 'pointerdown', (event) => {
    if (event.target.closest('[data-canvas-command],[data-object-prop],[data-highlight-color]')) {
      preserveRange();
      if (event.target.closest('.canvas-type-format')) event.preventDefault();
    }
  });
  listen(host, 'click', (event) => {
    const cmd = event.target.closest('[data-canvas-command]');
    if (cmd) {
      event.preventDefault();
      closeContextMenu();
      Promise.resolve(command(cmd.dataset.canvasCommand, { anchor: cmd })).catch((e) =>
        options.onNotify?.(e.message),
      );
      return;
    }
    const tab = event.target.closest('[data-canvas-panel]');
    if (tab) {
      finishText();
      state.panel = tab.dataset.canvasPanel;
      renderPanel();
      return;
    }
    const p = event.target.closest('[data-select-page]');
    if (p) {
      state.activePage = p.dataset.selectPage;
      setSelectionState(null);
      state.inside = null;
      renderPanel();
      fit();
      return;
    }
    const open = event.target.closest('[data-scene-open],[data-doc-id]');
    if (open && (!options.editing || event.metaKey || event.ctrlKey || open.dataset.sceneOpen)) {
      event.preventDefault();
      onOpen(open.dataset.sceneOpen || open.dataset.docId, {
        newTab: event.metaKey || event.ctrlKey,
        toRight: (event.metaKey || event.ctrlKey) && event.altKey,
      });
    } else if (options.editing && event.target.closest('.canvas-text a')) event.preventDefault();
  });
  listen(host, 'auxclick', (event) => {
    const link = event.target.closest('[data-doc-id],[data-scene-open]');
    if (event.button === 1 && link) {
      event.preventDefault();
      onOpen(link.dataset.docId || link.dataset.sceneOpen, {
        newTab: true,
        toRight: (event.metaKey || event.ctrlKey) && event.altKey,
      });
    }
  });
  listen(host, 'change', (event) => {
    const el = event.target;
    if (el.matches('[data-flow-composer]')) {
      void setFlowComposer(el.value);
      return;
    }
    if (el.matches('[data-flow-auto]')) {
      mutate(() => {
        textFlowForFrame(doc(), object()).automaticPages = el.checked;
      }, 'Change text flow');
      return;
    }
    if (el.matches('input,select,textarea')) {
      el.dataset.editing = 'false';
      el.dataset.focusValue = el.value;
    }
    if (el.matches('[data-page-order]')) {
      const index = Math.max(
        0,
        Math.min(doc().pages.length - 1, Math.round(Number(el.value) || 1) - 1),
      );
      mutate(() => reorderPage(doc(), page().id, index), 'Reorder page');
      fit();
      return;
    }
    if (el.matches('[data-selection-page]') && el.value) {
      const pageId = el.value;
      mutate(() => {
        for (const item of objects()) moveObjectToPage(doc(), item.id, pageId);
        state.activePage = pageId;
        state.inside = null;
      }, 'Move to page');
      fit();
      return;
    }
    if (el.dataset.selectionProp && objects().length > 1) {
      const key = el.dataset.selectionProp,
        value = Number(el.value);
      if (!Number.isFinite(value)) return;
      mutate(() => {
        const rect = selectionBounds(doc(), state.selection);
        const amount = ['w', 'h'].includes(key)
          ? Math.max(0.01, Math.min(100000, value))
          : Math.max(-100000, Math.min(100000, value));
        const next = editReferenceRect(
          rect,
          key,
          amount,
          state.transformReference,
          state.constrainProportions,
        );
        transformSelection(doc(), state.selection, next, structuredClone(doc()));
      });
      return;
    }
    if (el.matches('[data-active-page],[data-property-page]')) {
      if (endTextEditing() === false) return;
      if (doc().pages.some((page) => page.id === el.value)) {
        state.activePage = el.value;
        renderPanel();
        fit();
      }
      return;
    }
    if (el.matches('.canvas-file-input')) {
      addFiles([...el.files]);
      el.value = '';
      return;
    }
    if (el.dataset.objectProp && object()) {
      const prop = el.dataset.objectProp;
      if (prop === 'textStyle' && options.resolveFont) {
        void publishingControls.chooseFont(el.value);
        return;
      }
      if (prop === 'textStyle' && el.value.startsWith(SYSTEM_FONT_PREFIX)) return;
      if (['bold', 'italic'].includes(prop) && publishingControls.variant(prop, el.checked)) return;
      let value =
        el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      if (el.type === 'number' && !Number.isFinite(value)) return;
      if (['x', 'y'].includes(prop)) value = Math.max(-100000, Math.min(100000, value));
      if (['w', 'h'].includes(prop)) value = Math.max(0.01, Math.min(100000, value));
      if (prop === 'fontSize') value = Math.max(1, Math.min(2000, value));
      if (['strokeWidth', 'opacity'].includes(prop)) value = Math.max(0, Math.min(100, value));
      if (prop === 'rotation') value = Math.max(-36000, Math.min(36000, value));
      if (prop === 'leading') value = Math.max(0, Math.min(4000, value));
      if (prop === 'tracking') value = Math.max(-1000, Math.min(10000, value));
      if (['paragraphBefore', 'paragraphAfter'].includes(prop))
        value = Math.max(0, Math.min(2000, value));
      if (CHARACTER_FIELDS[prop] || PARAGRAPH_FIELDS[prop]) {
        const attr = CHARACTER_FIELDS[prop] || PARAGRAPH_FIELDS[prop];
        if (validTextAttribute(attr, String(value)) === null) {
          options.onNotify?.('Choose a valid typography value.');
          return;
        }
      }
      if (CHARACTER_FIELDS[prop] || PARAGRAPH_FIELDS[prop]) {
        if (applyTextProperty(prop, value)) {
          if (el.type === 'number') el.value = String(value);
          el.dataset.focusValue = el.value;
        }
        return;
      }
      mutate(() => {
        const item = object();
        if (['x', 'y', 'w', 'h'].includes(prop))
          transformObject(
            doc(),
            item.id,
            editReferenceRect(
              { x: item.x, y: item.y, w: item.w, h: item.h },
              prop,
              value,
              state.transformReference,
              state.constrainProportions,
            ),
            structuredClone(doc()),
          );
        else if (prop === 'cropX' || prop === 'cropY') {
          item.crop = {
            ...item.crop,
            [prop === 'cropX' ? 'x' : 'y']: Math.max(0, Math.min(100, value)),
          };
          item.objectPosition = { ...item.crop };
        } else {
          if (['opacity', 'rotation'].includes(prop)) enablePublishing(doc());
          item[prop] = value;
        }
      });
    }
    if (el.dataset.pageProp) {
      const key = el.dataset.pageProp,
        value =
          key === 'name'
            ? el.value.slice(0, 120)
            : Math.max(72, Math.min(14400, Number(el.value) || 72));
      mutate(() => {
        page()[key] = value;
      });
    }
    if (el.dataset.sceneMeta) {
      const key = el.dataset.sceneMeta;
      mutate(() => {
        doc()[key] =
          key === 'title'
            ? el.value.trim().slice(0, 180) || 'Untitled'
            : [
                ...new Set(
                  el.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                ),
              ];
        options.onMetadata?.();
      });
    }
  });
  listen(host, 'pointerdown', (event) => {
    const element = event.target.closest('.canvas-flow-input');
    if (
      ownsInput() &&
      options.editing &&
      element &&
      !element.isContentEditable &&
      sceneObject(doc(), element.dataset.sceneText)
    ) {
      event.preventDefault();
      focusText(element.dataset.sceneText, event);
      placeTextCaret(element, event.clientX, event.clientY);
    }
  });
  listen(host, 'focusin', (event) => {
    if (event.target.matches('input,textarea')) {
      event.target.dataset.focusValue = event.target.value;
      event.target.dataset.editing = 'false';
    }
    if (event.target.matches('[data-scene-text]')) {
      setSelectionState(event.target.dataset.sceneText);
      selectionDirty = true;
      requestFrame();
    }
  });
  listen(host, 'focusout', (event) => {
    if (event.target.matches('[data-scene-text]')) finishText();
  });
  listen(document, 'selectionchange', () => {
    if (!applyingText && !restoring) {
      rememberTextSelection();
      refreshTextControls();
      if (!composing) {
        flowSelection?.sync();
        followTextFlowCaret();
      }
    }
  });
  function finishDocumentInput(element, result) {
    if (result === 'unchanged' || syncText(element)) finishText({ synchronized: true });
  }
  function inheritInputTypography(element) {
    const selection = element.ownerDocument.getSelection();
    if (selection.isCollapsed && selection.rangeCount)
      inheritEmptyParagraphTypography(element, selection.getRangeAt(0), pendingMarks);
  }
  listen(host, 'compositionstart', (event) => {
    const element = activeText();
    if (!ownsInput() || !element?.contains(event.target)) return;
    beginTextInput('insertCompositionText');
    const selection = textViewBefore?.textSelection;
    if (
      sourceTextFlow(element) &&
      selection &&
      selection.anchor.index !== selection.focus.index &&
      Math.min(selection.anchor.index, selection.focus.index) <
        Number(element.dataset.projectedStart)
    )
      projectFlowInput(element, 0);
    composing = true;
    inheritInputTypography(element);
  });
  listen(host, 'compositionend', (event) => {
    if (!composing) return;
    composing = false;
    const element = activeText();
    if (element && !event.data) {
      // The OS can remove a selected range as it starts a candidate. Cancel
      // returns both text and selection to where the user began the operation.
      const flow = sourceTextFlow(element);
      element.innerHTML = cleanHTML(flow?.html ?? sceneObject(doc(), activeTextId)?.html);
      delete element.dataset.projectedStart;
      applyNamedTextStyles(element, doc());
      const bookmark = textViewBefore?.textSelection;
      if (bookmark && document.activeElement === element)
        restoreTextSelection(element, bookmark, { focus: false });
      textBefore = textViewBefore = null;
      inputType = '';
      if (flow) followTextFlowCaret();
      rememberTextSelection();
      requestFrame();
    } else if (element) {
      syncText(element);
      inputType = 'insertCompositionText';
      finishText();
    }
    for (const resolve of compositionWaiters.splice(0)) resolve();
  });
  listen(host, 'beforeinput', (event) => {
    const element = event.target.closest('[data-scene-text]');
    if (!ownsInput()) {
      if (element) event.preventDefault();
      return;
    }
    if (
      !element ||
      element.dataset.sceneText !== activeTextId ||
      applyingText ||
      event.defaultPrevented
    )
      return;
    if (['historyUndo', 'historyRedo'].includes(event.inputType)) {
      event.preventDefault();
      command(event.inputType === 'historyUndo' ? 'undo' : 'redo');
      return;
    }
    const nativeFormat = {
      formatBold: 'bold',
      formatItalic: 'italic',
      formatUnderline: 'underline',
    }[event.inputType];
    if (nativeFormat) {
      event.preventDefault();
      void command(nativeFormat);
      return;
    }
    if (composing || event.isComposing) return;
    rebasePendingMarks();
    beginTextInput(event.inputType);
    if (event.inputType.startsWith('insert')) inheritInputTypography(element);
    const handled =
      event.cancelable &&
      applyDocumentInput(
        element,
        event.inputType,
        event.data ?? event.dataTransfer?.getData('text/plain'),
        pendingMarks,
        event.getTargetRanges?.(),
        event.inputType.startsWith('deleteSoftLine') &&
          sourceTextFlow(element) &&
          element.ownerDocument.getSelection().isCollapsed
          ? flowSelection.lineDeletionRange(event.inputType.endsWith('Backward'))
          : undefined,
      );
    if (handled) {
      event.preventDefault();
      finishDocumentInput(element, handled);
      return;
    }
    const flow = sourceTextFlow(element);
    if (flow && revealFlowEditRange(element, event)) {
      const previousHTML = flow.html;
      // The input event normally projects the edited source immediately. A no-op
      // or canceled edit has no input event, so restore its view before paint.
      requestAnimationFrame(() => {
        if (
          alive &&
          !composing &&
          activeText() === element &&
          sourceTextFlow(element) === flow &&
          flow.html === previousHTML &&
          element.dataset.projectedStart === '0'
        )
          followTextFlowCaret();
      });
    }
    if (
      event.inputType === 'insertText' &&
      event.data &&
      Object.keys(pendingMarks).length &&
      event.cancelable
    ) {
      event.preventDefault();
      const range = preserveRange();
      if (!range) return;
      applyingText = true;
      try {
        const span = document.createElement('span');
        for (const [field, value] of Object.entries(pendingMarks))
          setTextAttribute(span, CHARACTER_FIELDS[field], value);
        span.textContent = event.data;
        range.deleteContents();
        range.insertNode(span);
        range.selectNodeContents(span);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        syncText(element);
      } finally {
        applyingText = false;
      }
      finishText();
    }
  });
  listen(host, 'input', (event) => {
    if (!ownsInput()) return;
    const element = event.target;
    if (element.matches('input,textarea'))
      element.dataset.editing = String(element.value !== element.dataset.focusValue);
    if (!element.dataset.sceneText || applyingText || restoring || composing) return;
    beginTextInput(event.inputType || 'insertText');
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak')
      inheritInputTypography(element);
    syncText(element);
    finishText();
  });
  listen(window, 'paste', (event) => {
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (!ownsInput() || busy || dialogOpen() || target?.closest('input,textarea,select')) return;
    const objectData = event.clipboardData?.getData(OBJECT_CLIPBOARD_TYPE);
    if (objectData && !activeTextId && options.editing) {
      event.preventDefault();
      void pasteObjects(objectData);
      return;
    }
    const files = clipboardImages(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      if (!options.editing) {
        onRequestEdit?.(files);
        return;
      }
      addFiles(files);
      return;
    }
    const text = target?.closest('[data-scene-text],[data-flow-frame]');
    if (text && options.editing) {
      event.preventDefault();
      beginTextInput('insertFromPaste');
      document.execCommand('insertHTML', false, textClipboardHTML(event.clipboardData));
      publishingControls.prepareLegacyFonts();
    }
  });
  for (const type of ['copy', 'cut']) listen(window, type, copyObjects);
  for (const type of ['copy', 'cut'])
    listen(host, type, (event) => {
      const element = activeText(),
        selection = window.getSelection();
      if (
        !ownsInput() ||
        !sourceTextFlow(element) ||
        !selection.rangeCount ||
        selection.isCollapsed ||
        !element.contains(selection.anchorNode) ||
        !element.contains(selection.focusNode)
      )
        return;
      const range = selection.getRangeAt(0),
        copy = document.createElement('div');
      copy.append(range.cloneContents());
      const html = flowInputHTML(copy),
        plain = document.createElement('div');
      plain.innerHTML = html
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(p|div|li|h[2-4]|blockquote)>/gi, '\n');
      event.preventDefault();
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', plain.textContent.replace(/\n$/, ''));
      if (type === 'cut' && options.editing) {
        beginTextInput('deleteByCut');
        range.deleteContents();
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        syncText(element);
        finishText();
      }
    });
  listen(viewport, 'contextmenu', showContextMenu);
  listen(window, 'pointerdown', (event) => {
    if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
  });
  listen(viewport, 'pointerdown', pointerDown);
  listen(viewport, 'pointermove', pointerMove);
  listen(viewport, 'pointerup', pointerUp);
  listen(viewport, 'pointercancel', pointerUp);
  listen(viewport, 'lostpointercapture', (event) => {
    if (gesture?.pointerId === event.pointerId) finishGesture();
  });
  listen(viewport, 'dblclick', (event) => {
    if (!options.editing) return;
    if (event.target.closest('[data-type-circle]')) {
      convertText();
      return;
    }
    if (state.tool === 'polygon') {
      finishPolygon();
      return;
    }
    const id = event.target.closest('[data-object]')?.dataset.object || lastHit;
    if (activeTextId === id) return;
    if (['text', 'quote'].includes(sceneObject(doc(), id)?.type)) focusText(id, event, true);
  });
  listen(
    viewport,
    'wheel',
    (event) => {
      if (!ownsInput()) return;
      event.preventDefault();
      const delta = wheelDelta(event, {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
      if (event.ctrlKey) zoom(pinchWheelScale(delta.y), pointer(event));
      else if (event.altKey) zoom(Math.exp(-delta.y * 0.005), pointer(event));
      else {
        finishGesture();
        cameraTo(panBy(state.camera, delta));
      }
    },
    { passive: false },
  );
  listen(viewport, 'dragover', (event) => event.preventDefault());
  listen(viewport, 'drop', (event) => {
    event.preventDefault();
    if (options.editing) addFiles([...event.dataTransfer.files]);
  });
  listen(window, 'keydown', (event) => {
    if (
      !(event.target instanceof Element) ||
      !ownsInput() ||
      busy ||
      dialogOpen() ||
      !host.isConnected ||
      event.isComposing ||
      composing
    )
      return;
    if (contextMenu) {
      const buttons = [...contextMenu.querySelectorAll('button:not(:disabled)')];
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        buttons[
          (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeContextMenu();
        viewport.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Tab') closeContextMenu();
      else return;
    }
    editor.dataset.option = String(event.altKey);
    if (['Alt', 'Shift'].includes(event.key) && replayMoveModifiers(event)) {
      event.preventDefault();
      return;
    }
    if (handleFieldTab(event)) return;
    const focusedText = activeText();
    const typeAction = typeShortcut(event, navigator.platform);
    if (
      typeAction &&
      !event.defaultPrevented &&
      options.editing &&
      (focusedText?.contains(event.target) ||
        (!activeTextId &&
          !typing(event.target) &&
          (event.target === document.body || viewport.contains(event.target)))) &&
      ['text', 'quote'].includes(object()?.type)
    ) {
      event.preventDefault();
      const { field, delta, toggle, value } = typeAction;
      if (delta) {
        const base = effectiveTextStyle(doc(), frameTextSettings(doc(), object())).fontSize ?? 16;
        const size =
          activeTextId && window.getSelection()?.isCollapsed
            ? (readSelectedTextStyle()?.values.fontSize ?? base)
            : base;
        const adjust = (points) => Math.max(1, Math.min(2000, points + delta));
        applyTextProperty(field, adjust(size), { adjust });
      } else applyTextProperty(field, toggle ? !readSelectedTextStyle()?.values[field] : value);
      return;
    }
    const move = textNavigationShortcut(event, navigator.platform);
    // The pasteboard owns the viewport when there is no text insertion point.
    if (
      move &&
      !move.extend &&
      !event.defaultPrevented &&
      !focusedText?.isContentEditable &&
      (event.target === document.body || viewport.contains(event.target)) &&
      !typing(event.target) &&
      !event.target.closest('button,a,[role="menu"]')
    ) {
      const pageKey = event.key === 'PageUp' || event.key === 'PageDown';
      const edgeKey = event.key === 'Home' || event.key === 'End';
      if (move.unit.startsWith('scroll-') || pageKey || edgeKey) {
        const scrollPage = pageKey || move.unit === 'scroll-page';
        event.preventDefault();
        scrollTextView(scrollPage ? 'scroll-page' : 'scroll-edge', move.direction === 'forward');
        return;
      }
    }
    if (
      !event.defaultPrevented &&
      focusedText?.isContentEditable &&
      focusedText.contains(event.target)
    ) {
      if (move?.unit.startsWith('scroll-')) {
        event.preventDefault();
        scrollTextView(move.unit, move.direction === 'forward');
        return;
      }
      if (
        move &&
        !sourceTextFlow(focusedText) &&
        moveSingleFrameSelection(
          focusedText,
          move,
          viewport.clientHeight,
          sceneObject(doc(), activeTextId)?.html,
        )
      ) {
        event.preventDefault();
        const selection = focusedText.ownerDocument.getSelection();
        const focus = document.createRange();
        focus.setStart(selection.focusNode, selection.focusOffset);
        focus.collapse(true);
        const rect = focus.getBoundingClientRect(),
          bounds = viewport.getBoundingClientRect();
        if (rect.height) {
          const dy =
            Math.min(0, bounds.bottom - 12 - rect.bottom) ||
            Math.max(0, bounds.top + 12 - rect.top);
          if (dy) cameraTo({ ...state.camera, y: state.camera.y + dy });
        }
        return;
      }
    }
    const deletion = textDeletionShortcut(event, navigator.platform);
    if (deletion && !event.defaultPrevented) {
      if (focusedText?.isContentEditable && focusedText.contains(event.target)) {
        const text = focusedText;
        event.preventDefault();
        beginTextInput(deletion);
        const result = applyDocumentInput(text, deletion, '', {});
        if (result) finishDocumentInput(text, result);
        else {
          // A selection across unsupported structures uses the platform's
          // structural deletion, with the same word/character intent.
          const selection = text.ownerDocument.getSelection();
          if (sourceTextFlow(text)) projectFlowInput(text, 0);
          if (selection.isCollapsed)
            selection.modify(
              'extend',
              deletion.endsWith('Backward') ? 'backward' : 'forward',
              deletion.startsWith('deleteWord') ? 'word' : 'character',
            );
          if (
            !selection.isCollapsed &&
            text.contains(selection.anchorNode) &&
            text.contains(selection.focusNode)
          )
            document.execCommand('delete');
          finishText();
        }
        return;
      }
    }
    const modifier = event.metaKey || event.ctrlKey;
    if (event.key === 'Tab' && !modifier && !event.altKey) {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const text = activeText();
      if (text?.isContentEditable && text.contains(event.target)) {
        if (event.shiftKey) options.onNotify?.('Right-indent tabs are not available yet.');
        else {
          rebasePendingMarks();
          beginTextInput('insertText');
          inheritInputTypography(text);
          const result = applyDocumentInput(text, 'insertText', '\t', pendingMarks);
          if (result) finishDocumentInput(text, result);
          else {
            document.execCommand('insertText', false, '\t');
            syncText(text);
            finishText();
          }
        }
      } else if (!typing(event.target))
        command(event.shiftKey ? 'toggle-side-panels' : 'toggle-panels');
      return;
    }
    if (modifier && !event.altKey && event.key.toLowerCase() === 'u' && !event.shiftKey) {
      event.preventDefault();
      command('toggle-smart-guides');
      return;
    }
    if (modifier && !event.altKey && ['[', ']', '{', '}'].includes(event.key)) {
      event.preventDefault();
      if (!typing(event.target)) {
        command(
          ['[', '{'].includes(event.key)
            ? event.shiftKey
              ? 'send-back'
              : 'send-backward'
            : event.shiftKey
              ? 'bring-front'
              : 'bring-forward',
        );
      }
      return;
    }
    const flowInput = activeText();
    if (sourceTextFlow(flowInput) && event.target === flowInput) {
      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        command('select-all');
        return;
      }
      if (
        ['ArrowLeft', 'ArrowUp', 'Home'].includes(event.key) &&
        Number(flowInput.dataset.projectedStart) > 0
      ) {
        const selection = window.getSelection(),
          offset = sourceCaretIndex(),
          caret = selection.rangeCount && selection.getRangeAt(0).getBoundingClientRect(),
          box = flowInput.getBoundingClientRect();
        if (
          offset <= Number(flowInput.dataset.projectedStart) ||
          (event.key === 'ArrowUp' && caret && caret.top < box.top + caret.height)
        ) {
          event.preventDefault();
          projectFlowInput(flowInput, 0);
          selection.modify(
            event.shiftKey ? 'extend' : 'move',
            'backward',
            event.key === 'ArrowUp'
              ? 'line'
              : event.key === 'Home'
                ? 'lineboundary'
                : event.altKey || modifier
                  ? 'word'
                  : 'character',
          );
          followTextFlowCaret();
          rememberTextSelection();
          return;
        }
      }
    }
    if (event.target.closest('[data-type-circle]') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      convertText();
      return;
    }
    if (event.target.closest('button') && ['Enter', ' '].includes(event.key) && !draft) return;
    if (modifier && event.key.toLowerCase() === 'e') return;
    if (
      modifier &&
      event.key.toLowerCase() === 'z' &&
      (event.target.closest('[data-scene-text]') ||
        (event.target.closest('.canvas-properties') &&
          event.target.matches('input,textarea') &&
          event.target.dataset.editing !== 'true'))
    ) {
      event.preventDefault();
      command(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (activeTextId && event.target.closest('[data-scene-text]') && modifier) {
      const key = event.key.toLowerCase();
      if (['b', 'i'].includes(key) || (key === 'u' && event.shiftKey)) {
        event.preventDefault();
        command({ b: 'bold', i: 'italic', u: 'underline' }[key]);
        return;
      }
    }
    if (typing(event.target)) {
      if (event.key === 'Escape') {
        event.target.blur();
        tool('select');
        paint();
        event.preventDefault();
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (gesture?.kind === 'marquee' && key === 'e') {
      event.preventDefault();
      gesture.enclosed = !gesture.enclosed;
      if (gesture.lastClient)
        pointerMove({
          clientX: gesture.lastClient.x,
          clientY: gesture.lastClient.y,
          pointerId: gesture.pointerId,
        });
      return;
    }
    if (modifier && event.shiftKey && key === 'a') {
      event.preventDefault();
      select(null);
      return;
    }
    if (modifier && key === 'a') {
      event.preventDefault();
      command('select-all');
      return;
    }
    if (modifier && key === 'z') {
      if (options.editing) {
        event.preventDefault();
        command(event.shiftKey ? 'redo' : 'undo');
      }
      return;
    }
    if (modifier && key === '0') {
      event.preventDefault();
      fit(true);
      return;
    }
    if (['+', '=', '-'].includes(key)) {
      event.preventDefault();
      zoom(key === '-' ? 0.8 : 1.25);
      return;
    }
    if (key === ' ') {
      space = true;
      viewport.classList.add('space-pan');
      event.preventDefault();
      return;
    }
    if (key === 'escape') {
      closeContextMenu();
      if (gesture) finishGesture(true);
      threadFrom = null;
      draft = null;
      state.inside = null;
      select(null);
      tool('select');
      paint();
      return;
    }
    if (!options.editing || modifier || event.altKey) return;
    const name = { v: 'select', a: 'direct', t: 'text', m: 'rectangle', p: 'polygon', h: 'hand' }[
      key
    ];
    if (name) {
      event.preventDefault();
      tool(name);
      paint();
      return;
    }
    if (key === 'enter' && draft) {
      event.preventDefault();
      finishPolygon();
      return;
    }
    if (['delete', 'backspace'].includes(key) && objects().length) {
      event.preventDefault();
      command('delete');
      return;
    }
    if (key.startsWith('arrow') && objects().length) {
      event.preventDefault();
      mutate(() => {
        const amount = event.shiftKey ? 10 : 1;
        for (const item of objects()) {
          item.x += key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0;
          item.y += key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0;
        }
      });
    }
  });
  listen(window, 'ivo:smart-guides-changed', () => {
    state.snap = snapEnabled;
    guides.replaceChildren();
    options.onViewChange?.();
  });
  listen(window, 'keyup', (event) => {
    editor.dataset.option = String(event.altKey);
    if (['Alt', 'Shift'].includes(event.key) && replayMoveModifiers(event)) event.preventDefault();
    if (event.key === ' ') {
      space = false;
      viewport.classList.remove('space-pan');
    }
  });
  listen(window, 'blur', () => {
    delete editor.dataset.option;
    finishGesture(true);
    finishText();
    space = false;
    viewport.classList.remove('space-pan');
    pointers.clear();
    pinch = null;
    delete editor.dataset.gesture;
  });
  function dialogOpen() {
    return !!document.querySelector('dialog[open]');
  }
  const contextualBar = createContextualBar(editor, viewport, {
    doc,
    state,
    objects,
    editing: () => options.editing,
    textEditing: () => !!activeTextId,
    textState: () => textSummary,
    fonts: options.fonts,
    systemFonts: options.systemFonts,
    allowed: () => ownsInput() && !busy && !composing,
  });
  const publishingControls = installPublishingControls(editor, {
    doc,
    state,
    objects,
    mutate,
    applyTextProperty,
    render: renderPanel,
    select,
    preserveRange,
    allowed: () => ownsInput() && options.editing && !busy && !composing && !dialogOpen(),
    dialogAllowed: () => ownsInput() && options.editing && !busy && !composing,
    notify: options.onNotify,
    onAsset: options.onAsset,
    onEditParent: editParent,
    textState: () => (textSummary = readSelectedTextStyle()),
    resolveFont: options.resolveFont,
    refreshSystemFonts: options.refreshSystemFonts,
    prepareDocumentFonts: options.prepareDocumentFonts,
    canPrepareFonts: () => ownsInput() && !busy && !composing,
    ensureFontVariant: options.ensureFontVariant,
    fontSelection: () => {
      preserveRange();
      const view = captureView(),
        flow = textFlowForFrame(doc(), view.activeTextId);
      return JSON.stringify([
        doc().id,
        flow ? [flow.id] : state.selection,
        flow?.id || view.activeTextId,
        view.textSelection?.anchor.index,
        view.textSelection?.focus.index,
      ]);
    },
    applyFontSettings: (settings) => {
      finishText();
      const before = structuredClone(doc()),
        viewBefore = captureView();
      try {
        for (const [key, value] of Object.entries(settings)) {
          if (
            key === 'fontVariations' &&
            value === 'normal' &&
            readSelectedTextStyle()?.values.fontVariations === 'normal'
          )
            continue;
          applyTextProperty(key, value, { commit: false });
        }
      } catch (error) {
        for (const key of Object.keys(doc())) delete doc()[key];
        Object.assign(doc(), before);
        flowSignature = '';
        restoreView(viewBefore);
        throw error;
      }
      if (documentContent(before) !== documentContent(doc()))
        onCommit(before, { label: 'Font', viewBefore, viewAfter: captureView() });
    },
    showPanel: (kind) => workspacePanels.show(kind),
    clearOverrides: clearTextOverrides,
    fonts: options.fonts,
    parentMode: options.parentMode,
  });
  inputAnchor = createNativeInputAnchor(host.querySelector('.canvas-flow-input'), {
    allowed: () =>
      (!!sourceTextFlow()?.composition || activeText()?.hasAttribute('data-flow-wrap')) && alive,
    isComposing: () => composing,
  });
  nativeSession = createCompositionSession({
    getDocument: doc,
    scope: canWrite,
    compose: (snapshot, settings) => {
      if (!options.textComposition)
        throw Error(
          'This document requires the native text composer. Open it in the current Mac or iPhone/iPad app.',
        );
      return composeNativeTextFlows(snapshot, {
        ...settings,
        compose: options.textComposition.compose,
      });
    },
    onResult: (plan, snapshot) => {
      nativeError = '';
      compositionNotice.hidden = true;
      delete editor.dataset.compositionError;
      nativePlan = plan;
      nativePlanKey = compositionLayoutKey(snapshot);
      if (plan.changed) {
        const liveBlocks = new Map(doc().blocks.map((block) => [block.id, block]));
        doc().blocks = snapshot.blocks.map((block) => liveBlocks.get(block.id) || block);
        doc().pages = snapshot.pages;
        for (const flow of doc().textFlows || []) {
          const derived = snapshot.textFlows?.find((value) => value.id === flow.id);
          if (flow.composition && derived) {
            flow.frameIds = derived.frameIds;
            flow.autoPages = derived.autoPages;
          }
        }
        onChange();
      }
      flowSignature = '';
      refreshFlowPreview();
      followTextFlowCaret();
      renderPanel({ visibleOnly: true });
      flowSelection?.sync();
    },
    onError: (error) => {
      editor.dataset.compositionError = error.message;
      if (nativeError !== error.message)
        options.onNotify?.('Text is saved; composition paused. ' + error.message);
      nativeError = error.message;
      compositionNotice.hidden = false;
      compositionNotice.querySelector('span').textContent = error.message;
      renderPanel();
    },
  });
  compositionNotice = document.createElement('div');
  compositionNotice.className = 'canvas-composition-notice';
  compositionNotice.hidden = true;
  compositionNotice.setAttribute('role', 'alert');
  compositionNotice.innerHTML = '<span></span><button type="button">Retry</button>';
  compositionNotice.querySelector('button').addEventListener(
    'click',
    () => {
      nativeSession.retry(doc(), {
        assets: options.assets?.() || options.fonts?.() || [],
        allowPages: canWrite(),
      });
    },
    { signal: controller.signal },
  );
  editor.append(compositionNotice);
  flowSelection = installFlowSelection(viewport, {
    allowed: (event) =>
      ownsInput() &&
      options.editing &&
      !busy &&
      !composing &&
      nativeGeometryReady(event) &&
      !dialogOpen() &&
      (!event || (!space && (state.tool === 'text' || !!sourceTextFlow()))),
    input: () => (sourceTextFlow() ? activeText() : null),
    flow: () => sourceTextFlow(),
    frames: () =>
      (sourceTextFlow()?.frameIds || []).map((id) => sceneObject(doc(), id)).filter(Boolean),
    fragment: (id) => flowPlan.fragments.get(id),
    layoutKey: () => flowSignature + ':' + sceneRevision,
    preview: (id) => world.querySelector(`[data-flow-frame="${CSS.escape(id)}"]`),
    onNativeCaret: (rect) => inputAnchor.update(rect, { measure: false }),
    activate: (id, event) => {
      const native = activeText() && captureTextSelection(activeText());
      if (
        activeTextId !== id ||
        !activeText()?.isContentEditable ||
        (native && native.anchor.index !== native.focus.index)
      )
        focusText(id, event);
    },
    selection: () => {
      const element = activeText();
      return (
        element &&
        (captureTextSelection(element) ||
          (savedTextSelection?.id === activeTextId ? savedTextSelection.bookmark : null))
      );
    },
    onSelection: () => {
      rememberTextSelection();
      refreshTextControls();
      selectionDirty = true;
      requestFrame();
    },
    showRange: (value) => {
      const layer = host.querySelector('.canvas-input-world');
      layer.classList.toggle('flow-range-active', value);
      if (value)
        for (const node of world.querySelectorAll('[data-flow-editing]'))
          delete node.dataset.flowEditing;
    },
    pan: (x, y) => cameraTo({ ...state.camera, x: state.camera.x + x, y: state.camera.y + y }),
  });
  publishingControls.prepareLegacyFonts();
  function editParent(id) {
    if (parentEditor || options.parentMode || !options.editing) return;
    endTextEditing();
    parentEditor = openParentEditor(editor, id, {
      getDocument,
      mount: mountCanvasEditor,
      options,
      onCommit: (before, metadata) => {
        try {
          ensureTextWrapFlows(doc());
          validateNativeSources();
          updateFlowPlan();
        } catch (error) {
          restoreGestureDocument(before);
          throw error;
        }
        onCommit(before, metadata);
      },
      onClose: () => {
        parentEditor = null;
        paint();
      },
    });
  }
  const observer = new ResizeObserver(() => {
    selectionDirty = true;
    requestFrame();
  });
  observer.observe(viewport);
  if (state.camera && !state.target) state.target = { ...state.camera };
  if (!state.camera) {
    state.camera = fitCamera(
      { x: 0, y: 0, w: page().width, h: page().height },
      { width: viewport.clientWidth, height: viewport.clientHeight },
      48,
    );
    state.target = { ...state.camera };
  }
  setSelectionState(state.selection);
  if (!doc().pages.some((p) => p.id === state.activePage)) state.activePage = doc().pages[0].id;
  if (!sceneObject(doc(), state.inside)) state.inside = null;
  paint();
  if (documentContent(initialDocument) !== documentContent(doc())) onChange();
  document.fonts?.ready.then(() => {
    if (alive) {
      selectionDirty = true;
      requestFrame();
    }
  });
  return {
    command,
    textCommandTarget() {
      const target = document.activeElement,
        item = object();
      if (
        !ownsInput() ||
        !options.editing ||
        busy ||
        composing ||
        dialogOpen() ||
        !target ||
        !viewport.contains(target) ||
        target.closest('input,textarea,select,button') ||
        !item ||
        !['text', 'quote'].includes(item.type)
      )
        return null;
      const flow = textFlowForFrame(doc(), item),
        view = captureView();
      return JSON.stringify([
        doc().id,
        doc().version,
        item.id,
        flow?.id || null,
        view.textSelection?.anchor.index ?? null,
        view.textSelection?.focus.index ?? null,
        view.textSelection?.anchor.affinity || null,
        view.textSelection?.focus.affinity || null,
      ]);
    },
    refreshFonts() {
      const choices = fontChoices(
        options.fonts?.() || [],
        options.systemFonts?.() || [],
        readSelectedTextStyle()?.values.textStyle,
      );
      for (const select of editor.querySelectorAll('select[data-object-prop="textStyle"]')) {
        if (document.activeElement === select) continue;
        const value = select.value;
        select.innerHTML = choices
          .map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`)
          .join('');
        select.value = value;
      }
      const style = editor.querySelector('[data-font-style]');
      if (style) delete style.dataset.family;
      syncTextStyle();
      requestFrame();
    },
    getPanelLayout: () => workspacePanels.getState(),
    setPanelLayout: (layout) => workspacePanels.restore(layout),
    getTextFlowStatus(id) {
      const status = flowPlan.status.get(id);
      return status ? structuredClone(status) : null;
    },
    addFiles,
    captureView,
    restoreView,
    prepareHistory,
    deactivate,
    refreshExternal,
    setBusy(value) {
      busy = value;
      if (value) {
        previews.hide();
        flowSelection.cancel();
      }
      editor.inert = value;
      editor.classList.toggle('interaction-busy', value);
      if (value) {
        finishGesture(true);
        const element = activeText();
        if (element && document.activeElement === element) element.blur();
      }
    },
    finish() {
      parentEditor?.finish();
      finishGesture();
      const element = activeText();
      if (element && composing) element.blur();
      finishText();
    },
    async flush() {
      if (parentEditor) await parentEditor.flush();
      await publishingControls.flush();
      finishGesture();
      if (composing) {
        activeText()?.blur();
        if (composing) await new Promise((resolve) => compositionWaiters.push(resolve));
      }
      finishText();
      while (pendingCount) await pendingFiles;
      await nativeSession.flush();
    },
    get pending() {
      return (
        pendingCount > 0 ||
        composing ||
        nativeSession.pending ||
        publishingControls.pending ||
        parentEditor?.pending
      );
    },
    destroy() {
      finishGesture();
      endTextEditing();
      alive = false;
      nativeSession.destroy();
      closeContextMenu();
      previews.destroy();
      tooltips.destroy();
      publishingControls.destroy();
      contextualBar.destroy();
      flowSelection.destroy();
      inputAnchor.destroy();
      parentEditor?.destroy();

      workspacePanels.destroy();
      controller.abort();
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
    getMenuState: () => ({
      canvasView: ownsInput() && !busy && !dialogOpen(),
      canArrange:
        ownsInput() &&
        canWrite() &&
        options.editing &&
        !busy &&
        !composing &&
        !activeTextId &&
        !typing(document.activeElement) &&
        objects().length > 0,
      smartGuides: snapEnabled,
    }),
    getState: () => structuredClone({ ...state, activeTextId, composing, busy }),
  };
}
