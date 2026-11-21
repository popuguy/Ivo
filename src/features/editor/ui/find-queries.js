const prefix = 'ivo.find-change.query.';
const presets = [
  { name: 'Multiple Spaces to Single Space', mode: 'grep', needle: ' {2,}', replacement: ' ' },
  { name: 'Remove Trailing Space', mode: 'grep', needle: '\\h+$', replacement: '' },
  {
    name: 'Multiple Returns to Single Return',
    mode: 'grep',
    needle: '\\r{2,}',
    replacement: '\\r',
  },
];
function savedQueries() {
  const list = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const q = JSON.parse(localStorage.getItem(key));
        if (
          q &&
          ['text', 'grep'].includes(q.mode) &&
          typeof q.needle === 'string' &&
          typeof q.replacement === 'string'
        )
          list.push({ ...q, name: key.slice(prefix.length) });
      } catch {
        /* Ignore an unreadable preference entry. */
      }
    }
  } catch {
    /* Built-in queries also work without local preferences. */
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Queries store editing preferences on this device. Scope belongs to the open document. */
export function installFindQueries(form, { read, apply, report }) {
  const field = (name) => form.elements.namedItem(name);
  const select = field('query');
  const remove = field('delete-query');
  const entry = form.querySelector('[data-query-entry]');
  let queries;
  function refresh(id = '') {
    queries = new Map();
    select.replaceChildren(new Option('Custom', ''));
    for (const [group, items] of [
      ['Presets', presets],
      ['Saved queries', savedQueries()],
    ]) {
      const options = document.createElement('optgroup');
      options.label = group;
      for (const q of items) {
        const value = group + '/' + q.name;
        queries.set(value, q);
        options.append(new Option(q.name, value));
      }
      if (items.length) select.append(options);
    }
    select.value = id;
    remove.disabled = !select.value.startsWith('Saved queries/');
  }
  refresh();
  select.addEventListener('change', () => {
    entry.hidden = true;
    const query = queries.get(select.value);
    if (query) apply(query);
    remove.disabled = !select.value.startsWith('Saved queries/');
  });
  field('save-query').onclick = () => {
    entry.hidden = !entry.hidden;
    if (!entry.hidden) {
      field('query-name').value = '';
      field('query-name').focus();
    }
  };
  function save() {
    const name = field('query-name').value.trim();
    if (!name) return report('Enter a name for the query.');
    const query = read();
    if (!query.needle && !query.findFormat)
      return report('Enter a search or choose a find format.');
    try {
      if (localStorage.getItem(prefix + name) !== null)
        return report('A query with that name already exists.');
      localStorage.setItem(prefix + name, JSON.stringify(query));
    } catch {
      return report('This device could not save the query.');
    }
    refresh('Saved queries/' + name);
    entry.hidden = true;
    report('Query saved.');
  }
  field('confirm-query').onclick = save;
  field('query-name').onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      save();
    }
  };
  remove.onclick = () => {
    if (!select.value.startsWith('Saved queries/')) return;
    try {
      localStorage.removeItem(prefix + queries.get(select.value).name);
    } catch {
      return report('This device could not delete the query.');
    }
    refresh();
    report('Query deleted.');
  };
  return () => {
    select.value = '';
    remove.disabled = true;
  };
}
