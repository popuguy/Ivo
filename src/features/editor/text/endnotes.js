import { containsEndnoteField, endnoteFields } from '../../../domain/documents/endnotes.js';
import { LIMITS } from '../../../domain/documents/constants.js';
import { uid } from '../../../domain/documents/model.js';
import { objectAvailable } from '../../../domain/documents/publishing.js';
import { addPage, insertObject } from '../../../domain/documents/scene.js';
import { startTextFlow, textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { rangeFromBookmark, textIndexMap } from '../../../shared/dom/text-selection.js';
import { cleanHTML } from '../../../shared/html/sanitize.js';

const selector = 'a[data-endnote]';
const point = (index) => ({ path: [], offset: 0, index, kind: 'text', affinity: 'forward' });

function sourceRoot(holder) {
  const root = document.createElement('div');
  root.innerHTML = holder.html;
  return root;
}

function noteSources(doc, fragment) {
  const frames = new Map(doc.blocks.map((frame) => [frame.id, frame]));
  const pageOrder = new Map(doc.pages.map((page, i) => [page.id, i]));
  const sources = [
    ...doc.blocks.filter((b) => !b.textFlowId && ['text', 'quote'].includes(b.type)),
    ...(doc.textFlows || []),
  ];
  const markers = [];
  const roots = new Map();
  for (const holder of sources) {
    if (!holder.endnotes && !containsEndnoteField(holder.html)) continue;
    const root = sourceRoot(holder);
    roots.set(holder, root);
    const positions = textIndexMap(root);
    const ownerFrames = holder.frameIds?.map((id) => frames.get(id)) || [holder];
    for (const anchor of root.querySelectorAll(selector)) {
      const [start] = positions.boundaries.get(anchor);
      const frame =
        ownerFrames.find((f) => {
          const part = fragment?.(f.id);
          return part && part.start <= start && part.end > start;
        }) || ownerFrames[0];
      const role = holder.endnotes ? 'body' : 'cite';
      if (!anchor.dataset.endnote.startsWith(role + '-')) continue;
      markers.push({
        role,
        id: anchor.dataset.endnote.slice(5),
        holder,
        anchor,
        root,
        at: start,
        frame,
        page: pageOrder.get(frame.pageId),
        frames: ownerFrames,
      });
    }
  }
  markers.sort(
    (a, b) =>
      a.page - b.page ||
      a.frame.y - b.frame.y ||
      a.frame.x - b.frame.x ||
      a.frame.id.localeCompare(b.frame.id) ||
      a.at - b.at,
  );
  return { roots, markers };
}

function writable(doc, holder) {
  return (holder.frameIds || [holder.id]).every((id) =>
    objectAvailable(
      doc,
      doc.blocks.find((b) => b.id === id),
    ),
  );
}

function notesFlow(doc) {
  let notes = doc.textFlows?.find((f) => f.endnotes);
  if (notes) return notes;
  if (doc.pages.length >= 128 || doc.blocks.length >= LIMITS.blocksPerDocument)
    throw Error('The document has reached its page or object limit.');
  const page = addPage(doc, doc.pages.at(-1).id);
  page.name = 'Endnotes';
  const margin = Math.min(36, page.width / 8, page.height / 8);
  const frame = insertObject(doc, 'text', page.id, {
    x: margin,
    y: margin,
    w: page.width - margin * 2,
    h: page.height - margin * 2,
    html: '<p><strong>Endnotes</strong></p>',
    textKind: 'area',
  });
  notes = startTextFlow(doc, frame.id);
  notes.endnotes = true;
  doc.canvasVersion = Math.max(doc.canvasVersion, 34);
  return notes;
}

function marker(role, id, page) {
  const anchor = document.createElement('a');
  anchor.dataset.endnote = role + '-' + id;
  anchor.setAttribute('href', '#page=' + page);
  anchor.textContent = '1';
  return anchor;
}

/** Both ends live in the same document transaction as page creation and numbering. */
export function insertEndnote(doc, frame, bookmark, fontSize, fragment) {
  const source = textFlowForFrame(doc, frame) || frame;
  if (
    !bookmark ||
    !source ||
    !['text', 'quote'].includes(frame?.type) ||
    source.endnotes ||
    !writable(doc, source)
  )
    throw Error('Place the insertion point in an unlocked text frame.');
  if (source.contents || source.index)
    throw Error(
      'Insert the reference in authored text. Generated contents and indexes replace their text when updated.',
    );
  const root = sourceRoot(source);
  const end = Math.max(bookmark.anchor.index, bookmark.focus.index);
  const range = rangeFromBookmark(root, { anchor: point(end), focus: point(end) });
  if (!range) throw Error('The insertion point is no longer available.');
  const container =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  const link = container.closest('a');
  if (link) {
    const edges = textIndexMap(root).boundaries.get(link);
    if (end === edges.at(-1)) range.setStartAfter(link);
    else if (end === edges[0]) range.setStartBefore(link);
    else throw Error('Place the insertion point outside the existing link.');
    range.collapse(true);
  }
  const notes = notesFlow(doc),
    id = uid('en-');
  if (!writable(doc, notes)) throw Error('Unlock the endnotes frame first.');
  const notePage = doc.blocks.find((b) => b.id === notes.frameIds[0]).pageId;
  const cite = marker('cite', id, notePage);
  const size = Number(fontSize) || 12;
  cite.setAttribute('data-ivo-size', String(Math.max(1, Math.round(size * 583) / 1000)));
  cite.setAttribute('data-ivo-baseline', String(Math.round(size * 333) / 1000));
  range.insertNode(cite);
  const html = cleanHTML(root.innerHTML);
  if (html.length > LIMITS.html) throw Error('The reference would exceed the document text limit.');
  source.html = html;
  const row = document.createElement('p');
  row.append(marker('body', id, frame.pageId), '\t');
  notes.html += row.outerHTML;
  updateEndnotes(doc, fragment);
  return id;
}

/** Keep multi-paragraph annotations together when an earlier citation is inserted or removed. */
export function updateEndnotes(doc, fragment, removed = new Set()) {
  const notes = doc.textFlows?.find((f) => f.endnotes);
  if (!notes) return;
  const { roots, markers } = noteSources(doc, fragment);
  const citations = markers.filter((m) => m.role === 'cite');
  const bodies = new Map();
  const bodyRoot = roots.get(notes);
  const groups = new Map();
  let group = null;
  for (const node of [...bodyRoot.childNodes]) {
    const labels =
      node.nodeType === Node.ELEMENT_NODE
        ? [...node.querySelectorAll('a[data-endnote^="body-"]')]
        : [];
    if (labels.length > 1) throw Error('Each endnote must start in its own paragraph.');
    if (labels.length) {
      const id = labels[0].dataset.endnote.slice(5);
      if (groups.has(id)) throw Error('Two endnotes have the same marker.');
      groups.set(id, (group = []));
    }
    group?.push(node);
  }
  for (const m of markers) if (m.role === 'body') bodies.set(m.id, m);
  const seen = new Set();
  const desired = [];
  function number(marker, page, i) {
    if (marker.anchor.textContent !== String(i)) marker.anchor.textContent = String(i);
    marker.anchor.setAttribute('href', '#page=' + page);
  }
  for (const [index, citation] of citations.entries()) {
    if (seen.has(citation.id)) throw Error('Two references have the same endnote marker.');
    const body = bodies.get(citation.id);
    if (!body)
      throw Error('The endnote text marker is missing. Undo its deletion or remove the reference.');
    seen.add(citation.id);
    number(citation, body.frame.pageId, index + 1);
    number(body, citation.frame.pageId, index + 1);
    desired.push(...groups.get(citation.id));
  }
  // Preserve unmatched authored prose unless its corresponding reference was explicitly deleted.
  for (const [id, nodes] of groups) {
    if (!seen.has(id) && !removed.has(id)) desired.push(...nodes);
    if (removed.has(id) && !seen.has(id)) for (const node of nodes) node.remove();
  }
  bodyRoot.append(...desired);
  for (const [holder, root] of roots) {
    if (holder.html === root.innerHTML) continue;
    if (!writable(doc, holder))
      throw Error('Unlock the affected text frames before updating endnotes.');
    if (root.innerHTML.length > LIMITS.html)
      throw Error('The endnotes exceed the document text limit.');
    holder.html = root.innerHTML;
  }
}

export function endnoteAt(doc, frame, bookmark, fragment) {
  if (!frame || !bookmark) return null;
  const source = textFlowForFrame(doc, frame) || frame,
    at = bookmark.focus.index;
  const own = noteSources(doc, fragment)
    .markers.filter((m) => m.holder === source)
    .sort((a, b) => a.at - b.at);
  return source.endnotes
    ? own.filter((m) => m.at <= at).at(-1)
    : own.find((m) => m.at <= at && at <= m.at + m.anchor.textContent.length);
}

export function endnoteLocation(doc, id, role, fragment) {
  const target = noteSources(doc, fragment).markers.find((m) => m.id === id && m.role === role);
  if (!target) return null;
  const end = target.at + target.anchor.textContent.length;
  const start =
    role === 'body' && target.anchor.nextSibling?.textContent?.startsWith('\t') ? end + 1 : end;
  return { frames: target.frames, start, end: start };
}

export function deleteEndnote(doc, frame, bookmark, fragment) {
  const selected = endnoteAt(doc, frame, bookmark, fragment);
  if (!selected) throw Error('Place the insertion point at an endnote reference or in its text.');
  const source = noteSources(doc, fragment).markers.find(
    (m) => m.role === 'cite' && m.id === selected.id,
  );
  if (source) {
    if (!writable(doc, source.holder)) throw Error('Unlock the endnote reference first.');
    source.anchor.remove();
    source.holder.html = source.root.innerHTML;
  }
  updateEndnotes(doc, fragment, new Set([selected.id]));
}

/** Run after a structural edit, before committing it. Ordinary typing does not traverse the document. */
export function reconcileEndnoteStructure(before, doc, fragment) {
  if (!before.textFlows?.some((f) => f.endnotes)) return;
  const previous = citationsInLayoutOrder(before);
  const current = citationsInLayoutOrder(doc);
  if (current.length && !doc.textFlows?.some((f) => f.endnotes))
    throw Error('Remove the endnote references before deleting their text frame.');
  if (previous.length === current.length && previous.every((entry, i) => entry === current[i]))
    return;
  const ids = (items) => items.map((item) => item.split('/').at(-1));
  const retained = new Set(ids(current));
  updateEndnotes(doc, fragment, new Set(ids(previous).filter((id) => !retained.has(id))));
}

function citationsInLayoutOrder(doc) {
  const seen = new Set(),
    result = [];
  const flows = new Map(doc.textFlows?.map((f) => [f.id, f]));
  const page = new Map(doc.pages.map((p, i) => [p.id, i]));
  const frames = doc.blocks
    .filter((b) => b.type === 'text' || b.type === 'quote')
    .sort(
      (a, b) =>
        page.get(a.pageId) - page.get(b.pageId) ||
        a.y - b.y ||
        a.x - b.x ||
        a.id.localeCompare(b.id),
    );
  for (const frame of frames) {
    const holder = flows.get(frame.textFlowId) || frame;
    if (seen.has(holder.id) || holder.endnotes || !containsEndnoteField(holder.html)) continue;
    seen.add(holder.id);
    for (const id of endnoteFields(holder.html, 'cite').keys())
      result.push(frame.pageId + '/' + holder.id + '/' + id);
  }
  return result;
}
