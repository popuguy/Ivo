export function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    colon: ':',
    tab: '\t',
    newline: '\n',
  };
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);?/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const point =
      entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\uFFFD';
  });
}

export function plainText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function attribute(attributes, name) {
  const match = String(attributes).match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}
