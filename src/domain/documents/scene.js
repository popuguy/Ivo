import { unlinkEndnoteFields } from './endnotes.js';
import {
  ownedSelection,
  remapAnchorOwnership,
  removeAnchorReferences,
  retainAnchorsOnPageRemoval,
} from './anchor-ownership.js';
import { retainTableThreads, tableThreads } from './table-threads.js';
import { supportedCanvas } from './capabilities.js';
import { ensureTextWrapFlows } from './text-wrap.js';
import { textWrapObjectPath } from '../geometry/wrap-contour.js';
import { removeTextFlowFrames, duplicateTextFlows } from './text-flows.js';
/** Page/object domain commands. All scene lengths are points; viewport state is separate. */
import { uid, createDocument, createBlock } from './model.js';
import { scaledPointType } from '../text/metrics.js';
import { basicParagraph, effectiveTextStyle, saveTextStyle } from './publishing.js';

export const DEFAULT_PAGE = Object.freeze({ width: 612, height: 792 });
export const isSceneDocument = (document) => supportedCanvas(document.canvasVersion);
export function makePage(size = DEFAULT_PAGE, name = 'Page 1') {
  return {
    id: uid('page-'),
    name,
    width: size.width,
    height: size.height,
    ...(size.topMargin === undefined ? {} : { topMargin: size.topMargin }),
  };
}
export function createSceneDocument(title = 'Untitled', size = DEFAULT_PAGE, defaultFont) {
  const document = createDocument(title || 'Untitled');
  document.canvasVersion = 1;
  document.pages = [makePage(size)];
  if (defaultFont) {
    const style = saveTextStyle(document, 'paragraph', {
      name: '[Basic Paragraph]',
      attributes: {
        textStyle: defaultFont,
        fontSize: 12,
        leading: 0,
        autoLeading: 120,
        paragraphBefore: 0,
        paragraphAfter: 0,
      },
    });
    document.extensions = { ivoTypography: { version: 1, defaultParagraphStyle: style.id } };
  }
  return document;
}
/** Nonmutating preview/upgrade. The caller must retain a legacy revision before first save. */
export function upgradeDocument(source, referenceWidth = 900) {
  if (isSceneDocument(source)) return structuredClone(source);
  const document = structuredClone(source),
    page = makePage({ width: referenceWidth, height: source.layout.rows * 22 });
  document.canvasVersion = 1;
  document.pages = [page];
  document.legacyLayout = { columns: 12, rows: source.layout.rows, referenceWidth };
  for (const object of document.blocks) {
    object.pageId = page.id;
    object.x *= referenceWidth / 12;
    object.w *= referenceWidth / 12;
    object.y *= 22;
    object.h *= 22;
  }
  return document;
}
export function addPage(document, afterId) {
  const index = Math.max(
      0,
      document.pages.findIndex((page) => page.id === afterId),
    ),
    previous = document.pages[index];
  const page = makePage(previous, `Page ${document.pages.length + 1}`);
  if (previous.parentPageId) page.parentPageId = previous.parentPageId;
  document.pages.splice(index + 1, 0, page);
  return page;
}
export function pagePositions(pages, gap = 64) {
  let y = 0;
  return pages.map((page) => {
    const position = { ...page, x: 0, y };
    y += page.height + gap;
    return position;
  });
}
export function sceneObject(document, id) {
  return document.blocks.find((object) => object.id === id);
}
export function childrenOf(document, id) {
  return document.blocks.filter((object) => object.parentId === id);
}
export function descendantsOf(document, id) {
  const result = [];
  for (const child of childrenOf(document, id)) {
    result.push(child, ...descendantsOf(document, child.id));
  }
  return result;
}
export function worldRect(document, object) {
  let x = object.x,
    y = object.y,
    parent = object.parentId;
  while (parent) {
    const item = sceneObject(document, parent);
    if (!item) break;
    x += item.x;
    y += item.y;
    parent = item.parentId;
  }
  return { x, y, w: object.w, h: object.h };
}
export function makeObject(type, pageId, overrides = {}) {
  const object = createBlock(type, {
    x: 48,
    y: 48,
    w: 180,
    h: type === 'text' ? 100 : 140,
    html: '',
    caption: '',
    ...overrides,
  });
  object.type = type;
  object.pageId = pageId;
  if (type === 'polygon') {
    const points = object.points ?? [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    object.points = points.map((point) => ({ ...point, id: point.id ?? uid('vertex-') }));
    object.fill ??= '#e6e8eb';
    object.stroke ??= '#626872';
    object.strokeWidth ??= 1;
    object.clip ??= false;
  }
  return object;
}
export function insertObject(document, type, pageId, { parentId, ...overrides } = {}) {
  const parent = parentId && sceneObject(document, parentId);
  if (parent && (parent.type !== 'polygon' || parent.pageId !== pageId))
    throw new Error('Draw inside requires a polygon on this page.');
  const basic = basicParagraph(document);
  const defaults = ['text', 'quote'].includes(type) && basic;
  const wrap = document.extensions?.ivoTextWrapDefaults;
  const object = makeObject(type, pageId, {
    ...(type === 'table' &&
      basic && {
        textStyle: basic.attributes.textStyle || 'cmu-serif',
        fontSize: basic.attributes.fontSize || 16,
      }),
    ...(wrap && { textWrap: structuredClone(wrap) }),
    ...(defaults && { ...defaults.attributes, paragraphStyle: defaults.id }),
    ...overrides,
  });
  if (wrap && object.textWrap) textWrapObjectPath(object, object.textWrap);
  if (defaults && object.paragraphStyle === defaults.id) {
    for (const key of Object.keys(defaults.attributes))
      if (key in overrides && overrides[key] !== defaults.attributes[key])
        (object.textOverrides ||= {})[key] = overrides[key];
  }
  if (document.publishing) {
    const layer =
      document.publishing.layers.find((l) => l.id === (parent?.layerId || overrides.layerId)) ||
      [...document.publishing.layers].reverse().find((l) => l.visible && !l.locked);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose an unlocked visible layer before adding an object.');
    object.layerId = layer.id;
  }
  if (parent) {
    parent.clip = true;
    object.parentId = parent.id;
    object.x = overrides.x ?? 0;
    object.y = overrides.y ?? 0;
    object.w = overrides.w ?? parent.w;
    object.h = overrides.h ?? parent.h;
  }
  document.blocks.push(object);
  if (type === 'table') document.canvasVersion = Math.max(document.canvasVersion || 0, 28);
  if (wrap && object.textWrap?.mode !== 'none') ensureTextWrapFlows(document);
  return object;
}
export function continueTableOnNextPage(doc, id) {
  const frames = tableThreads(doc.blocks).get(id);
  if (!frames || frames.some((f) => f.parentId || f.extensions?.ivoAnchor))
    throw Error('Choose a free-standing table on a document page.');
  const tail = frames.at(-1),
    index = doc.pages.findIndex((p) => p.id === tail.pageId);
  if (
    doc.blocks.length + (doc.publishing?.parents || []).reduce((n, p) => n + p.blocks.length, 0) >=
      1000 ||
    (index + 1 === doc.pages.length && doc.pages.length >= 128)
  )
    throw Error('The document has reached its page or object limit.');
  const layer = doc.publishing?.layers.find((l) => l.id === tail.layerId);
  if (doc.publishing && (!layer || !layer.visible || layer.locked))
    throw Error('Choose an unlocked visible layer before continuing the table.');
  const page = doc.pages[index + 1] || addPage(doc, tail.pageId);
  const w = Math.min(tail.w, page.width),
    h = Math.min(tail.h, page.height);
  const next = insertObject(doc, 'table', page.id, {
    x: Math.max(0, Math.min(tail.x, page.width - w)),
    y: Math.max(0, Math.min(tail.y, page.height - h)),
    w,
    h,
    rotation: tail.rotation,
    ...(tail.frameOptions && { frameOptions: structuredClone(tail.frameOptions) }),
    fontSize: tail.fontSize,
    textStyle: tail.textStyle,
    layerId: tail.layerId,
  });
  delete next.table;
  tail.tableNext = next.id;
  doc.canvasVersion = Math.max(doc.canvasVersion, 31);
  return next;
}
/** Resize a container and its local descendants as one transform. */
export function transformObject(document, id, rect, startingDocument = document) {
  const object = sceneObject(document, id),
    original = { ...sceneObject(startingDocument, id) };
  Object.assign(object, rect);
  const sx = rect.w / original.w,
    sy = rect.h / original.h;
  for (const old of descendantsOf(startingDocument, id)) {
    const child = sceneObject(document, old.id);
    Object.assign(child, { x: old.x * sx, y: old.y * sy, w: old.w * sx, h: old.h * sy });
    if (['text', 'quote'].includes(child.type))
      Object.assign(
        child,
        scaledPointType(old, sx, sy, {
          min: 1,
          max: 2000,
          baseSize: effectiveTextStyle(startingDocument, old).fontSize,
        }),
      );
  }
}
function rotateOffset(x, y, rotation = 0) {
  if (!(rotation % 360)) return { x, y };
  const radians = ((rotation % 360) * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  return { x: c * x - s * y, y: s * x + c * y };
}
/** Keep untouched vertices and child content stationary while a path point moves.
 * Position is in the unrotated parent's coordinates, as for existing callers. */
export function moveVertex(document, id, vertexId, position) {
  const object = sceneObject(document, id);
  if (object?.type !== 'polygon') throw new Error('Select a polygon point.');
  const points = object.points.map((point) => ({
    id: point.id,
    x: object.x + point.x * object.w,
    y: object.y + point.y * object.h,
  }));
  const selected = points.find((point) => point.id === vertexId);
  if (!selected) throw new Error('Unknown polygon point.');
  Object.assign(selected, position);
  const x = Math.min(...points.map((point) => point.x)),
    y = Math.min(...points.map((point) => point.y));
  const w = Math.max(0.01, Math.max(...points.map((point) => point.x)) - x),
    h = Math.max(0.01, Math.max(...points.map((point) => point.y)) - y);
  // Reboxing changes CSS's rotation center. Compensate the origin so the new
  // local frame has the old rendered transform, followed only by reboxing.
  const dx = x + w / 2 - (object.x + object.w / 2),
    dy = y + h / 2 - (object.y + object.h / 2),
    rotated = rotateOffset(dx, dy, object.rotation);
  for (const child of childrenOf(document, id)) {
    child.x += object.x - x;
    child.y += object.y - y;
  }
  Object.assign(object, {
    x: object.rotation % 360 ? x + rotated.x - dx : x,
    y: object.rotation % 360 ? y + rotated.y - dy : y,
    w,
    h,
    points: points.map((point) => ({ id: point.id, x: (point.x - x) / w, y: (point.y - y) / h })),
  });
}
export function removeObject(document, id) {
  const ids = ownedSelection(document, [id], { deleting: true });
  removeAnchorReferences(document, ids);
  retainTableThreads(
    document.blocks,
    new Map(document.blocks.filter((item) => !ids.has(item.id)).map((b) => [b.id, b])),
  );
  document.blocks = document.blocks.filter((item) => !ids.has(item.id));
  removeTextFlowFrames(document, ids);
}
/** Copy a selection in one identity pass so selected threaded frames stay one textFlow. */
export function duplicateObjects(document, selection, { offset = { x: 16, y: 16 } } = {}) {
  const selected = new Set(selection),
    roots = document.blocks
      .filter((item) => selected.has(item.id))
      .filter((item) => {
        let parent = item.parentId;
        while (parent) {
          if (selected.has(parent)) return false;
          parent = sceneObject(document, parent)?.parentId;
        }
        return true;
      });
  const included = ownedSelection(
    document,
    roots.map((item) => item.id),
  );
  if (document.blocks.length + included.size > 1000)
    throw new Error('A document can contain up to 1,000 objects.');
  const copies = document.blocks
    .filter((item) => included.has(item.id))
    .map((item) => structuredClone(item));
  const byOriginal = new Map(copies.map((item) => [item.id, item]));
  const ids = new Map(copies.map((item) => [item.id, uid('object-')]));
  for (const copy of copies) {
    copy.id = ids.get(copy.id);
    if (copy.html) copy.html = unlinkEndnoteFields(copy.html);
    if (ids.has(copy.parentId)) copy.parentId = ids.get(copy.parentId);
    if (copy.points) copy.points = copy.points.map((point) => ({ ...point, id: uid('vertex-') }));
  }
  retainTableThreads(document.blocks, byOriginal, { copy: true });
  document.blocks.push(...copies);
  duplicateTextFlows(document, ids);
  for (const copy of copies) remapAnchorOwnership(copy, ids);
  const rootCopies = roots
    .map((item) => byOriginal.get(item.id))
    .filter((item) => !item.extensions?.ivoAnchor);
  for (const copy of rootCopies) {
    copy.x += offset.x;
    copy.y += offset.y;
  }
  return rootCopies;
}
export function duplicateObject(document, id) {
  return duplicateObjects(document, [id])[0];
}
export function removePage(document, id) {
  if (document.pages.length === 1) throw new Error('A document needs at least one page.');
  const index = document.pages.findIndex((page) => page.id === id);
  const section = document.pages[index]?.section,
    next = document.pages[index + 1];
  // Deleting the first page preserves the document's initial section. Other
  // section starts belong to the removed page, so numbering resumes from above.
  if (index === 0 && section && next && !next.section) next.section = section;
  document.pages = document.pages.filter((page) => page.id !== id);
  retainAnchorsOnPageRemoval(document, id);
  const removed = ownedSelection(
    document,
    document.blocks.filter((object) => object.pageId === id).map((object) => object.id),
    { deleting: true },
  );
  removeAnchorReferences(document, removed);
  retainTableThreads(
    document.blocks,
    new Map(document.blocks.filter((b) => !removed.has(b.id)).map((b) => [b.id, b])),
  );
  document.blocks = document.blocks.filter((object) => !removed.has(object.id));
  removeTextFlowFrames(document, removed);
}

/** Release only the clipping relationship, retaining source objects in their parent space. */
export function releaseMask(document, id) {
  const mask = sceneObject(document, id);
  if (mask?.type !== 'polygon') throw new Error('Select a polygon mask.');
  for (const child of childrenOf(document, id)) {
    if (mask.rotation % 360) {
      const cx = mask.w / 2,
        cy = mask.h / 2,
        center = rotateOffset(
          child.x + child.w / 2 - cx,
          child.y + child.h / 2 - cy,
          mask.rotation,
        );
      child.x = mask.x + cx + center.x - child.w / 2;
      child.y = mask.y + cy + center.y - child.h / 2;
      child.rotation = ((child.rotation || 0) + mask.rotation) % 360;
    } else {
      child.x += mask.x;
      child.y += mask.y;
    }
    if (mask.parentId) child.parentId = mask.parentId;
    else delete child.parentId;
  }
  mask.clip = false;
}

/** Reorder physical pages without changing stable IDs or any page-local authored geometry. */
export function reorderPage(document, id, index) {
  const current = document.pages.findIndex((page) => page.id === id);
  if (current < 0 || !Number.isInteger(index) || index < 0 || index >= document.pages.length)
    throw new Error('Choose a page position in this document.');
  if (index === current) return false;
  const [page] = document.pages.splice(current, 1);
  document.pages.splice(index, 0, page);
  return true;
}
export function pageAtPoint(document, point) {
  return (
    pagePositions(document.pages).find(
      (page) =>
        point.x >= page.x &&
        point.x <= page.x + page.width &&
        point.y >= page.y &&
        point.y <= page.y + page.height,
    ) || null
  );
}
/** Explicit transfer retains page-local placement; pointer-drop supplies a world-preserving position. */
export function moveObjectToPage(document, id, pageId, { position } = {}) {
  const object = sceneObject(document, id);
  if (!object || !document.pages.some((page) => page.id === pageId))
    throw new Error('Choose an object and a page in this document.');
  if (object.pageId === pageId && !object.parentId && !position) return false;
  const rect = worldRect(document, object),
    children = descendantsOf(document, id);
  const moved = new Set([id, ...children.map((child) => child.id)]);
  for (const textFlow of document.textFlows || [])
    textFlow.autoPages = textFlow.autoPages.filter((value) => !moved.has(value.frameId));
  Object.assign(object, { pageId, x: position?.x ?? rect.x, y: position?.y ?? rect.y });
  delete object.parentId;
  for (const child of children) child.pageId = pageId;
  return true;
}
/** A whole object's center acquires a page on release. Content moved within a mask stays in that mask. */
export function transferObjectsAtDrop(document, ids) {
  let count = 0;
  const positions = pagePositions(document.pages);
  for (const id of ids) {
    const object = sceneObject(document, id);
    if (!object || object.parentId) continue;
    const source = positions.find((page) => page.id === object.pageId),
      x = source.x + object.x,
      y = source.y + object.y;
    const target = pageAtPoint(document, { x: x + object.w / 2, y: y + object.h / 2 });
    if (!target || target.id === source.id) continue;
    moveObjectToPage(document, id, target.id, { position: { x: x - target.x, y: y - target.y } });
    count++;
  }
  return count;
}
