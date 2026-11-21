// Each view retains its selection and input handlers. Only the active view presents its
// controls at the workspace edges, so inspecting a different pane never reparents live text.
export function installSplitControls(shell) {
  const surface = document.createElement('div');
  surface.className = 'split-control-surface';
  surface.setAttribute('aria-hidden', 'true');
  shell.append(surface);
  const presentationClasses = ['show-properties', 'panels-hidden', 'tools-hidden'];
  let active = null,
    visibleClasses;
  const observer = new MutationObserver(reflect);
  function reflect() {
    const classes = active?.classList;
    shell.classList.toggle(
      'split-has-tools',
      !!classes?.contains('scene-editing') && !classes.contains('tools-hidden'),
    );
    shell.classList.toggle(
      'split-has-dock',
      !!classes?.contains('scene-editing') &&
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
      const next = editor || null;
      if (next === active && shell.classList.contains('split-controls') === split) return;
      shell.classList.toggle('split-controls', split);
      observer.disconnect();
      if (active)
        visibleClasses = presentationClasses.filter((name) => active.classList.contains(name));
      active = next;
      if (active) {
        if (visibleClasses)
          for (const name of presentationClasses)
            active.classList.toggle(name, visibleClasses.includes(name));
        if (split)
          observer.observe(active, { attributes: true, attributeFilter: ['class', 'style'] });
      }
      reflect();
    },
    destroy() {
      observer.disconnect();
      surface.remove();
    },
  };
}
