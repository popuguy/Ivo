/** Give the restored DOM and scheduled canvas work a paint before native presentation. */
export function afterStartupPaint() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );
}
export async function presentStartup(root, { failed = false } = {}) {
  root.dataset.startupState = failed ? 'error' : 'ready';
  root.setAttribute('aria-busy', 'false');
  // Newly mounted interface text starts the local font request. Reveal only after
  // those metrics settle, so the first interaction cannot race a font swap.
  root.getBoundingClientRect();
  await document.fonts?.ready;
  await afterStartupPaint();
  const windows = globalThis.ivoNative?.windows;
  if (failed) await windows?.failed?.();
  else await windows?.ready?.();
}
