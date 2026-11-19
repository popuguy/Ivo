import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textDeletionShortcut,
  textNavigationShortcut,
  typeShortcut,
} from '../../src/domain/text/editing-shortcuts.js';
import {
  createTextNavigation,
  logicalSelection,
  moveTextPosition,
} from '../../src/domain/text/flow-selection.js';

test('type shortcuts distinguish point increments, formatting, and platform ownership', () => {
  for (const [platform, modifier] of [
    ['MacIntel', 'metaKey'],
    ['Win32', 'ctrlKey'],
  ]) {
    const press = (key, options = {}) =>
      typeShortcut({ key, shiftKey: true, [modifier]: true, ...options }, platform);
    assert.deepEqual(press('<'), { field: 'fontSize', delta: -2 });
    assert.deepEqual(press('>'), { field: 'fontSize', delta: 2 });
    assert.deepEqual(press('¯', { code: 'Period', altKey: true }), {
      field: 'fontSize',
      delta: 10,
    });
    assert.deepEqual(press(',', { altKey: true }), { field: 'fontSize', delta: -10 });
    assert.deepEqual(press('K'), { field: 'allCaps', toggle: true });
    assert.deepEqual(press('H'), { field: 'smallCaps', toggle: true });
    assert.deepEqual(press('A', { altKey: true }), { field: 'leading', value: 0 });
    assert.deepEqual(press('J'), { field: 'align', value: 'justify' });
    assert.deepEqual(press('F'), { field: 'align', value: 'justify-all' });
    for (const options of [
      { isComposing: true },
      { shiftKey: false },
      { getModifierState: () => true },
    ])
      assert.equal(press('>', options), null);
    for (const key of ['[', ']', 'ArrowLeft', 'ArrowRight']) assert.equal(press(key), null);
  }
});

test('compact Mac keys and translated extended keys have the same scroll, movement and selection behavior', () => {
  for (const [raw, translated, direction, scroll, select] of [
    ['ArrowLeft', 'Home', 'backward', 'scroll-edge', 'flow'],
    ['ArrowRight', 'End', 'forward', 'scroll-edge', 'flow'],
    ['ArrowUp', 'PageUp', 'backward', 'scroll-page', 'screen'],
    ['ArrowDown', 'PageDown', 'forward', 'scroll-page', 'screen'],
  ])
    for (const shiftKey of [true, false]) {
      const expected = { unit: shiftKey ? select : scroll, direction, extend: shiftKey };
      assert.deepEqual(
        textNavigationShortcut(
          { key: raw, shiftKey, getModifierState: (k) => k === 'Fn' },
          'MacIntel',
        ),
        expected,
      );
      assert.deepEqual(textNavigationShortcut({ key: translated, shiftKey }, 'MacIntel'), expected);
    }
});
test('directional navigation and deletion distinguish Apple and Windows modifier conventions', () => {
  for (const [platform, modifier, horizontal, vertical] of [
    ['MacIntel', 'metaKey', 'line-boundary', 'flow'],
    ['MacIntel', 'altKey', 'word', 'paragraph'],
    ['Win32', 'ctrlKey', 'word-start', 'paragraph-start'],
  ])
    for (const [key, unit] of [
      ['ArrowLeft', horizontal],
      ['ArrowRight', horizontal],
      ['ArrowUp', vertical],
      ['ArrowDown', vertical],
    ]) {
      assert.equal(
        textNavigationShortcut({ key, [modifier]: true, shiftKey: true }, platform).unit,
        unit,
      );
    }
  for (const key of ['Home', 'End', 'PageUp', 'PageDown'])
    for (const shiftKey of [false, true]) {
      const homeEnd = key === 'Home' || key === 'End';
      assert.equal(
        textNavigationShortcut({ key, shiftKey }, 'Win32').unit,
        homeEnd ? 'line-boundary' : 'screen',
      );
      if (homeEnd)
        assert.equal(
          textNavigationShortcut({ key, ctrlKey: true, shiftKey }, 'Win32').unit,
          'flow',
        );
    }
  for (const [key, expected] of [
    ['Backspace', 'deleteWordBackward'],
    ['Delete', 'deleteWordForward'],
  ]) {
    for (const [platform, modifier] of [
      ['MacIntel', 'metaKey'],
      ['MacIntel', 'altKey'],
      ['Win32', 'ctrlKey'],
    ])
      assert.equal(textDeletionShortcut({ key, [modifier]: true }, platform), expected);
    for (const args of [
      { altKey: true, ctrlKey: true },
      { ctrlKey: true, isComposing: true },
      { ctrlKey: true, shiftKey: true },
    ])
      assert.equal(textDeletionShortcut({ key, ...args }, 'Win32'), null);
  }
  assert.equal(
    textDeletionShortcut({ key: 'Backspace', getModifierState: () => true }, 'MacIntel'),
    'deleteContentForward',
  );
  assert.equal(
    textDeletionShortcut(
      { key: 'Backspace', metaKey: true, getModifierState: () => true },
      'MacIntel',
    ),
    'deleteWordForward',
  );
});
test('Windows word and paragraph jumps land at the next start, with the original Shift anchor', () => {
  const text = 'One two\nThree four',
    nav = createTextNavigation(text);
  for (const [unit, forward, back] of [
    ['word-start', 4, 0],
    ['paragraph-start', 8, 0],
  ]) {
    for (const [direction, expected] of [
      ['forward', forward],
      ['backward', back],
    ]) {
      const options = { unit, direction };
      assert.equal(nav.move(2, options).index, expected);
      assert.deepEqual(nav.move(2, options), moveTextPosition(text, 2, options));
    }
    const selected = nav.selection(logicalSelection(2), { unit, extend: true });
    assert.equal(selected.anchor.index, 2);
    assert.equal(selected.focus.index, forward);
  }
  assert.equal(nav.selection(logicalSelection(2, 5), { unit: 'flow' }).focus.index, text.length);
});
