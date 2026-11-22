import test from 'node:test';
import assert from 'node:assert/strict';
import { scanGrep } from '../../src/features/editor/text/grep-worker.js';
import { replacementParts } from '../../src/features/editor/text/grep.js';
import {
  decodeFindField,
  findCharacters,
  readFindQuery,
} from '../../src/features/editor/text/find-characters.js';

const hits = (text, needle) => scanGrep({ texts: [text], needle, caseSensitive: true })[0];
test('character-menu choices address editable source in Text and GREP in both directions', () => {
  for (const [, entries] of findCharacters) {
    for (const [label, code, value, escape] of entries) {
      const grep = escape ?? '~' + code;
      assert.equal(decodeFindField('^' + code), value, label);
      assert.deepEqual(hits('a' + value + 'b', grep)[0][0], [1, 2], label);
      assert.deepEqual(replacementParts(grep, []), [value], label);
    }
  }
  assert.deepEqual(hits('~s \u00a0\u202f', '[~s~S]+')[0][0], [3, 5]);
  assert.deepEqual(hits('~s \u00a0', '\\~s')[0][0], [0, 2]);
  assert.deepEqual(replacementParts('\\~s~s', []), ['~s\u00a0']);
  assert.equal(decodeFindField('^^n^n'), '^n\n');
  const old = readFindQuery({ mode: 'text', needle: '^s^^n^t', replacement: '^n' });
  assert.equal(decodeFindField(old.needle), '^s^n\t');
  assert.equal(decodeFindField(old.replacement), '^n');
  const pattern = readFindQuery({ mode: 'grep', needle: '~s', replacement: '\\~s' });
  assert.deepEqual(hits('~s \u00a0', pattern.needle)[0][0], [0, 2]);
  assert.deepEqual(replacementParts(pattern.replacement, []), ['\\~s']);
});
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
