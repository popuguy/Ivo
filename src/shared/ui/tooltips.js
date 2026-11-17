/** Rectangular, nonmodal tooltips, kept outside the document's zoomed surface. */
export function installTooltips(host, { exclude = null } = {}) {
  const controller = new AbortController();
  let timer, tooltip, owner;
  function hide() {
    clearTimeout(timer);
    tooltip?.remove();
    tooltip = null;
    owner = null;
  }
  function targetFor(event) {
    const target = event.target.closest('[data-tooltip],[title]');
    return target && (!exclude || !target.closest(exclude)) ? target : null;
  }
  host.addEventListener(
    'pointerover',
    (event) => {
      const target = targetFor(event);
      if (
        !target ||
        (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) ||
        event.pointerType === 'touch'
      )
        return;
      hide();
      const text = target.dataset.tooltip || target.title;
      if (!text) return;
      owner = target;
      target.dataset.tooltip = text;
      target.removeAttribute('title');
      timer = setTimeout(() => {
        if (!target.isConnected) return;
        tooltip = document.createElement('div');
        tooltip.className = 'classic-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.textContent = text;
        document.body.append(tooltip);
        const rect = target.getBoundingClientRect(),
          bounds = tooltip.getBoundingClientRect();
        tooltip.style.left = Math.max(4, Math.min(rect.left, innerWidth - bounds.width - 4)) + 'px';
        tooltip.style.top =
          (rect.bottom + bounds.height + 10 > innerHeight
            ? rect.top - bounds.height - 4
            : rect.bottom + 6) + 'px';
      }, 600);
    },
    { signal: controller.signal },
  );
  host.addEventListener(
    'pointerout',
    (event) => {
      if (owner && event.relatedTarget instanceof Node && owner.contains(event.relatedTarget))
        return;
      hide();
    },
    { signal: controller.signal },
  );
  for (const name of ['pointerdown', 'keydown', 'wheel'])
    host.addEventListener(name, hide, { signal: controller.signal });
  window.addEventListener('blur', hide, { signal: controller.signal });
  return {
    destroy() {
      hide();
      controller.abort();
    },
  };
}
