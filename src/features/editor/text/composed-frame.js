// Keep the SVG (and its screen transform) alive during editing. Unchanged
// outlines and line groups survive even when a new PDF snapshot token arrives.
export function patchComposedFrame(element, before, after) {
  if (
    !before?.native ||
    !after?.native ||
    before.columns.length !== after.columns.length ||
    element.children.length !== after.columns.length
  )
    return false;
  const columns = Array.from(element.children);
  for (const [i, node] of columns.entries()) {
    const a = before.columns[i],
      b = after.columns[i],
      svg = node.firstElementChild;
    if (
      !a.paint ||
      !b.paint ||
      a.id !== b.id ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.left !== b.left ||
      a.top !== b.top ||
      svg?.localName !== 'svg' ||
      svg.children.length !== 4
    )
      return false;
  }
  for (const [i, node] of columns.entries()) {
    const old = before.columns[i].paint,
      next = after.columns[i].paint,
      svg = node.firstElementChild;
    if (before.columns[i].bottomOverhang !== after.columns[i].bottomOverhang) {
      const overhang = after.columns[i].bottomOverhang || 0;
      node.toggleAttribute('data-bottom-overhang', overhang > 0);
      node.style.setProperty('--ink-bottom', overhang + 'px');
    }
    const defs = svg.firstElementChild;
    for (const path of [...defs.children]) if (!next.outlines.has(path.id)) path.remove();
    for (const [id, d] of next.outlines) {
      if (old.outlines.get(id) === d) continue;
      let path = defs.querySelector('#' + CSS.escape(id));
      if (!path) {
        path = document.createElementNS(svg.namespaceURI, 'path');
        path.id = id;
        defs.append(path);
      }
      path.setAttribute('d', d);
    }
    for (let plane = 0; plane < 3; plane++) {
      const parent = svg.children[plane + 1],
        rows = next.planes[plane];
      while (parent.childElementCount > rows.length) parent.lastElementChild.remove();
      for (let j = 0; j < rows.length; j++) {
        let group = parent.children[j];
        if (!group) {
          group = document.createElementNS(svg.namespaceURI, 'g');
          parent.append(group);
        }
        if (plane === 1 && old.starts[j] !== next.starts[j])
          group.dataset.lineStart = next.starts[j];
        if (old.planes[plane][j] !== rows[j]) group.innerHTML = rows[j];
      }
    }
    if (old.label !== next.label) svg.setAttribute('aria-label', next.label);
    if (old.token !== next.token) svg.dataset.compositionToken = next.token;
  }
  return true;
}
