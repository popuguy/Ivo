import {
  preflightPresets,
  preflightProfile,
} from '../../../domain/documents/preflight-profiles.js';
import { editPreflightProfile } from './preflight-profile-dialog.js';
import { uid } from '../../../domain/documents/model.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { inspectPublication } from '../../../domain/documents/preflight.js';

export function createPreflightPanel({ editor, publication, reveal }) {
  const selectionKey = 'ivo:preflight-profile',
    definitionsKey = 'ivo:preflight-definitions:1';
  let selected = 'basic',
    custom = {},
    timer,
    target,
    lastHTML,
    dialog;
  function readProfiles() {
    try {
      const stored = JSON.parse(localStorage.getItem(definitionsKey) || '{}');
      const restored = {};
      for (const [id, value] of Object.entries(stored)) {
        if (!/^profile-[\w-]{1,100}$/.test(id)) continue;
        try {
          restored[id] = preflightProfile(value);
        } catch {}
      }
      custom = restored;
      selected = localStorage.getItem(selectionKey) || 'basic';
    } catch {}
    if (!Object.hasOwn(preflightPresets, selected) && !Object.hasOwn(custom, selected))
      selected = 'basic';
  }
  function choose(id) {
    selected = id;
    try {
      localStorage.setItem(selectionKey, id);
    } catch {}
    refresh();
  }
  function storeProfiles(next) {
    localStorage.setItem(definitionsKey, JSON.stringify(next));
    custom = next;
  }
  const active = () => custom[selected] || preflightPresets[selected];
  readProfiles();
  function refresh() {
    clearTimeout(timer);
    if (!target) return;
    const issues = inspectPublication(...publication(active()));
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
      '<section class="preflight-report"><label>Profile <select data-preflight-profile>' +
      Object.entries({ ...preflightPresets, ...custom })
        .map(
          ([id, p]) =>
            '<option value="' +
            esc(id) +
            '"' +
            (id === selected ? ' selected' : '') +
            '>' +
            esc(p.name) +
            '</option>',
        )
        .join('') +
      '</select></label><button type="button" data-new-profile>New profile…</button>' +
      (Object.hasOwn(custom, selected)
        ? '<button type="button" data-edit-profile>Edit profile…</button>'
        : '') +
      '<p role="status">' +
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
  const listeners = new AbortController(),
    options = { signal: listeners.signal };
  window.addEventListener(
    'storage',
    (event) => {
      if (event.key === selectionKey || event.key === definitionsKey || event.key === null) {
        readProfiles();
        refresh();
      }
    },
    options,
  );
  editor.addEventListener(
    'load',
    (event) => {
      if (
        target &&
        active().checks.includes('resolution') &&
        event.target.matches?.('.canvas-image-frame img')
      ) {
        clearTimeout(timer);
        timer = setTimeout(refresh, 175);
      }
    },
    { ...options, capture: true },
  );
  editor.addEventListener(
    'change',
    (event) => {
      if (event.target.matches('[data-preflight-profile]')) choose(event.target.value);
    },
    options,
  );
  editor.addEventListener(
    'click',
    (event) => {
      const edit = event.target.closest('[data-edit-profile]'),
        create = event.target.closest('[data-new-profile]');
      if (edit || create) {
        if (dialog?.open) return;
        const id = edit ? selected : uid('profile-');
        dialog = editPreflightProfile(active(), {
          editing: !!edit,
          save(profile) {
            readProfiles();
            if (edit && !Object.hasOwn(custom, id))
              throw Error('This profile was removed in another window.');
            if (!edit && Object.keys(custom).length >= 64)
              throw Error('Up to 64 custom profiles can be saved.');
            if (
              Object.entries({ ...preflightPresets, ...custom }).some(
                ([key, p]) => key !== id && p.name.toLowerCase() === profile.name.toLowerCase(),
              )
            )
              throw Error('Choose a different profile name.');
            storeProfiles({ ...custom, [id]: profile });
            choose(id);
          },
          remove() {
            readProfiles();
            const next = { ...custom };
            delete next[id];
            storeProfiles(next);
            choose('basic');
          },
        });
        return;
      }
      const button = event.target.closest('[data-preflight-object],[data-preflight-parent]');
      if (button) reveal(button.dataset.preflightObject, button.dataset.preflightParent);
    },
    options,
  );
  return {
    render(content) {
      const first = content && !target;
      if (content !== target) lastHTML = null;
      target = content;
      clearTimeout(timer);
      if (!target) return;
      if (first) {
        readProfiles();
        refresh();
      } else timer = setTimeout(refresh, 175);
    },
    destroy() {
      listeners.abort();
      if (dialog?.open) dialog.close();
      clearTimeout(timer);
      target = null;
    },
  };
}
