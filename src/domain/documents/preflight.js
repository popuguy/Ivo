import { createDocumentResolver, textLinkTargets } from '../knowledge/index.js';
import { fontsInText } from '../text/font-references.js';
import { attribute } from '../text/html.js';

/** Inspect the document and its current composition without writing to either. */
export function inspectPublication(doc, { assets, documents, flowStatus, frameOverflow, digital }) {
  const resources = new Set(assets.map((asset) => asset.id));
  const blocks = new Map(doc.blocks.map((item) => [item.id, item]));
  const pages = new Map(doc.pages.map((page, i) => [page.id, page.name || 'Page ' + (i + 1)]));
  const resolver = digital ? createDocumentResolver(documents) : null;
  const issues = [],
    keys = new Set();
  function report(group, problem, location, detail = '') {
    const key = JSON.stringify([group, problem, location, detail]);
    if (keys.has(key)) return;
    keys.add(key);
    issues.push({ group, problem, location, detail });
  }
  function locate(block) {
    return {
      page: block?.pageId,
      object: block?.id,
      label: pages.get(block?.pageId) || 'Document',
    };
  }
  function inspect(source, location) {
    for (const id of fontsInText(source))
      if (!resources.has(id)) report('Fonts', 'Missing vault font', location, id);
    function asset(value) {
      if (value?.startsWith('asset:') && !resources.has(value.slice(6)))
        report('Links', 'Missing vault resource', location, value.slice(6));
    }
    asset(source.src);
    for (const tag of (source.html || '').matchAll(/<[^>]+>/g))
      for (const name of ['href', 'src']) asset(attribute(tag[0], name));
    if (resolver)
      for (const { target, canonical } of textLinkTargets(source.html)) {
        const exists = canonical ? resolver.byId.has(target) : resolver.resolve(target, doc.id);
        if (!exists) report('Links', 'Unresolved document link', location, target);
      }
    if (digital && source.type === 'image' && source.src && !source.alt?.trim())
      report('Images', 'Missing image description', location);
  }
  for (const item of doc.blocks) {
    const location = locate(item);
    inspect(item, location);
    if (!item.textFlowId && ['text', 'quote'].includes(item.type) && item.textKind !== 'point') {
      const overflow = frameOverflow(item);
      if (overflow === true) report('Text', 'Overset text', location);
      if (overflow == null) report('Unchecked', 'Frame layout unavailable', location);
    }
  }
  for (const flow of doc.textFlows || []) {
    inspect({ ...flow.style, html: flow.html }, locate(blocks.get(flow.frameIds[0])));
    const location = locate(blocks.get(flow.frameIds.at(-1)));
    const status = flowStatus(flow);
    if (status?.overset) report('Text', 'Overset text', location);
    if (!status) report('Unchecked', 'Awaiting text composition', location);
  }
  for (const parent of doc.publishing?.parents || [])
    for (const item of parent.blocks)
      inspect(item, { parent: parent.id, label: parent.name || 'Parent page' });
  for (const kind of ['paragraphStyles', 'characterStyles'])
    for (const style of doc.publishing?.[kind] || [])
      inspect(style.attributes || {}, { label: style.name });
  return issues;
}
