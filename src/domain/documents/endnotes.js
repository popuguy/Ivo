import { attribute } from '../text/html.js';

/** Each pair belongs to one document. Whole-document copies retain pair identities locally. */
export const validEndnoteMarker = (value) =>
  typeof value === 'string' && /^(cite|body)-en-[a-zA-Z0-9_-]{1,100}$/.test(value);

const markerAttribute = /\sdata-endnote\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
export const containsEndnoteField = (html) =>
  typeof html === 'string' && /<a\b[^>]*\sdata-endnote\s*=/i.test(html);

export function hasEndnotes(doc) {
  return (
    doc.canvasVersion === 34 ||
    doc.textFlows?.some((f) => f.endnotes || containsEndnoteField(f.html)) ||
    doc.blocks?.some((b) => containsEndnoteField(b.html))
  );
}

/** A fragment copied on its own is an ordinary link back to its original page. */
export function unlinkEndnoteFields(html) {
  if (!containsEndnoteField(html)) return html;
  return html.replace(/<a\b[^>]*>/gi, (tag) => tag.replace(markerAttribute, ''));
}

export function endnoteFields(html, role) {
  const fields = new Map();
  if (!containsEndnoteField(html)) return fields;
  for (const [, tag, body] of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/gi)) {
    const marker = attribute(tag, 'data-endnote');
    if (validEndnoteMarker(marker) && marker.startsWith(role + '-'))
      fields.set(marker.slice(5), body.replace(/<[^>]*>/g, ''));
  }
  return fields;
}

export const endnoteCommands = {
  'insert-endnote': 'Insert Endnote',
  'go-to-endnote': 'Go to Endnote Reference or Text',
  'delete-endnote': 'Delete Endnote',
  'update-endnotes': 'Update Endnotes',
};

export function otherEndnoteMarker(marker) {
  return validEndnoteMarker(marker)
    ? (marker.startsWith('cite-') ? 'body-' : 'cite-') + marker.slice(5)
    : null;
}

/** Only canonical text owns an annotation. A malformed file cannot silently retarget a duplicate. */
export function validateEndnotePairs(doc) {
  const citations = new Set(),
    bodies = new Set();
  for (const holder of [...doc.blocks.filter((b) => !b.textFlowId), ...(doc.textFlows || [])]) {
    if (!containsEndnoteField(holder.html)) continue;
    for (const [tag] of holder.html.matchAll(/<a\b[^>]*>/gi)) {
      const marker = attribute(tag, 'data-endnote');
      if (marker === null) continue;
      const [role] = marker.split('-'),
        id = marker.slice(5),
        expected = holder.endnotes ? 'body' : 'cite';
      const used = role === 'cite' ? citations : bodies;
      if (role !== expected || used.has(id))
        throw Error('An endnote marker is duplicated or lies outside its source.');
      used.add(id);
    }
  }
  if (citations.size !== bodies.size || [...citations].some((id) => !bodies.has(id)))
    throw Error('Each endnote reference needs its paired note text.');
}
