import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeTextAttributes } from '../../src/shared/dom/native-text-format.js';

test('native Normal and emphasis declarations become typed true/false character marks', () => {
  assert.deepEqual(
    nativeTextAttributes({ fontStyle: 'normal', fontWeight: '400', textDecorationLine: 'none' }),
    { italic: 'false', bold: 'false', underline: 'false', strike: 'false' },
  );
  assert.deepEqual(
    nativeTextAttributes({
      fontStyle: 'italic',
      fontWeight: 'bold',
      textDecorationLine: 'underline line-through',
    }),
    { italic: 'true', bold: 'true', underline: 'true', strike: 'true' },
  );
  assert.deepEqual(
    nativeTextAttributes({
      fontStyle: 'inherit',
      fontWeight: 'bolder',
      textDecorationLine: 'var(--anything)',
    }),
    {},
  );
});

test('native font declarations resolve only exact shipped or vault family identities', () => {
  assert.equal(
    nativeTextAttributes({ fontFamily: '"CMU Serif", Georgia, serif' }).font,
    'cmu-serif',
  );
  assert.equal(nativeTextAttributes({ fontFamily: 'Geist' }).font, 'geist');
  assert.equal(nativeTextAttributes({ fontFamily: '"Helvetica Neue"' }).font, 'sans');
  assert.equal(nativeTextAttributes({ fontFamily: 'Georgia' }).font, 'serif');
  const digest = 'a'.repeat(64);
  assert.equal(nativeTextAttributes({ fontFamily: `"ivo-font-${digest}"` }).font, 'font-' + digest);
  assert.deepEqual(nativeTextAttributes({ fontFamily: 'Unknown Family, "CMU Serif"' }), {});
  assert.deepEqual(nativeTextAttributes({ fontFamily: 'Arial, sans-serif' }), {});
});

test('only bounded absolute metrics are converted, with no Auto/fixed-leading conflation', () => {
  assert.deepEqual(
    nativeTextAttributes({ fontSize: '24px', lineHeight: '31.5px', letterSpacing: '0.02em' }),
    { size: '24', leading: '31.5', tracking: '20' },
  );
  assert.deepEqual(
    nativeTextAttributes({ fontSize: '12pt', lineHeight: 'normal', letterSpacing: '2px' }),
    {},
  );
  assert.deepEqual(nativeTextAttributes({ fontSize: '5000px', lineHeight: '0px' }), {});
  assert.deepEqual(
    nativeTextAttributes({ fontSize: 'calc(10px * 2)', lineHeight: 'var(--ivo-auto-leading)' }),
    {},
  );
  assert.equal(nativeTextAttributes({ letterSpacing: 'normal' }).tracking, '0');
});

test('color conversion retains opaque RGB only and never copies arbitrary style properties', () => {
  assert.deepEqual(
    nativeTextAttributes({ color: 'rgb(10, 20, 30)', backgroundColor: 'rgba(255, 241, 118, 1)' }),
    { color: '#0a141e', highlight: '#fff176' },
  );
  assert.deepEqual(nativeTextAttributes({ backgroundColor: 'transparent' }), { highlight: 'none' });
  assert.deepEqual(
    nativeTextAttributes({
      color: 'rgba(10,20,30,0.5)',
      backgroundImage: 'url(https://example.invalid/)',
      position: 'fixed',
      transform: 'scale(500)',
    }),
    {},
  );
  assert.deepEqual(nativeTextAttributes({ color: 'rgb(999,0,0)' }), {});
});
