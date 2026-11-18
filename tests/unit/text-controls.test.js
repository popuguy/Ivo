import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectFont } from '../../src/domain/text/fonts.js';
import { BUNDLED_FONT_FEATURES } from '../../src/domain/text/bundled-font-features.js';
import { placePopover } from '../../src/domain/geometry/popover.js';

test('feature applicability matches the actual shipped font faces', async () => {
  const faces = { regular: 'cmunrm', bold: 'cmunbx', italic: 'cmunti', boldItalic: 'cmunbi' };
  for (const [face, file] of Object.entries(faces)) {
    const font = inspectFont(
      await readFile(new URL(`../../public/fonts/cmu-serif/${file}.ttf`, import.meta.url)),
    );
    assert.deepEqual(BUNDLED_FONT_FEATURES['cmu-serif'][face], font.features);
  }
});

test('bundled Geist applicability matches its shipped variable font', async () => {
  const font = inspectFont(
    await readFile(new URL('../../public/fonts/geist/Geist-Variable.ttf', import.meta.url)),
  );
  assert.deepEqual(BUNDLED_FONT_FEATURES.geist.regular, font.features);
});

test('anchored type options fit above/below and at either canvas edge', () => {
  const bounds = { x: 0, y: 0, w: 600, h: 500 },
    size = { w: 242, h: 290 };
  assert.deepEqual(placePopover({ x: 150, y: 100, w: 20, h: 16 }, size, bounds), {
    x: 150,
    y: 118,
    w: 242,
    h: 290,
    side: 'below',
  });
  for (const anchor of [
    { x: 590, y: 470, w: 20, h: 16 },
    { x: -20, y: 240, w: 20, h: 16 },
    { x: 100, y: 10, w: 20, h: 16 },
  ]) {
    const p = placePopover(anchor, size, bounds);
    assert(p.x >= 4 && p.x + p.w <= 596 && p.y >= 4 && p.y + p.h <= 496);
  }
  assert.equal(placePopover({ x: 580, y: 470, w: 20, h: 16 }, size, bounds).side, 'above');
  const narrow = placePopover({ x: 20, y: 60, w: 20, h: 16 }, size, { x: 0, y: 0, w: 180, h: 150 });
  assert.equal(narrow.w, 172);
  assert(narrow.h <= 68);
});
