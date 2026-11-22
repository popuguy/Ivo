import { escapeHTML as esc } from '../../shared/html/sanitize.js';
import { icon } from '../../shared/ui/icons.js';
import { showNavigationMenu } from './menu.js';

const actions = `
  <div class="vault-picker-card">
    <div class="vault-picker-action">
      <div><h2>Create new vault</h2><p>Create a new Ivo vault under a folder.</p></div>
      <button class="vault-picker-primary" data-picker="create">Create</button>
    </div>
    <div class="vault-picker-action">
      <div><h2>Open folder as vault</h2><p>Choose an existing Ivo vault or an empty folder.</p></div>
      <button data-picker="choose">Open</button>
    </div>
  </div>`;

const setup = `
  <button class="vault-picker-back" data-picker="back">‹ Back</button>
  <form class="vault-picker-card">
    <div class="vault-picker-action">
      <label for="new-vault-name">Vault name</label>
      <input id="new-vault-name" name="name" autocomplete="off" maxlength="80">
    </div>
    <div class="vault-picker-action">
      <div><h2>Location</h2><p>Choose where to create the vault folder.</p></div>
      <button class="vault-picker-primary" type="submit" disabled>Choose…</button>
    </div>
  </form>`;

function vaultRow(entry) {
  return `<div class="vault-list-row" data-id="${esc(entry.id)}">
    <button class="vault-list-open" data-vault-open="${esc(entry.id)}" title="${esc(entry.path)}">
      <strong>${esc(entry.name)}</strong><span>${esc(entry.parent)}</span>
    </button>
    <button class="vault-list-options" aria-label="Options for ${esc(entry.name)}"
      aria-haspopup="menu" aria-expanded="false" title="More options">${icon('dots')}</button>
  </div>`;
}

export async function mountVaultPicker(root, version, onError) {
  const native = globalThis.ivoNative,
    api = native.vaults;
  document.title = 'Ivo vaults';
  root.setAttribute('aria-label', 'Ivo vaults');
  root.innerHTML = `<main class="vault-manager">
    <aside aria-label="Recent vaults"><div class="vault-list"></div></aside>
    <section aria-label="Vault setup"><header><h1>Ivo</h1><p>Version ${esc(version)}</p></header>
      <div class="vault-picker-actions">${actions}</div>
    </section></main>`;
  const picker = root.firstElementChild,
    list = picker.querySelector('.vault-list'),
    pane = picker.querySelector('.vault-picker-actions');
  let entries = [],
    revision = 0,
    busy = false;

  async function refresh() {
    const request = ++revision,
      next = await api.list();
    if (request !== revision) return;
    entries = next;
    const focused = document.activeElement,
      row = focused?.closest('.vault-list-row');
    const content = next.map(vaultRow).join('');
    // Keep the list's scroll position and restore keyboard focus on registry updates.
    list.innerHTML = content;
    picker.querySelector('aside').hidden = !next.length;
    if (row) {
      const target = [...list.children].find((entry) => entry.dataset.id === row.dataset.id);
      (
        target?.querySelector(
          focused.matches('.vault-list-options') ? '.vault-list-options' : '.vault-list-open',
        ) ||
        list.querySelector('button') ||
        pane.querySelector('button')
      )?.focus({ preventScroll: true });
    }
  }

  async function options(row, event) {
    const entry = entries.find((item) => item.id === row.dataset.id);
    if (!entry) return;
    const anchor = row.querySelector('.vault-list-options');
    anchor.setAttribute('aria-expanded', 'true');
    try {
      const action = await showNavigationMenu(
        [
          { id: 'show', label: 'Open vault folder' },
          { type: 'separator' },
          { id: 'forget', label: 'Remove from list', enabled: !entry.open },
        ],
        { anchor, native: false, label: 'Vault options', x: event?.clientX, y: event?.clientY },
      );
      if (action === 'show') {
        const message = await api.show(entry.id);
        if (message) throw new Error(message);
      }
      if (action === 'forget') await api.forget(entry.id);
    } finally {
      anchor.setAttribute('aria-expanded', 'false');
    }
  }

  function showActions() {
    pane.innerHTML = actions;
    pane.querySelector('[data-picker="create"]').focus();
  }
  async function open(operation) {
    if (busy) return;
    busy = true;
    picker.setAttribute('aria-busy', 'true');
    try {
      const result = await operation();
      if (!result.canceled) await native.windows.close();
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
      picker.removeAttribute('aria-busy');
    }
  }

  picker.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    const row = button.closest('.vault-list-row');
    if (row) {
      if (button.matches('.vault-list-options')) void options(row).catch(onError);
      else void open(() => api.open(row.dataset.id));
    } else if (button.dataset.picker === 'create') {
      pane.innerHTML = setup;
      pane.querySelector('input').focus();
    } else if (button.dataset.picker === 'back') showActions();
    else if (button.dataset.picker === 'choose') void open(() => api.choose());
  });
  picker.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.vault-list-row');
    if (!row) return;
    event.preventDefault();
    void options(row, event).catch(onError);
  });
  pane.addEventListener('input', (event) => {
    if (event.target.name === 'name')
      event.target.form.querySelector('[type="submit"]').disabled = !event.target.value.trim();
  });
  pane.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = event.target.elements.name.value.trim();
    if (name) void open(() => api.create(name));
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pane.querySelector('form') && !busy) showActions();
  });
  native.onVaultsChanged(() => refresh().catch(onError));
  await refresh();
}
