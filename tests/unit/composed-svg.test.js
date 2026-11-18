import test from 'node:test';
import assert from 'node:assert/strict';
import { composedSVG } from '../../src/rendering/text/composed-svg.js';
function fixture() {
  return {
    vectors: [{ id: 'g-a', pathD: 'M0 0L4 0L2 8Z' }],
    layout: {
      lines: [
        {
          frame: 'one',
          baseline: 12,
          ascent: 10,
          descent: 3,
          runs: [
            {
              start: 0,
              end: 1,
              textColor: '#112233',
              underlinePosition: -1,
              underlineThickness: 0.5,
              xHeight: 4,
              glyphs: [{ index: 0, end: 1, vector: 'g-a', position: [2, 0], advance: [5, 0] }],
            },
          ],
        },
      ],
    },
  };
}
test('native display paints the returned glyph positions and font metrics without browser text', () => {
  const html = composedSVG(
    fixture(),
    { id: 'one', width: 100, height: 40 },
    {
      text: 'A',
      styles: [{ start: 0, end: 1, highlight: '#ffff00', underline: true }],
    },
  );
  assert.match(html, /translate\(2 12\) scale\(1 -1\)/);
  assert.match(html, /fill="#112233"/);
  assert.match(html, /y="13" width="5" height="0.5"/);
  assert.match(html, /fill="#ffff00"/);
  assert.doesNotMatch(html, /<text[\s>]/);
});
test('native display rejects nonfinite paths, escaped references and out-of-source glyph indices', () => {
  for (const mutate of [
    (r) => (r.vectors[0].pathD = 'M1e999 0'),
    (r) => (r.vectors[0].id = 'bad"/>'),
    (r) => (r.layout.lines[0].runs[0].glyphs[0].end = 2),
    (r) => (r.layout.lines[0].runs[0].glyphs[0].advance[1] = Infinity),
  ]) {
    const result = fixture();
    mutate(result);
    assert.throws(() => composedSVG(result, { id: 'one', width: 100, height: 40 }, { text: 'A' }));
  }
});
