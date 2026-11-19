import { insertObject } from '../../../src/domain/documents/scene.js';
import { layoutDocumentTextFlows } from '../../../src/rendering/text/flow-layout.js';
import { flowInputHTML } from '../../../src/rendering/text/flow-input.js';
import {
  captureTextSelection,
  restoreTextSelection,
} from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export function verifyWrapLayoutFailureFences(document, continuationId) {
  const attempts = [
    [
      'center continuation',
      (doc) => {
        doc.blocks.find((b) => b.id === continuationId).frameOptions = { verticalAlign: 'center' };
      },
      /Top vertical alignment/,
    ],
    [
      'bottom continuation',
      (doc) => {
        doc.blocks.find((b) => b.id === continuationId).frameOptions = { verticalAlign: 'bottom' };
      },
      /Top vertical alignment/,
    ],
    [
      'rotated continuation',
      (doc) => {
        doc.blocks.find((b) => b.id === continuationId).rotation = 15;
      },
      /unrotated/,
    ],
    [
      'rotated containing group',
      (doc) => {
        const frame = doc.blocks.find((b) => b.id === continuationId),
          group = insertObject(doc, 'polygon', frame.pageId, {
            x: 0,
            y: 0,
            w: 600,
            h: 660,
            rotation: 15,
            stroke: 'none',
            strokeWidth: 0,
          });
        frame.parentId = group.id;
      },
      /unrotated/,
    ],
    [
      'superscript source',
      (doc) => {
        doc.textFlows[0].html = '<p>Base<sup>raised</sup></p>';
      },
      /superscript\/subscript/,
    ],
    [
      'subscript source',
      (doc) => {
        doc.textFlows[0].html = '<p>Base<sub>lowered</sub></p>';
      },
      /superscript\/subscript/,
    ],
  ];
  for (const [label, change, expected] of attempts) {
    const doc = structuredClone(document);
    change(doc);
    const before = JSON.stringify(doc);
    let message = '';
    try {
      layoutDocumentTextFlows(doc, { allowPages: false });
    } catch (error) {
      message = error.message;
    }
    assert(
      expected.test(message),
      'Unsupported wrapped ' + label + ' did not reject explicitly: ' + message,
    );
    assert(JSON.stringify(doc) === before, 'Rejecting wrapped ' + label + ' wrote document state');
  }
  return {
    unsupportedFrameFence: true,
    containingGroupFence: true,
    unsupportedSemanticSourceFence: true,
  };
}

const historyState = (history) =>
  JSON.stringify({
    size: history.size,
    undo: history.canUndo,
    redo: history.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
  });
const logicalRange = (input) => {
  const value = captureTextSelection(input);
  return value && { anchor: value.anchor.index, focus: value.focus.index };
};
export async function verifyWrappedTransactionFailure({
  host,
  getDocument,
  editor,
  history,
  getCommits,
  notices,
}) {
  const input = () => host.querySelector('.canvas-flow-input'),
    selected = input();
  selected.focus();
  const initialSelection = captureTextSelection(selected);
  assert(initialSelection, 'Rollback fixture lost its active source selection');
  const assertUnchanged = (snapshot, label, noticePattern) => {
    assert(
      JSON.stringify(getDocument()) === snapshot.document,
      label + ' left partial source/derived document changes',
    );
    assert(
      historyState(history) === snapshot.history && getCommits() === snapshot.commits,
      label + ' changed history or emitted a commit',
    );
    assert(
      flowInputHTML(input()) === snapshot.domSource,
      label + ' did not restore the DOM source',
    );
    assert(
      JSON.stringify(logicalRange(input())) === JSON.stringify(snapshot.selection),
      label + ' changed the selected source interval',
    );
    const messages = notices.splice(snapshot.notices);
    assert(
      messages.length === 1 && noticePattern.test(messages[0]),
      label + ' did not provide one useful notice: ' + JSON.stringify(messages),
    );
  };
  const snapshot = () => ({
    document: JSON.stringify(getDocument()),
    history: historyState(history),
    commits: getCommits(),
    domSource: flowInputHTML(input()),
    selection: logicalRange(input()),
    notices: notices.length,
  });
  const pasteBefore = snapshot(),
    transfer = new DataTransfer();
  transfer.setData('text/plain', 'X'.repeat(200010));
  selected.dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
  );
  await tick();
  await editor.flush();
  await tick();
  assertUnchanged(
    pasteBefore,
    'Over-budget wrapped paste',
    /200,?000.*source positions|source.*budget/i,
  );
  for (const key of ['hyphenate', 'keepTogether']) {
    const current = input();
    current.focus();
    assert(
      restoreTextSelection(current, initialSelection),
      'Could not restore rollback property scope',
    );
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    const control = host.querySelector(`[data-object-prop="${key}"]`);
    assert(
      control && !control.disabled,
      'Rollback fixture did not use the actual Properties control: ' + key,
    );
    const detail = control.closest('details');
    if (detail) detail.open = true;
    const propertyBefore = snapshot();
    control.focus();
    control.checked = true;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    await editor.flush();
    await tick();
    assertUnchanged(propertyBefore, 'Unsupported wrapped ' + key, /hyphenation|keep overrides/i);
    assert(
      !host.querySelector(`[data-object-prop="${key}"]`).checked,
      'Rejected Properties checkbox retained its checked state: ' + key,
    );
  }
  return {
    budgetPasteRollback: true,
    unsupportedPropertyRollback: true,
    failureSelectionHistoryPreserved: true,
  };
}
