import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { inspectPublication } from '../../../domain/documents/preflight.js';

export function createPreflightPanel({ editor, publication, reveal }) {
  let digital = false,
    timer,
    target,
    lastHTML;
  try {
    digital = localStorage.getItem('ivo:preflight-profile') === 'digital';
  } catch {}
  function refresh() {
    clearTimeout(timer);
    if (!target) return;
    const issues = inspectPublication(...publication(digital));
    const groups = new Map();
    for (const issue of issues) {
      if (!groups.has(issue.group)) groups.set(issue.group, []);
      groups.get(issue.group).push(issue);
    }
    const errors = issues.length - (groups.get('Unchecked')?.length || 0);
    const summary =
      errors +
      (errors === 1 ? ' error' : ' errors') +
      (groups.has('Unchecked') ? ' · Incomplete' : '');
    const html =
      '<section class="preflight-report"><label>Profile <select data-preflight-profile><option value="basic">Basic</option><option value="digital"' +
      (digital ? ' selected' : '') +
      '>Digital publication</option></select></label><p role="status">' +
      summary +
      '</p>' +
      [...groups]
        .map(
          ([name, entries]) =>
            '<section><h4>' +
            esc(name) +
            ' (' +
            entries.length +
            ')</h4>' +
            entries
              .map(({ problem, detail, location }) => {
                const attributes = location.object
                  ? ' data-preflight-object="' + esc(location.object) + '"'
                  : location.parent
                    ? ' data-preflight-parent="' + esc(location.parent) + '"'
                    : '';
                const label =
                  '<span>' +
                  esc(problem) +
                  '</span><small>' +
                  esc(location.label || 'Document') +
                  (detail ? ' · ' + esc(detail) : '') +
                  '</small>';
                return attributes
                  ? '<button type="button"' + attributes + '>' + label + '</button>'
                  : '<div>' + label + '</div>';
              })
              .join('') +
            '</section>',
        )
        .join('') +
      '</section>';
    if (lastHTML !== html) {
      target.innerHTML = html;
      lastHTML = html;
    }
  }
  editor.addEventListener('change', (event) => {
    if (!event.target.matches('[data-preflight-profile]')) return;
    digital = event.target.value === 'digital';
    try {
      localStorage.setItem('ivo:preflight-profile', digital ? 'digital' : 'basic');
    } catch {}
    refresh();
  });
  editor.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preflight-object],[data-preflight-parent]');
    if (button) reveal(button.dataset.preflightObject, button.dataset.preflightParent);
  });
  return {
    render(content) {
      const first = content && !target;
      if (content !== target) lastHTML = null;
      target = content;
      clearTimeout(timer);
      if (!target) return;
      if (first) refresh();
      else timer = setTimeout(refresh, 175);
    },
    destroy() {
      clearTimeout(timer);
      target = null;
    },
  };
}
