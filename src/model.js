/** Pure, dependency-free document model. Persistence and HTML sanitization belong to the UI. */
const BLOCK_TYPES = new Set(['text', 'image', 'quote', 'pdf', 'rule', 'equation', 'citation']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const LIMITS = { documents: 5000, blocksPerDocument: 1000, blocks: 50000, assets: 2000, assetBytes: 30 * 1024 * 1024, totalAssetBytes: 100 * 1024 * 1024, html: 1_000_000 };
const normalize = value => String(value ?? '').trim().toLocaleLowerCase('en-US');
const tagName = value => normalize(value).replace(/^#/, '');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function uid(prefix = '') {
  return `${prefix}${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
}

export function createDocument(title = 'Untitled', template = 'blank') {
  const now = new Date().toISOString();
  return { id: uid('doc-'), title: String(title).trim() || 'Untitled', kicker: '', subtitle: '', tags: [], aliases: [], blocks: [], updatedAt: now, createdAt: now, layout: { columns: 12, rows: 38 }, version: 1, template };
}

export function createBlock(type = 'text', overrides = {}) {
  if (!BLOCK_TYPES.has(type)) throw new TypeError(`Unknown block type: ${type}`);
  return { id: uid('block-'), type, x: 0, y: 0, w: 6, h: 5, html: '', src: '', caption: '', alt: '', fit: 'cover', textStyle: 'serif', fontSize: 16, align: 'left', crop: { x: 50, y: 50 }, objectPosition: { x: 50, y: 50 }, ...overrides, type };
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n' };
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);?/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\uFFFD';
  });
}

function plainText(html) {
  return decodeEntities(String(html ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attribute(attributes, name) {
  const match = String(attributes).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}

function resolver(documents) {
  const byId = new Map(documents.map(doc => [doc.id, doc]));
  const titles = new Map();
  const aliases = new Map();
  const add = (map, key, id) => { if (key) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); } };
  for (const doc of documents) {
    add(titles, normalize(doc.title), doc.id);
    for (const alias of doc.aliases ?? []) add(aliases, normalize(alias), doc.id);
  }
  return { byId, resolve(target, source) {
    const name = String(target).split('|')[0].split('#')[0].trim();
    if (!name) return source || null;
    if (byId.has(name)) return name;
    const candidates = titles.get(normalize(name)) ?? aliases.get(normalize(name));
    return candidates?.size === 1 ? [...candidates][0] : null;
  } };
}

export function resolveDocumentLink(documents, target, source = null) {
  return resolver(documents).resolve(target, source);
}

function documentTargets(doc) {
  const targets = [];
  for (const block of doc.blocks ?? []) {
    let html = String(block.html ?? '').replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attributes) => {
      const id = attribute(attributes, 'data-doc-id');
      if (id === null) return whole;
      targets.push({ target: id, canonical: true });
      return '';
    });
    const text = decodeEntities(html.replace(/<[^>]*>/g, ''));
    for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) targets.push({ target: match[1], canonical: false });
  }
  return targets;
}

/** Backlink entries are {source, target, count, title}; source/target are immutable IDs. */
export function buildIndex(documents = []) {
  const { byId, resolve } = resolver(documents);
  const nodes = documents.map(doc => ({ id: doc.id, title: doc.title, tags: [...new Set((doc.tags ?? []).map(tagName).filter(Boolean))] }));
  const tagCounts = Object.create(null);
  const backlinks = Object.create(null);
  for (const node of nodes) {
    backlinks[node.id] = [];
    for (const tag of node.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }
  const edgeMap = new Map();
  const unresolvedMap = new Map();
  for (const doc of documents) {
    for (const link of documentTargets(doc)) {
      const target = link.canonical ? (byId.has(link.target) ? link.target : null) : resolve(link.target, doc.id);
      if (!target) {
        const label = link.canonical ? link.target : link.target.split('|')[0].trim();
        unresolvedMap.set(JSON.stringify([doc.id, label]), { source: doc.id, target: label });
        continue;
      }
      const key = JSON.stringify([doc.id, target]);
      const edge = edgeMap.get(key) ?? { source: doc.id, target, count: 0 };
      edge.count += 1;
      edgeMap.set(key, edge);
    }
  }
  const edges = [...edgeMap.values()];
  for (const edge of edges) backlinks[edge.target].push({ ...edge, title: byId.get(edge.source).title });
  return { nodes, edges, backlinks, unresolved: [...unresolvedMap.values()], tagCounts };
}

const matchesTag = (tags, requested) => tags.some(tag => tag === requested || tag.startsWith(`${requested}/`));

/** Small predictable search: AND terms, quoted phrases, and tag:parent/subtag. */
export function filterDocuments(documents, query = '', tag = '') {
  const requestedTags = tag ? [tagName(tag)] : [];
  const words = [];
  for (const match of String(query).matchAll(/tag:(?:"([^"]+)"|([^\s]+))|"([^"]+)"|(\S+)/gi)) {
    if (match[1] || match[2]) requestedTags.push(tagName(match[1] ?? match[2]));
    else words.push(normalize(match[3] ?? match[4]));
  }
  return documents.filter(doc => {
    const tags = (doc.tags ?? []).map(tagName);
    if (!requestedTags.every(requested => matchesTag(tags, requested))) return false;
    const haystack = normalize([doc.title, doc.kicker, doc.subtitle, ...(doc.aliases ?? []), ...tags, ...(doc.blocks ?? []).flatMap(block => [plainText(block.html), block.caption, block.alt])].join(' '));
    return words.every(word => haystack.includes(word));
  });
}

export function localGraph(index, documentId, depth = 1) {
  if (!index.nodes.some(node => node.id === documentId)) return { nodes: [], edges: [] };
  const distance = Math.max(0, Math.min(100, Number.isFinite(depth) ? Math.floor(depth) : 1));
  const neighbors = new Map(index.nodes.map(node => [node.id, new Set()]));
  for (const edge of index.edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  const included = new Set([documentId]);
  let frontier = [documentId];
  for (let level = 0; level < distance && frontier.length; level += 1) {
    const next = [];
    for (const id of frontier) for (const adjacent of neighbors.get(id) ?? []) if (!included.has(adjacent)) { included.add(adjacent); next.push(adjacent); }
    frontier = next;
  }
  return { nodes: index.nodes.filter(node => included.has(node.id)), edges: index.edges.filter(edge => included.has(edge.source) && included.has(edge.target)) };
}

function fail(message) { throw new TypeError(`Invalid Ivo archive: ${message}`); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${label} has an unsafe key`);
  return value;
}
function string(value, label, max = 8192, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be a string of at most ${max} characters`);
  return value;
}
function number(value, label, min, max, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} must be a number between ${min} and ${max}`);
  return value;
}
function enumeration(value, label, values, fallback) {
  if (value === undefined) return fallback;
  if (!values.includes(value)) fail(`${label} has an unsupported value`);
  return value;
}
function stringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) fail(`${label} must contain at most 100 strings`);
  return [...new Set(value.map((item, index) => string(item, `${label}[${index}]`, 512).trim()).filter(Boolean))];
}
function timestamp(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) fail(`${label} must be a timestamp`);
  return new Date(value).toISOString();
}
function position(value, label) {
  if (value === undefined) return { x: 50, y: 50 };
  if (typeof value === 'string') {
    const match = value.match(/^\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/);
    if (!match) fail(`${label} must contain two percentages`);
    return { x: number(Number(match[1]), label, 0, 100), y: number(Number(match[2]), label, 0, 100) };
  }
  record(value, label);
  return { x: number(value.x, `${label}.x`, 0, 100, 50), y: number(value.y, `${label}.y`, 0, 100, 50) };
}
function extensions(value, label, depth = 0, budget = { count: 0 }) {
  if (depth > 8 || ++budget.count > 2000) fail(`${label} exceeds extension complexity limits`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return string(value, label, 100_000);
  if (typeof value === 'number') return number(value, label, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (Array.isArray(value)) return value.map((item, index) => extensions(item, `${label}[${index}]`, depth + 1, budget));
  record(value, label);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, extensions(item, `${label}.${key}`, depth + 1, budget)]));
}

function checkUrl(value, label, { link = false } = {}) {
  const url = decodeEntities(value).trim();
  if (!url) return;
  if (/[\u0000-\u001f\u007f]/.test(url)) fail(`${label} contains URL control characters`);
  const scheme = url.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (!scheme) { if (url.includes('\\') || url.startsWith('//')) fail(`${label} has an unsafe relative URL`); return; }
  if (scheme === 'asset') { if (!ID_PATTERN.test(url.slice(6))) fail(`${label} has an invalid asset ID`); return; }
  if (['https', 'http'].includes(scheme) || (link && ['mailto', 'tel'].includes(scheme))) return;
  if (scheme === 'data' && /^data:(?:image\/(?:png|jpeg|webp|gif|avif)|application\/pdf);base64,[A-Za-z0-9+/]*={0,2}$/i.test(url)) {
    if (url.length > LIMITS.assetBytes * 4 / 3 + 100) fail(`${label} exceeds the asset size limit`);
    return;
  }
  fail(`${label} uses a disallowed URL scheme`);
}

/** Reject known active content here; the UI must still sanitize HTML before rendering. */
function checkHtml(html, label, assetIds) {
  if (/<\s*\/?\s*(?:script|iframe|object|embed|form|meta|link|style|svg|math)\b/i.test(html)) fail(`${label} contains active HTML`);
  if (/\s+on[a-z]+\s*=/i.test(html) || /\s+srcdoc\s*=/i.test(html)) fail(`${label} contains an event handler`);
  if (/\s+srcset\s*=/i.test(html)) fail(`${label} contains an unsupported srcset`);
  for (const tag of html.matchAll(/<[^>]*>/g)) {
    for (const key of ['href', 'src', 'poster', 'action', 'formaction', 'xlink:href']) {
      const value = attribute(tag[0], key);
      if (value !== null) {
        checkUrl(value, `${label}.${key}`, { link: key === 'href' });
        if (/^asset:/i.test(value.trim()) && !assetIds.has(value.trim().slice(6))) fail(`${label}.${key} refers to a missing asset`);
      }
    }
    const style = attribute(tag[0], 'style');
    if (style && /url\s*\(|expression\s*\(|@import/i.test(decodeEntities(style))) fail(`${label} contains active CSS`);
  }
}

/** Normalize schema v1 without mutating the input or regenerating any supplied ID. */
export function validateImport(payload) {
  record(payload, 'archive');
  if (payload.schemaVersion !== 1) fail('unsupported schema version');
  if (!Array.isArray(payload.documents) || payload.documents.length > LIMITS.documents) fail(`documents must contain at most ${LIMITS.documents} entries`);
  if (payload.assets !== undefined && (!Array.isArray(payload.assets) || payload.assets.length > LIMITS.assets)) fail(`assets must contain at most ${LIMITS.assets} entries`);
  const usedIds = new Set();
  const id = (value, label) => {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(`${label} is not a valid stable ID`);
    if (usedIds.has(value)) fail(`duplicate ID ${value}`);
    usedIds.add(value);
    return value;
  };
  let totalAssetBytes = 0;
  const assets = (payload.assets ?? []).map((asset, index) => {
    const label = `assets[${index}]`;
    record(asset, label);
    const assetId = id(asset.id, `${label}.id`);
    const data = string(asset.data, `${label}.data`, Math.ceil(LIMITS.assetBytes * 4 / 3) + 100);
    const match = data.match(/^data:(image\/(?:jpeg|png|webp|gif|avif)|application\/pdf);base64,([A-Za-z0-9+/]*={0,2})$/i);
    if (!match || !match[2] || match[2].length % 4 !== 0) fail(`${label}.data must be supported base64 image or PDF data`);
    const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    totalAssetBytes += bytes;
    if (bytes > LIMITS.assetBytes || totalAssetBytes > LIMITS.totalAssetBytes) fail('asset byte limits exceeded');
    const mimeType = string(asset.mimeType, `${label}.mimeType`, 100, match[1].toLowerCase()).toLowerCase();
    if (mimeType !== match[1].toLowerCase()) fail(`${label}.mimeType does not match its data`);
    return { id: assetId, data, name: string(asset.name, `${label}.name`, 1024, 'Untitled asset'), mimeType };
  });
  const assetIds = new Set(assets.map(asset => asset.id));
  const now = new Date().toISOString();
  let totalBlocks = 0;
  let totalHtml = 0;
  const documents = payload.documents.map((doc, docIndex) => {
    const label = `documents[${docIndex}]`;
    record(doc, label);
    const documentId = id(doc.id, `${label}.id`);
    const layout = doc.layout === undefined ? {} : record(doc.layout, `${label}.layout`);
    if (layout.columns !== undefined && layout.columns !== 12) fail(`${label}.layout.columns must be 12`);
    const rows = number(layout.rows, `${label}.layout.rows`, 20, 100, 38);
    if (!Number.isInteger(rows)) fail(`${label}.layout.rows must be an integer`);
    if (!Array.isArray(doc.blocks) || doc.blocks.length > LIMITS.blocksPerDocument || (totalBlocks += doc.blocks.length) > LIMITS.blocks) fail(`${label}.blocks exceeds block limits`);
    const blocks = doc.blocks.map((block, blockIndex) => {
      const key = `${label}.blocks[${blockIndex}]`;
      record(block, key);
      const blockId = id(block.id, `${key}.id`);
      if (!BLOCK_TYPES.has(block.type)) fail(`${key}.type is unsupported`);
      const x = number(block.x, `${key}.x`, 0, 12, 0);
      const y = number(block.y, `${key}.y`, 0, 100, 0);
      const w = number(block.w, `${key}.w`, 0.1, 12, 6);
      const h = number(block.h, `${key}.h`, 0.1, 100, 5);
      if (x + w > 12 + 1e-8 || y + h > rows + 1e-8) fail(`${key} exceeds its document layout`);
      const html = string(block.html, `${key}.html`, LIMITS.html);
      totalHtml += html.length;
      if (totalHtml > 20_000_000) fail('total HTML exceeds 20 million characters');
      checkHtml(html, `${key}.html`, assetIds);
      const src = string(block.src, `${key}.src`, Math.ceil(LIMITS.assetBytes * 4 / 3) + 100).trim().replace(/^asset:/i, 'asset:');
      checkUrl(src, `${key}.src`);
      if (src.startsWith('asset:') && !assetIds.has(src.slice(6))) fail(`${key}.src refers to a missing asset`);
      if (/^data:/i.test(src)) {
        totalAssetBytes += src.length * 3 / 4;
        if (totalAssetBytes > LIMITS.totalAssetBytes) fail('asset byte limits exceeded');
      }
      const normalized = { id: blockId, type: block.type, x, y, w, h, html, src, caption: string(block.caption, `${key}.caption`), alt: string(block.alt, `${key}.alt`), fit: enumeration(block.fit, `${key}.fit`, ['cover', 'contain'], 'cover'), textStyle: enumeration(block.textStyle, `${key}.textStyle`, ['serif', 'sans', 'display'], 'serif'), fontSize: number(block.fontSize, `${key}.fontSize`, 10, 120, 16), align: enumeration(block.align, `${key}.align`, ['left', 'center', 'right', 'justify'], 'left'), crop: position(block.crop, `${key}.crop`), objectPosition: position(block.objectPosition ?? block.crop, `${key}.objectPosition`) };
      if (block.extensions !== undefined) normalized.extensions = extensions(block.extensions, `${key}.extensions`);
      return normalized;
    });
    const normalized = { id: documentId, title: string(doc.title, `${label}.title`, 1024, 'Untitled'), kicker: string(doc.kicker, `${label}.kicker`, 512), subtitle: string(doc.subtitle, `${label}.subtitle`), tags: stringList(doc.tags, `${label}.tags`), aliases: stringList(doc.aliases, `${label}.aliases`), blocks, createdAt: timestamp(doc.createdAt, `${label}.createdAt`, now), updatedAt: timestamp(doc.updatedAt, `${label}.updatedAt`, now), layout: { columns: 12, rows }, version: enumeration(doc.version, `${label}.version`, [1], 1), template: string(doc.template, `${label}.template`, 100, 'blank') };
    if (doc.extensions !== undefined) normalized.extensions = extensions(doc.extensions, `${label}.extensions`);
    return normalized;
  });
  return { schemaVersion: 1, documents, assets };
}

function markdownText(text) { return String(text ?? '').replace(/([\\`*_[\]])/g, '\\$1'); }
function markdownPath(title) { return `${encodeURIComponent(String(title).replace(/[\\/]/g, '-'))}.md`; }
function markdownUrl(value) { return String(value ?? '').replace(/[\s()]/g, character => character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character)); }
function htmlToMarkdown(html, documents) {
  const { byId, resolve } = resolver(documents);
  let result = String(html ?? '');
  result = result.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attributes, body) => {
    const id = attribute(attributes, 'data-doc-id');
    const target = id === null ? attribute(attributes, 'href') : byId.get(id) ? markdownPath(byId.get(id).title) : `ivo-document:${encodeURIComponent(id)}`;
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
  result = result.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, level, content) => `\n${'#'.repeat(Number(level))} ${content}\n\n`);
  result = result.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '**$2**').replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, '*$2*');
  result = result.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|ul|ol|blockquote)\s*>/gi, '\n\n').replace(/<[^>]*>/g, '');
  return decodeEntities(result).replace(/\n{3,}/g, '\n\n').trim();
}

/** Portable reading-order export; full-fidelity layout belongs in the JSON archive. */
export function exportMarkdown(doc, documents = []) {
  const linkedDocs = documents.some(item => item.id === doc.id) ? documents : [...documents, doc];
  const meta = ['---', `ivo_id: ${JSON.stringify(doc.id)}`];
  if (doc.tags?.length) meta.push(`tags: ${JSON.stringify(doc.tags)}`);
  if (doc.aliases?.length) meta.push(`aliases: ${JSON.stringify(doc.aliases)}`);
  meta.push('---', '', `# ${doc.title}`, '');
  if (doc.kicker) meta.push(`*${markdownText(doc.kicker)}*`, '');
  if (doc.subtitle) meta.push(doc.subtitle, '');
  const blocks = [...(doc.blocks ?? [])].sort((left, right) => left.y - right.y || left.x - right.x);
  for (const block of blocks) {
    const text = htmlToMarkdown(block.html, linkedDocs);
    const source = block.src?.startsWith('asset:') ? `assets/${encodeURIComponent(block.src.slice(6))}` : block.src;
    if (block.type === 'image') meta.push(`![${markdownText(block.alt || block.caption)}](${markdownUrl(source)})`);
    else if (block.type === 'pdf') meta.push(`[${markdownText(block.caption || block.alt || 'PDF document')}](${markdownUrl(source)})`);
    else if (block.type === 'rule') meta.push('---');
    else if (block.type === 'quote') meta.push(text.split('\n').map(line => `> ${line}`).join('\n'));
    else meta.push(text);
    if (block.caption && ['image', 'pdf'].includes(block.type)) meta.push('', `*${markdownText(block.caption)}*`);
    meta.push('');
  }
  return `${meta.join('\n').trim()}\n`;
}
