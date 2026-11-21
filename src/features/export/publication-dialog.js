import { plainText } from '../../domain/text/html.js';
import { readingOrder } from './epub.js';

function orderControl(
  form,
  label,
  initial,
  options,
  { chapters = false, owner, excluded = [] } = {},
) {
  const group = document.createElement('fieldset'),
    legend = document.createElement('legend'),
    list = document.createElement('select'),
    actions = document.createElement('div'),
    omitted = new Set(excluded),
    labels = new Map(options),
    order = [...initial];
  group.className = 'publication-order-control';
  legend.textContent = label;
  list.setAttribute('aria-label', label);
  list.size = 5;
  group.append(legend, list, actions);
  form.insertBefore(group, form.querySelector('[type=submit]'));
  const addButton = (label, fn) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', fn);
    actions.append(btn);
    return btn;
  };
  function move(step) {
    const i = list.selectedIndex,
      j = i + step;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    draw(j);
    list.focus();
  }
  const up = addButton('Move up', () => move(-1)),
    down = addButton('Move down', () => move(1));
  const toggle = addButton(chapters ? 'Remove' : 'Exclude', () => {
    const i = list.selectedIndex,
      id = order[i];
    if (!id || (chapters && id === owner)) return;
    if (chapters) order.splice(i, 1);
    else if (omitted.has(id)) omitted.delete(id);
    else omitted.add(id);
    draw(Math.min(i, order.length - 1));
  });
  let add, source;
  if (chapters) {
    source = document.createElement('select');
    source.setAttribute('aria-label', 'Available documents');
    actions.append(source);
    add = addButton('Add chapter', () => {
      if (source.value && !order.includes(source.value)) {
        order.push(source.value);
        draw(order.length - 1);
      }
    });
  }
  function state() {
    const i = list.selectedIndex,
      id = order[i];
    up.disabled = i <= 0;
    down.disabled = i < 0 || i === order.length - 1;
    toggle.disabled = !id || (chapters && id === owner);
    if (!chapters) toggle.textContent = omitted.has(id) ? 'Include' : 'Exclude';
  }
  function draw(index) {
    list.replaceChildren(
      ...order.map(
        (id) =>
          new Option(
            (omitted.has(id) ? 'Excluded · ' : '') + (labels.get(id) || 'Missing document · ' + id),
            id,
          ),
      ),
    );
    list.selectedIndex = index;
    if (source) {
      const used = new Set(order);
      source.replaceChildren(
        ...options.filter(([id]) => !used.has(id)).map(([id, title]) => new Option(title, id)),
      );
      add.disabled = source.disabled = !source.length;
    }
    state();
  }
  list.addEventListener('change', state);
  list.addEventListener('keydown', (e) => {
    if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? -1 : 1);
    }
  });
  draw(order.length ? 0 : -1);
  return { order, omitted };
}

export function editPublicationOrder({ document: doc, documents, dialog, showDialog, save }) {
  const entries = readingOrder(doc, { editingOrder: true }),
    initial = doc.publication,
    pages = new Map(doc.pages.map((page, i) => [page.id, i + 1]));
  let items, book;
  const headings = new Map();
  showDialog(
    '<h2>Publication order</h2><button type="submit" class="button-primary">Save order</button>',
    async () => {
      await save({
        ...(headings.size ? { headings: Object.fromEntries(headings) } : {}),
        version: 1,
        order: [...items.order],
        excluded: [...items.omitted],
        chapters: [...book.order],
      });
      dialog.close();
    },
  );
  const form = dialog.querySelector('form');
  items = orderControl(
    form,
    'Reading order',
    entries.map((e) => e.id),
    entries.map(({ id, item, html }) => [
      id,
      'Page ' +
        pages.get(item.pageId) +
        ' · ' +
        (plainText(html).slice(0, 72) || item.alt || item.caption || item.type),
    ]),
    { excluded: initial?.excluded.filter((id) => entries.some((e) => e.id === id)) },
  );
  if (doc.publishing?.paragraphStyles.length) {
    const details = document.createElement('details'),
      summary = document.createElement('summary');
    summary.textContent = 'Paragraph styles in contents';
    details.append(summary);
    for (const style of doc.publishing.paragraphStyles) {
      const label = document.createElement('label'),
        pick = document.createElement('select');
      label.textContent = style.name;
      pick.add(new Option('Body text', ''));
      for (let level = 2; level <= 6; level++)
        pick.add(new Option('Heading ' + level, String(level)));
      const level = initial?.headings?.[style.id];
      if (level) {
        headings.set(style.id, level);
        pick.value = String(level);
      }
      pick.addEventListener('change', () => {
        if (pick.value) headings.set(style.id, Number(pick.value));
        else headings.delete(style.id);
      });
      label.append(pick);
      details.append(label);
    }
    form.insertBefore(details, form.querySelector('[type=submit]'));
  }
  book = orderControl(
    form,
    'Book chapters',
    initial?.chapters.length ? initial.chapters : [doc.id],
    documents.map((d) => [d.id, d.title]),
    { chapters: true, owner: doc.id },
  );
}
