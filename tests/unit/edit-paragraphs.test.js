import test from 'node:test';
import assert from 'node:assert/strict';
import { editParagraphs } from '../../src/domain/text/edit-paragraphs.js';

const run = (text, style) => ({ text, style });
const pos = (paragraph, offset) => ({ paragraph, offset });
const para = (block, ...runs) => ({ block, runs });
const doc = [
  para('left', run('First ', 'body'), run('blue', 'link')),
  para('middle', run('middle', 'italic')),
  para('right', run('Third', 'regular'), run(' end', 'bold')),
];
const apply = (source, change) => [
  ...source.slice(0, change.from),
  ...change.replacement,
  ...source.slice(change.through + 1),
];
test('forward and reversed multi-paragraph replacements retain unaffected rich runs and one caret', () => {
  const start = pos(0, 8),
    end = pos(2, 3),
    input = { type: 'insertReplacementText', text: ' + ' };
  const previous = structuredClone(doc);
  const change = editParagraphs(doc, end, start, input);
  assert.deepEqual(change, editParagraphs(doc, start, end, input));
  assert.deepEqual(apply(doc, change)[0].runs, [
    run('First ', 'body'),
    run('bl', 'link'),
    run(' + ', 'link'),
    run('rd', 'regular'),
    run(' end', 'bold'),
  ]);
  assert.equal(change.replacement[0].block, 'left');
  assert.deepEqual(change.caret, pos(0, 11));
  assert.deepEqual(doc, previous);
});
test('structural joins work in both directions and consume exactly one blank paragraph', () => {
  const source = [doc[0], para('blank'), doc[2]];
  for (const [type, caret] of [
    ['deleteContentBackward', pos(1, 0)],
    ['deleteContentForward', pos(0, 10)],
  ]) {
    const edit = editParagraphs(source, caret, caret, { type });
    const after = apply(source, edit);
    assert.deepEqual(after[0].runs, doc[0].runs);
    assert.equal(after[1], doc[2]);
    assert.deepEqual(edit.caret, pos(0, 10));
  }
  assert.equal(
    editParagraphs(source, pos(0, 0), pos(0, 0), { type: 'deleteContentBackward' }),
    null,
  );
});
test('a grapheme split over formatting runs deletes as one in either direction', () => {
  const source = [para('p', run('A👩', 'italic'), run('🏽‍💻B', 'regular'))];
  for (const [type, offset] of [
    ['deleteContentBackward', 1 + '👩🏽‍💻'.length],
    ['deleteContentForward', 1],
  ]) {
    const caret = pos(0, offset);
    const edit = editParagraphs(source, caret, caret, { type });
    assert.deepEqual(edit.replacement[0].runs, [run('A', 'italic'), run('B', 'regular')]);
    assert.deepEqual(edit.caret, pos(0, 1));
  }
  const edit = editParagraphs(source, pos(0, 2), pos(0, 4), {
    type: 'insertText',
    text: 'é',
    style: 'bold',
  });
  assert.deepEqual(edit.replacement[0].runs, [
    run('A', 'italic'),
    run('é', 'bold'),
    run('B', 'regular'),
  ]);
});
test('paragraph and soft breaks distinguish layout, preserving paragraph and insertion styles', () => {
  const point = pos(0, 10);
  const enter = editParagraphs(doc, point, point, { type: 'insertParagraph' });
  assert.deepEqual(
    enter.replacement.map((p) => p.block),
    ['left', 'left'],
  );
  assert.deepEqual(enter.replacement[1].runs, []);
  assert.equal(enter.replacement[1].emptyStyle, 'link');
  assert.deepEqual(enter.caret, pos(1, 0));
  const result = apply(doc, enter);
  const type = editParagraphs(result, pos(1, 0), pos(1, 0), {
    type: 'insertText',
    text: ' leading ',
  });
  assert.deepEqual(type.replacement[0].runs, [run(' leading ', 'link')]);
  const soft = editParagraphs(doc, point, point, { type: 'insertLineBreak' });
  assert.deepEqual(soft.replacement[0].runs.at(-1), { break: true, style: 'link' });
  assert.deepEqual(soft.caret, pos(0, 11));
});
test('directional word deletion matches word, punctuation, space, and return boundaries', () => {
  for (const [marked, backward, expected] of [
    ['One two| three', true, 'One three'],
    ['One t|wo three', true, 'One wo three'],
    ['One |two three', true, 'two three'],
    ['One |two three', false, 'One three'],
    ['One t|wo three', false, 'One tthree'],
    ['One two| three', false, 'One twothree'],
    ['one|   two', true, '   two'],
    ['one,  |two-three!', true, 'onetwo-three!'],
    ['one|,  two-three!', false, 'onetwo-three!'],
    ['a\t|\tb', true, 'a\tb'],
    ['a|\t\tb', false, 'a\tb'],
    ['ab|...!? cd', false, 'abcd'],
    ['A|👩🏽‍💻 B', false, 'AB'],
    ['A\n|B', true, 'AB'],
    ['A|\nB', false, 'AB'],
    ['hello|', false, 'hello'],
    ['|hello', true, 'hello'],
  ]) {
    const original = marked.replace('|', '');
    const source = [para('p', run(original, 'regular'))];
    const caret = pos(0, marked.indexOf('|'));
    const edit = editParagraphs(source, caret, caret, {
      type: backward ? 'deleteWordBackward' : 'deleteWordForward',
    });
    assert.equal(
      edit ? edit.replacement[0].runs.map((r) => r.text).join('') : original,
      expected,
      marked,
    );
  }
});
