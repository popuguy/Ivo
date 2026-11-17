import { icon } from './icons.js';

export function dialogMarkup(html, { prompt = false } = {}) {
  return `${prompt ? '' : `<button type="button" class="dialog-close icon-button" data-dialog-close aria-label="Close dialog">${icon('close')}</button>`}<form method="dialog" novalidate>${html}</form>`;
}

/** Native dialog backdrops retarget events to the dialog. Require a complete outside click,
 * rather than closing after a text selection or drag that began inside the window.
 */
export function installDialogDismissal(dialog, { canDismiss = () => true } = {}) {
  const controller = new AbortController();
  let origin;
  const listen = (target, name, fn) =>
    target.addEventListener(name, fn, { signal: controller.signal });
  const outside = (event) => {
    const r = dialog.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  };
  listen(dialog, 'pointerdown', (event) => {
    origin =
      event.button === 0 && event.isPrimary
        ? {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            outside: outside(event),
          }
        : null;
  });
  listen(dialog, 'pointercancel', () => (origin = null));
  listen(window, 'blur', () => (origin = null));
  listen(dialog, 'click', (event) => {
    const down = origin;
    origin = null;
    if (event.defaultPrevented || !canDismiss()) return;
    const close = event.target.closest('[data-dialog-close]');
    if (
      close ||
      (down?.outside &&
        outside(event) &&
        event.button === 0 &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5 &&
        Math.hypot(event.screenX - down.screenX, event.screenY - down.screenY) < 5)
    ) {
      event.preventDefault();
      dialog.close();
    }
  });
  listen(dialog, 'cancel', (event) => {
    if (!canDismiss()) event.preventDefault();
  });
  listen(dialog, 'close', () => (origin = null));
  return { destroy: () => controller.abort() };
}
