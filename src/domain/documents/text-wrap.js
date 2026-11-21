import { enablePublishing, objectAvailable, parentObjects } from './publishing.js';
import { startTextFlow } from './text-flows.js';
import { textWrapObjectPath } from '../geometry/wrap-contour.js';

export const TEXT_WRAP_MODES = Object.freeze(['none', 'bounds', 'contour', 'jump', 'next-column']);
export const TEXT_WRAP_SIDES = Object.freeze([
  'both',
  'left',
  'right',
  'largest',
  'inside',
  'outside',
]);
const sides = ['top', 'right', 'bottom', 'left'];
const ownRecord = (value, allowed, label) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new TypeError('Unsupported ' + label + ' field or representation.');
  return value;
};
const boolean = (value, fallback, label) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(label + ' must be boolean.');
  return value;
};

/** Canonical authored options only; contours, exclusions and line geometry are derived. */
export function normalizeTextWrap(input = {}) {
  ownRecord(input, ['mode', 'offsets', 'side', 'invert', 'contour'], 'text wrap');
  const mode = input.mode === undefined ? 'none' : input.mode,
    side = input.side === undefined ? 'both' : input.side;
  if (!TEXT_WRAP_MODES.includes(mode) || !TEXT_WRAP_SIDES.includes(side))
    throw new TypeError('Choose a supported text-wrap mode and side.');
  const supplied = ownRecord(
      input.offsets === undefined ? {} : input.offsets,
      sides,
      'text-wrap offsets',
    ),
    offsets = {};
  for (const name of sides) {
    const value = supplied[name] === undefined ? 0 : supplied[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 2000)
      throw new TypeError('Text-wrap offsets must be finite points between -2000 and 2000.');
    offsets[name] = value;
  }
  const contour = ownRecord(
    input.contour === undefined ? {} : input.contour,
    ['source', 'insideEdges'],
    'text-wrap contour',
  );
  const source = contour.source === undefined ? 'frame' : contour.source;
  if (!['frame', 'bounding-box', 'graphic-frame', 'edges', 'alpha'].includes(source))
    throw new TypeError('Choose a supported contour source.');
  const insideEdges = boolean(contour.insideEdges, false, 'Include inside edges');
  if (insideEdges && !['alpha', 'edges'].includes(source))
    throw TypeError('Inside edges require an image contour.');
  return {
    mode,
    offsets,
    side,
    invert: boolean(input.invert, false, 'Invert text wrap'),
    contour: { source, ...(insideEdges && { insideEdges: true }) },
  };
}

export function normalizeTextWrapPreferences(input = {}) {
  ownRecord(input, ['onlyBelow', 'facingPages', 'firstPageSide'], 'text-wrap preferences');
  const firstPageSide = input.firstPageSide === undefined ? 'right' : input.firstPageSide;
  if (!['left', 'right'].includes(firstPageSide))
    throw new TypeError('Choose a left or right first page.');
  return {
    onlyBelow: boolean(input.onlyBelow, false, 'Text wrap only below'),
    facingPages: boolean(input.facingPages, false, 'Facing pages'),
    firstPageSide,
  };
}

export function enableTextWrap(document) {
  enablePublishing(document);
  document.canvasVersion = Math.max(document.canvasVersion || 1, 8);
  return document;
}

/** Pages with authored or inherited active wrap, independent of current visibility. */
export function activeTextWrapPages(document) {
  const pages = new Set(
    document.blocks
      .filter((block) => block.textWrap && block.textWrap.mode !== 'none')
      .map((block) => block.pageId),
  );
  for (const page of document.pages || [])
    if (
      parentObjects(document, page).some(
        (block) => block.textWrap && block.textWrap.mode !== 'none',
      )
    )
      pages.add(page.id);
  return pages;
}

/** Adopt one canonical input owner at the authored wrap boundary, never during read/paint.
 * Parent definitions remain templates; their isolated edit proxy uses the parent ID as its page. */
export function ensureTextWrapFlows(document) {
  if (
    document.pages?.length === 1 &&
    document.publishing?.parents.some((parent) => parent.id === document.pages[0].id)
  )
    return [];
  const pages = activeTextWrapPages(document),
    targets = document.blocks.filter(
      (block) =>
        pages.has(block.pageId) &&
        ['text', 'quote'].includes(block.type) &&
        block.textKind !== 'point' &&
        !block.textFlowId,
    );
  if (!targets.length) return [];
  enableTextWrap(document);
  return targets.map((frame) => startTextFlow(document, frame.id, { automaticPages: false }));
}

function selected(document, ids, textOnly = false) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('Select an object.');
  return [...new Set(ids)].map((id) => {
    const object = document.blocks.find((value) => value.id === id);
    if (
      !object ||
      !objectAvailable(document, object) ||
      (textOnly && !['text', 'quote'].includes(object.type))
    )
      throw new Error(
        textOnly ? 'Select unlocked text frames.' : 'Select unlocked visible objects.',
      );
    return object;
  });
}

function updatedWrap(current, patch) {
  ownRecord(patch, ['mode', 'offsets', 'side', 'invert', 'contour'], 'text wrap');
  if ('offsets' in patch) ownRecord(patch.offsets, sides, 'text-wrap offsets');
  if ('contour' in patch) ownRecord(patch.contour, ['source', 'insideEdges'], 'text-wrap contour');
  const previous = normalizeTextWrap(current);
  return normalizeTextWrap({
    ...previous,
    ...patch,
    offsets: { ...previous.offsets, ...patch.offsets },
    contour: {
      ...previous.contour,
      ...(patch.contour?.source &&
        !['alpha', 'edges'].includes(patch.contour.source) && { insideEdges: false }),
      ...patch.contour,
    },
  });
}

export function normalizeTextWrapDefaults(input) {
  const wrap = normalizeTextWrap(input);
  if (wrap.contour.source !== 'frame')
    throw new Error('Creation defaults use the object frame contour.');
  if (
    wrap.mode === 'contour' &&
    Object.values(wrap.offsets).some((value) => value !== wrap.offsets.top)
  )
    throw new Error('Creation defaults for shape contours require uniform offsets.');

  return wrap;
}

// Document-level creation defaults travel with the vault. Existing objects retain their own settings.
export function setTextWrapDefaults(document, patch) {
  const value = normalizeTextWrapDefaults(
    updatedWrap(document.extensions?.ivoTextWrapDefaults, patch),
  );
  enableTextWrap(document);
  document.extensions = { ...document.extensions, ivoTextWrapDefaults: value };
}

/** Validate every target before touching the document; the caller owns one history transaction. */
export function setTextWrap(document, ids, patch) {
  const targets = selected(document, ids),
    values = targets.map((object) => {
      const next = updatedWrap(object.textWrap, patch);
      textWrapObjectPath(object, next);
      return next;
    });
  enableTextWrap(document);
  if (values.some((wrap) => ['alpha', 'edges'].includes(wrap.contour.source)))
    document.canvasVersion = Math.max(document.canvasVersion, 26);
  targets.forEach((object, index) => {
    object.textWrap = values[index];
  });
  ensureTextWrapFlows(document);
  return targets;
}

export function setIgnoreTextWrap(document, ids, value) {
  const flag = boolean(value, false, 'Ignore text wrap'),
    targets = selected(document, ids, true);
  enableTextWrap(document);
  for (const object of targets) object.ignoreTextWrap = flag;
  ensureTextWrapFlows(document);
  return targets;
}

export function setTextWrapPreferences(document, patch) {
  ownRecord(patch, ['onlyBelow', 'facingPages', 'firstPageSide'], 'text-wrap preferences');
  const next = normalizeTextWrapPreferences({
    ...normalizeTextWrapPreferences(document.textWrapPreferences),
    ...patch,
  });
  enableTextWrap(document);
  document.textWrapPreferences = next;
  ensureTextWrapFlows(document);
  return next;
}

/** A hidden layer normally retains its exclusions; this option suppresses them only while hidden. */
export function setLayerIgnoreWrap(document, id, value) {
  const flag = boolean(value, false, 'Ignore wrap on hidden layer');
  if (!document.publishing?.layers.some((layer) => layer.id === id))
    throw new Error('Choose a document layer.');
  enableTextWrap(document);
  document.publishing.layers.find((layer) => layer.id === id).ignoreWrap = flag;
  ensureTextWrapFlows(document);
}
