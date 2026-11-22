import {
  captureTextSelection,
  restoreTextSelection,
  logicalText,
} from '../../../src/shared/dom/text-selection.js';
import { findTextMatches } from '../../../src/features/editor/text/find-change.js';
import { runningFieldRanges } from '../../../src/domain/documents/running-text.js';

export async function verifyRunningFields(parentHost, assert) {
  const object = parentHost.querySelector('[data-object]:has([data-running-fields])');
  object.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = object.querySelector('[contenteditable="true"]');
  assert(input, 'Parent field could not be opened for inline editing');
  const sel = document.getSelection();
  function select(a, b = a) {
    const point = (index) => ({ kind: 'text', path: [], index, offset: 0, affinity: 'forward' });
    restoreTextSelection(input, { anchor: point(a), focus: point(b) });
  }
  function insert(key) {
    const chooser = parentHost.querySelector('[data-running-field]');
    chooser.value = key;
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const at = logicalText(input).indexOf('«');
  assert(at >= 0, 'Test running field missing');
  select(at);
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
  );
  assert(
    captureTextSelection(input).focus.index === at + '«Current Page Number»'.length,
    'Arrow split a running field',
  );
  input.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(input.textContent === 'Collection 01', 'Backspace damaged part of a parent field');
  select(0);
  insert('section-marker');
  assert(
    input.textContent === '«Section Marker»Collection 01',
    'Insert running text ignored the current caret',
  );
  // A dragged partial selection is normalized before typing, including styled legacy field names.
  input.querySelector('p').innerHTML = '«Section <b>Marker</b>»Collection 01';
  const field = input.querySelector('b').firstChild;
  sel.setBaseAndExtent(field, 5, field, 1);
  input.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'A',
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(
    input.textContent === 'ACollection 01',
    'Reverse replacement left a partial formatted field',
  );
  const replacement = logicalText(input).indexOf('ACollection 01');
  select(replacement, replacement + 1);
  input.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'deleteContentForward',
      bubbles: true,
      cancelable: true,
    }),
  );
  select(logicalText(input).indexOf('Collection 01') + 'Collection 01'.length);
  insert('current-page-number');
  assert(input.textContent === 'Collection 01«Current Page Number»', 'Parent field restore failed');
  const html = '<p>Page «Current <em>Page</em> Number».</p>';
  const matches = findTextMatches([{ id: 'field', html, runningFields: true }], {
    needle: 'Page',
    mode: 'text',
  });
  assert(
    (await matches).length === 1 && runningFieldRanges(input.textContent).length === 1,
    'Find/Change treated a variable name as ordinary writable text',
  );
}
