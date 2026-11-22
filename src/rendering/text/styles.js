import { paintConditionalText } from './paragraph-style-rules.js';
import { captureTextSelection, restoreTextSelection } from '../../shared/dom/text-selection.js';
import { paintListNumbers } from '../../shared/dom/list-numbering.js';
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
import { sizeAnchorSites } from './anchor-sites.js';
import { applyTextWhitespace } from './whitespace.js';
const paintedRuleRoots = new WeakSet();
const owned = new WeakMap(),
  featuresOwned = new WeakSet();
const features = Object.entries(OPENTYPE_FEATURES);
const featureSelector = features.map(([, tag]) => '[data-ivo-' + tag + ']').join(',');

/** Resolve style references into disposable CSS only. Definitions/overrides remain the source. */
export function applyNamedTextStyles(root, doc) {
  if (
    !root.hasAttribute('data-flow-root') &&
    !root.hasAttribute('data-flow-frame') &&
    (root.dataset.sceneText || root.dataset.textFlow)
  ) {
    const hadRules = paintedRuleRoots.has(root),
      hasRules = doc?.publishing?.paragraphStyles.some(
        (s) => s.nestedStyles?.length || s.grepStyles?.length,
      );
    if (hadRules || hasRules) {
      const flow = doc.textFlows?.find((f) => f.id === root.dataset.textFlow);
      if (!flow?.composition) {
        const bookmark = captureTextSelection(root);
        if (hadRules)
          for (const span of root.querySelectorAll('[data-ivo-rule-run]'))
            span.replaceWith(...span.childNodes);
        if (hasRules) {
          const settings = flow?.style || doc.blocks?.find((b) => b.id === root.dataset.sceneText);
          paintConditionalText(root, doc, settings);
          paintedRuleRoots.add(root);
        } else paintedRuleRoots.delete(root);
        if (bookmark) restoreTextSelection(root, bookmark);
      }
    }
  }
  // The editable projection replaces the painted column while typing. Its object
  // markers must reserve the same space as the column's markers.
  if (root.matches('.canvas-flow-input[data-text-flow]')) sizeAnchorSites(root, doc);
  paintListNumbers(root);
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
      explicit =
        node.matches(featureSelector) ||
        ['paragraph', 'character'].some((kind) => {
          const id = node.getAttribute(
            kind === 'paragraph' ? 'data-ivo-pstyle' : 'data-ivo-cstyle',
          );
          if (!id) return false;
          const named = resolvedTextStyle(doc, kind, id);
          return features.some(([key]) => named[key] !== undefined);
        });
    if (explicit) {
      node.style.fontFeatureSettings = features
        .filter(([key, tag]) => !tag.startsWith('ss') || style[key])
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
