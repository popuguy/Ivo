import { uid } from './model.js';
import { upgradeDocument } from './scene.js';
import { basicParagraph } from './publishing.js';
export const isTemplate = (document) => document?.extensions?.ivoTemplate?.version === 1;

/** Copy authored data, remapping owned IDs and self-links while retaining immutable asset refs. */
export function copyDocument(source, { title = source.title + ' (copy)', template = false } = {}) {
  const document = structuredClone(source),
    ids = new Map();
  for (const item of [
    document,
    ...(document.pages || []),
    ...(document.textFlows || []),
    ...(document.publishing?.layers || []),
    ...(document.publishing?.parents || []),
    ...(document.publishing?.paragraphStyles || []),
    ...(document.publishing?.characterStyles || []),
    ...(document.publishing?.parents || []).flatMap((p) => p.blocks),
    ...(document.publishing?.parents || []).flatMap((p) => p.blocks.flatMap((b) => b.points || [])),
    ...document.blocks,
    ...document.blocks.flatMap((block) => block.points || []),
  ])
    ids.set(item.id, uid('copy-'));
  document.id = ids.get(source.id);
  const basic = basicParagraph(source);
  if (basic) document.extensions.ivoTypography.defaultParagraphStyle = ids.get(basic.id);
  document.title = title.trim().slice(0, 180) || 'Untitled';
  document.aliases = [];
  document.version = 1;
  document.createdAt = document.updatedAt = new Date().toISOString();
  for (const page of document.pages || []) {
    page.id = ids.get(page.id);
    if (page.parentPageId) page.parentPageId = ids.get(page.parentPageId);
    if (page.parentOverrides) page.parentOverrides = page.parentOverrides.map((id) => ids.get(id));
  }
  function remapRichText(holder) {
    if (holder.html)
      holder.html = holder.html.replace(
        /(data-ivo-(?:pstyle|cstyle)=["'])([^"']+)(["'])/g,
        (all, prefix, id, suffix) => (ids.has(id) ? prefix + ids.get(id) + suffix : all),
      );
    for (const key of ['paragraphStyle', 'characterStyle'])
      if (holder[key] && ids.has(holder[key])) holder[key] = ids.get(holder[key]);
  }
  if (document.publishing) {
    for (const layer of document.publishing.layers) layer.id = ids.get(layer.id);
    for (const style of [
      ...document.publishing.paragraphStyles,
      ...document.publishing.characterStyles,
    ]) {
      style.id = ids.get(style.id);
      if (style.basedOn) style.basedOn = ids.get(style.basedOn);
      if (style.nextStyle) style.nextStyle = ids.get(style.nextStyle);
    }
    for (const parent of document.publishing.parents) {
      parent.id = ids.get(parent.id);
      for (const block of parent.blocks) {
        block.id = ids.get(block.id);
        if (block.parentId) block.parentId = ids.get(block.parentId);
        if (block.layerId) block.layerId = ids.get(block.layerId);
        for (const point of block.points || []) point.id = ids.get(point.id);
        remapRichText(block);
      }
    }
  }
  for (const block of document.blocks) {
    block.id = ids.get(block.id);
    if (block.layerId) block.layerId = ids.get(block.layerId);
    if (block.parentOriginId) block.parentOriginId = ids.get(block.parentOriginId);
    remapRichText(block);
    if (block.pageId) block.pageId = ids.get(block.pageId);
    if (block.textFlowId) block.textFlowId = ids.get(block.textFlowId);
    if (block.parentId) block.parentId = ids.get(block.parentId);
    for (const point of block.points || []) point.id = ids.get(point.id);
    block.html = (block.html || '')
      .replace(/(\bdata-doc-id\s*=\s*)(["'])([^"']*)\2/gi, (all, prefix, quote, value) =>
        value === source.id ? prefix + quote + document.id + quote : all,
      )
      .replace(/(\bhref\s*=\s*)(["'])#doc=([^"']*)\2/gi, (all, prefix, quote, value) =>
        value === source.id ? prefix + quote + '#doc=' + document.id + quote : all,
      );
  }
  for (const textFlow of document.textFlows || []) {
    textFlow.id = ids.get(textFlow.id);
    remapRichText(textFlow);
    remapRichText(textFlow.style);
    textFlow.frameIds = textFlow.frameIds.map((id) => ids.get(id));
    textFlow.autoPages = textFlow.autoPages.map((value) => ({
      pageId: ids.get(value.pageId),
      frameId: ids.get(value.frameId),
    }));
    textFlow.html = textFlow.html
      .replace(/(\bdata-doc-id\s*=\s*)(["'])([^"']*)\2/gi, (all, prefix, quote, value) =>
        value === source.id ? prefix + quote + document.id + quote : all,
      )
      .replace(/(\bhref\s*=\s*)(["'])#doc=([^"']*)\2/gi, (all, prefix, quote, value) =>
        value === source.id ? prefix + quote + '#doc=' + document.id + quote : all,
      );
  }
  if (document.extensions?.ivoTemplate) {
    delete document.extensions.ivoTemplate;
    if (!Object.keys(document.extensions).length) delete document.extensions;
  }
  if (template) document.extensions = { ...document.extensions, ivoTemplate: { version: 1 } };
  return document;
}
export function createUserTemplate(source, name) {
  return copyDocument(upgradeDocument(source), { title: name, template: true });
}
export function instantiateTemplate(source, title) {
  if (!isTemplate(source)) throw new Error('Choose an available template.');
  return copyDocument(upgradeDocument(source), { title });
}
