import {
  captureTextSelection,
  logicalText,
  restoreTextSelection,
  textParagraphRanges,
} from '../../shared/dom/text-selection.js';
import { createTextNavigation } from '../../domain/text/flow-selection.js';

const navigationCache = new WeakMap();

// A standalone frame uses the editable surface's laid-out lines. A threaded
// flow has its own composed rows and never calls this adapter.
export function moveSingleFrameSelection(root, move, viewportHeight, revision) {
  if (move.unit === 'grapheme' || move.unit === 'adjacent-line') return false;
  const selection = root.ownerDocument.getSelection();
  if (!selection.rangeCount || !root.contains(selection.focusNode)) return false;
  const forward = move.direction === 'forward';
  if (move.unit === 'line-boundary') {
    selection.modify(move.extend ? 'extend' : 'move', forward ? 'right' : 'left', 'lineboundary');
    return true;
  }
  if (move.unit !== 'screen') {
    const range = captureTextSelection(root);
    if (!range) return false;
    let cached = navigationCache.get(root);
    if (!cached || cached.revision !== revision) {
      cached = {
        revision,
        index: createTextNavigation(logicalText(root), { paragraphs: textParagraphRanges(root) }),
      };
      navigationCache.set(root, cached);
    }
    const next = cached.index.selection(range, move);
    const point = (p) => ({ ...p, path: [], kind: 'text', offset: 0 });
    return restoreTextSelection(root, { anchor: point(next.anchor), focus: point(next.focus) });
  }
  const caret = root.ownerDocument.createRange();
  const position = () => {
    caret.setStart(selection.focusNode, selection.focusOffset);
    caret.collapse(true);
    return caret.getBoundingClientRect().y;
  };
  const start = position(),
    anchor = selection.anchorNode,
    offset = selection.anchorOffset;
  selection.collapse(selection.focusNode, selection.focusOffset);
  for (;;) {
    const node = selection.focusNode,
      at = selection.focusOffset;
    selection.modify('move', move.direction, 'line');
    if (!root.contains(selection.focusNode)) {
      selection.collapse(node, at);
      break;
    }
    if (
      (selection.focusNode === node && selection.focusOffset === at) ||
      Math.abs(position() - start) >= viewportHeight
    )
      break;
  }
  if (move.extend)
    selection.setBaseAndExtent(anchor, offset, selection.focusNode, selection.focusOffset);
  return true;
}
