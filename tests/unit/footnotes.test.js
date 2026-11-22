import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFootnoteHTML,
  validateFootnoteOptions,
  defaultFootnoteOptions,
  footnoteText,
} from '../../src/domain/documents/footnotes.js';

test('footnote source round-trips plain Unicode, line breaks and reserved characters', () => {
  const body = 'Cotton & linen.\nΕλληνικά <sample> 20%';
  const encoded = encodeURIComponent(body);
  assert.equal(footnoteText(encoded), body);
  assert.doesNotThrow(() =>
    validateFootnoteHTML('<p><span data-footnote="' + encoded + '"><strong>12</strong></span></p>'),
  );
  for (const bad of ['%', '%00', '', '   ']) assert.equal(footnoteText(bad), null);
  for (const html of [
    '<a data-footnote="sample">1</a>',
    '<span data-footnote="%">1</span>',
    '<span data-footnote="text">prose</span>',
    '<span data-footnote="text"><span data-footnote="other">1</span></span>',
    '<span data-footnote="text">1',
  ])
    assert.throws(() => validateFootnoteHTML(html));
});
test('document footnote options reject source that cannot be laid out', () => {
  assert.doesNotThrow(() => validateFootnoteOptions(defaultFootnoteOptions));
  assert.doesNotThrow(() =>
    validateFootnoteOptions({ startAt: 9, allowSplitting: false, rule: false }),
  );
  for (const bad of [
    { startAt: 0 },
    { startAt: 1.5 },
    { leading: -1 },
    { ruleWidth: Infinity },
    { rule: 'off' },
    { somethingElse: true },
  ])
    assert.throws(() => validateFootnoteOptions(bad));
});
