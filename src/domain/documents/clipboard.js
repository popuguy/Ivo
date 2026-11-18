import { archiveVersion } from './capabilities.js';
import { uid } from './model.js';
import { copyDocument } from './copy.js';
import { descendantsOf, worldRect, pagePositions } from './scene.js';
import { selectionRoots } from '../geometry/selection.js';
import { enablePublishing } from './publishing.js';
import { validateImport } from './schema.js';
import { attribute } from '../text/html.js';
import { referencedFonts, legacyFontFamilies } from '../text/font-references.js';

export const OBJECT_CLIPBOARD_TYPE = 'application/x-ivo-objects+json';
export const MAX_OBJECT_CLIPBOARD = 160 * 1024 * 1024;

/** A self-contained selection, not a reference to a live editor or source vault. */
export function copyObjectSelection(doc, selection, assets = []) {
  const roots = selectionRoots(doc, selection);
  if (!roots.length) return null;
  const included = new Set(
    roots.flatMap((b) => [b.id, ...descendantsOf(doc, b.id).map((c) => c.id)]),
  );
  const fragment = structuredClone(doc);
  // Keep document links pointing to their original document when identities are remapped on paste.
  fragment.id = uid('clipboard-');
  fragment.blocks = fragment.blocks.filter((b) => included.has(b.id));
  for (const root of roots) {
    const copy = fragment.blocks.find((b) => b.id === root.id);
    Object.assign(copy, worldRect(doc, root));
    delete copy.parentId;
  }
  for (const block of fragment.blocks) delete block.parentOriginId;
  const pageIndexes = fragment.blocks.map((b) => doc.pages.findIndex((p) => p.id === b.pageId));
  fragment.pages = fragment.pages.slice(Math.min(...pageIndexes), Math.max(...pageIndexes) + 1);
  for (const page of fragment.pages) {
    delete page.parentPageId;
    delete page.parentOverrides;
  }
  if (fragment.publishing) fragment.publishing.parents = [];
  fragment.textFlows = (fragment.textFlows || []).filter((f) =>
    f.frameIds.some((id) => included.has(id)),
  );
  for (const flow of fragment.textFlows) {
    flow.frameIds = flow.frameIds.filter((id) => included.has(id));
    flow.automaticPages = false;
    flow.autoPages = [];
  }
  if (!fragment.textFlows.length) delete fragment.textFlows;
  if (fragment.publishing) {
    const used = { paragraph: new Set(), character: new Set() },
      holders = [...fragment.blocks, ...(fragment.textFlows || []).flatMap((f) => [f, f.style])];
    for (const holder of holders)
      for (const kind of ['paragraph', 'character']) {
        if (holder[kind + 'Style']) used[kind].add(holder[kind + 'Style']);
        for (const tag of (holder.html || '').matchAll(/<[^>]+>/g)) {
          const id = attribute(tag[0], 'data-ivo-' + (kind === 'paragraph' ? 'pstyle' : 'cstyle'));
          if (id) used[kind].add(id);
        }
      }
    for (const kind of ['paragraph', 'character']) {
      const styles = fragment.publishing[kind + 'Styles'];
      for (const id of used[kind]) {
        const parent = styles.find((style) => style.id === id)?.basedOn;
        if (parent) used[kind].add(parent);
      }
      fragment.publishing[kind + 'Styles'] = styles.filter((style) => used[kind].has(style.id));
    }
  }
  const required = referencedFonts(fragment),
    legacy = legacyFontFamilies(fragment);
  for (const holder of [...fragment.blocks, ...(fragment.textFlows || [])]) {
    if (holder.src?.startsWith('asset:')) required.add(holder.src.slice(6));
    for (const tag of (holder.html || '').matchAll(/<[^>]+>/g))
      for (const name of ['href', 'src']) {
        const value = attribute(tag[0], name);
        if (value?.startsWith('asset:')) required.add(value.slice(6));
      }
  }
  // All stored family companions are necessary for the same font to render offline.
  const families = new Set(
    assets.filter((a) => required.has(a.id) && a.font).map((a) => a.font.family),
  );
  const resources = assets.filter(
    (a) =>
      required.has(a.id) || (a.font && (families.has(a.font.family) || legacy.has(a.font.family))),
  );
  return {
    version: 1,
    archive: validateImport({
      schemaVersion: archiveVersion([fragment], resources),
      documents: [fragment],
      assets: resources,
    }),
  };
}

/** Validate before resource writes or document mutation. Clipboard data is untrusted. */
export function readObjectClipboard(value) {
  if (typeof value !== 'string' || value.length > MAX_OBJECT_CLIPBOARD)
    throw new Error('The object clipboard is too large.');
  const payload = JSON.parse(value);
  if (payload?.version !== 1) throw new Error('This object clipboard version is not supported.');
  const archive = validateImport(payload.archive);
  if (
    archive.documents.length !== 1 ||
    !archive.documents[0].pages?.length ||
    !archive.documents[0].blocks.length
  )
    throw new Error('The clipboard has no page objects.');
  return archive;
}

/** Paste into one active page with fresh object/flow/style IDs; commit the result atomically. */
export function pasteObjectSelection(
  doc,
  archive,
  { pageId, parentId = null, layerId, offset = { x: 16, y: 16 } },
) {
  if (!doc.pages.some((p) => p.id === pageId))
    throw new Error('The destination page is no longer available.');
  const incoming = copyDocument(archive.documents[0]);
  if (doc.blocks.length + incoming.blocks.length > 1000)
    throw new Error('A document can contain up to 1,000 objects.');
  const next = structuredClone(doc),
    parent = next.blocks.find((b) => b.id === parentId);
  if (parentId && (!parent || parent.type !== 'polygon' || parent.pageId !== pageId))
    throw new Error('The destination mask is no longer available.');
  const layer =
    next.publishing?.layers.find((l) => l.id === (parent?.layerId || layerId)) ||
    [...(next.publishing?.layers || [])].reverse().find((l) => l.visible && !l.locked);
  if (next.publishing && (!layer || !layer.visible || layer.locked))
    throw new Error('Choose an unlocked visible layer before pasting.');
  if (incoming.publishing) {
    const publishing = enablePublishing(next),
      remap = new Map();
    for (const kind of ['paragraph', 'character']) {
      const key = kind + 'Styles';
      for (const [index, style] of incoming.publishing[key].entries()) {
        const original = archive.documents[0].publishing[key][index],
          existing = publishing[key].find((s) => s.id === original.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(original))
          remap.set(style.id, existing.id);
      }
      const additions = incoming.publishing[key].filter((s) => !remap.has(s.id));
      for (const style of additions)
        if (remap.has(style.basedOn)) style.basedOn = remap.get(style.basedOn);
      publishing[key].push(...additions);
    }
    for (const holder of [
      ...incoming.blocks,
      ...(incoming.textFlows || []).flatMap((f) => [f, f.style]),
    ]) {
      for (const key of ['paragraphStyle', 'characterStyle'])
        if (remap.has(holder[key])) holder[key] = remap.get(holder[key]);
      if (holder.html)
        holder.html = holder.html.replace(
          /(data-ivo-(?:pstyle|cstyle)\s*=\s*["'])([^"']+)(["'])/g,
          (all, prefix, id, suffix) => (remap.has(id) ? prefix + remap.get(id) + suffix : all),
        );
    }
    if (publishing.paragraphStyles.length > 256 || publishing.characterStyles.length > 256)
      throw new Error('The pasted objects exceed the text style limit.');
  }
  const positions = pagePositions(incoming.pages),
    first = positions[0],
    parentRect = parent ? worldRect(next, parent) : { x: 0, y: 0 };
  const roots = incoming.blocks.filter((b) => !b.parentId);
  for (const root of roots) {
    const page = positions.find((p) => p.id === root.pageId);
    root.x += offset.x - parentRect.x;
    root.y += page.y - first.y + offset.y - parentRect.y;
    if (parent) root.parentId = parent.id;
  }
  if (parent) parent.clip = true;
  const destinationLayer = layer?.id || next.publishing?.layers.at(-1).id;
  for (const block of incoming.blocks) {
    block.pageId = pageId;
    if (destinationLayer) block.layerId = destinationLayer;
    else delete block.layerId;
  }
  next.blocks.push(...incoming.blocks);
  if (incoming.textFlows?.length) {
    (next.textFlows ||= []).push(...incoming.textFlows);
    next.canvasVersion = Math.max(next.canvasVersion, 4);
  }
  if (incoming.canvasVersion >= 5)
    next.canvasVersion = Math.max(next.canvasVersion, incoming.canvasVersion);
  Object.assign(doc, next);
  return roots;
}
