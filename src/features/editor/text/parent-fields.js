import { runningFieldEdge, runningFieldRanges } from '../../../domain/documents/running-text.js';
import {
  captureTextSelection,
  logicalText,
  restoreTextSelection,
} from '../../../shared/dom/text-selection.js';

/** Attach only to the disposable parent-page editor; ordinary typing never
 * scans fields. Field names remain editable as a unit across legacy style runs. */
export function protectParentFieldSelections(overlay) {
  function normalize(event) {
    const root = event.target.closest?.('[data-running-fields][contenteditable="true"]');
    if (!root) return;
    const selection = captureTextSelection(root);
    if (!selection) return;
    const { anchor, focus } = selection;
    const fields = runningFieldRanges(logicalText(root));
    let a = anchor.index,
      b = focus.index;
    const right = event.key === 'ArrowRight';
    const arrow =
      event.type === 'keydown' &&
      (right || event.key === 'ArrowLeft') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (arrow) {
      if (!event.shiftKey && a !== b) return;
      const step = right ? 1 : -1;
      const edge = runningFieldEdge(fields, b + step, right ? 'end' : 'start');
      if (edge === b + step) return;
      b = edge;
      if (!event.shiftKey) a = b;
      event.preventDefault();
      event.stopPropagation();
    } else if (a === b) a = b = runningFieldEdge(fields, a, 'nearest');
    else {
      const forward = a < b;
      a = runningFieldEdge(fields, a, forward ? 'start' : 'end');
      b = runningFieldEdge(fields, b, forward ? 'end' : 'start');
    }
    if (anchor.index !== a || focus.index !== b)
      restoreTextSelection(
        root,
        { anchor: { ...anchor, index: a }, focus: { ...focus, index: b } },
        { focus: false },
      );
  }
  for (const event of [
    'pointerup',
    'keydown',
    'beforeinput',
    'compositionstart',
    'copy',
    'cut',
    'paste',
  ])
    overlay.addEventListener(event, normalize, true);
}
