const owned = new WeakMap();
export const DEFAULT_TAB_INTERVAL = 36; // Document points: InDesign's default half inch.

/** Disposable whitespace projection; literal U+0009 remains the only saved source. */
export function applyDefaultTabs(root) {
  for (const [node, prior] of owned.get(root) || []) {
    node.style.whiteSpace = prior.whiteSpace;
    node.style.tabSize = prior.tabSize;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    blocks = new Set();
  let node;
  while ((node = walker.nextNode())) {
    if (!node.data.includes('\t')) continue;
    const block = node.parentElement.closest('p,div,li,blockquote,h1,h2,h3,h4,h5,h6');
    blocks.add(block && root.contains(block) ? block : root);
  }
  const next = new Map();
  for (const block of blocks) {
    next.set(block, { whiteSpace: block.style.whiteSpace, tabSize: block.style.tabSize });
    block.style.whiteSpace = 'pre-wrap';
    block.style.tabSize = DEFAULT_TAB_INTERVAL + 'px';
  }
  owned.set(root, next);
}
