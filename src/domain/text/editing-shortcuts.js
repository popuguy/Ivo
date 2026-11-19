// Compact Mac keyboards can expose either the translated key or the Fn chord.
const functionKeys = {
  ArrowLeft: 'Home',
  ArrowRight: 'End',
  ArrowUp: 'PageUp',
  ArrowDown: 'PageDown',
  Backspace: 'Delete',
};
function normalizedKey(event, apple) {
  return (apple && event.getModifierState?.('Fn') && functionKeys[event.key]) || event.key;
}
const applePlatform = (platform) => /Mac|iPad|iPhone/.test(platform);

export function textDeletionShortcut(event, platform) {
  if (event.isComposing || event.shiftKey) return null;
  const apple = applePlatform(platform);
  const key = normalizedKey(event, apple);
  if (key !== 'Delete' && key !== 'Backspace') return null;
  const word = apple
    ? !event.ctrlKey && Boolean(event.metaKey) !== Boolean(event.altKey)
    : event.ctrlKey && !event.altKey && !event.metaKey;
  if (word) return key === 'Backspace' ? 'deleteWordBackward' : 'deleteWordForward';
  if (key !== event.key && !event.metaKey && !event.ctrlKey && !event.altKey)
    return 'deleteContentForward';
  return null;
}

export function textNavigationShortcut(event, platform) {
  const { metaKey, ctrlKey, altKey } = event;
  const apple = applePlatform(platform);
  const key = normalizedKey(event, apple);
  // AppKit's editing aliases operate on the composed rows as well.
  if (apple && ctrlKey && !metaKey && !altKey && !event.isComposing) {
    const alias = {
      a: ['line-boundary', 'backward'],
      e: ['line-boundary', 'forward'],
      b: ['grapheme', 'backward'],
      f: ['grapheme', 'forward'],
      p: ['adjacent-line', 'backward'],
      n: ['adjacent-line', 'forward'],
    }[key.toLowerCase()];
    if (alias) return { unit: alias[0], direction: alias[1], extend: Boolean(event.shiftKey) };
  }
  if (
    event.isComposing ||
    (apple && ctrlKey) ||
    (!apple && (metaKey || altKey)) ||
    (metaKey && altKey)
  )
    return null;
  const forward = ['ArrowRight', 'ArrowDown', 'End', 'PageDown'].includes(key);
  const extend = Boolean(event.shiftKey);
  let unit;
  if (key === 'Home' || key === 'End') {
    if (apple && (metaKey || altKey)) return null;
    unit = apple ? (extend ? 'flow' : 'scroll-edge') : ctrlKey ? 'flow' : 'line-boundary';
  } else if (key === 'PageUp' || key === 'PageDown') {
    if (metaKey || ctrlKey) return null;
    unit = apple && !extend && !altKey ? 'scroll-page' : 'screen';
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (metaKey) unit = 'line-boundary';
    else if (ctrlKey) unit = 'word-start';
    else unit = altKey ? 'word' : 'grapheme';
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (metaKey) unit = 'flow';
    else if (ctrlKey) unit = 'paragraph-start';
    else unit = altKey ? 'paragraph' : 'adjacent-line';
  } else return null;
  return { unit, direction: forward ? 'forward' : 'backward', extend };
}
