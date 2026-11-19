import { cleanHTML, escapeHTML } from '../../../shared/html/sanitize.js';

/** Insertion context only: preserve rich boundary spaces until the source-owned
 * whitespace projection takes over. The sanitizer unwraps this temporary span. */
export function textClipboardHTML(data) {
  const source =
    data?.getData('text/html') ||
    escapeHTML(data?.getData('text/plain') || '').replace(/\r\n?|\n/g, '<br>');
  const html = cleanHTML(source);
  return html
    ? '<span data-ivo-clipboard-whitespace style="white-space:pre-wrap">' + html + '</span>'
    : '';
}
