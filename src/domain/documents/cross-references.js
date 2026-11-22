import { pageFolios } from './page-sections.js';
import { customFormatId } from './reference-formats.js';

export const crossReferenceFormats = {
  folio: 'Page Number',
  'paragraph-text': 'Paragraph Text',
  'page-name': 'Page Name',
  'document-page': 'Document Name and Page Number',
};
export const validCrossReferenceFormat = (id) =>
  Object.hasOwn(crossReferenceFormats, id) || customFormatId(id);

/** The source document owns the format; the destination supplies the live field values. */
export function crossReferenceResolver(documents, source) {
  const chapters = new Map(documents.map((doc) => [doc.id, doc])),
    formats = new Map(source?.referenceFormats?.map((f) => [f.id, f.definition])),
    pages = new Map();
  return (documentId, pageId, format, paragraph) => {
    const chapter = chapters.get(documentId);
    if (!chapter?.pages) return null;
    if (!pages.has(chapter)) {
      const folios = pageFolios(chapter.pages);
      let marker = '';
      pages.set(
        chapter,
        new Map(
          chapter.pages.map((p, i) => {
            if (p.section) marker = p.section.marker || '';
            return [
              p.id,
              {
                pageNum: folios[i],
                pageName: p.name,
                sectionMarker: marker,
                fileName: chapter.title,
              },
            ];
          }),
        ),
      );
    }
    const page = pages.get(chapter).get(pageId);
    if (!page) return null;
    if (format === 'paragraph-text') return paragraph?.title || null;
    if (format === 'page-name') return page.pageName;
    if (format === 'document-page') return chapter.title + ', ' + page.pageNum;
    if (format === 'folio') return page.pageNum;
    const definition = formats.get(format);
    if (definition === undefined || (definition.includes('<paraText/>') && !paragraph?.title))
      return null;
    return definition.replace(/<([A-Za-z]+)\/>/g, (_, key) =>
      key === 'paraText' ? paragraph.title : page[key],
    );
  };
}
