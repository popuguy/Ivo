import { pageFieldValues, resolveRunningText } from './running-text.js';
import { HYPHENATION_DEFAULTS } from '../text/hyphenation.js';
import { uid } from './model.js';
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS, validTextAttribute } from '../text/typography.js';
import { markTypographyVersion } from './capabilities.js';

const baseLayer = () => ({
  id: 'default',
  name: 'Layer 1',
  color: '#4b80ff',
  visible: true,
  locked: false,
});
export const layersFor = (doc) => doc.publishing?.layers || [baseLayer()];
export function basicParagraph(doc) {
  const id = doc.extensions?.ivoTypography?.defaultParagraphStyle;
  return id && doc.publishing?.paragraphStyles.find((style) => style.id === id);
}
/** New capabilities are opt-in on authored mutations; opening an older note does not migrate it. */
export function enablePublishing(doc) {
  doc.canvasVersion = Math.max(doc.canvasVersion || 1, 5);
  if (!doc.publishing) {
    const layer = { ...baseLayer(), id: uid('layer-') };
    doc.publishing = {
      version: 1,
      layers: [layer],
      parents: [],
      paragraphStyles: [],
      characterStyles: [],
    };
    for (const item of doc.blocks) item.layerId = layer.id;
  }
  return doc.publishing;
}
/** Author the new composition capability only when an extended frame policy is chosen. */
export function enableFrameComposition(doc) {
  const publishing = enablePublishing(doc);
  doc.canvasVersion = Math.max(doc.canvasVersion || 1, 6);
  return publishing;
}
export function layerFor(doc, item) {
  const layers = layersFor(doc);
  return layers.find((layer) => layer.id === item?.layerId) || layers[0];
}
export function objectAvailable(doc, item, { editing = true } = {}) {
  const seen = new Set();
  while (item) {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    const layer = layerFor(doc, item);
    if (item.hidden || !layer.visible || (editing && (item.locked || layer.locked))) return false;
    item = item.parentId ? doc.blocks.find((b) => b.id === item.parentId) : null;
  }
  return true;
}
export function orderedPageObjects(doc, pageId) {
  const layers = layersFor(doc);
  return doc.blocks
    .filter(
      (b) => b.pageId === pageId && !b.parentId && objectAvailable(doc, b, { editing: false }),
    )
    .sort((a, b) => layers.indexOf(layerFor(doc, a)) - layers.indexOf(layerFor(doc, b)));
}
export function addLayer(doc, name = 'Layer ' + (layersFor(doc).length + 1)) {
  const p = enablePublishing(doc);
  if (p.layers.length >= 128) throw new Error('A document can have up to 128 layers.');
  const layer = {
    id: uid('layer-'),
    name: String(name).trim().slice(0, 120) || 'Layer',
    color: ['#4b80ff', '#ed5757', '#39a65c', '#ab6ad5', '#eaa133'][p.layers.length % 5],
    visible: true,
    locked: false,
  };
  p.layers.push(layer);
  return layer;
}
export function moveToLayer(doc, ids, layerId) {
  if (!doc.publishing && layerId === 'default') return;
  const candidate = layersFor(doc).find((l) => l.id === layerId);
  if (!candidate || candidate.locked || !candidate.visible)
    throw new Error('Choose an unlocked visible layer.');
  const p = enablePublishing(doc),
    layer = p.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked || !layer.visible)
    throw new Error('Choose an unlocked visible layer.');
  const selected = new Set(ids);
  const byId = new Map(doc.blocks.map((item) => [item.id, item]));
  for (const id of selected) {
    const item = byId.get(id);
    if (!item?.parentId) continue;
    let ancestor = byId.get(item.parentId);
    const parentLayer = layerFor(doc, ancestor);
    while (ancestor && !selected.has(ancestor.id)) ancestor = byId.get(ancestor.parentId);
    if (!ancestor && parentLayer.id !== layerId)
      throw new Error('Move the containing group to change its layer.');
  }
  for (const item of doc.blocks) {
    let node = item;
    while (node && !selected.has(node.id)) node = byId.get(node.parentId);
    if (node) item.layerId = layerId;
  }
}
export function removeLayer(doc, id) {
  if (layersFor(doc).length === 1) throw new Error('Keep at least one layer.');
  const p = enablePublishing(doc);
  if (p.layers.length === 1) throw new Error('Keep at least one layer.');
  if (!p.layers.some((l) => l.id === id)) throw new Error('Unknown layer.');
  const target = p.layers.find((l) => l.id !== id);
  const artwork = [...doc.blocks, ...p.parents.flatMap((parent) => parent.blocks)];
  for (const item of artwork) if (item.layerId === id) item.layerId = target.id;
  p.layers = p.layers.filter((l) => l.id !== id);
}
export function reorderLayer(doc, id, beforeId = null) {
  const p = enablePublishing(doc),
    index = p.layers.findIndex((l) => l.id === id);
  if (index < 0 || id === beforeId) return;
  const [layer] = p.layers.splice(index, 1),
    at = p.layers.findIndex((l) => l.id === beforeId);
  p.layers.splice(at < 0 ? p.layers.length : at, 0, layer);
}
/** Named definitions stay sparse. Inheritance cycles are rejected before any mutation. */
export function resolvedTextStyle(doc, kind, id, trail = new Set()) {
  if (!id || id === 'none') return {};
  if (trail.has(id)) throw new Error('Text styles cannot inherit in a cycle.');
  const style = doc.publishing?.[
    kind === 'paragraph' ? 'paragraphStyles' : 'characterStyles'
  ]?.find((s) => s.id === id);
  if (!style) throw new Error('Missing text style: ' + id);
  trail.add(id);
  return { ...resolvedTextStyle(doc, kind, style.basedOn, new Set(trail)), ...style.attributes };
}
export function effectiveTextStyle(doc, settings) {
  return {
    ...settings,
    ...resolvedTextStyle(doc, 'paragraph', settings.paragraphStyle),
    ...resolvedTextStyle(doc, 'character', settings.characterStyle),
    ...settings.textOverrides,
  };
}
export function saveTextStyle(
  doc,
  kind,
  { id = uid('style-'), name, basedOn = null, nextStyle = null, attributes = {} },
) {
  const fields = { ...CHARACTER_FIELDS, ...(kind === 'paragraph' ? PARAGRAPH_FIELDS : {}) },
    clean = {};
  for (const [key, value] of Object.entries(attributes)) {
    const attr = fields[key];
    if (
      !attr ||
      ['cstyle', 'pstyle'].includes(attr) ||
      (Object.hasOwn(HYPHENATION_DEFAULTS, key) &&
        typeof value !== typeof HYPHENATION_DEFAULTS[key]) ||
      validTextAttribute(attr, String(value)) === null
    )
      throw new Error('Invalid style property: ' + key);
    clean[key] = value;
  }
  const p = doc.publishing,
    key = kind === 'paragraph' ? 'paragraphStyles' : 'characterStyles';
  const next = {
    id,
    name:
      String(name || '')
        .trim()
        .slice(0, 120) || 'New style',
    basedOn,
    ...(nextStyle && nextStyle !== id ? { nextStyle } : {}),
    attributes: clean,
  };
  const definitions = (p?.[key] || []).filter((s) => s.id !== id);
  if (definitions.length >= 256) throw new Error('Use up to 256 text styles of each kind.');
  if (
    nextStyle &&
    (kind !== 'paragraph' ||
      (nextStyle !== id && !definitions.some((style) => style.id === nextStyle)))
  )
    throw Error('Choose an existing next paragraph style.');
  const preview = { ...doc, publishing: { ...p, [key]: [...definitions, next] } };
  resolvedTextStyle(preview, kind, id);
  enablePublishing(doc)[key] = [...definitions, next];
  markTypographyVersion(doc);
  return next;
}
export function createParent(doc, pageId, name = 'Parent') {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error('Choose a page.');
  const originals = doc.blocks.filter((b) => b.pageId === pageId);
  if (
    doc.blocks.length +
      (doc.publishing?.parents || []).reduce((n, p) => n + p.blocks.length, 0) +
      originals.length >
    1000
  )
    throw new Error('Parent creation exceeds the document object limit.');
  if ((doc.publishing?.parents.length || 0) >= 26)
    throw new Error('Use up to 26 parent definitions.');
  if (originals.some((b) => b.textFlowId))
    throw new Error('Use unthreaded frames on a parent page.');
  const publishing = enablePublishing(doc),
    ids = new Map();
  for (const b of originals) {
    ids.set(b.id, uid('parent-object-'));
    for (const v of b.points || []) ids.set(v.id, uid('vertex-'));
  }
  const parent = {
    id: uid('parent-'),
    prefix: String.fromCharCode(65 + publishing.parents.length),
    name: String(name).trim().slice(0, 120) || 'Parent',
    width: page.width,
    height: page.height,
    blocks: structuredClone(originals),
  };
  for (const b of parent.blocks) {
    b.id = ids.get(b.id);
    delete b.pageId;
    if (b.parentId) b.parentId = ids.get(b.parentId);
    for (const v of b.points || []) v.id = ids.get(v.id);
  }
  publishing.parents.push(parent);
  return parent;
}
export function applyParent(doc, pageId, parentId) {
  const p = enablePublishing(doc),
    page = doc.pages.find((p) => p.id === pageId);
  if (!page || (parentId && !p.parents.some((p) => p.id === parentId)))
    throw new Error('Choose a page and parent.');
  if (parentId) page.parentPageId = parentId;
  else delete page.parentPageId;
  delete page.parentOverrides;
}
/** Commit an isolated parent canvas together with its shared layer/style changes. */
export function commitParentDefinition(doc, id, edited) {
  const next = structuredClone(edited.publishing),
    target = next.parents.find((parent) => parent.id === id);
  if (!doc.publishing?.parents.some((parent) => parent.id === id) || !target)
    throw new Error('This parent definition was removed during editing.');
  target.width = edited.pages[0].width;
  target.height = edited.pages[0].height;
  target.name = edited.pages[0].name;
  target.blocks = edited.blocks.map((block) => {
    const { pageId, ...rest } = structuredClone(block);
    return rest;
  });
  if (doc.blocks.length + next.parents.reduce((n, parent) => n + parent.blocks.length, 0) > 1000)
    throw new Error('Parent editing exceeds the document object limit.');
  const layerIds = new Set(next.layers.map((layer) => layer.id));
  // Removing a shared layer also moves artwork outside the isolated parent canvas.
  for (const block of doc.blocks)
    if (!layerIds.has(block.layerId)) block.layerId = next.layers[0].id;
  doc.publishing = next;
  if (edited.canvasVersion >= 6) enableFrameComposition(doc);
  doc.canvasVersion = Math.max(doc.canvasVersion, edited.canvasVersion);
}
/** Parent art is derived with deterministic instance IDs; it never duplicates text source on the page. */
export function parentObjects(doc, page) {
  const parent = doc.publishing?.parents.find((p) => p.id === page.parentPageId);
  if (!parent) return [];
  let fields;
  return parent.blocks
    .filter((b) => !page.parentOverrides?.includes(b.id))
    .map((b) => ({
      ...structuredClone(b),
      ...(b.extensions?.ivoRunningText === true && {
        html: resolveRunningText(b.html, (fields ||= pageFieldValues(doc, page))),
      }),
      id: `${page.id}--${b.id}`,
      pageId: page.id,
      ...(b.parentId ? { parentId: `${page.id}--${b.parentId}` } : {}),
    }));
}
export function overrideParent(doc, pageId) {
  const page = doc.pages.find((p) => p.id === pageId),
    instances = parentObjects(doc, page);
  if (
    doc.blocks.length +
      instances.length +
      (doc.publishing?.parents || []).reduce((n, p) => n + p.blocks.length, 0) >
    1000
  )
    throw new Error('Overriding these items exceeds the document object limit.');
  const ids = new Map(instances.map((b) => [b.id, uid('object-')]));
  for (const b of instances) {
    if (b.extensions?.ivoRunningText === true) {
      delete b.extensions.ivoRunningText;
      if (!Object.keys(b.extensions).length) delete b.extensions;
    }
    b.parentOriginId = b.id.slice(page.id.length + 2);
    b.id = ids.get(b.id);
    if (b.parentId) b.parentId = ids.get(b.parentId);
    for (const v of b.points || []) v.id = uid('vertex-');
    doc.blocks.push(b);
  }
  page.parentOverrides = doc.publishing.parents
    .find((p) => p.id === page.parentPageId)
    .blocks.map((b) => b.id);
  return instances.map((b) => b.id);
}
