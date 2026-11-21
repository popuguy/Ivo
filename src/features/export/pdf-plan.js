import { referencedFonts, legacyFontFamilies } from '../../domain/text/font-references.js';
import { archiveVersion } from '../../domain/documents/capabilities.js';
import { buildIndex } from '../../domain/knowledge/index.js';
import { validateImport } from '../../domain/documents/schema.js';
import { isSceneDocument, upgradeDocument } from '../../domain/documents/scene.js';

/** A frozen, validated sharing snapshot. No persistence, camera, selection or history writes. */
export function createPDFSnapshot(
  documents,
  assets,
  documentId,
  { includeLinked = false, useBook = false } = {},
) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  if (!byId.has(documentId)) throw new Error('Open a document to export.');
  const savedOrder = useBook && byId.get(documentId).publication?.chapters;
  const ids = savedOrder?.length ? [...savedOrder] : [documentId];
  const included = new Set(ids);
  if (includeLinked && !savedOrder?.length) {
    const edges = buildIndex(documents).edges;
    for (let i = 0; i < ids.length; i++)
      for (const edge of edges)
        if (edge.source === ids[i] && !included.has(edge.target)) {
          included.add(edge.target);
          ids.push(edge.target);
        }
  }
  const selected = ids.map((id) => {
    const chapter = byId.get(id);
    if (!chapter)
      throw Error(
        'A book chapter is missing from the vault. Update the book order before exporting.',
      );
    return chapter;
  });
  return freezePDFDocuments(selected, assets, documentId);
}

export function freezePDFDocuments(selected, assets, documentId) {
  const owner = selected.find((doc) => doc.id === documentId);
  if (!owner) throw Error('The PDF must include its owning document.');
  const assetIds = new Set(
    selected
      .flatMap((doc) => doc.blocks.map((block) => block.src))
      .filter((src) => src?.startsWith('asset:'))
      .map((src) => src.slice(6)),
  );
  for (const doc of selected) {
    for (const id of referencedFonts(doc)) assetIds.add(id);
    for (const parent of doc.publishing?.parents || [])
      for (const b of parent.blocks) if (b.src?.startsWith('asset:')) assetIds.add(b.src.slice(6));
  }
  const values = assets instanceof Map ? [...assets.values()] : assets;
  const families = new Set([
    ...selected.flatMap((doc) => [...legacyFontFamilies(doc)]),
    ...values.filter((a) => assetIds.has(a.id) && a.font).map((a) => a.font.family),
  ]);
  for (const asset of values)
    if (asset.font && families.has(asset.font.family)) assetIds.add(asset.id);
  const archive = validateImport({
    schemaVersion: archiveVersion(
      selected,
      values.filter((asset) => assetIds.has(asset.id)),
    ),
    documents: selected,
    assets: values.filter((asset) => assetIds.has(asset.id)),
  });
  const scenes = archive.documents.map((doc) =>
    isSceneDocument(doc) ? doc : upgradeDocument(doc),
  );
  if (
    scenes.reduce(
      (sum, doc) => sum + (doc.textFlows || []).filter((flow) => flow.composition).length,
      0,
    ) > 256
  )
    throw Error('Export up to 256 independently composed text flows at a time.');
  const count = scenes.reduce((sum, doc) => sum + doc.pages.length, 0);
  if (count > 256) throw new Error('Export up to 256 pages at a time.');
  const errors = [];
  for (const doc of scenes)
    for (const block of doc.blocks) {
      if (block.type === 'pdf')
        errors.push(
          `${doc.title}: legacy PDF attachments cannot be included in exported pages. Save the original, then remove its attachment object before exporting.`,
        );
      if (
        block.type === 'image' &&
        (!block.src ||
          !(
            /^(?:asset:|data:image\/)/i.test(block.src) ||
            /^\.\/public\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(block.src)
          ))
      )
        errors.push(
          `${doc.title}: store image “${block.alt || block.id}” in the atlas before exporting.`,
        );
    }
  if (errors.length) throw new Error([...new Set(errors)].join('\n'));
  return {
    format: 'ivo-pdf-1',
    documentId,
    title: owner.title,
    createdAt: new Date().toISOString(),
    documents: scenes,
    assets: archive.assets,
  };
}

/** Only rectangular visible hit regions are emitted. Polygon-clipped links are conservatively omitted. */
export function intersectPDFRect(a, b) {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    right = Math.min(a.x + a.w, b.x + b.w),
    bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

export function pdfRectInsidePolygon(rect, points) {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p) => {
    let value = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j],
        b = points[i];
      if (
        Math.abs(cross(a, b, p)) < 1e-7 &&
        p.x >= Math.min(a.x, b.x) - 1e-7 &&
        p.x <= Math.max(a.x, b.x) + 1e-7 &&
        p.y >= Math.min(a.y, b.y) - 1e-7 &&
        p.y <= Math.max(a.y, b.y) + 1e-7
      )
        return true;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        value = !value;
    }
    return value;
  };
  if (!corners.every(inside)) return false;
  // Any path boundary passing through the rectangle's interior makes a rectangular
  // hit target unsafe, including corner-touching cuts and self-intersections.
  return !points.some((a, index) => {
    const b = points[(index + 1) % points.length];
    let lo = 0,
      hi = 1;
    for (const [axis, min, max] of [
      ['x', rect.x, rect.x + rect.w],
      ['y', rect.y, rect.y + rect.h],
    ]) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-10) {
        if (a[axis] < min || a[axis] > max) return false;
        continue;
      }
      const t0 = (min - a[axis]) / delta,
        t1 = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      if (hi < lo) return false;
    }
    const t = (lo + hi) / 2,
      x = a.x + (b.x - a.x) * t,
      y = a.y + (b.y - a.y) * t;
    return (
      x > rect.x + 1e-7 &&
      x < rect.x + rect.w - 1e-7 &&
      y > rect.y + 1e-7 &&
      y < rect.y + rect.h - 1e-7
    );
  });
}
