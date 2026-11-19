import { applyTextDecorations } from './decorations.js';
import { resolvedTextStyle } from '../../domain/documents/publishing.js';
import {
  CHARACTER_FIELDS,
  PARAGRAPH_FIELDS,
  OPENTYPE_FEATURES,
  TEXT_DEFAULTS,
} from '../../domain/text/typography.js';
import { applyTextAttributes } from '../../shared/dom/text-attributes.js';
import { nodeTextStyle } from './selection-style.js';
import { applyTextWhitespace } from './whitespace.js';
const owned = new WeakMap(),
  featuresOwned = new WeakSet();

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
    for (const key of owned.get(node) || []) node.style.removeProperty(key);
    for (const key of proxy.style) node.style.setProperty(key, proxy.style.getPropertyValue(key));
    owned.set(node, [...proxy.style]);
    if (proxy.lang) node.lang = proxy.lang;
  }
  const visit = (node, inherited) => {
    const style = nodeTextStyle(node, inherited, doc),
      explicit = Object.entries(OPENTYPE_FEATURES).some(
        ([key, tag]) =>
          node.hasAttribute('data-ivo-' + tag) ||
          ['paragraph', 'character'].some((kind) => {
            const id = node.getAttribute(
              'data-ivo-' + (kind === 'paragraph' ? 'pstyle' : 'cstyle'),
            );
            return id && resolvedTextStyle(doc, kind, id)[key] !== undefined;
          }),
      );
    if (explicit) {
      node.style.fontFeatureSettings = Object.entries(OPENTYPE_FEATURES)
        .map(([key, tag]) => `"${tag}" ${style[key] ? 1 : 0}`)
        .join(',');
      featuresOwned.add(node);
    } else if (featuresOwned.has(node)) {
      node.style.removeProperty('font-feature-settings');
      featuresOwned.delete(node);
    }
    for (const child of node.children) visit(child, style);
  };
  visit(root, TEXT_DEFAULTS);
  applyTextDecorations(root, doc);
  applyTextWhitespace(root);
}
