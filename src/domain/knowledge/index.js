import { attribute, decodeEntities, plainText } from '../text/html.js';
const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US');

const tagName = (value) => normalize(value).replace(/^#/, '');

export function createDocumentResolver(documents) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const titles = new Map();
  const aliases = new Map();
  const add = (map, key, id) => {
    if (key) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(id);
    }
  };
  for (const doc of documents) {
    add(titles, normalize(doc.title), doc.id);
    for (const alias of doc.aliases ?? []) add(aliases, normalize(alias), doc.id);
  }
  return {
    byId,
    resolve(target, source) {
      const name = String(target).split('|')[0].split('#')[0].trim();
      if (!name) return source || null;
      if (byId.has(name)) return name;
      const candidates = titles.get(normalize(name)) ?? aliases.get(normalize(name));
      return candidates?.size === 1 ? [...candidates][0] : null;
    },
  };
}

export function resolveDocumentLink(documents, target, source = null) {
  return createDocumentResolver(documents).resolve(target, source);
}

export function textLinkTargets(source) {
  const targets = [];
  let html = String(source ?? '').replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attributes) => {
    const id = attribute(attributes, 'data-doc-id');
    if (id === null) return whole;
    targets.push({ target: id, canonical: true });
    return '';
  });
  const text = decodeEntities(html.replace(/<[^>]*>/g, ''));
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g))
    targets.push({ target: match[1], canonical: false });
  return targets;
}

export function buildIndex(documents = []) {
  const { byId, resolve } = createDocumentResolver(documents);
  const nodes = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    tags: [...new Set((doc.tags ?? []).map(tagName).filter(Boolean))],
  }));
  const tagCounts = Object.create(null);
  const backlinks = Object.create(null);
  for (const node of nodes) {
    backlinks[node.id] = [];
    for (const tag of node.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }
  const edgeMap = new Map();
  const unresolvedMap = new Map();
  for (const doc of documents) {
    for (const link of [...(doc.blocks ?? []), ...(doc.textFlows ?? [])].flatMap((source) =>
      textLinkTargets(source.html),
    )) {
      const target = link.canonical
        ? byId.has(link.target)
          ? link.target
          : null
        : resolve(link.target, doc.id);
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
  for (const edge of edges)
    backlinks[edge.target].push({ ...edge, title: byId.get(edge.source).title });
  return { nodes, edges, backlinks, unresolved: [...unresolvedMap.values()], tagCounts };
}

const matchesTag = (tags, requested) =>
  tags.some((tag) => tag === requested || tag.startsWith(`${requested}/`));

export function filterDocuments(documents, query = '', tag = '') {
  const requestedTags = tag ? [tagName(tag)] : [];
  const words = [];
  for (const match of String(query).matchAll(/tag:(?:"([^"]+)"|([^\s]+))|"([^"]+)"|(\S+)/gi)) {
    if (match[1] || match[2]) requestedTags.push(tagName(match[1] ?? match[2]));
    else words.push(normalize(match[3] ?? match[4]));
  }
  return documents.filter((doc) => {
    const tags = (doc.tags ?? []).map(tagName);
    if (!requestedTags.every((requested) => matchesTag(tags, requested))) return false;
    const haystack = normalize(
      [
        doc.title,
        doc.kicker,
        doc.subtitle,
        ...(doc.aliases ?? []),
        ...tags,
        ...[...(doc.blocks ?? []), ...(doc.textFlows ?? [])].flatMap((block) => [
          block.table?.cells.map((row) => row.join(' ')).join(' '),
          plainText(block.html),
          block.caption,
          block.alt,
        ]),
      ].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

export function localGraph(index, documentId, depth = 1) {
  if (!index.nodes.some((node) => node.id === documentId)) return { nodes: [], edges: [] };
  const distance = Math.max(0, Math.min(100, Number.isFinite(depth) ? Math.floor(depth) : 1));
  const neighbors = new Map(index.nodes.map((node) => [node.id, new Set()]));
  for (const edge of index.edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  const included = new Set([documentId]);
  let frontier = [documentId];
  for (let level = 0; level < distance && frontier.length; level += 1) {
    const next = [];
    for (const id of frontier)
      for (const adjacent of neighbors.get(id) ?? [])
        if (!included.has(adjacent)) {
          included.add(adjacent);
          next.push(adjacent);
        }
    frontier = next;
  }
  return {
    nodes: index.nodes.filter((node) => included.has(node.id)),
    edges: index.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
  };
}
