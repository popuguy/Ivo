import { tableMarkup } from '../../rendering/table.js';
import { attribute, decodeEntities, plainText } from '../../domain/text/html.js';
import { createDocumentResolver as resolver } from '../../domain/knowledge/index.js';
function markdownText(text) {
  return String(text ?? '').replace(/([\\`*_[\]])/g, '\\$1');
}

function markdownPath(title) {
  return `${encodeURIComponent(String(title).replace(/[\\/]/g, '-'))}.md`;
}

function markdownUrl(value) {
  return String(value ?? '').replace(/[\s()]/g, (character) =>
    character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character),
  );
}

function htmlToMarkdown(html, documents) {
  const { byId, resolve } = resolver(documents);
  let result = String(html ?? '');
  result = result.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attributes, body) => {
    const id = attribute(attributes, 'data-doc-id');
    const target =
      id === null
        ? attribute(attributes, 'href')
        : byId.get(id)
          ? markdownPath(byId.get(id).title)
          : `ivo-document:${encodeURIComponent(id)}`;
    return target ? `[${markdownText(plainText(body))}](${markdownUrl(target)})` : plainText(body);
  });
  result = result.replace(/\[\[([^\]\n]+)\]\]/g, (whole, value) => {
    const [reference, display] = value.split('|');
    const [name, ...fragment] = reference.split('#');
    const target = byId.get(resolve(name));
    const path = name ? markdownPath(target?.title ?? name) : '';
    const anchor = fragment.length ? `#${encodeURIComponent(fragment.join('#'))}` : '';
    return `[${markdownText(display ?? reference)}](${markdownUrl(`${path}${anchor}`)})`;
  });
  result = result.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
    (_, level, content) => `\n${'#'.repeat(Number(level))} ${content}\n\n`,
  );
  result = result
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '*$2*');
  result = result
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|ul|ol|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(result)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function exportMarkdown(doc, documents = []) {
  const linkedDocs = documents.some((item) => item.id === doc.id) ? documents : [...documents, doc];
  const meta = ['---', `ivo_id: ${JSON.stringify(doc.id)}`];
  if (doc.tags?.length) meta.push(`tags: ${JSON.stringify(doc.tags)}`);
  if (doc.aliases?.length) meta.push(`aliases: ${JSON.stringify(doc.aliases)}`);
  meta.push('---', '', `# ${doc.title}`, '');
  if (doc.kicker) meta.push(`*${markdownText(doc.kicker)}*`, '');
  if (doc.subtitle) meta.push(doc.subtitle, '');
  const pageOrder = new Map((doc.pages || []).map((page, index) => [page.id, index]));
  const blocks = [...(doc.blocks ?? [])].sort(
    (left, right) =>
      (pageOrder.get(left.pageId) || 0) - (pageOrder.get(right.pageId) || 0) ||
      left.y - right.y ||
      left.x - right.x,
  );
  const emittedTextFlows = new Set();
  for (const block of blocks) {
    const textFlow =
      block.textFlowId && doc.textFlows?.find((value) => value.id === block.textFlowId);
    if (textFlow && emittedTextFlows.has(textFlow.id)) continue;
    if (textFlow) emittedTextFlows.add(textFlow.id);
    const text = htmlToMarkdown(textFlow?.html ?? block.html, linkedDocs);
    const source = block.src?.startsWith('asset:')
      ? `assets/${encodeURIComponent(block.src.slice(6))}`
      : block.src;
    if (block.type === 'image')
      meta.push(`![${markdownText(block.alt || block.caption)}](${markdownUrl(source)})`);
    else if (block.type === 'pdf')
      meta.push(
        `[${markdownText(block.caption || block.alt || 'PDF document')}](${markdownUrl(source)})`,
      );
    else if (block.type === 'table') meta.push(tableMarkup(block.table));
    else if (block.type === 'rule') meta.push('---');
    else if (block.type === 'quote')
      meta.push(
        text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      );
    else meta.push(text);
    if (block.caption && ['image', 'pdf'].includes(block.type))
      meta.push('', `*${markdownText(block.caption)}*`);
    meta.push('');
  }
  return `${meta.join('\n').trim()}\n`;
}
