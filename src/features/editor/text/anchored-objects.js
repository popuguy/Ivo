import { anchorObject } from '../../../domain/documents/anchored-objects.js';
import { LIMITS } from '../../../domain/documents/constants.js';
import { objectAvailable } from '../../../domain/documents/publishing.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { rangeFromBookmark, textIndexMap } from '../../../shared/dom/text-selection.js';
import { cleanHTML } from '../../../shared/html/sanitize.js';

/** Insert into the complete flow, including when the caret is in a continuation. */
export function insertAnchoredObject(doc, frame, bookmark, block, position = 'inline') {
  const flow = textFlowForFrame(doc, frame);
  const source = flow || frame;
  if (
    !bookmark ||
    !objectAvailable(doc, frame) ||
    !['text', 'quote'].includes(frame?.type) ||
    source.contents ||
    source.index ||
    !objectAvailable(doc, block)
  )
    throw Error(
      'Place the insertion point in an unlocked text frame and choose an unlocked object.',
    );
  const root = document.createElement('div');
  root.innerHTML = source.html;
  const at = Math.max(bookmark.anchor.index, bookmark.focus.index);
  if (at > textIndexMap(root).boundaries.get(root).at(-1))
    throw Error('The insertion point is no longer available.');
  const point = { path: [], offset: 0, index: at, kind: 'text', affinity: 'forward' };
  const range = rangeFromBookmark(root, { anchor: point, focus: point });
  if (!range) throw Error('The insertion point is no longer available.');
  const container =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  const previous = container.closest('[data-ivo-anchor]');
  if (previous) {
    const [start] = textIndexMap(root).boundaries.get(previous);
    if (start === at) range.setStartBefore(previous);
    else range.setStartAfter(previous);
    range.collapse(true);
  }
  const marker = document.createElement('span');
  marker.dataset.ivoAnchor = block.id;
  marker.textContent = '\uFFFC';
  range.insertNode(marker);
  const html = cleanHTML(root.innerHTML);
  if (html.length > LIMITS.html) throw Error('The object would exceed the document text limit.');
  anchorObject(doc, block, source.id, position);
  source.html = html;
  return { flowId: flow?.id, frameId: frame.id, start: at + 1, end: at + 1 };
}
