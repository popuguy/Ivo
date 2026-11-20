import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dictionaryHyphenationPoints } from '../../src/domain/text/dictionary-hyphenation.js';
import { chooseParagraphFlow } from '../../src/domain/text/paragraph-flow.js';
import { chooseWrappedParagraphFlow } from '../../src/domain/text/wrapped-paragraph-flow.js';
import { retainedHyphenCount } from '../../src/domain/text/line-hyphenation.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';

test('word length, prefix, suffix, capitals and last word filter only dictionary positions', () => {
  const text = 'Typesetting typesetting.';
  assert.deepEqual(dictionaryHyphenationPoints(text, { hyphenCapitals: false }), [16, 19]);
  assert.deepEqual(dictionaryHyphenationPoints(text, { hyphenLastWord: false }), [4, 7]);
  assert.deepEqual(dictionaryHyphenationPoints(text, { hyphenWordLength: 12 }), []);
  assert.deepEqual(dictionaryHyphenationPoints(text, { hyphenAfterFirst: 5 }), [7, 19]);
  assert.deepEqual(dictionaryHyphenationPoints(text, { hyphenBeforeLast: 5 }), []);
  assert.deepEqual(dictionaryHyphenationPoints('representation', { hyphenBeforeLast: 5 }), [5, 8]);
  assert.deepEqual(
    dictionaryHyphenationPoints('representation', { hyphenAfterFirst: 5 }),
    [5, 8, 10],
  );
  assert.deepEqual(dictionaryHyphenationPoints('Typesetting  🌿.', { hyphenLastWord: false }), []);
});
const measured = (start, end, width) => ({
  start,
  end,
  width,
  ascent: 8,
  descent: 2,
  leading: 10,
  advance: 10,
  capHeight: 7,
  xHeight: 5,
});
function threaded() {
  return {
    start: 0,
    end: 6,
    opportunities: [0, 1, 2, 3, 4, 6].map((index) => ({
      index,
      automatic: [1, 2, 4].includes(index),
    })),
    measurements: [
      measured(0, 1, 10),
      measured(1, 2, 10),
      measured(2, 3, 15),
      measured(2, 4, 20),
      measured(3, 6, 20),
      measured(4, 6, 20),
    ],
    columns: [
      { width: 10, height: 20 },
      { width: 20, height: 40 },
    ],
  };
}
test('a soft limit survives a frame break in both composers and both geometry solvers', () => {
  for (const compose of [chooseParagraphFlow, chooseWrappedParagraphFlow]) {
    for (const mode of ['paragraph', 'single-line']) {
      for (const limit of [0, 1, 2, 3]) {
        const result = compose({
          ...threaded(),
          mode,
          hyphenation: { hyphenLimit: limit, hyphenZone: 0 },
        });
        assert.equal(result.status, 'fit');
        assert.deepEqual(
          result.lines.map((l) => [l.frame, l.end]),
          [
            [0, 1],
            [0, 2],
            [1, limit === 1 || limit === 2 ? 3 : 4],
            [1, 6],
          ],
        );
      }
    }
  }
});
test('zone changes only ragged single-line composition', () => {
  for (const compose of [chooseParagraphFlow, chooseWrappedParagraphFlow]) {
    const run = (mode, align, zone) =>
      compose({
        ...threaded(),
        mode,
        layout: { align },
        hyphenation: { hyphenLimit: 0, hyphenZone: zone },
      }).lines[2].end;
    assert.equal(run('single-line', 'left', 4.99), 4);
    assert.equal(run('single-line', 'left', 5), 3);
    assert.equal(run('single-line', 'justify', 5), 4);
    assert.equal(run('paragraph', 'left', 5), 4);
  }
});
test('a suffix kept in another frame counts physical line endings, including a discretionary break', () => {
  const lines = [
    { end: 1 },
    { end: 2 },
    { end: 3, continuesRow: true },
    { end: 4 },
    { end: 5, continuesRow: true },
  ];
  assert.equal(retainedHyphenCount(lines, new Set([1, 3, 5]), 3), 3);
  assert.equal(retainedHyphenCount(lines, new Set([1, 2, 5]), 3), 1);
  assert.equal(retainedHyphenCount(lines, new Set([1, 3, 5]), 1), 1);
});
test('hyphenation settings opt a document into archive 15, including explicit resets', async () => {
  const old = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v10.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(validateImport(old), old);
  for (const author of [
    (f) => {
      f.html = '<p DATA-IVO-HYPLIMIT = "0">Typesetting</p>';
    },
    (f) => {
      f.style.hyphenZone = 4.25;
    },
    (f) => {
      f.style.textOverrides = { hyphenCapitals: true };
    },
  ]) {
    const archive = structuredClone(old),
      doc = archive.documents[0];
    author(doc.textFlows[0]);
    assert.throws(() => validateImport(archive), /hyphenation settings/i);
    markTypographyVersion(doc);
    archive.schemaVersion = archiveVersion([doc]);
    assert.equal(archive.schemaVersion, 15);
    assert.equal(validateImport(archive).documents[0].canvasVersion, 14);
    for (const settings of [
      { hyphenLimit: 1.5 },
      { hyphenZone: -1 },
      { hyphenWordLength: '8' },
      { hyphenLastWord: 'false' },
    ]) {
      Object.assign(doc.textFlows[0].style, settings);
      assert.throws(() => validateImport(archive), /invalid/);
      delete doc.textFlows[0].style[Object.keys(settings)[0]];
    }
  }
});

test('a wrap obstacle that divides one row into two fragments counts as one line', () => {
  const input = threaded();
  const obstacle = {
    mode: 'bounds',
    side: 'both',
    bounds: { left: 10, right: 20, top: 0, bottom: 10 },
    polygons: [
      [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ],
    ],
  };
  input.columns = [
    { width: 30, height: 10, obstacles: [obstacle] },
    { width: 20, height: 40 },
  ];
  for (const limit of [1, 2]) {
    const result = chooseWrappedParagraphFlow({
      ...input,
      mode: 'single-line',
      hyphenation: { hyphenLimit: limit, hyphenZone: 0 },
    });
    assert.equal(result.status, 'fit');
    assert.equal(result.lines[1].continuesRow, true);
    assert.equal(result.lines[2].frame, 1);
    assert.equal(result.lines[2].end, limit === 1 ? 3 : 4);
  }
});
