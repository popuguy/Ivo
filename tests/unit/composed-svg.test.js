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
const frame = { id: 'one', width: 100, height: 100 };
function rectangles(html) {
  return [...html.matchAll(/<rect ([^>]*)\/>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [
        attribute[1],
        ['x', 'y', 'width', 'height'].includes(attribute[1]) ? Number(attribute[2]) : attribute[2],
      ]),
    ),
  );
}
function shapedRun(count = 4) {
  const result = fixture(),
    line = result.layout.lines[0],
    run = line.runs[0];
  run.end = count;
  run.glyphs = Array.from({ length: count }, (_, index) => ({
    index,
    end: index + 1,
    vector: 'g-a',
    position: [2 + index * 5, 0],
    advance: [5, 0],
  }));
  line.carets = Array.from({ length: count + 1 }, (_, index) => ({
    index,
    primary: 2 + index * 5,
  }));
  return result;
}
function ligature() {
  const result = fixture(),
    line = result.layout.lines[0],
    run = line.runs[0];
  run.end = 2;
  run.glyphs[0].end = 2;
  run.glyphs[0].advance[0] = 10;
  line.carets = [
    { index: 0, primary: 2 },
    { index: 1, primary: 6.25 },
    { index: 2, primary: 12 },
  ];
  return result;
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

test('source decoration spans can split one same-shaped native run without repainting glyph ink', () => {
  const result = shapedRun(),
    styles = [
      { start: 0, end: 1 },
      { start: 1, end: 3, highlight: '#ffff00', underline: true },
      { start: 3, end: 4, strikethrough: true },
    ],
    before = structuredClone({ result, styles }),
    plain = composedSVG(result, frame, { text: 'ABCD' }),
    painted = composedSVG(result, frame, { text: 'ABCD', styles });
  assert.deepEqual(rectangles(painted), [
    { x: 7, y: 2, width: 10, height: 13, fill: '#ffff00' },
    { x: 7, y: 13, width: 10, height: 0.5, fill: '#112233' },
    { x: 17, y: 10, width: 5, height: 0.5, fill: '#112233' },
  ]);
  assert.deepEqual(
    [...painted.matchAll(/<use [^>]*\/>/g)].map((match) => match[0]),
    [...plain.matchAll(/<use [^>]*\/>/g)].map((match) => match[0]),
  );
  assert.equal((painted.match(/<use /g) || []).length, 4);
  assert.equal((painted.match(/<path /g) || []).length, 1);
  assert.deepEqual({ result, styles }, before);
});

test('partial ligature highlighting and links use measured source carets rather than the whole cluster', () => {
  const result = ligature(),
    links = [{ start: 1, end: 2, documentId: 'linked-note' }],
    html = composedSVG(result, frame, {
      text: 'fi',
      styles: [{ start: 1, end: 2, highlight: '#ffff00', underline: true }],
      links,
    });
  assert.deepEqual(rectangles(html), [
    { x: 6.25, y: 2, width: 5.75, height: 13, fill: '#ffff00' },
    { x: 6.25, y: 13, width: 5.75, height: 0.5, fill: '#112233' },
    { x: 6.25, y: 2, width: 5.75, height: 13, fill: 'transparent', 'pointer-events': 'all' },
  ]);
  assert.equal((html.match(/<use /g) || []).length, 1);
  assert.match(html, /data-doc-id="linked-note"/);
  assert.match(html, /<title>i<\/title>/);
});

test('RTL run edges select the secondary bidi offset even when both offsets fall inside the run', () => {
  const result = ligature(),
    line = result.layout.lines[0],
    run = line.runs[0];
  run.rtl = true;
  run.glyphs[0].position[0] = 10;
  run.glyphs[0].advance[0] = 20;
  line.carets = [
    { index: 0, primary: 10, secondary: 30 },
    { index: 1, primary: 20, secondary: 20 },
    { index: 2, primary: 40, secondary: 10 },
  ];
  const html = composedSVG(result, frame, {
    text: 'אב',
    styles: [{ start: 0, end: 1, highlight: '#ffff00' }],
    links: [{ start: 1, end: 2, url: 'https://example.test/' }],
  });
  assert.deepEqual(rectangles(html), [
    { x: 20, y: 2, width: 10, height: 13, fill: '#ffff00' },
    { x: 10, y: 2, width: 10, height: 13, fill: 'transparent', 'pointer-events': 'all' },
  ]);
  assert.equal((html.match(/<use /g) || []).length, 1);
});

test('shifted/scaled run decorations and link regions use signed ink metrics', () => {
  const result = ligature(),
    line = result.layout.lines[0],
    run = line.runs[0];
  line.baseline = 50;
  line.ascent = 20;
  line.descent = 10;
  Object.assign(run, {
    inkAscent: -4,
    inkDescent: 12,
    baselineShift: -8,
    verticalScale: 150,
    underlinePosition: -2,
    underlineThickness: 0.75,
  });
  run.glyphs[0].position[1] = -8;
  line.carets[1].primary = 7;
  const before = structuredClone(result),
    html = composedSVG(result, frame, {
      text: 'fi',
      styles: [
        { start: 0, end: 1, highlight: '#ffff00', underline: true },
        { start: 1, end: 2, strikethrough: true },
      ],
      links: [{ start: 1, end: 2, documentId: 'other' }],
    });
  assert.deepEqual(rectangles(html), [
    { x: 2, y: 54, width: 5, height: 8, fill: '#ffff00' },
    { x: 2, y: 60, width: 5, height: 0.75, fill: '#112233' },
    { x: 7, y: 55, width: 5, height: 0.75, fill: '#112233' },
    { x: 7, y: 54, width: 5, height: 8, fill: 'transparent', 'pointer-events': 'all' },
  ]);
  assert.match(html, /translate\(2 58\) scale\(1 -1\)/);
  assert.deepEqual(result, before);
});

test('a link spanning native runs keeps independent hit boxes and signed ink instead of bridging visual gaps', () => {
  const result = shapedRun(2),
    line = result.layout.lines[0],
    original = line.runs[0];
  line.runs = [
    { ...original, end: 1, glyphs: [original.glyphs[0]] },
    {
      ...original,
      start: 1,
      glyphs: [{ ...original.glyphs[1], position: [30, 0] }],
      inkAscent: 18,
      inkDescent: -8,
    },
  ];
  line.carets = [
    { index: 0, primary: 2 },
    { index: 1, primary: 7, secondary: 30 },
    { index: 2, primary: 35 },
  ];
  const html = composedSVG(result, frame, {
    text: 'AB',
    links: [{ start: 0, end: 2, documentId: 'other' }],
  });
  assert.deepEqual(rectangles(html), [
    { x: 2, y: 2, width: 5, height: 13, fill: 'transparent', 'pointer-events': 'all' },
    { x: 30, y: -6, width: 5, height: 10, fill: 'transparent', 'pointer-events': 'all' },
  ]);
  assert.equal((html.match(/<a /g) || []).length, 1);
});

test('unmeasurable interior decoration and link boundaries fail explicitly, while undecorated text still paints', () => {
  for (const style of [{ highlight: '#ffff00' }, { underline: true }, { strikethrough: true }]) {
    const result = ligature();
    result.layout.lines[0].carets.splice(1, 1);
    assert.throws(
      () => composedSVG(result, frame, { text: 'fi', styles: [{ start: 1, end: 2, ...style }] }),
      /native run caret/,
    );
  }
  const result = ligature();
  result.layout.lines[0].carets.splice(1, 1);
  assert.throws(
    () =>
      composedSVG(result, frame, {
        text: 'fi',
        links: [{ start: 1, end: 2, documentId: 'other' }],
      }),
    /native run caret/,
  );
  assert.equal(
    (
      composedSVG(result, frame, { text: 'fi', styles: [{ start: 1, end: 2 }] }).match(/<use /g) ||
      []
    ).length,
    1,
  );
});

test('whole-run links retain native extent fallback for older protocol results without caret tables', () => {
  const html = composedSVG(fixture(), frame, {
    text: 'A',
    styles: [{ start: 0, end: 1, highlight: '#ffff00', underline: true }],
    links: [{ start: 0, end: 1, documentId: 'other' }],
  });
  assert.deepEqual(rectangles(html).at(-1), {
    x: 2,
    y: 2,
    width: 5,
    height: 13,
    fill: 'transparent',
    'pointer-events': 'all',
  });
});
