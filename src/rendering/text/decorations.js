import { scaleBreakPlanner } from './scale-breaks.js';
import { applyCharacterScale } from './character-scale.js';
import { TEXT_DEFAULTS } from '../../domain/text/typography.js';
import { resolvedTextStyle } from '../../domain/documents/publishing.js';
import { captureTextSelection, restoreTextSelection } from '../../shared/dom/text-selection.js';
import { nodeTextStyle } from './selection-style.js';

const contexts = new WeakMap(),
  composing = new WeakSet();
const marker = 'data-ivo-decoration-run';
function ownsUnderline(node, doc) {
  if (node.hasAttribute('data-ivo-underline') || node.tagName === 'U') return true;
  return ['paragraph', 'character'].some((kind) => {
    const id = node.getAttribute('data-ivo-' + (kind === 'paragraph' ? 'pstyle' : 'cstyle'));
    return id && resolvedTextStyle(doc, kind, id).underline !== undefined;
  });
}
function observeComposition(root) {
  root.addEventListener('compositionstart', () => composing.add(root));
  root.addEventListener('compositionend', () => {
    composing.delete(root);
    queueMicrotask(() => {
      const context = contexts.get(root);
      if (root.isConnected && context && !composing.has(root))
        applyTextDecorations(root, context.doc);
    });
  });
}
function classOn(node, name) {
  if (!node.classList.contains(name)) node.classList.add(name);
}

/**
 * CSS cannot cancel a decoration painted by an ancestor. Keep source declarations
 * intact, suppress that ancestor paint, and decorate effective text runs instead.
 * These transparent inline wrappers never own fonts, metrics or canonical text.
 */
export function applyTextDecorations(root, doc) {
  // Native glyphs own horizontal advances. The hidden input still supplies
  // the OS caret height for IME, including vertically scaled inline runs.
  const flowId = root.dataset.textFlow;
  const nativeInput =
    flowId && doc.textFlows?.some((flow) => flow.id === flowId && flow.composition);
  if (!contexts.has(root)) observeComposition(root);
  contexts.set(root, { doc });
  if (composing.has(root)) return false;
  const bookmark = captureTextSelection(root),
    plans = [];
  let changed = false,
    paragraph = 0;
  const staleJoins = new Set(root.querySelectorAll('[data-ivo-scale-join]'));
  // Native editing may split a derived run. Remove only its view wrapper; retain
  // the existing text/format nodes and restore any parent-offset selection below.
  for (const wrapper of root.querySelectorAll('span[' + marker + ']')) {
    if (staleJoins.has(wrapper)) continue;
    if (wrapper.childNodes.length === 1 && wrapper.firstChild.nodeType === Node.TEXT_NODE) continue;
    wrapper.replaceWith(...wrapper.childNodes);
    changed = true;
  }
  function visit(node, inherited, link = null) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.length)
        plans.push({
          node,
          line: [
            inherited.underline || link ? 'underline' : '',
            inherited.strikethrough ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' '),
          link,
          horizontalScale: nativeInput ? 100 : inherited.horizontalScale,
          verticalScale: inherited.verticalScale,
          paragraph,
        });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('p,div,blockquote,li,h1,h2,h3,h4,h5,h6,br')) paragraph++;
    if (node.hasAttribute(marker)) {
      for (const child of node.childNodes) visit(child, inherited, link);
      return;
    }
    const style = nodeTextStyle(node, inherited, doc);
    // Hyperlink decoration is a view affordance. Explicit run/character styling
    // inside a link still controls its underline, independently of link color.
    if (node !== root && ownsUnderline(node, doc)) link = null;
    if (
      node.tagName === 'A' &&
      !ownsUnderline(node, doc) &&
      (node.hasAttribute('href') || node.classList.contains('unresolved'))
    )
      link = node.classList.contains('unresolved') ? 'unresolved' : 'link';
    classOn(node, 'ivo-decoration-source');
    for (const child of node.childNodes) visit(child, style, link);
  }
  visit(root, TEXT_DEFAULTS);
  const hasScale = plans.some((plan) => plan.horizontalScale !== 100 || plan.verticalScale !== 100);
  const planner = hasScale ? scaleBreakPlanner(root, plans) : null;
  const prepared = hasScale ? [] : plans;
  if (planner)
    for (const plan of plans) {
      const { node, horizontalScale, verticalScale } = plan;
      const scaled = horizontalScale !== 100 || verticalScale !== 100;
      const prior = node.parentElement;
      const scope = prior.hasAttribute(marker) ? prior.parentElement : prior;
      const words = planner.parts(plan);
      if (words && words.length > 1) {
        if (prior.hasAttribute(marker)) prior.replaceWith(node);
        const fragment = document.createDocumentFragment();
        let offset = 0;
        for (const word of words) {
          const part = document.createTextNode(word);
          fragment.append(part);
          prepared.push({
            ...plan,
            node: part,
            scaled,
            scope,
            source: node,
            start: offset,
            end: offset + word.length,
          });
          offset += word.length;
        }
        node.replaceWith(fragment);
        changed = true;
      } else prepared.push({ ...plan, scaled, scope, source: node, start: 0, end: node.length });
    }
  let previous;
  for (const plan of prepared) {
    const { node, line, link, horizontalScale, verticalScale, scaled } = plan;
    const boundary = planner?.boundary(previous, plan);
    previous = plan;
    const first = node.parentElement.hasAttribute(marker) ? node.parentElement : node;
    if (boundary) {
      let guard = first.previousSibling;
      if (!guard?.hasAttribute?.('data-ivo-scale-join')) {
        guard = document.createElement('span');
        guard.setAttribute(marker, '');
        guard.setAttribute('aria-hidden', 'true');
        first.before(guard);
        changed = true;
      }
      guard.dataset.ivoScaleJoin = boundary;
      staleJoins.delete(guard);
    }
    let wrapper = node.parentElement.hasAttribute(marker) ? node.parentElement : null;
    if (!line && !scaled) {
      if (wrapper) {
        wrapper.replaceWith(node);
        changed = true;
      }
      continue;
    }
    if (!wrapper) {
      wrapper = document.createElement('span');
      wrapper.setAttribute(marker, '');
      wrapper.className = 'ivo-decoration-run';
      node.replaceWith(wrapper);
      wrapper.append(node);
      changed = true;
    }
    applyCharacterScale(wrapper, horizontalScale, verticalScale);
    wrapper.toggleAttribute('data-ivo-scale-hyphen', scaled && planner.visibleHyphen(plan));
    if (wrapper.style.textDecorationLine !== line) {
      wrapper.style.textDecorationLine = line;
      changed = true;
    }
    if (link) {
      if (wrapper.dataset.ivoDecorationLink !== link) {
        wrapper.dataset.ivoDecorationLink = link;
        changed = true;
      }
    } else if (wrapper.hasAttribute('data-ivo-decoration-link')) {
      wrapper.removeAttribute('data-ivo-decoration-link');
      changed = true;
    }
  }
  planner?.dispose();
  for (const guard of staleJoins) {
    guard.remove();
    changed = true;
  }
  if (changed && bookmark) restoreTextSelection(root, bookmark, { focus: false });
  return changed;
}
