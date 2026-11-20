// Each view retains its selection and input handlers. Only the active view presents its
// controls at the workspace edges, so inspecting a different pane never reparents live text.
export function installSplitControls(shell) {
  const surface = document.createElement('div');
  surface.className = 'split-control-surface';
  surface.setAttribute('aria-hidden', 'true');
  shell.append(surface);
  let active = null;
  const observer = new MutationObserver(reflect);
  function reflect() {
    const classes = active?.classList;
    shell.classList.toggle(
      'split-has-tools',
      !!classes?.contains('scene-editing') && !classes.contains('tools-hidden'),
    );
    shell.classList.toggle(
      'split-has-dock',
      !!classes &&
        !classes.contains('panels-hidden') &&
        !classes.contains('panel-floating') &&
        !classes.contains('panel-collapsed'),
    );
    const width = active?.style.getPropertyValue('--context-panel-width') || '';
    if (width !== shell.style.getPropertyValue('--split-dock-width'))
      shell.style.setProperty('--split-dock-width', width);
  }
  return {
    surface,
    bind(editor, split) {
      shell.classList.toggle('split-controls', split);
      const next = split ? editor : null;
      if (next === active) return;
      observer.disconnect();
      active = next;
      if (active)
        observer.observe(active, { attributes: true, attributeFilter: ['class', 'style'] });
      reflect();
    },
    destroy() {
      observer.disconnect();
      surface.remove();
    },
  };
}
