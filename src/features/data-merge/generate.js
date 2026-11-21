import { copyDocument } from '../../domain/documents/copy.js';
import { LIMITS } from '../../domain/documents/constants.js';
import { archiveVersion } from '../../domain/documents/capabilities.js';
import { validateImport } from '../../domain/documents/schema.js';
import { mergeRecordRange } from '../../domain/text/merge-records.js';
import { textIndexMap } from '../../shared/dom/text-selection.js';

export function mergeImageFrames(doc) {
  return [...doc.blocks, ...(doc.publishing?.parents || []).flatMap((p) => p.blocks)].filter(
    (b) => b.type === 'image',
  );
}

// Work on inert markup. Replace from the end so each source offset remains valid.
// Inserting in the opening text node preserves its character style and link.
function substituteHTML(html, fields, used) {
  if (!html || !/[{&]/.test(html)) return html;
  const root = document.createElement('template');
  root.innerHTML = html;
  const container = root.content.ownerDocument.createElement('div');
  container.append(root.content);
  const { segments } = textIndexMap(container);
  const runs = [];
  for (const segment of segments) {
    const last = runs.at(-1);
    if (!last || last.at(-1).end !== segment.start) runs.push([segment]);
    else last.push(segment);
  }
  let changed = false;
  for (const run of runs) {
    const text = run.map((s) => s.node.data).join('');
    const matches = Array.from(text.matchAll(/\{\{\{\{|\{\{([^{}\n]+)\}\}/g));
    let j = run.length - 1;
    for (const match of matches.reverse()) {
      const field = match[1]?.trim(),
        start = run[0].start + match.index,
        end = start + match[0].length;
      if (field !== undefined && (!fields.has(field) || field.startsWith('@')))
        throw Error('Unknown text field “' + field + '”.');
      const value = field === undefined ? '{{' : fields.get(field);
      if (field !== undefined) used.add(field);
      while (j > 0 && run[j].start >= end) j--;
      while (run[j].start > start) {
        run[j].node.deleteData(0, Math.min(end, run[j].end) - run[j].start);
        j--;
      }
      const { node, start: offset, end: nodeEnd } = run[j];
      node.deleteData(start - offset, Math.min(end, nodeEnd) - start);
      const tail = node.splitText(start - offset);
      const lines = value.split('\n'),
        fragment = container.ownerDocument.createDocumentFragment();
      for (const [i, line] of lines.entries()) {
        if (i) fragment.append(container.ownerDocument.createElement('br'));
        fragment.append(container.ownerDocument.createTextNode(line));
      }
      tail.before(fragment);
      changed = true;
    }
  }
  return changed ? container.innerHTML : html;
}

function imageLookup(assets) {
  const ids = new Map(),
    names = new Map();
  for (const asset of assets.filter((a) => a.mimeType.startsWith('image/'))) {
    ids.set('asset:' + asset.id, asset.id);
    names.set(asset.name, names.has(asset.name) ? null : asset.id);
  }
  return (value) => {
    const id = ids.get(value) || names.get(value);
    if (!id)
      throw Error(
        names.has(value)
          ? 'Image name is ambiguous. Use its asset: ID.'
          : 'Vault image missing: ' + value,
      );
    return 'asset:' + id;
  };
}

/** Generate editable record documents in isolation. The caller persists the complete batch once. */
export async function generateMergeDocuments(
  template,
  table,
  {
    first,
    last,
    bindings = new Map(),
    assets = [],
    documentCount = 1,
    yieldWork = () => Promise.resolve(),
  },
) {
  mergeRecordRange(first, last, table.records.length);
  const total = last - first + 1;
  if (documentCount + total > LIMITS.documents || template.blocks.length * total > LIMITS.blocks)
    throw Error('This batch exceeds vault capacity. Choose a smaller record range.');
  // Embedded media and parent artwork are copied with every record. Bound expanded input
  // before making copies. Vault asset references stay small regardless of the image size.
  if (JSON.stringify(template).length * total > 120 * 1024 * 1024)
    throw Error('The expanded batch exceeds 120 MB. Choose a smaller record range.');
  const sourceImages = mergeImageFrames(template),
    resolveImage = imageLookup(assets);
  const imageColumns = new Set(table.headers.filter((k) => k.startsWith('@')));
  for (const [id, key] of bindings)
    if (!sourceImages.some((b) => b.id === id) || !imageColumns.has(key))
      throw Error('Choose an image field for an existing frame.');
  const out = [];
  let htmlLength = 0,
    lastYield = performance.now();
  for (let n = first; n <= last; n++) {
    const fields = new Map(table.headers.map((k, i) => [k, table.records[n - 1][i]])),
      used = new Set();
    const doc = copyDocument(template, { title: template.title.slice(0, 166) + ' · ' + n });
    try {
      for (const holder of [
        ...doc.blocks,
        ...(doc.textFlows || []),
        ...(doc.publishing?.parents || []).flatMap((p) => p.blocks),
      ]) {
        if (!holder.html) continue;
        holder.html = substituteHTML(holder.html, fields, used);
        htmlLength += holder.html.length;
        if (holder.html.length > LIMITS.html || htmlLength > 20_000_000)
          throw Error('Merged text exceeds vault capacity. Choose a smaller record range.');
      }
      for (const [i, block] of mergeImageFrames(doc).entries()) {
        const key = bindings.get(sourceImages[i].id);
        if (key) {
          block.src = resolveImage(fields.get(key));
          used.add(key);
        }
      }
      if (!used.size)
        throw Error('Place a {{column name}} in a text frame or assign an image field.');
    } catch (error) {
      throw Error('Record ' + n + ' · ' + error.message, { cause: error });
    }
    out.push(doc);
    if (performance.now() - lastYield > 16) {
      await yieldWork();
      lastYield = performance.now();
    }
  }
  return validateImport({ schemaVersion: archiveVersion(out, assets), documents: out, assets })
    .documents;
}
