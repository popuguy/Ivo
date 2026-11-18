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
  for (const source of sources) {
    if (source.textOverrides?.textStyle) result.add(source.textOverrides.textStyle);
    if (/^font-[a-f0-9]{64}$/.test(source.textStyle || '')) result.add(source.textStyle);
    for (const tag of (source.html || '').matchAll(/<[^>]+>/g)) {
      const font = attribute(tag[0], 'data-ivo-font');
      if (/^font-[a-f0-9]{64}$/.test(font || '')) result.add(font);
    }
  }
  return result;
}
