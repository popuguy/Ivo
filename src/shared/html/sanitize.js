import { footnoteText } from '../../domain/documents/footnotes.js';
import { validEndnoteMarker } from '../../domain/documents/endnotes.js';
import {
  validParagraphId,
  validParagraphKey,
} from '../../domain/documents/paragraph-destinations.js';
import { validCrossReferenceFormat } from '../../domain/documents/cross-references.js';
import { listOrdinal } from '../../domain/text/list-numbering.js';
import { nativeTextAttributes } from '../dom/native-text-format.js';
import { normalizeInlineMetrics } from '../dom/inline-metrics.js';
import { resolveDocumentLink } from '../../domain/knowledge/index.js';
import {
  validTextAttribute,
  TEXT_ATTRIBUTE_NAMES,
  OPENTYPE_FEATURES,
} from '../../domain/text/typography.js';
import { applyTextAttributes } from '../dom/text-attributes.js';
const featureTags = new Set(Object.values(OPENTYPE_FEATURES));
const allowedAttributes = new Set(TEXT_ATTRIBUTE_NAMES);
const TAGS = new Set([
  'DIV',
  'P',
  'BR',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'H2',
  'H3',
  'H4',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'A',
  'SUP',
  'SUB',
  'SPAN',
  'CODE',
]);
const DROP = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'FORM',
  'INPUT',
  'BUTTON',
  'TEXTAREA',
  'HEAD',
  'TITLE',
  'META',
  'BASE',
  'LINK',
]);
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function safeURL(value) {
  const s = String(value || '').trim();
  if (s.startsWith('asset:')) return /^asset:[a-zA-Z0-9_-]+$/.test(s) ? s : '';
  if (/^\.\/public\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(s)) return s;
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
export function cleanHTML(value) {
  // This input is a fragment, including clipboard selections beginning with a
  // space. A document parser discards whitespace before its implicit <body>.
  // Template parsing keeps those source characters and remains inert until the
  // allowlisted copy below has removed executable/resource-bearing markup.
  const source = document.createElement('template');
  source.innerHTML = String(value || '');
  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || DROP.has(node.tagName))
      return document.createTextNode('');
    if (
      !TAGS.has(node.tagName) ||
      (node.tagName === 'SPAN' &&
        (node.hasAttribute('data-ivo-rule-run') ||
          node.hasAttribute('data-ivo-decoration-run') ||
          node.hasAttribute('data-ivo-clipboard-whitespace')))
    ) {
      const frag = document.createDocumentFragment();
      node.childNodes.forEach((c) => frag.append(clean(c)));
      return frag;
    }
    if (
      node.tagName === 'SPAN' &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(node.dataset.ivoAnchor || '')
    ) {
      const text = node.textContent,
        offset = text.indexOf('\uFFFC');
      if (offset < 0) return document.createTextNode(text);
      const fragment = document.createDocumentFragment();
      const marker = document.createElement('span');
      marker.dataset.ivoAnchor = node.dataset.ivoAnchor;
      marker.textContent = '\uFFFC';
      fragment.append(text.slice(0, offset), marker, text.slice(offset + 1));
      return fragment;
    }
    const authored = {};
    for (const attribute of node.attributes) {
      if (!attribute.name.startsWith('data-ivo-')) continue;
      const name = attribute.name.slice(9);
      if (!allowedAttributes.has(name)) continue;
      const valid = validTextAttribute(name, attribute.value);
      if (valid !== null) authored[name] = valid;
    }
    // Named-style CSS is a disposable projection, not a native direct override.
    const native =
      !node.style.length || 'pstyle' in authored || 'cstyle' in authored
        ? {}
        : nativeTextAttributes(node.style);
    // Both flags share one generated CSS property. Do not reinterpret that
    // derived CSS as a newly authored sibling mark on subsequent serialization.
    if ('underline' in authored || 'strike' in authored) {
      delete native.underline;
      delete native.strike;
    }
    const attributes = { ...native, ...authored };
    const out = document.createElement(node.tagName.toLowerCase());
    if (
      node.tagName === 'SPAN' &&
      node.hasAttribute('data-footnote') &&
      footnoteText(node.dataset.footnote) !== null
    )
      out.dataset.footnote = node.dataset.footnote;
    if (/^(P|H[234])$/.test(node.tagName) && validParagraphId(node.dataset.paragraphDestination))
      out.dataset.paragraphDestination = node.dataset.paragraphDestination;
    const counter = node.tagName === 'OL' ? 'start' : node.tagName === 'LI' ? 'value' : null;
    if (node.tagName === 'OL' && node.dataset.ivoListSeries === 'default')
      out.dataset.ivoListSeries = 'default';
    if (counter && !node.hasAttribute('data-flow-list-start')) {
      const ordinal = listOrdinal(node.getAttribute(counter));
      if (ordinal !== null) out.setAttribute(counter, String(ordinal));
    }
    node.childNodes.forEach((c) => out.append(clean(c)));
    // Older editors nested a new run for each OpenType toggle. A lone child
    // inherits all flags, with its own flags taking precedence (including Off).
    // Keep links, sibling runs, named styles and line-metric boundaries intact.
    if (
      out.tagName === 'SPAN' &&
      Object.keys(attributes).length &&
      Object.keys(attributes).every((name) => featureTags.has(name)) &&
      out.childNodes.length === 1 &&
      out.firstChild.nodeName === 'SPAN'
    ) {
      const child = out.firstChild;
      const flags = [...child.attributes].filter((attr) => attr.name !== 'style');
      if (flags.length && flags.every((attr) => featureTags.has(attr.name.slice(9)))) {
        for (const attr of flags) attributes[attr.name.slice(9)] = attr.value;
        child.replaceWith(...child.childNodes);
      }
    }
    if (Object.keys(attributes).length) {
      for (const name of TEXT_ATTRIBUTE_NAMES)
        if (attributes[name] !== undefined) out.setAttribute('data-ivo-' + name, attributes[name]);
      applyTextAttributes(out, attributes);
    }
    if (node.tagName === 'A') {
      const target = node.getAttribute('data-doc-id');
      const href = safeURL(node.getAttribute('href'));
      if (target && /^[\w-]{1,120}$/.test(target)) {
        out.dataset.docId = target;
        if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(node.dataset.pageId || ''))
          out.dataset.pageId = node.dataset.pageId;
        out.href = '#doc=' + encodeURIComponent(target);
      } else if (/^#page=[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(node.getAttribute('href') || '')) {
        out.setAttribute('href', node.getAttribute('href'));
        if (validEndnoteMarker(node.dataset.endnote)) out.dataset.endnote = node.dataset.endnote;
      } else if (href) {
        out.href = href;
        out.target = '_blank';
        out.rel = 'noopener noreferrer';
      }
      if (
        (out.dataset.pageId || out.getAttribute('href')?.startsWith('#page=')) &&
        validCrossReferenceFormat(node.dataset.xrefFormat) &&
        (node.dataset.xrefFormat !== 'paragraph-text' ||
          validParagraphKey(node.dataset.xrefParagraph))
      ) {
        out.dataset.xrefFormat = node.dataset.xrefFormat;
        if (validParagraphKey(node.dataset.xrefParagraph))
          out.dataset.xrefParagraph = node.dataset.xrefParagraph;
      }
    }
    return out;
  }
  const host = document.createElement('div');
  source.content.childNodes.forEach((n) => host.append(clean(n)));
  normalizeInlineMetrics(host);
  return host.innerHTML;
}
export function readableHTML(
  html,
  documents,
  sourceId = null,
  { preserveWikiText = false, trustedFlow = false } = {},
) {
  const node = document.createElement('div');
  node.innerHTML = trustedFlow ? html : cleanHTML(html);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const leaves = [];
  while (walker.nextNode())
    if (!walker.currentNode.parentElement.closest('a,code')) leaves.push(walker.currentNode);
  for (const text of leaves) {
    const origin = text.parentElement.closest('[data-flow-text]'),
      base = origin ? Number(origin.dataset.flowText) : null;
    const append = (fragment, value, index) => {
      if (base === null) {
        fragment.append(value);
        return;
      }
      const span = document.createElement('span');
      span.dataset.flowText = base + index;
      span.textContent = value;
      fragment.append(span);
    };
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let match,
      last = 0;
    const fragment = document.createDocumentFragment();
    while ((match = re.exec(text.data))) {
      append(fragment, text.data.slice(last, match.index), last);
      const target = resolveDocumentLink(documents, match[1], sourceId);
      const a = document.createElement('a');
      if (base !== null) a.dataset.flowText = base + match.index;
      a.textContent = preserveWikiText ? match[0] : match[2] || match[1];
      if (target) {
        a.dataset.docId = target;
        a.href = '#doc=' + encodeURIComponent(target);
      } else {
        a.className = 'unresolved';
        a.title = 'Unresolved or ambiguous document link';
      }
      fragment.append(a);
      last = re.lastIndex;
    }
    if (last) {
      append(fragment, text.data.slice(last), last);
      text.replaceWith(fragment);
    }
  }
  return node.innerHTML;
}
