/** Trusted input: click counts come from the host, never fabricated DOM detail. */
export async function selectWithMouse(contents, { from, to = from, clicks = 1 }) {
  if (
    ![1, 2, 3].includes(clicks) ||
    ![from, to].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
  )
    throw Error('Invalid text-selection gesture');
  const at = (p) => ({ x: Math.round(p[0]), y: Math.round(p[1]) });
  contents.sendInputEvent({ type: 'mouseMove', ...at(from) });
  for (let clickCount = 1; clickCount <= clicks; clickCount++) {
    contents.sendInputEvent({ type: 'mouseDown', ...at(from), button: 'left', clickCount });
    if (clickCount === clicks && to !== from)
      for (let i = 1; i <= 20; i++) {
        await new Promise((r) => setTimeout(r, 8));
        contents.sendInputEvent({
          type: 'mouseMove',
          ...at(from.map((v, axis) => v + ((to[axis] - v) * i) / 20)),
          button: 'left',
          modifiers: ['leftButtonDown'],
        });
      }
    contents.sendInputEvent({
      type: 'mouseUp',
      ...at(clickCount === clicks ? to : from),
      button: 'left',
      clickCount,
    });
  }
}
