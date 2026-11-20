import test from 'node:test';
import assert from 'node:assert/strict';
import { editParagraphs } from '../../src/domain/text/edit-paragraphs.js';

test('inline paste preserves both untouched spaces, rich runs, and the caret after the fragment', () => {
  const plain = [],
    emphasis = ['italic'];
  const pasted = [
    { text: 'light', style: plain },
    { text: '\u00a0blue', style: emphasis },
    { break: true, style: plain },
    { text: 'ink', style: plain },
  ];
  const change = editParagraphs(
    [{ runs: [{ text: 'The green pen', style: plain }] }],
    { paragraph: 0, offset: 4 },
    { paragraph: 0, offset: 9 },
    { type: 'insertInlineFragment', runs: pasted },
  );
  assert.deepEqual(change.replacement[0].runs, [
    { text: 'The ', style: plain },
    ...pasted,
    { text: ' pen', style: plain },
  ]);
  assert.deepEqual(change.caret, { paragraph: 0, offset: 18 });
});

test('a rich inline replacement joins the surviving parts of two selected paragraphs', () => {
  const style = [];
  const rows = ['One old', 'second end'].map((text, block) => ({ block, runs: [{ text, style }] }));
  const result = editParagraphs(
    rows,
    { paragraph: 0, offset: 4 },
    { paragraph: 1, offset: 6 },
    { type: 'insertInlineFragment', runs: [{ text: 'new', style }] },
  );
  assert.deepEqual(result.replacement[0].runs, [
    { text: 'One ', style },
    { text: 'new', style },
    { text: ' end', style },
  ]);
  assert.deepEqual(result.caret, { paragraph: 0, offset: 7 });
  assert.equal(result.replacement[0].block, 0);
});
