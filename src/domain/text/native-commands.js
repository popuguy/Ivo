export const NATIVE_TEXT_COMMANDS = Object.freeze(['bold', 'italic', 'underline']);
export const NATIVE_TEXT_ACCELERATORS = Object.freeze({
  bold: 'CmdOrCtrl+B',
  italic: 'CmdOrCtrl+I',
  underline: 'CmdOrCtrl+Shift+U',
});
export const MAX_TEXT_COMMAND_TARGET = 16384;
const validTarget = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_COMMAND_TARGET;

/** An opaque selection identity, not document text or executable IPC fields. Invalid state disables formatting. */
export function nativeTextMenuState(value) {
  return value?.canFormat === true && validTarget(value.textTarget)
    ? { canFormat: true, textTarget: value.textTarget }
    : { canFormat: false, textTarget: '' };
}

export function nativeTextCommand(value) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    NATIVE_TEXT_COMMANDS.includes(value.name) &&
    validTarget(value.textTarget)
    ? { name: value.name, textTarget: value.textTarget }
    : null;
}

/** Recheck at invocation: native enabled state may be stale after a caret, field or document change. */
export function matchesNativeTextCommand(value, currentTarget) {
  const command = nativeTextCommand(value);
  return !!command && validTarget(currentTarget) && command.textTarget === currentTarget;
}
