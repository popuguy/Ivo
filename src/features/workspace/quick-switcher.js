import { icon } from '../../shared/ui/icons.js';
import { quickSwitcherResults } from '../../domain/knowledge/navigation.js';
import { escapeHTML as esc } from '../../shared/html/sanitize.js';
/** Accessible quick-switcher UI; document creation and opening are application commands. */
export function showQuickSwitcher({
  dialog,
  showDialog,
  documents,
  recentIds,
  activeId,
  onCreate,
  onOpen,
}) {
  if (dialog.open && dialog.dataset.dialogKind === 'prompt') {
    dialog.querySelector('#quick-search')?.focus();
    return;
  }
  showDialog(
    `<label class="prompt-input"><input id="quick-search" maxlength="180" placeholder="Type to switch or create…" aria-label="Open document" role="combobox" aria-expanded="true" aria-controls="quick-results" aria-autocomplete="list" autofocus autocomplete="off"><button type="button" class="prompt-clear icon-button" aria-label="Close quick switcher">${icon('close')}</button></label><div id="quick-results" class="quick-results link-options" role="listbox" aria-label="Documents"></div><p class="prompt-instructions">↑ ↓ Select · Enter Open · ⌘Enter New tab · ⌘⌥Enter Right pane · Shift+Enter New document</p>`,
    undefined,
    { prompt: true },
  );
  const input = dialog.querySelector('#quick-search'),
    list = dialog.querySelector('.quick-results');
  const clear = dialog.querySelector('.prompt-clear');
  clear.addEventListener('pointerdown', (event) => {
    if (input.value) event.preventDefault();
  });
  clear.addEventListener('click', () => {
    if (!input.value) return dialog.close();
    input.value = '';
    selected = 0;
    update();
    input.focus();
  });
  let selected = 0,
    matches = [];
  function highlight() {
    [...list.querySelectorAll('[data-quick]')].forEach((button, index) => {
      button.classList.toggle('active', index === selected);
      button.setAttribute('aria-selected', String(index === selected));
    });
    if (matches[selected]) input.setAttribute('aria-activedescendant', 'quick-option-' + selected);
    else input.removeAttribute('aria-activedescendant');
  }
  function update() {
    matches = quickSwitcherResults(documents, input.value, { recentIds, activeId });
    selected = Math.min(selected, Math.max(0, matches.length - 1));
    clear.setAttribute('aria-label', input.value ? 'Clear search' : 'Close quick switcher');
    list.innerHTML =
      matches
        .map(
          ({ document: d, alias }, i) =>
            `<button type="button" id="quick-option-${i}" role="option" tabindex="-1" data-quick="${esc(d.id)}"><span>${esc(d.title)}</span>${alias ? `<small>${esc(alias)}</small>` : ''}</button>`,
        )
        .join('') || '<p class="small-empty">No matching documents. Enter creates a document.</p>';
    highlight();
  }
  input.addEventListener('input', () => {
    selected = 0;
    update();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') {
      const title = input.value.trim().slice(0, 180);
      if (event.shiftKey || !matches.length) {
        if (title) onCreate(title);
      } else if (matches[selected]) {
        const id = matches[selected].document.id;
        dialog.close();
        onOpen(id, {
          newTab: event.metaKey || event.ctrlKey,
          toRight: (event.metaKey || event.ctrlKey) && event.altKey,
        });
      }
    } else if (matches.length) {
      selected =
        (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      highlight();
      list.children[selected]?.scrollIntoView({ block: 'nearest' });
    }
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick]');
    if (button) {
      dialog.close();
      onOpen(button.dataset.quick, {
        newTab: event.metaKey || event.ctrlKey,
        toRight: (event.metaKey || event.ctrlKey) && event.altKey,
      });
    }
  });
  update();
  input.focus();
}
