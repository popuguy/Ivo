import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTextNavigation,
  logicalSelection,
  selectionIntervals,
  caretInterval,
  snapTextPosition,
  moveTextPosition,
  moveTextSelection,
  wordSelection,
  paragraphSelection,
} from '../../src/domain/text/flow-selection.js';

test('a backward selection intersects nonsequential physical frames by logical source offsets', () => {
  const selection = logicalSelection(
    { index: 35, affinity: 'backward' },
    { index: 5, affinity: 'forward' },
  );
  const intervals = [
    { frame: 'page-3', column: 0, start: 20, end: 30 },
    { frame: 'page-1', column: 1, start: 10, end: 20 },
    { frame: 'page-1', column: 0, start: 0, end: 10 },
    { frame: 'page-4', column: 0, start: 30, end: 40 },
  ];
  assert.equal(selection.backward, true);
  assert.deepEqual(selectionIntervals(selection, intervals), [
    { frame: 'page-3', column: 0, start: 20, end: 30 },
    { frame: 'page-1', column: 1, start: 10, end: 20 },
    { frame: 'page-1', column: 0, start: 5, end: 10 },
    { frame: 'page-4', column: 0, start: 30, end: 35 },
  ]);
  assert.deepEqual(selection.anchor, { index: 35, affinity: 'backward' });
  assert.equal(intervals[2].start, 0);
});

test('collapsed carets select one affinity-owned frame and never create highlights on both sides', () => {
  const intervals = [
    { id: 'before', start: 0, end: 10 },
    { id: 'after', start: 10, end: 20 },
  ];
  assert.deepEqual(selectionIntervals(logicalSelection(10), intervals), []);
  assert.equal(caretInterval({ index: 10, affinity: 'backward' }, intervals).id, 'before');
  assert.equal(caretInterval({ index: 10, affinity: 'forward' }, intervals).id, 'after');
  assert.equal(caretInterval(25, intervals), null);
  assert.deepEqual(caretInterval(0, [{ id: 'empty', start: 0, end: 0 }]), {
    id: 'empty',
    start: 0,
    end: 0,
  });
});

test('paragraph-only intervals survive selection while zero-length frames remain unpainted', () => {
  assert.deepEqual(
    selectionIntervals(logicalSelection(8, 9), [
      { id: 'paragraph-mark', start: 8, end: 9 },
      { id: 'empty-frame', start: 9, end: 9 },
      { id: 'next', start: 9, end: 15 },
    ]),
    [{ id: 'paragraph-mark', start: 8, end: 9 }],
  );
});

test('grapheme movement and hit snapping cannot split emoji, combining marks or ZWJ sequences', () => {
  const text = 'A👩🏽‍💻e\u0301🇯🇵Z',
    edges = [0, 1, 8, 10, 14, 15];
  let point = { index: 0, affinity: 'forward' };
  const actual = [point.index];
  for (let i = 0; i < 5; i++) {
    point = moveTextPosition(text, point);
    actual.push(point.index);
  }
  assert.deepEqual(actual, edges);
  for (const edge of edges.slice(0, -1).reverse()) {
    point = moveTextPosition(text, point, { direction: 'backward' });
    assert.equal(point.index, edge);
  }
  assert.equal(snapTextPosition(text, { index: 4, affinity: 'forward' }).index, 8);
  assert.equal(snapTextPosition(text, { index: 4, affinity: 'backward' }).index, 1);
  assert.equal(snapTextPosition(text, { index: 9, affinity: 'forward' }).index, 10);
  assert.equal(moveTextPosition(text, { index: 4, affinity: 'forward' }).index, 8);
  assert.equal(
    moveTextPosition(text, { index: 4, affinity: 'backward' }, { direction: 'backward' }).index,
    1,
  );
});

test('word navigation uses Unicode segments and does not depend on frame or markup boundaries', () => {
  const text = '\nHello,   world!\nΚαλημέρα';
  assert.equal(moveTextPosition(text, 2, { unit: 'word' }).index, 6);
  assert.equal(moveTextPosition(text, 6, { unit: 'word' }).index, 15);
  assert.equal(moveTextPosition(text, 15, { unit: 'word', direction: 'backward' }).index, 10);
  assert.equal(
    moveTextPosition(text, text.length, { unit: 'word', direction: 'backward' }).index,
    17,
  );
  const word = wordSelection(text, 12);
  assert.equal(text.slice(word.start, word.end), 'world');
  const previous = wordSelection(text, { index: 6, affinity: 'backward' });
  assert.equal(text.slice(previous.start, previous.end), 'Hello');
  const spaces = wordSelection(text, 8);
  assert.equal(text.slice(spaces.start, spaces.end), '   ');
});

test('selection extension retains anchor through reversal and ordinary arrows collapse first', () => {
  const text = 'one two three',
    original = logicalSelection(4);
  const extended = moveTextSelection(text, original, { extend: true, unit: 'word' });
  assert.equal(extended.anchor.index, 4);
  assert.equal(extended.focus.index, 7);
  const reversed = moveTextSelection(text, extended, {
    extend: true,
    unit: 'flow',
    direction: 'backward',
  });
  assert.equal(reversed.anchor.index, 4);
  assert.equal(reversed.focus.index, 0);
  assert.equal(reversed.backward, true);
  assert.equal(moveTextSelection(text, reversed, { direction: 'forward' }).focus.index, 4);
  assert.equal(moveTextSelection(text, reversed, { direction: 'backward' }).focus.index, 0);
  assert.equal(original.collapsed, true);
});

test('explicit paragraph ranges preserve virtual boundaries and intentional blank paragraphs', () => {
  const text = '\nAlpha\n\n\n\nBeta\n',
    paragraphs = [
      { start: 0, end: 7 },
      { start: 7, end: 9 },
      { start: 9, end: 15 },
    ];
  assert.deepEqual(
    [
      paragraphSelection(text, 8, { paragraphs }).start,
      paragraphSelection(text, 8, { paragraphs }).end,
    ],
    [7, 9],
  );
  assert.equal(
    paragraphSelection(text, { index: 7, affinity: 'backward' }, { paragraphs }).start,
    0,
  );
  assert.equal(
    paragraphSelection(text, { index: 7, affinity: 'forward' }, { paragraphs }).start,
    7,
  );
  assert.equal(moveTextPosition(text, 7, { unit: 'paragraph', paragraphs }).index, 9);
  assert.equal(
    moveTextPosition(text, 9, { unit: 'paragraph', direction: 'backward', paragraphs }).index,
    7,
  );
  assert.equal(paragraphSelection('', 0).collapsed, true);
});

test('selection clamps stale offsets without accepting malformed indices or directions', () => {
  assert.deepEqual(logicalSelection(-1, 50, { length: 12 }).focus, {
    index: 12,
    affinity: 'forward',
  });
  assert.equal(moveTextPosition('', 0).index, 0);
  assert.equal(moveTextPosition('A', 500, { direction: 'backward' }).index, 0);
  assert.throws(() => logicalSelection(NaN), /integer/);
  assert.throws(() => logicalSelection(1.5), /integer/);
  assert.throws(() => logicalSelection({ index: 1, affinity: 'sideways' }), /affinity/);
  assert.throws(() => moveTextPosition('A', 0, { direction: 'left' }), /direction/);
});

test('cached navigation preserves standalone Unicode, affinity, direction and range contracts', () => {
  for (const text of ['', 'A👩🏽‍💻e\u0301🇯🇵Z', '\nHello,   world!\nΚαλημέρα', 'one\n\nthree\r\nfour']) {
    const nav = createTextNavigation(text);
    for (let index = -1; index <= text.length + 1; index++)
      for (const affinity of ['forward', 'backward']) {
        const point = { index, affinity };
        assert.deepEqual(nav.snap(point), snapTextPosition(text, point));
        assert.deepEqual(nav.word(point), wordSelection(text, point));
        assert.deepEqual(nav.paragraph(point), paragraphSelection(text, point));
        for (const way of ['forward', 'backward'])
          for (const unit of ['grapheme', 'word', 'paragraph', 'flow']) {
            const options = { direction: way, unit };
            assert.deepEqual(nav.move(point, options), moveTextPosition(text, point, options));
            for (const extend of [false, true]) {
              const range = logicalSelection(
                { index: Math.min(4, text.length), affinity: 'backward' },
                point,
              );
              assert.deepEqual(
                nav.selection(range, { ...options, extend }),
                moveTextSelection(text, range, { ...options, extend }),
              );
            }
          }
      }
    assert(Object.isFrozen(nav.graphemeBoundaries));
    assert.throws(() => nav.graphemeBoundaries.push(900));
  }
});

test('cached paragraph navigation snapshots source structure and preserves blank-mark affinity', () => {
  const text = '\nAlpha\n\n\n\nBeta\n',
    paragraphs = [
      { start: 0, end: 7 },
      { start: 7, end: 9 },
      { start: 9, end: 15 },
    ],
    nav = createTextNavigation(text, { paragraphs });
  for (let index = 0; index <= text.length; index++)
    for (const affinity of ['forward', 'backward']) {
      const point = { index, affinity };
      assert.deepEqual(nav.paragraph(point), paragraphSelection(text, point, { paragraphs }));
      for (const direction of ['forward', 'backward'])
        assert.deepEqual(
          nav.move(point, { unit: 'paragraph', direction }),
          moveTextPosition(text, point, { unit: 'paragraph', direction, paragraphs }),
        );
    }
  paragraphs[1].start = 99;
  assert.equal(nav.paragraph(8).start, 7);
  const overlap = [
      { start: 0, end: 15 },
      { start: 7, end: 9 },
    ],
    unusual = createTextNavigation(text, { paragraphs: overlap });
  assert.deepEqual(unusual.paragraph(8), paragraphSelection(text, 8, { paragraphs: overlap }));
  assert.deepEqual(
    unusual.move(8, { unit: 'paragraph' }),
    moveTextPosition(text, 8, { unit: 'paragraph', paragraphs: overlap }),
  );
});

test('long-flow repeated navigation segments each requested granularity once, lazily', (t) => {
  const original = Intl.Segmenter,
    counts = { grapheme: 0, word: 0 },
    constructors = { grapheme: 0, word: 0 },
    characters = { grapheme: 0, word: 0 };
  t.mock.method(Intl, 'Segmenter', function (locale, options) {
    constructors[options.granularity]++;
    const inner = new original(locale, options);
    return {
      segment(value) {
        counts[options.granularity]++;
        characters[options.granularity] += value.length;
        return inner.segment(value);
      },
    };
  });
  const text = 'Alpha 👩🏽‍💻 e\u0301 beta.\n'.repeat(2000),
    nav = createTextNavigation(text);
  assert.deepEqual(counts, { grapheme: 0, word: 0 });
  assert.equal(nav.move(10, { unit: 'flow' }).index, text.length);
  nav.paragraph(10);
  assert.deepEqual(counts, { grapheme: 0, word: 0 });
  let point = { index: 0, affinity: 'forward' };
  for (let i = 0; i < 4000; i++) {
    point = nav.move(point);
    nav.snap(point);
    nav.selection(logicalSelection(0, point), {
      extend: true,
      direction: i % 2 ? 'forward' : 'backward',
    });
    if (i === 2)
      assert.equal(counts.grapheme, 1, 'Repeated arrow navigation rescanned the long flow');
  }
  for (let i = 0; i < 2000; i++) {
    nav.word(i);
    nav.move(i, { unit: 'word' });
    if (i === 2) assert.equal(counts.word, 1, 'Repeated word navigation rescanned the long flow');
  }
  assert.deepEqual(counts, { grapheme: 1, word: 1 });
  assert.deepEqual(constructors, { grapheme: 1, word: 1 });
  assert.deepEqual(characters, { grapheme: text.length, word: text.length });
  assert.equal(nav.graphemeBoundaries[0], 0);
  assert.equal(nav.graphemeBoundaries.at(-1), text.length);
});

test('grapheme keys use editable paragraph content and cross each structural break once', () => {
  const text = '\nA\u0301\n\n\n\nЯ\n';
  const paragraphs = [
    { start: 0, contentStart: 1, contentEnd: 3, end: 4 },
    { start: 4, contentStart: 5, contentEnd: 5, end: 6 },
    { start: 6, contentStart: 7, contentEnd: 8, end: 9 },
  ];
  const nav = createTextNavigation(text, { paragraphs });
  for (const [start, direction, expected] of [
    [1, 'backward', 1],
    [1, 'forward', 3],
    [3, 'forward', 5],
    [5, 'forward', 7],
    [7, 'forward', 8],
    [8, 'forward', 8],
    [7, 'backward', 5],
    [5, 'backward', 3],
    [3, 'backward', 1],
  ]) {
    const options = { unit: 'grapheme', direction };
    assert.equal(nav.move(start, options).index, expected);
    assert.deepEqual(
      moveTextPosition(text, start, { ...options, paragraphs }),
      nav.move(start, options),
    );
  }
});
