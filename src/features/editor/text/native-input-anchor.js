/** Keep the existing native input owner while its presentation uses composed glyphs. */
function linearParentMatrix(root) {
  let result = new DOMMatrix();
  for (let node = root.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node),
      transform = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
    if (
      ['m13', 'm14', 'm23', 'm24', 'm31', 'm32', 'm34', 'm43'].some(
        (key) => Math.abs(transform[key]) > 1e-6,
      ) ||
      Math.abs(transform.m44 - 1) > 1e-6
    )
      return null;
    let local = new DOMMatrix([transform.a, transform.b, transform.c, transform.d, 0, 0]);
    if (style.rotate && style.rotate !== 'none') {
      const match = style.rotate.match(/^(?:z\s+)?(-?[\d.]+)(deg|rad|turn|grad)$/);
      if (!match) return null;
      const degrees =
        Number(match[1]) * { deg: 1, rad: 180 / Math.PI, turn: 360, grad: 0.9 }[match[2]];
      local = new DOMMatrix().rotate(degrees).multiply(local);
    }
    if (style.scale && style.scale !== 'none') {
      const values = style.scale
        .split(/\s+/)
        .map((value) => (value.endsWith('%') ? parseFloat(value) / 100 : Number(value)));
      if (!values.every(Number.isFinite) || values.length > 2) return null;
      local = new DOMMatrix().scale(values[0], values[1] ?? values[0]).multiply(local);
    }
    const zoom = parseFloat(style.zoom) || 1;
    result = new DOMMatrix().scale(zoom).multiply(local).multiply(result);
  }
  return Math.abs(result.a * result.d - result.b * result.c) > 1e-9 ? result : null;
}
function caretBounds(root) {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount || !root.contains(selection.anchorNode))
    return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = [...range.getClientRects()].find((r) => r.height > 0);
  return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
}

/**
 * Anchor the same contenteditable's native caret query to composed presentation.
 * Only individual CSS translate is owned here; source, fonts, width/height, text
 * nodes and selection remain intact. Align the bottom-left IME query point and
 * report any height difference instead of changing authoring/layout metrics.
 */
export function createNativeInputAnchor(
  root,
  { allowed = () => true, isComposing = () => false } = {},
) {
  const controller = new AbortController(),
    original = root.style.translate;
  let x = 0,
    y = 0,
    composing = false,
    pending = null,
    alive = true;
  function reset() {
    root.style.translate = original;
    x = y = 0;
    pending = null;
  }
  function update(target) {
    if (!alive || !allowed()) return { applied: false, reason: 'inactive-owner' };
    if (!target || !['x', 'y', 'height'].every((key) => Number.isFinite(target[key]))) {
      reset();
      return { applied: false, reason: 'missing-native-caret' };
    }
    pending = { ...target };
    if (composing || isComposing())
      return { applied: false, deferred: true, reason: 'composition-active' };
    if (original && original !== 'none')
      return { applied: false, reason: 'input-translate-already-owned' };
    const source = caretBounds(root),
      basis = linearParentMatrix(root);
    if (!source || !basis)
      return {
        applied: false,
        reason: source ? 'unsupported-parent-transform' : 'native-input-caret-unavailable',
      };
    const delta = new DOMPoint(
      target.x - source.x,
      target.y + target.height - source.y - source.height,
    ).matrixTransform(basis.inverse());
    if (Math.abs(delta.x) > 0.001 || Math.abs(delta.y) > 0.001) {
      x += delta.x;
      y += delta.y;
      root.style.translate = `${x}px ${y}px`;
    }
    const measured = caretBounds(root);
    return {
      applied: true,
      source,
      target: { ...target },
      measured,
      translation: { x, y },
      residual: measured
        ? {
            x: measured.x - target.x,
            bottom: measured.y + measured.height - target.y - target.height,
            height: measured.height - target.height,
          }
        : null,
    };
  }
  root.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    { signal: controller.signal },
  );
  root.addEventListener(
    'compositionend',
    () => {
      composing = false;
      queueMicrotask(() => {
        if (alive && root.isConnected && pending) update(pending);
      });
    },
    { signal: controller.signal },
  );
  return {
    update,
    reset,
    get composing() {
      return composing || isComposing();
    },
    destroy() {
      if (!alive) return;
      alive = false;
      controller.abort();
      reset();
    },
  };
}
