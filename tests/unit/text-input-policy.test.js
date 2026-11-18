import test from 'node:test';
import assert from 'node:assert/strict';
import { configureTextInput } from '../../desktop/text-input-policy.mjs';
test('Force Click lookup is disabled only through the Mac application preference', () => {
  const calls = [],
    preferences = { setUserDefault: (...args) => calls.push(args) };
  configureTextInput(preferences, 'darwin');
  assert.deepEqual(calls, [['com.apple.trackpad.forceClick', 'integer', 0]]);
  configureTextInput(preferences, 'win32');
  configureTextInput(preferences, 'linux');
  assert.equal(calls.length, 1);
});
