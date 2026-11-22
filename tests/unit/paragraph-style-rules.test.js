import { copyObjectSelection, pasteObjectSelection } from '../../src/domain/documents/clipboard.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../src/domain/documents/publishing.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import { importTextStyles } from '../../src/domain/documents/import-text-styles.js';
import {
  paragraphRuleRuns,
  inheritedStyleRules,
} from '../../src/domain/text/paragraph-style-rules.js';
import { forEachStyleMatch } from '../../src/domain/text/style-pattern.js';
const stylePatternRanges = (text, pattern) => {
  const out = [];
  forEachStyleMatch(text, pattern, (start, end) => out.push([start, end]));
  return out;
};

test('greedy Unicode style patterns keep UTF-16 positions and bound ambiguous repetitions', () => {
  const cases = [
    [
      '💡A12 and Ω34',
      '\\p{L}\\d+',
      [
        [2, 5],
        [10, 13],
      ],
    ],
    ['x-$50.22 now', '$', null],
    ['x-$50.22 now', '\\$\\d+\\.\\d{2}', [[2, 8]]],
    ['as asas', '\\b[a-z]{2}\\b', [[0, 2]]],
    ['1234,56', '\\d+\\d{2}', [[0, 4]]],
    ['01234', '^0?\\d+$', [[0, 5]]],
    ['xxxxx', 'x*', [[0, 5]]],
    ['abc123', '[^\\d]+', [[0, 3]]],
    ['a'.repeat(20000), 'a*a*a*a*b', []],
  ];
  for (const [text, pattern, answer] of cases) {
    if (answer === null) assert.throws(() => stylePatternRanges(text, pattern));
    else assert.deepEqual(stylePatternRanges(text, pattern), answer);
  }
  for (const invalid of ['(a+)+', '[abc', '(?=a)', 'a|b', 'a+?', '\\1', 'a{5,2}'])
    assert.throws(() => stylePatternRanges('abcd', invalid));
});

test('observed InDesign word boundaries, sequential rules, and precedence', () => {
  const text = 'One 23: 45.';
  const rules = {
    nestedStyles: [{ style: 'nested', delimiter: 'word', count: 2, inclusive: true }],
    grepStyles: [
      { style: 'first', pattern: '\\d+' },
      { style: 'second', pattern: '3' },
    ],
  };
  const values = () => {
    const style = Array(text.length).fill(null);
    for (const r of paragraphRuleRuns(text, rules)) style.fill(r.styles.at(-1), r.start, r.end);
    return style;
  };
  assert.deepEqual(values(), [...Array(8).fill('nested'), 'first', 'first', null]);
  rules.nestedStyles[0].inclusive = false;
  assert.deepEqual(values(), [...Array(7).fill('nested'), null, 'first', 'first', null]);
  rules.nestedStyles = [
    { style: null, delimiter: 'literal', literal: ':', count: 1, inclusive: true },
    { style: 'tail', delimiter: 'letter', count: 1, inclusive: false },
  ];
  assert.deepEqual(values(), [
    null,
    null,
    null,
    null,
    'first',
    'first',
    null,
    'tail',
    'tail',
    'tail',
    'tail',
  ]);
});

test('rule inheritance, archive gate, document copies and style imports preserve independent references', () => {
  const doc = createSceneDocument('Rules');
  const face = saveTextStyle(doc, 'character', { name: 'Price', attributes: { bold: true } });
  const p = saveTextStyle(doc, 'paragraph', {
    name: 'Body',
    grepStyles: [{ style: face.id, pattern: '\\d+' }],
  });
  const child = saveTextStyle(doc, 'paragraph', { name: 'Child', basedOn: p.id, nestedStyles: [] });
  assert.deepEqual(inheritedStyleRules(doc, child.id), {
    nestedStyles: [],
    grepStyles: p.grepStyles,
  });
  const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(archive.schemaVersion, 34);
  assert.deepEqual(
    validateImport(archive).documents[0].publishing.paragraphStyles,
    doc.publishing.paragraphStyles,
  );
  assert.throws(() => validateImport({ ...archive, schemaVersion: 33 }), /archive 34/);
  assert.throws(() =>
    saveTextStyle(doc, 'paragraph', {
      name: 'Bad',
      grepStyles: [{ style: 'unknown', pattern: 'x' }],
    }),
  );
  const copied = copyDocument(doc);
  const imported = createSceneDocument('Imported');
  importTextStyles(imported, doc, [child.id]);
  for (const target of [copied, imported]) {
    const rule = target.publishing.paragraphStyles.find((s) => s.name === 'Body').grepStyles[0];
    assert.notEqual(rule.style, face.id);
    assert.equal(rule.style, target.publishing.characterStyles[0].id);
  }
});
test('archive 33 has no implicit rule collections or version promotion', async () => {
  const old = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v33.json', import.meta.url)),
  );
  const [doc] = validateImport(old).documents;
  assert.equal(archiveVersion([doc]), 33);
  assert.ok(!doc.publishing?.paragraphStyles.some((s) => s.nestedStyles || s.grepStyles));
  const basic = saveTextStyle(doc, 'paragraph', { name: 'Body', attributes: { fontSize: 12 } });
  assert.equal(basic.nestedStyles, undefined);
  assert.equal(archiveVersion([doc]), 33);
});

test('object clipboard carries conditional character style dependencies and reuses them within a document', () => {
  const doc = createSceneDocument('Source'),
    pageId = doc.pages[0].id;
  const char = saveTextStyle(doc, 'character', { name: 'Numerals', attributes: { tracking: 111 } });
  const para = saveTextStyle(doc, 'paragraph', {
    name: 'Caption',
    grepStyles: [{ style: char.id, pattern: '\\d+' }],
  });
  const frame = insertObject(doc, 'text', pageId, {
    html: '<p>Issue 47</p>',
    paragraphStyle: para.id,
  });
  const { archive } = copyObjectSelection(doc, [frame.id]);
  for (const target of [doc, createSceneDocument('Destination')]) {
    const [pasted] = pasteObjectSelection(target, archive, { pageId: target.pages[0].id });
    const p = target.publishing.paragraphStyles.find((s) => s.id === pasted.paragraphStyle);
    assert.equal(target.publishing.characterStyles.length, 1);
    assert.equal(p.grepStyles[0].style, target.publishing.characterStyles[0].id);
    if (target === doc) assert.equal(p.id, para.id);
    else assert.notEqual(p.id, para.id);
  }
});
