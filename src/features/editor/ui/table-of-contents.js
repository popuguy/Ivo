import { contentsSettings } from '../../../domain/documents/contents-settings.js';
import { pageFolios } from '../../../domain/documents/page-sections.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';

export function contentsHTML(doc, headings, settings, { allowEmpty = false } = {}) {
  const folios = pageFolios(doc.pages);
  const entries = doc.pages.flatMap((page, i) =>
    (headings.get(page.id) || []).map((entry) => ({ ...entry, pageId: page.id, folio: folios[i] })),
  );
  if (!entries.length && !allowEmpty)
    throw Error(
      'No matching headings on the document pages. Choose a paragraph style or include headings.',
    );
  if (settings.order === 'alphabetical') {
    const collator = new Intl.Collator(doc.language || 'en', {
      numeric: true,
      sensitivity: 'base',
    });
    entries.sort((a, b) => collator.compare(a.title, b.title));
  }
  const firstLevel = entries.reduce((min, e) => Math.min(min, e.level), 6);
  const separator = settings.separator === 'tab' ? '\t' : '\u2003';
  const style = doc.publishing?.paragraphStyles.some((s) => s.id === settings.entryStyle)
    ? ' data-ivo-pstyle="' + esc(settings.entryStyle) + '"'
    : '';
  const rows = entries.map((e) => {
    const indent = (e.level - firstLevel) * 12;
    const title = esc(e.title),
      page = esc(e.folio);
    const label =
      settings.numbering === 'after'
        ? title + separator + page
        : settings.numbering === 'before'
          ? page + separator + title
          : title;
    return (
      '<p' +
      style +
      (indent ? ' data-ivo-left="' + indent + '"' : '') +
      '><a href="#page=' +
      esc(e.pageId) +
      '">' +
      label +
      '</a></p>'
    );
  });
  if (settings.title) rows.unshift('<p><strong>' + esc(settings.title) + '</strong></p>');
  return rows.join('') || '<p><br></p>';
}

export function contentsDialog(form, doc, { saved, emptyFrame = false }, apply) {
  const settings = contentsSettings(saved || { styles: doc.publication?.headings });
  const styles = doc.publishing?.paragraphStyles || [];
  const styleOptions = styles
    .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
    .join('');
  const choices = styles
    .map(
      (s) =>
        '<label>' +
        esc(s.name) +
        '<select data-toc-style="' +
        esc(s.id) +
        '"><option value="">Omit</option>' +
        [1, 2, 3, 4, 5, 6]
          .map((level) => '<option value="' + level + '">Level ' + level + '</option>')
          .join('') +
        '</select></label>',
    )
    .join('');
  const modal = form(
    'Table of Contents',
    '<label>Title<input name="title" maxlength="256"></label>' +
      '<label class="publishing-check"><input type="checkbox" name="semantic">Include document headings</label>' +
      (styles.length
        ? '<details><summary>Include Paragraph Styles</summary>' + choices + '</details>'
        : '') +
      '<label>Entry Style<select name="entryStyle"><option value="">Frame formatting</option>' +
      styleOptions +
      '</select></label>' +
      '<label>Page Number<select name="numbering"><option value="after">After Entry</option><option value="before">Before Entry</option><option value="none">No Page Number</option></select></label>' +
      '<label>Between Entry and Number<select name="separator"><option value="em">Em Space</option><option value="tab">Tab Character</option></select></label>' +
      '<label>Order<select name="order"><option value="page">Page order</option><option value="alphabetical">Alphabetical order</option></select></label>' +
      (!saved
        ? '<label>Place in<select name="placement">' +
          (emptyFrame
            ? '<option value="selection">Selected text frame (fixed length)</option>'
            : '') +
          '<option value="new">New pages at end</option></select></label>'
        : ''),
    () => {
      const picked = Object.fromEntries(
        [...modal.querySelectorAll('[data-toc-style]')]
          .filter((s) => s.value)
          .map((s) => [s.dataset.tocStyle, Number(s.value)]),
      );
      apply(
        contentsSettings({
          title: fields.title.value,
          numbering: fields.numbering.value,
          order: fields.order.value,
          separator: fields.separator.value,
          semantic: fields.semantic.checked,
          entryStyle: fields.entryStyle.value,
          styles: picked,
        }),
        fields.placement?.value,
      );
    },
  );
  const fields = modal.querySelector('form').elements;
  modal.setAttribute('aria-label', 'Table of Contents');
  for (const name of ['title', 'numbering', 'order', 'separator', 'entryStyle'])
    fields[name].value = settings[name];
  fields.semantic.checked = settings.semantic;
  for (const drop of modal.querySelectorAll('[data-toc-style]'))
    drop.value = String(settings.styles[drop.dataset.tocStyle] || '');
  fields.numbering.onchange = () => {
    fields.separator.disabled = fields.numbering.value === 'none';
  };
  fields.numbering.onchange();
}
