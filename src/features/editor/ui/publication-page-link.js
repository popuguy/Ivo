import { escapeHTML } from '../../../shared/html/sanitize.js';

export function publicationPageLink(ownerId, page, label) {
  const target =
    page.documentId === ownerId
      ? 'href="#page=' + escapeHTML(page.pageId) + '"'
      : 'href="#doc=' +
        escapeHTML(page.documentId) +
        '" data-doc-id="' +
        escapeHTML(page.documentId) +
        '" data-page-id="' +
        escapeHTML(page.pageId) +
        '"';
  return '<a ' + target + '>' + escapeHTML(label) + '</a>';
}
