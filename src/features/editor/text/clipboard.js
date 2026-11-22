import { unlinkEndnoteFields } from '../../../domain/documents/endnotes.js';
import { rewriteAnchorMarkers } from '../../../domain/documents/anchor-ownership.js';
import { uid } from '../../../domain/documents/model.js';
import { cleanHTML, escapeHTML } from '../../../shared/html/sanitize.js';

/** Insertion context only: preserve rich boundary spaces until the source-owned
 * whitespace projection takes over. The sanitizer unwraps this temporary span. */
export function textClipboardHTML(data, currentSource = () => '') {
  const source =
    data?.getData('text/html') ||
    escapeHTML(data?.getData('text/plain') || '').replace(/\r\n?|\n/g, '<br>');
  // Graphics require a paired object archive. Ordinary external HTML can
  // contain text copied from Ivo without any of the actual graphics.
  let html = rewriteAnchorMarkers(unlinkEndnoteFields(cleanHTML(source)), () => null);
  if (html.includes('data-paragraph-destination')) {
    const markers = [
      ...currentSource().matchAll(/\sdata-paragraph-destination="(par-[\w-]+)"/g),
    ].map((match) => match[1]);
    const used = new Set(markers);
    html = html.replace(
      /(\sdata-paragraph-destination=")(par-[\w-]+)(")/g,
      (whole, prefix, id, suffix) => {
        if (used.has(id)) return prefix + uid('par-') + suffix;
        used.add(id);
        return whole;
      },
    );
  }
  return html
    ? '<span data-ivo-clipboard-whitespace style="white-space:pre-wrap">' + html + '</span>'
    : '';
}
