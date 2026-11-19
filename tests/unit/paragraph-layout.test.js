import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphLayout, paragraphLineArea } from '../../src/domain/text/paragraph-layout.js';

test('paragraph line areas distinguish first indent, hanging text and continuing lines', () => {
  const source = {
      align: 'justify-right',
      paragraphBefore: 7,
      paragraphAfter: 11,
      leftIndent: 18,
      rightIndent: 12,
      firstLineIndent: -9,
    },
    before = structuredClone(source);
  assert.deepEqual(paragraphLineArea(source, 200, true), { left: 9, width: 179 });
  assert.deepEqual(paragraphLineArea(source, 200), { left: 18, width: 170 });
  assert.deepEqual(source, before);
  assert.throws(() => paragraphLineArea({ firstLineIndent: -20 }, 200, true), /text width/);
  assert.throws(() => paragraphLineArea({ rightIndent: -1 }, 200), /text width/);
});

test('paragraph policy rejects invalid values and areas without clamping authored indents', () => {
  for (const value of [
    { align: 'middle' },
    { paragraphBefore: -1 },
    { paragraphAfter: Infinity },
    { leftIndent: NaN },
    { firstLineIndent: 2001 },
    { rightIndent: '12' },
  ])
    assert.throws(() => paragraphLayout(value), /Invalid paragraph/);
  for (const width of [0, -1, Infinity, NaN])
    assert.throws(() => paragraphLineArea({}, width), /text width/);
  assert.throws(() => paragraphLineArea({ leftIndent: 50 }, 50), /text width/);
  assert.throws(() => paragraphLineArea({ firstLineIndent: 50 }, 50, true), /text width/);
  assert.equal(paragraphLineArea({ leftIndent: 49 }, 50).width, 1);
});
