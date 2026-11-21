import test from 'node:test';
import assert from 'node:assert/strict';
import { scanGrep } from '../../src/features/editor/text/grep-worker.js';
import { replacementParts } from '../../src/features/editor/text/grep.js';

const hits = (text, needle) => scanGrep({ texts: [text], needle, caseSensitive: true })[0];
test('GREP uses paragraph and flow edges, Unicode words and UTF-16 capture positions', () => {
  assert.deepEqual(
    hits('🌿uno\ndos\rtres', '^|$').map((m) => m[0]),
    [
      [0, 0],
      [9, 9],
      [10, 10],
      [14, 14],
    ],
  );
  assert.deepEqual(
    hits('éти β́\t１２', String.raw`\b(\w+)\b`).map((m) => m[1]),
    [
      [0, 3],
      [4, 6],
      [7, 9],
    ],
  );
  assert.deepEqual(
    hits('a\nb\rc', String.raw`\A|\z`).map((m) => m[0]),
    [
      [0, 0],
      [5, 5],
    ],
  );
  assert.deepEqual(Array.from(hits('ab\nCD', '(?is)(AB).(cd)')[0]), [
    [0, 5],
    [0, 2],
    [3, 5],
  ]);
  assert.equal(hits('a\t \u202fb', String.raw`\h+`)[0][0][1], 4);
  assert.deepEqual(hits('$^', String.raw`[\$\^]+`)[0][0], [0, 2]);
  assert.throws(() => hits('x', '['));
});
test('replacement tokens distinguish captured source, optional groups and literal dollars', () => {
  const groups = [{ text: 'x7' }, { text: '7' }, undefined];
  assert.deepEqual(replacementParts(String.raw`$$1:$1\t$0\r$2\n\\`, groups), [
    '$1:',
    groups[1],
    '\t',
    groups[0],
    '\r',
    '\n\\',
  ]);
  assert.throws(() => replacementParts('$8', groups), /no capture/);
  assert.throws(() => scanGrep({ texts: ['a'.repeat(100001)], needle: '.' }), /Too many/);
});
