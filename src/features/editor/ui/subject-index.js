import { indexSettings } from '../../../domain/documents/subject-index.js';
import { pageFolios } from '../../../domain/documents/page-sections.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';

export function indexHTML(doc, matches, settings, { allowEmpty = false } = {}) {
  const tree = new Map(),
    folios = pageFolios(doc.pages);
  doc.pages.forEach((page, i) => {
    for (const key of new Set((matches.get(page.id) || []).map((hit) => hit.title))) {
      let siblings = tree,
        node;
      for (const part of JSON.parse(key)) {
        if (!siblings.has(part)) siblings.set(part, { children: new Map(), pages: [] });
        node = siblings.get(part);
        siblings = node.children;
      }
      node.pages.push(i);
    }
  });
  if (!tree.size && !allowEmpty)
    throw Error('No matching topics on the printed pages. Check spelling and capitalization.');
  const collator = new Intl.Collator(doc.language || 'en', { numeric: true });
  const rows = [];
  if (settings.title) rows.push('<p><strong>' + esc(settings.title) + '</strong></p>');
  const link = (i) => '<a href="#page=' + esc(doc.pages[i].id) + '">' + esc(folios[i]) + '</a>';
  function append(siblings, depth) {
    for (const name of [...siblings.keys()].sort(collator.compare)) {
      const { children, pages } = siblings.get(name);
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
        }),
        data.get('placement'),
      ),
  );
  dialog.setAttribute('aria-label', 'Generate Index');
  const fields = dialog.querySelector('form').elements;
  fields.title.value = saved?.title ?? 'Index';
  fields.topics.value = (saved?.topics || []).map((path) => path.join(' > ')).join('\n');
  fields.ranges.checked = saved?.ranges ?? true;
  fields.topics.focus();
}
