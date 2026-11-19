import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  SHIPPED_TEXT_FONT_FILES,
  SHIPPED_TEXT_FONT_METADATA,
  shippedTextFontURL,
} from '../../src/rendering/text/font-resources.js';
import { inspectFont } from '../../src/domain/text/fonts.js';
import { nativeCharacterFeatureAdmission } from '../../src/domain/text/native-character-style.js';

test('shipped metadata independently matches every exact public font resource', async () => {
  assert.deepEqual(Object.keys(SHIPPED_TEXT_FONT_METADATA), Object.keys(SHIPPED_TEXT_FONT_FILES));
  for (const id of Object.keys(SHIPPED_TEXT_FONT_FILES)) {
    const bytes = await readFile(shippedTextFontURL(id)),
      inspected = inspectFont(bytes);
    assert.deepEqual(
      SHIPPED_TEXT_FONT_METADATA[id],
      {
        digest: createHash('sha256').update(bytes).digest('hex'),
        postscript: inspected.postscript,
        features: inspected.features,
      },
      id + ' metadata must be regenerated when its font bytes change',
    );
  }
});

test('shipped IDs and URLs preserve their original byte-resource contract', () => {
  assert.deepEqual(SHIPPED_TEXT_FONT_FILES, {
    'cmu-regular': 'cmu-serif/cmunrm.ttf',
    'cmu-italic': 'cmu-serif/cmunti.ttf',
    'cmu-bold': 'cmu-serif/cmunbx.ttf',
    'cmu-bold-italic': 'cmu-serif/cmunbi.ttf',
  });
  for (const [id, file] of Object.entries(SHIPPED_TEXT_FONT_FILES))
    assert.equal(
      shippedTextFontURL(id).href,
      new URL('../../public/fonts/' + file, import.meta.url).href,
    );
  assert.throws(() => shippedTextFontURL('cmu-unknown'), /Unknown bundled text font/);
});

test('synchronous shipped feature metadata is deeply immutable and face-specific', () => {
  assert.ok(Object.isFrozen(SHIPPED_TEXT_FONT_METADATA));
  for (const font of Object.values(SHIPPED_TEXT_FONT_METADATA)) {
    assert.ok(Object.isFrozen(font));
    assert.ok(Object.isFrozen(font.features));
    assert.throws(() => {
      font.features.push('xxxx');
    }, TypeError);
    assert.throws(() => {
      font.digest = 'b'.repeat(64);
    }, TypeError);
  }
  for (const id of ['cmu-regular', 'cmu-bold'])
    assert.equal(
      nativeCharacterFeatureAdmission({ smallCaps: true }, SHIPPED_TEXT_FONT_METADATA[id]).status,
      'available',
    );
  for (const id of ['cmu-italic', 'cmu-bold-italic']) {
    const result = nativeCharacterFeatureAdmission(
      { smallCaps: true },
      SHIPPED_TEXT_FONT_METADATA[id],
    );
    assert.equal(result.status, 'missing');
    assert.deepEqual(result.missing, ['smcp']);
  }
});
