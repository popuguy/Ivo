import { indexSettings } from '../../../domain/documents/subject-index.js';
import { pageFolios } from '../../../domain/documents/page-sections.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';

export function indexHTML(doc, matches, settings, { allowEmpty = false } = {}) {
  const tree = new Map(),
    folios = pageFolios(doc.pages);
  const nodes = new Map();
  function topic(path) {
    const key = JSON.stringify(path);
    if (nodes.has(key)) return nodes.get(key);
    const siblings = path.length === 1 ? tree : topic(path.slice(0, -1)).children;
    const node = { name: path.at(-1), children: new Map(), pages: [], references: [] };
    siblings.set(node.name, node);
    nodes.set(key, node);
    return node;
  }
  doc.pages.forEach((page, i) => {
    for (const key of new Set((matches.get(page.id) || []).map((hit) => hit.title)))
      topic(JSON.parse(key)).pages.push(i);
  });
  function firstPage(node) {
    if (!node) return undefined;
    const pages = [node.pages[0], ...[...node.children.values()].map(firstPage)].filter(
      Number.isInteger,
    );
    return pages.length ? Math.min(...pages) : undefined;
  }
  for (const ref of settings.references || []) {
    const target = nodes.get(JSON.stringify(ref.to)),
      page = firstPage(target);
    if (page === undefined)
      throw Error('No printed entry for the index reference to ' + ref.to.join(' > ') + '.');
    topic(ref.from).references.push({ ...ref, page });
  }
  for (const item of settings.sortKeys || []) {
    const node = nodes.get(JSON.stringify(item.path));
    if (node) node.sortKey = item.key;
  }
  if (!tree.size && !allowEmpty)
    throw Error('No matching topics on the printed pages. Check spelling and capitalization.');
  const collator = new Intl.Collator(doc.language || 'en', { numeric: true });
  const rows = [];
  if (settings.title) rows.push('<p><strong>' + esc(settings.title) + '</strong></p>');
  const link = (i) => '<a href="#page=' + esc(doc.pages[i].id) + '">' + esc(folios[i]) + '</a>';
  function append(siblings, depth) {
    for (const node of [...siblings.values()].sort(
      (a, b) =>
        collator.compare(a.sortKey || a.name, b.sortKey || b.name) ||
        collator.compare(a.name, b.name),
    )) {
      const { name, children, references } = node;
      const pages = references.some((ref) => ref.kind === 'see') ? [] : node.pages;
      const refs = [];
      for (let j = 0; j < pages.length; j++) {
        const first = pages[j];
        while (
          settings.ranges &&
          j + 1 < pages.length &&
          pages[j + 1] === pages[j] + 1 &&
          !doc.pages[pages[j + 1]].section
        )
          j++;
        refs.push(first === pages[j] ? link(first) : link(first) + '–' + link(pages[j]));
      }
      for (const ref of references)
        refs.push(
          '<em>' +
            (ref.kind === 'see' ? 'See' : 'See also') +
            '</em> <a href="#page=' +
            esc(doc.pages[ref.page].id) +
            '">' +
            esc(ref.to.join(' > ')) +
            '</a>',
        );
      rows.push(
        '<p' +
          (depth ? ' data-ivo-left="' + depth * 12 + '"' : '') +
          '>' +
          esc(name) +
          (refs.length ? '\u2003' + refs.join(', ') : '') +
          '</p>',
      );
      append(children, depth + 1);
    }
  }
  append(tree, 0);
  return rows.join('') || '<p><br></p>';
}

export function indexDialog(form, doc, { saved, emptyFrame }, apply) {
  const dialog = form(
    'Generate Index',
    '<label>Title<input name="title" maxlength="256"></label>' +
      '<label>Topics<textarea name="topics" rows="7"></textarea></label>' +
      '<p>Enter one topic per line. Use &gt; for subtopics, such as Materials &gt; Wool. The last term matches whole words with the same capitalization.</p>' +
      '<details><summary>Topic references and sorting</summary><div data-index-references></div><button type="button" data-add-reference>Add topic reference</button><div data-index-sorts></div><button type="button" data-add-sort>Add sort key</button></details>' +
      '<label><input type="checkbox" name="ranges">Combine consecutive pages into ranges</label>' +
      (saved
        ? ''
        : '<label>Place in<select name="placement">' +
          (emptyFrame
            ? '<option value="selection">Selected text frame (fixed length)</option>'
            : '') +
          '<option value="new">New pages at end</option></select></label>'),
    (data) =>
      apply(
        indexSettings({
          title: data.get('title'),
          topics: data
            .get('topics')
            .split(/\r?\n/)
            .filter((s) => s.trim())
            .map((s) => s.split('>')),
          ranges: data.has('ranges'),
          references: data.getAll('ref-from').map((s, i) => ({
            from: s.split('>'),
            kind: data.getAll('ref-kind')[i],
            to: data.getAll('ref-to')[i].split('>'),
          })),
          sortKeys: data
            .getAll('sort-path')
            .map((s, i) => ({ path: s.split('>'), key: data.getAll('sort-key')[i] })),
        }),
        data.get('placement'),
      ),
  );
  dialog.setAttribute('aria-label', 'Generate Index');
  const fields = dialog.querySelector('form').elements;
  function add(kind, value) {
    const row = document.createElement('fieldset');
    const reference = kind === 'reference';
    row.innerHTML = reference
      ? '<label>From topic<input name="ref-from" required></label><select name="ref-kind" aria-label="Reference type"><option value="see">See</option><option value="also">See also</option></select><label>To topic<input name="ref-to" required></label>'
      : '<label>Topic<input name="sort-path" required></label><label>Sort as<input name="sort-key" maxlength="160" required></label>';
    const inputs = row.querySelectorAll('input,select');
    const values = reference
      ? [value?.from?.join(' > '), value?.kind || 'see', value?.to?.join(' > ')]
      : [value?.path?.join(' > '), value?.key];
    inputs.forEach((input, i) => {
      input.value = values[i] || '';
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => row.remove());
    row.append(remove);
    dialog.querySelector(reference ? '[data-index-references]' : '[data-index-sorts]').append(row);
    if (!value) inputs[0].focus();
  }
  for (const [kind, rows] of [
    ['reference', saved?.references],
    ['sort', saved?.sortKeys],
  ]) {
    for (const entry of rows || []) add(kind, entry);
    dialog.querySelector('[data-add-' + kind + ']').addEventListener('click', () => add(kind));
  }
  fields.title.value = saved?.title ?? 'Index';
  fields.topics.value = (saved?.topics || []).map((path) => path.join(' > ')).join('\n');
  fields.ranges.checked = saved?.ranges ?? true;
  fields.topics.focus();
}
