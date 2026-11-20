export const CHARACTER_MENUS = Object.freeze([
  {
    path: ['Insert Special Character', 'Hyphens and Dashes'],
    commands: {
      'em-dash': { label: 'Em Dash', inputType: 'insertText', text: '\u2014' },
      'en-dash': { label: 'En Dash', inputType: 'insertText', text: '\u2013' },
      'nonbreaking-hyphen': {
        label: 'Nonbreaking Hyphen',
        inputType: 'insertText',
        text: '\u2011',
      },
      'discretionary-hyphen': {
        label: 'Discretionary Hyphen',
        inputType: 'insertText',
        text: '\u00ad',
      },
    },
  },
  {
    path: ['Insert Break Character'],
    commands: {
      'forced-line-break': { label: 'Forced Line Break', inputType: 'insertLineBreak', text: '' },
      'discretionary-line-break': {
        label: 'Discretionary Line Break',
        inputType: 'insertText',
        text: '\u200b',
      },
    },
  },
  {
    path: ['Insert White Space'],
    commands: {
      'nonbreaking-space': { label: 'Nonbreaking Space', inputType: 'insertText', text: '\u00a0' },
      'fixed-nonbreaking-space': {
        label: 'Nonbreaking Space (Fixed Width)',
        inputType: 'insertText',
        text: '\u202f',
      },
    },
  },
]);
export const INSERT_CHARACTERS = Object.freeze(
  Object.assign({}, ...CHARACTER_MENUS.map((group) => group.commands)),
);
export const NATIVE_TEXT_COMMANDS = Object.freeze([
  'bold',
  'italic',
  'underline',
  'keep-options',
  ...Object.keys(INSERT_CHARACTERS),
]);
export function textCommandEnabled(name, state) {
  return (
    state.canFormat &&
    (name !== 'keep-options' || state.canKeepOptions === true) &&
    (!Object.hasOwn(INSERT_CHARACTERS, name) || state.canInsertCharacter === true)
  );
}
export const NATIVE_TEXT_ACCELERATORS = Object.freeze({
  'keep-options': 'CmdOrCtrl+Alt+K',
  'discretionary-hyphen': 'CmdOrCtrl+Shift+-',
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
    ? {
        canFormat: true,
        textTarget: value.textTarget,
        ...(value.canInsertCharacter === true ? { canInsertCharacter: true } : {}),
        ...(value.canKeepOptions === true ? { canKeepOptions: true } : {}),
      }
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
