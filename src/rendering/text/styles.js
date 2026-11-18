import { resolvedTextStyle } from '../../domain/documents/publishing.js';
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../../domain/text/typography.js';
import { applyTextAttributes } from '../../shared/dom/text-attributes.js';

/** Resolve style references into disposable CSS only. Definitions/overrides remain the source. */
export function applyNamedTextStyles(root, doc) {
  for (const node of root.querySelectorAll('[data-ivo-pstyle],[data-ivo-cstyle]')) {
    const p = node.getAttribute('data-ivo-pstyle'),
      c = node.getAttribute('data-ivo-cstyle');
    if (!p && !c) continue;
    const effective = {
        ...resolvedTextStyle(doc, 'paragraph', p),
        ...resolvedTextStyle(doc, 'character', c),
      },
      proxy = document.createElement('span');
    for (const [key, value] of Object.entries(effective))
      proxy.setAttribute(
        'data-ivo-' + (CHARACTER_FIELDS[key] || PARAGRAPH_FIELDS[key]),
        String(value),
      );
    for (const attr of node.attributes)
      if (attr.name.startsWith('data-ivo-')) proxy.setAttribute(attr.name, attr.value);
    applyTextAttributes(proxy);
    for (const key of proxy.style) node.style.setProperty(key, proxy.style.getPropertyValue(key));
    if (proxy.lang) node.lang = proxy.lang;
  }
}
