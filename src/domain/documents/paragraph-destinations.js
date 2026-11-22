import { attribute, decodeEntities } from '../text/html.js';

export const validParagraphId = (id) =>
  typeof id === 'string' && /^par-[A-Za-z0-9_-]{1,100}$/.test(id);
export const validParagraphKey = (key) =>
  typeof key === 'string' && /^[A-Za-z0-9][\w-]{0,119}\/par-[\w-]{1,100}$/.test(key);
export const destinationTags = 'p,h2,h3,h4';

export function paragraphDestinations(doc) {
  const result = new Map(),
    frames = new Map(doc.blocks.map((b) => [b.id, b]));
  for (const holder of [
    ...doc.blocks.filter((b) => !b.textFlowId && ['text', 'quote'].includes(b.type)),
    ...(doc.textFlows || []),
  ]) {
    if (!holder.html?.includes('data-paragraph-destination')) continue;
    for (const [, tag, attrs, body] of holder.html.matchAll(
      /<(p|h[234])\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    )) {
      const id = attribute(attrs, 'data-paragraph-destination');
      if (!validParagraphId(id)) continue;
      const key = holder.id + '/' + id;
      const title = decodeEntities(
        body.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''),
      ).trim();
      const pageId = holder.frameIds
        ? holder.frameIds.length === 1
          ? frames.get(holder.frameIds[0])?.pageId
          : null
        : holder.pageId;
      // Ambiguous markers arriving from a rich-text paste must never silently retarget a field.
      result.set(
        key,
        result.has(key) || /<a\b[^>]*\sdata-xref-format=/i.test(body)
          ? null
          : { key, id, source: holder.id, tag, title, pageId },
      );
    }
  }
  return result;
}

/** A standalone frame keeps existing incoming references when promoted into a thread. */
export function paragraphDestination(doc, entries, key) {
  if (!entries) return null;
  if (entries.has(key)) return entries.get(key);
  const [frame, id] = key.split('/');
  const flow = doc?.blocks.find((b) => b.id === frame)?.textFlowId;
  return flow ? entries.get(flow + '/' + id) : null;
}
