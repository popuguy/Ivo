import { attribute } from './html.js';
export function referencedFonts(doc) {
  const result = new Set(),
    sources = [
      ...doc.blocks,
      ...(doc.textFlows || []).map((f) => ({ ...f, ...f.style })),
      ...(doc.publishing?.parents || []).flatMap((p) => p.blocks),
      ...(doc.publishing?.paragraphStyles || []).map((s) => s.attributes),
      ...(doc.publishing?.characterStyles || []).map((s) => s.attributes),
    ];
  for (const source of sources) for (const font of fontsInText(source)) result.add(font);
  return result;
}

export function fontsInText(source) {
  const result = new Set();
  if (/^font-[a-f0-9]{64}$/.test(source.textOverrides?.textStyle || ''))
    result.add(source.textOverrides.textStyle);
  if (/^font-[a-f0-9]{64}$/.test(source.textStyle || '')) result.add(source.textStyle);
  for (const tag of (source.html || '').matchAll(/<[^>]+>/g)) {
    const font = attribute(tag[0], 'data-ivo-font');
    if (/^font-[a-f0-9]{64}$/.test(font || '')) result.add(font);
  }
  return result;
}

/** Older authored presets retain their names; portable bytes can satisfy them without restyling source. */
export function legacyFontFamilies(doc) {
  const families = new Set(),
    aliases = { sans: 'Helvetica Neue', display: 'Helvetica Neue', serif: 'Georgia' };
  const sources = [
    ...doc.blocks.filter((b) => ['text', 'quote'].includes(b.type)),
    ...(doc.textFlows || []).map((f) => ({ ...f, ...f.style })),
    ...(doc.publishing?.parents || []).flatMap((p) =>
      p.blocks.filter((b) => ['text', 'quote'].includes(b.type)),
    ),
    ...(doc.publishing?.paragraphStyles || []).map((s) => s.attributes),
    ...(doc.publishing?.characterStyles || []).map((s) => s.attributes),
  ];
  for (const source of sources) {
    for (const value of [source.textStyle, source.textOverrides?.textStyle])
      if (aliases[value]) families.add(aliases[value]);
    for (const tag of (source.html || '').matchAll(/<[^>]+>/g)) {
      const value = attribute(tag[0], 'data-ivo-font');
      if (aliases[value]) families.add(aliases[value]);
    }
  }
  return families;
}
