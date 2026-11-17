import { uid } from './model.js';
import { upgradeDocument } from './scene.js';
export const isTemplate = (document) => document?.extensions?.ivoTemplate?.version === 1;

/** Copy authored data, remapping owned IDs and self-links while retaining immutable asset refs. */
export function copyDocument(source, { title = source.title + ' (copy)', template = false } = {}) {
  const document = structuredClone(source),
    ids = new Map();
  for (const item of [
    document,
    ...(document.pages || []),
    ...(document.textFlows || []),
    ...document.blocks,
    ...document.blocks.flatMap((block) => block.points || []),
  ])
    ids.set(item.id, uid('copy-'));
  document.id = ids.get(source.id);
  document.title = title.trim().slice(0, 180) || 'Untitled';
  document.aliases = [];
  document.version = 1;
  document.createdAt = document.updatedAt = new Date().toISOString();
  for (const page of document.pages || []) page.id = ids.get(page.id);
  for (const block of document.blocks) {
    block.id = ids.get(block.id);
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
