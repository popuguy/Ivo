import { PDFHexString, PDFName } from 'pdf-lib';

/** Each destination is a real page reference, independent of page size or reader zoom. */
export function addPDFBookmarks(pdf, manifest) {
  if (!manifest.length) return;
  const pages = pdf.getPages(),
    groups = [];
  for (const [index, page] of manifest.entries()) {
    let chapter = groups.at(-1);
    if (!chapter || chapter.documentId !== page.documentId) {
      chapter = { title: page.documentTitle, documentId: page.documentId, index, children: [] };
      groups.push(chapter);
    }
    const children = [],
      stack = [];
    for (const heading of page.headings || []) {
      const node = { title: heading.title, index, children: [] };
      while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
      (stack.at(-1)?.node.children || children).push(node);
      stack.push({ level: heading.level, node });
    }
    chapter.children.push({
      title: page.name || 'Page ' + (chapter.children.length + 1),
      index,
      children,
    });
  }
  for (const group of groups)
    if (group.children.length === 1) group.children = group.children[0].children;
  const ctx = pdf.context;
  const root = ctx.obj({ Type: 'Outlines' }),
    rootRef = ctx.register(root);
  function attach(parent, parentRef, entries) {
    const refs = entries.map(() => ctx.nextRef());
    let visible = entries.length;
    for (const [i, entry] of entries.entries()) {
      const node = ctx.obj({
        Title: PDFHexString.fromText(entry.title),
        Parent: parentRef,
        Dest: [pages[entry.index].ref, 'Fit'],
      });
      if (i) node.set(PDFName.of('Prev'), refs[i - 1]);
      if (i + 1 < refs.length) node.set(PDFName.of('Next'), refs[i + 1]);
      ctx.assign(refs[i], node);
      if (entry.children.length) visible += attach(node, refs[i], entry.children);
    }
    parent.set(PDFName.of('First'), refs[0]);
    parent.set(PDFName.of('Last'), refs.at(-1));
    parent.set(PDFName.of('Count'), ctx.obj(visible));
    return visible;
  }
  attach(root, rootRef, groups);
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
  const nums = manifest.flatMap((p, i) => [
    i,
    ctx.obj({ P: PDFHexString.fromText(p.folio || String(i + 1)) }),
  ]);
  pdf.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: nums }));
}
