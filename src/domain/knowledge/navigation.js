const normalize = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en-US')
    .trim();
function fuzzyScore(value, query) {
  const text = normalize(value);
  if (text === query) return -1000;
  if (text.startsWith(query)) return -500 + text.length * 0.01;
  let previous = -1,
    score = 0;
  for (const letter of query) {
    const index = text.indexOf(letter, previous + 1);
    if (index < 0) return null;
    score += index === previous + 1 ? -6 : Math.min(20, index - previous);
    if (index === 0 || /[\s/_-]/.test(text[index - 1])) score -= 5;
    previous = index;
  }
  return score + text.length * 0.02;
}
/** Name/alias fuzzy search. Explicit Ivo ranking, not an undocumented native score clone. */
export function quickSwitcherResults(
  documents,
  query = '',
  { recentIds = [], activeId, limit = 30 } = {},
) {
  const term = normalize(query),
    recent = new Map(recentIds.map((id, index) => [id, index]));
  return documents
    .map((document) => {
      const names = [document.title, ...(document.aliases || [])],
        matches = names
          .map((name, index) => {
            const score = term ? fuzzyScore(name, term) : 0;
            return score === null ? null : { score: score + index * 0.1, name, index };
          })
          .filter(Boolean)
          .sort((a, b) => a.score - b.score);
      if (!matches.length) return null;
      return {
        document,
        score: matches[0].score,
        alias: matches[0].index ? matches[0].name : null,
        recency:
          document.id === activeId ? -1 : (recent.get(document.id) ?? Number.MAX_SAFE_INTEGER),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.recency - b.recency ||
        b.document.updatedAt.localeCompare(a.document.updatedAt) ||
        a.document.title.localeCompare(b.document.title) ||
        a.document.id.localeCompare(b.document.id),
    )
    .slice(0, limit);
}
export function rememberDocument(recentIds, id, limit = 100) {
  return [...new Set([id, ...recentIds.filter((value) => typeof value === 'string')])].slice(
    0,
    limit,
  );
}
export function readRecentDocuments(storage) {
  try {
    const ids = JSON.parse(storage.getItem('ivo:recent-documents') || '[]');
    return Array.isArray(ids)
      ? [...new Set(ids.filter((id) => typeof id === 'string' && /^[\w-]{1,120}$/.test(id)))].slice(
          0,
          100,
        )
      : [];
  } catch {
    return [];
  }
}
