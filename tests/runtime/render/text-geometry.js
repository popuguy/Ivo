/** Measure document-space character rectangles, independently of the camera implementation. */
export function textGeometry(root, zoom) {
  const origin = root.getBoundingClientRect(),
    walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    result = [];
  let node;
  while ((node = walker.nextNode())) {
    for (let offset = 0; offset < node.length;) {
      const char = String.fromCodePoint(node.data.codePointAt(offset)),
        range = document.createRange();
      range.setStart(node, offset);
      offset += char.length;
      range.setEnd(node, offset);
      const rect = range.getBoundingClientRect();
      result.push({
        char,
        x: (rect.x - origin.x) / zoom,
        y: (rect.y - origin.y) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      });
    }
  }
  return result;
}

export function geometryDifference(before, after) {
  if (before.length !== after.length || before.some((value, i) => value.char !== after[i].char))
    throw Error('Zoom changed the text source');
  let maximum = 0,
    worst = null;
  for (let i = 0; i < before.length; i++)
    for (const key of ['x', 'y', 'width', 'height']) {
      const error = Math.abs(before[i][key] - after[i][key]);
      if (error > maximum) {
        maximum = error;
        worst = {
          index: i,
          char: before[i].char,
          key,
          before: before[i][key],
          after: after[i][key],
        };
      }
    }
  return { maximum, worst };
}
