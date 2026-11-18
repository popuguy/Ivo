import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_TEXT_COMMANDS,
  MAX_TEXT_COMMAND_TARGET,
  nativeTextMenuState,
  nativeTextCommand,
  matchesNativeTextCommand,
} from '../../src/domain/text/native-commands.js';
test('native text menu accepts only a bounded paired formatting capability', () => {
  const token = JSON.stringify(['document', 2, 'frame', 'flow', 1, 5, 'forward', 'backward']);
  assert.deepEqual(nativeTextMenuState({ canFormat: true, textTarget: token }), {
    canFormat: true,
    textTarget: token,
  });
  for (const state of [
    null,
    {},
    { canFormat: true },
    { canFormat: true, textTarget: '' },
    { canFormat: true, textTarget: new Array(1) },
    { canFormat: true, textTarget: 'x'.repeat(MAX_TEXT_COMMAND_TARGET + 1) },
    { canFormat: false, textTarget: token },
  ])
    assert.deepEqual(nativeTextMenuState(state), { canFormat: false, textTarget: '' });
});
test('native formatting descriptors reject arbitrary actions and stale or absent renderer targets', () => {
  const token = 'opaque-current-range';
  for (const name of NATIVE_TEXT_COMMANDS) {
    const command = { name, textTarget: token, ignored: 'not forwarded' };
    assert.deepEqual(nativeTextCommand(command), { name, textTarget: token });
    assert.equal(matchesNativeTextCommand(command, token), true);
    assert.equal(matchesNativeTextCommand(command, 'another-range'), false);
    assert.equal(matchesNativeTextCommand(command, null), false);
  }
  for (const value of [
    'italic',
    null,
    [],
    { name: 'delete', textTarget: token },
    { name: 'italic', textTarget: '' },
    { name: 'italic', textTarget: 'x'.repeat(MAX_TEXT_COMMAND_TARGET + 1) },
  ])
    assert.equal(nativeTextCommand(value), null);
});
