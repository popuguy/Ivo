const owned = new WeakMap();
export const DEFAULT_TAB_INTERVAL = 36; // Document points: InDesign's default half inch.

const blocks = 'p,div,li,blockquote,h1,h2,h3,h4,h5,h6';

/** Preserve authored spaces/tabs through paint; no whitespace CSS enters saved source. */
export function applyTextWhitespace(root) {
  for (const [node, prior] of owned.get(root) || []) {
    node.style.whiteSpace = prior.whiteSpace;
    node.style.tabSize = prior.tabSize;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT),
    paragraphs = new Map();
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== Node.TEXT_NODE && node.nodeName !== 'BR') continue;
    const closest = node.parentElement.closest(blocks),
      block = closest && root.contains(closest) ? closest : root,
      text = node.nodeType === Node.TEXT_NODE ? node.data : '\n';
    // Pretty-printed HTML may indent between actual paragraphs. Like the native
    // source projection, do not turn those structural separators into text lines.
    if (!/[^ \t\r\n\f]/.test(text) && block.querySelector(blocks)) continue;
    paragraphs.set(block, (paragraphs.get(block) || '') + text);
  }
  const next = new Map();
  for (const [block, text] of paragraphs) {
    if (!/\t| {2}|^ | $|\n | \n/.test(text)) continue;
    next.set(block, { whiteSpace: block.style.whiteSpace, tabSize: block.style.tabSize });
    block.style.whiteSpace = 'pre-wrap';
    block.style.tabSize = DEFAULT_TAB_INTERVAL + 'px';
  }
  owned.set(root, next);
}
