import { preflightPresets } from './preflight-profiles.js';
import { createDocumentResolver, textLinkTargets } from '../knowledge/index.js';
import { fontsInText } from '../text/font-references.js';
import { attribute } from '../text/html.js';

/** Inspect the document and its current composition without writing to either. */
export function inspectPublication(
  doc,
  {
    assets,
    documents,
    flowStatus,
    frameOverflow,
    imageResolution,
    digital,
    profile = digital ? preflightPresets.digital : preflightPresets.basic,
  },
) {
  const checks = new Set(profile.checks);
  const resources = new Set(assets.map((asset) => asset.id));
  const blocks = new Map(doc.blocks.map((item) => [item.id, item]));
  const pages = new Map(doc.pages.map((page, i) => [page.id, page.name || 'Page ' + (i + 1)]));
  const resolver = checks.has('links') ? createDocumentResolver(documents || [doc]) : null;
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
    if (checks.has('fonts'))
      for (const id of fontsInText(source))
        if (!resources.has(id)) report('Fonts', 'Missing vault font', location, id);
    function asset(value) {
      if (value?.startsWith('asset:') && !resources.has(value.slice(6)))
        report('Links', 'Missing vault resource', location, value.slice(6));
    }
    if (checks.has('resources')) asset(source.src);
    if (checks.has('resources') || resolver)
      for (const [tag] of (source.html || '').matchAll(/<[^>]+>/g)) {
        const href = attribute(tag, 'href');
        if (checks.has('resources')) {
          asset(href);
          asset(attribute(tag, 'src'));
        }
        if (resolver && /^<a\b/i.test(tag)) {
          const targetId = attribute(tag, 'data-doc-id'),
            pageId = attribute(tag, 'data-page-id');
          const chapter = targetId && resolver.byId.get(targetId);
          if (chapter && pageId && !chapter.pages?.some((p) => p.id === pageId))
            report('Links', 'Unresolved page link', location, chapter.title + ' / ' + pageId);
        }
        if (
          resolver &&
          /^<a\b/i.test(tag) &&
          href?.startsWith('#page=') &&
          !pages.has(href.slice(6))
        )
          report('Links', 'Unresolved page link', location, href.slice(6));
      }
    if (checks.has('resolution') && source.type === 'image' && source.src) {
      const measurement = imageResolution?.(source, location);
      if (measurement !== 'vector') {
        if (!Number.isFinite(measurement))
          report('Unchecked', 'Image resolution unavailable', location);
        else if (measurement < profile.ppi)
          report(
            'Images',
            'Low effective image resolution',
            location,
            `${Number(measurement.toFixed(1))} ppi (minimum ${profile.ppi} ppi)`,
          );
      }
    }
    if (resolver)
      for (const { target, canonical } of textLinkTargets(source.html)) {
        const exists = canonical ? resolver.byId.has(target) : resolver.resolve(target, doc.id);
        if (!exists) report('Links', 'Unresolved document link', location, target);
      }
    if (checks.has('descriptions') && source.type === 'image' && source.src && !source.alt?.trim())
      report('Images', 'Missing image description', location);
  }
  for (const item of doc.blocks) {
    const location = locate(item);
    inspect(item, location);
    if (
      checks.has('overset') &&
      !item.textFlowId &&
      ['text', 'quote', 'table'].includes(item.type) &&
      item.textKind !== 'point'
    ) {
      const overflow = frameOverflow(item);
      if (overflow === true) report('Text', 'Overset text', location);
      if (overflow == null) report('Unchecked', 'Frame layout unavailable', location);
    }
  }
  for (const flow of doc.textFlows || []) {
    inspect({ ...flow.style, html: flow.html }, locate(blocks.get(flow.frameIds[0])));
    if (!checks.has('overset')) continue;
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
