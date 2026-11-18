/** Bounded SFNT metadata reader. No system font installation or font program execution. */
export function inspectFont(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 12 || bytes.byteLength > 30 * 1024 * 1024)
    throw new Error('Choose a TrueType or OpenType font smaller than 30 MB.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tables = new Map();
  const need = (offset, size) => {
    if (!Number.isInteger(offset) || offset < 0 || size < 0 || offset + size > bytes.length)
      throw new Error('Damaged font table.');
  };
  const u16 = (o) => {
      need(o, 2);
      return v.getUint16(o);
    },
    u32 = (o) => {
      need(o, 4);
      return v.getUint32(o);
    };
  const tag = (o) => {
    need(o, 4);
    return String.fromCharCode(...bytes.subarray(o, o + 4));
  };
  const signature = u32(0),
    otf = tag(0) === 'OTTO';
  if (signature !== 0x10000 && !otf)
    throw new Error(
      'Use a single .ttf or .otf font file. Font collections and compressed web fonts are not supported yet.',
    );
  const count = u16(4);
  if (count > 256) throw new Error('Invalid font directory.');
  need(12, count * 16);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16,
      offset = u32(at + 8),
      size = u32(at + 12);
    need(offset, size);
    tables.set(tag(at), { offset, size });
  }
  const os = tables.get('OS/2'),
    names = tables.get('name');
  if (!os || os.size < 10 || !names || names.size < 6)
    throw new Error('The font has no usable identity or embedding metadata.');
  const fsType = u16(os.offset + 8);
  if (fsType & 2 || fsType & 0x200 || (fsType & 4 && !(fsType & 8)))
    throw new Error(
      'This font permits restricted or print-only embedding. Use a font licensed for editable documents.',
    );
  const at = names.offset,
    n = u16(at + 2),
    strings = at + u16(at + 4),
    records = [];
  if (n > 4096 || 6 + n * 12 > names.size) throw new Error('Invalid font names.');
  for (let i = 0; i < n; i++) {
    const p = at + 6 + i * 12,
      platform = u16(p),
      language = u16(p + 4),
      id = u16(p + 6),
      length = u16(p + 8),
      start = strings + u16(p + 10);
    if (start < at || start + length > at + names.size) throw new Error('Invalid font name range.');
    if (![1, 2, 6, 16, 17].includes(id)) continue;
    let text = '';
    if (platform === 0 || platform === 3) {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(u16(start + j));
    } else if (platform === 1)
      text = new TextDecoder('macintosh').decode(bytes.subarray(start, start + length));
    else continue;
    text = [...text]
      .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
      .join('')
      .trim()
      .slice(0, 180);
    if (text)
      records.push({
        id,
        text,
        rank: (platform === 3 ? 4 : platform === 0 ? 2 : 0) + (language === 0x409 ? 2 : 0),
      });
  }
  const name = (id) => records.filter((r) => r.id === id).sort((a, b) => b.rank - a.rank)[0]?.text;
  const family = name(16) || name(1),
    subfamily = name(17) || name(2) || 'Regular';
  if (!family) throw new Error('The font has no family name.');
  const features = new Set();
  for (const kind of ['GSUB', 'GPOS']) {
    const t = tables.get(kind);
    if (!t || t.size < 10) continue;
    const f = t.offset + u16(t.offset + 6);
    if (f < t.offset || f + 2 > t.offset + t.size)
      throw new Error('Invalid OpenType feature list.');
    const count = u16(f);
    if (count > 4096 || f + 2 + count * 6 > t.offset + t.size)
      throw new Error('Invalid OpenType features.');
    for (let i = 0; i < count; i++) features.add(tag(f + 2 + i * 6));
  }
  const axes = [],
    fvar = tables.get('fvar');
  if (fvar && fvar.size >= 16) {
    const start = fvar.offset + u16(fvar.offset + 4),
      count = u16(fvar.offset + 8),
      size = u16(fvar.offset + 10);
    if (count > 64 || size < 20 || start + count * size > fvar.offset + fvar.size)
      throw new Error('Invalid variable-font axes.');
    for (let i = 0; i < count; i++) {
      const p = start + i * size;
      axes.push({
        tag: tag(p),
        min: v.getInt32(p + 4) / 65536,
        default: v.getInt32(p + 8) / 65536,
        max: v.getInt32(p + 12) / 65536,
      });
    }
  }
  return {
    family,
    subfamily,
    postscript: name(6) || family,
    weight: Math.max(1, Math.min(1000, u16(os.offset + 4))),
    italic: os.size >= 64 ? !!(u16(os.offset + 62) & 1) : /italic|oblique/i.test(subfamily),
    embedding: fsType,
    features: [...features].sort(),
    axes,
    mimeType: otf ? 'font/otf' : 'font/ttf',
  };
}
