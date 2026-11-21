import { pageFolios } from './page-sections.js';

export const crossReferenceFormats = {
  folio: 'Page Number',
  'page-name': 'Page Name',
  'document-page': 'Document Name and Page Number',
};

/** Folios are derived once per destination document for this update or proof. */
export function crossReferenceResolver(documents) {
  const chapters = new Map(documents.map((doc) => [doc.id, doc])),
    pages = new Map();
  return (documentId, pageId, format) => {
    const chapter = chapters.get(documentId);
    if (!chapter?.pages || !Object.hasOwn(crossReferenceFormats, format)) return null;
    if (!pages.has(chapter)) {
      const folios = pageFolios(chapter.pages);
      pages.set(
        chapter,
        new Map(chapter.pages.map((p, i) => [p.id, { name: p.name, folio: folios[i] }])),
      );
    }
    const page = pages.get(chapter).get(pageId);
    if (!page) return null;
    if (format === 'page-name') return page.name;
    if (format === 'document-page') return chapter.title + ', ' + page.folio;
    return page.folio;
  };
}
