/** Tab traversal is reserved for a native-like field group, never the whole app chrome. */
export function handleFieldTab(event) {
  const target = event.target;
  if (
    event.defaultPrevented ||
    event.key !== 'Tab' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    !(target instanceof Element)
  )
    return false;
  const field = target.closest('input:not([type=hidden]),textarea,select'),
    group = target.closest('dialog[open],.canvas-properties,.canvas-contextual-bar');
  if (!field || !group) return false;
  const fields = [...group.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(
    (node) =>
      !node.matches(':disabled') && node.getClientRects().length && !node.closest('[inert]'),
  );
  const index = fields.indexOf(field);
  if (index < 0 || !fields.length) return false;
  event.preventDefault();
  fields[(index + (event.shiftKey ? -1 : 1) + fields.length) % fields.length].focus();
  return true;
}
