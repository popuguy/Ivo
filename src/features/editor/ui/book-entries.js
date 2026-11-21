import {
  composePublicationChapter,
  paintPublicationPage,
  publicationPages,
} from '../../../rendering/publication-pages.js';
import {
  collectPageHeadings,
  collectPrintedEntries,
} from '../../../rendering/text/publication-headings.js';
import { indexMatcher } from '../../../rendering/text/subject-index-matches.js';
import { prepareTextFlowFonts } from '../../../rendering/text/flow-layout.js';

export function entriesOnPages(owner, chapter, layout, pages, settings, kind) {
  if (kind === 'index')
    return publicationPages(
      chapter,
      collectPrintedEntries(chapter, layout, pages, {
        includeTables: true,
        matches: indexMatcher(settings.topics, chapter.language || 'en'),
      }),
    );
  let headings = settings.styles;
  if (owner.id !== chapter.id) {
    const levels = new Map(owner.publishing?.paragraphStyles.map((s) => [s.name, headings[s.id]]));
    headings = Object.fromEntries(
      (chapter.publishing?.paragraphStyles || [])
        .filter((s) => levels.get(s.name))
        .map((s) => [s.id, levels.get(s.name)]),
    );
  }
  return publicationPages(
    chapter,
    collectPageHeadings(chapter, layout, pages, { semantic: settings.semantic, headings }),
  );
}

/** Inspect the saved pages of closed chapters without opening tabs or authoring continuation pages. */
export async function bookEntries(
  owner,
  localPages,
  settings,
  kind,
  { documents, assets, source, compose, valid, getChapter },
) {
  const order = owner.publication?.chapters;
  if (!order?.includes(owner.id))
    throw Error('Set the book chapter order before generating book entries.');
  const sources = new Map(documents.map((d) => [d.id, d]));
  const chapters = order.map((id) => {
    const doc = sources.get(id);
    if (!doc?.pages) throw Error('A book chapter is unavailable. Check the book order.');
    return doc;
  });
  const initial = chapters.map((doc) => JSON.stringify(doc));
  const host = document.createElement('div');
  host.inert = true;
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style;z-index:-1';
  document.body.append(host);
  const result = [];
  try {
    await prepareTextFlowFonts();
    for (const [i, original] of chapters.entries()) {
      if (!valid()) throw Error('Book generation was cancelled.');
      if (original === owner) {
        result.push(...localPages);
        continue;
      }
      const chapter = JSON.parse(initial[i]);
      const { flow } = await composePublicationChapter(chapter, documents, assets, compose, false);
      const pages = chapter.pages.map((p) => {
        const section = document.createElement('div');
        section.style.cssText =
          'position:relative;overflow:hidden;width:' + p.width + 'px;height:' + p.height + 'px';
        host.append(section);
        paintPublicationPage(section, chapter, p, { source, flow, documents });
        return { pageId: p.id, section };
      });
      await document.fonts.ready;
      result.push(...entriesOnPages(owner, chapter, flow, pages, settings, kind));
      host.replaceChildren();
    }
    if (!valid() || chapters.some((doc, i) => JSON.stringify(getChapter(doc.id)) !== initial[i]))
      throw Error('A book chapter changed. Generate the entries again.');
    return result;
  } finally {
    host.remove();
  }
}
