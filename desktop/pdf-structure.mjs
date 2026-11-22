import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';

const name = PDFName.of;
function appendKid(ctx, parent, child) {
  const old = parent.get(name('K'));
  const kids = parent.lookup(name('K'));
  if (kids instanceof PDFArray) kids.push(child);
  else parent.set(name('K'), ctx.obj(old ? [old, child] : [child]));
}

function numberTreeEntries(dict, entries) {
  const nums = dict.lookup(name('Nums'));
  if (nums instanceof PDFArray)
    for (let i = 0; i < nums.size(); i += 2)
      entries.set(nums.lookup(i, PDFNumber).asNumber(), nums.get(i + 1));
  const kids = dict.lookup(name('Kids'));
  if (kids instanceof PDFArray)
    for (let i = 0; i < kids.size(); i++) numberTreeEntries(kids.lookup(i, PDFDict), entries);
}

/** Keep Chromium's content marks, page parents and authored drawing order.
 * Give each actionable link its own structure parent and point back to every
 * physical annotation rectangle (wrapped links can have more than one).
 */
export function preparePDFStructure(pdf, manifest) {
  const ctx = pdf.context;
  const root = pdf.catalog.lookup(name('StructTreeRoot'));
  if (!(root instanceof PDFDict)) return;
  const paragraphs = new Map((manifest.paragraphs || []).map((p) => [p.marker, p]));
  const links = new Map(manifest.links.map((link) => [link.marker, link]));
  const tags = new Map();
  const pageParents = new Map();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(name('Type')) !== name('StructElem')) continue;
    const pg = obj.get(name('Pg'));
    if (pg && !pageParents.has(pg.toString())) pageParents.set(pg.toString(), obj.get(name('P')));
    const alt = obj.lookup(name('Alt'));
    if (!(alt instanceof PDFHexString || alt instanceof PDFString)) continue;
    const marker = alt.decodeText();
    const paragraph = paragraphs.get(marker);
    if (!paragraph) continue;
    tags.set(marker, { ref, obj });
    obj.delete(name('Alt'));
    obj.set(name('S'), name('Div'));
    for (const part of paragraph.paragraphs) {
      const child = ctx.obj({
        Type: 'StructElem',
        S: part.role,
        Pg: obj.get(name('Pg')),
        P: ref,
        ActualText: PDFHexString.fromText(part.text),
      });
      const childRef = ctx.register(child);
      tags.set(part.key, { obj: child, ref: childRef });
      appendKid(ctx, obj, childRef);
    }
  }
  const parentTree = root.lookup(name('ParentTree'));
  if (!(parentTree instanceof PDFDict)) return;
  const entries = new Map();
  numberTreeEntries(parentTree, entries);
  let next = root.lookupMaybe(name('ParentTreeNextKey'), PDFNumber)?.asNumber() || 0;
  for (const key of entries.keys()) next = Math.max(next, key + 1);
  let added = false;
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    for (const oldRef of annots?.asArray() || []) {
      const annot = ctx.lookup(oldRef, PDFDict);
      const action = annot.lookupMaybe(name('A'), PDFDict);
      const uri = action?.lookup(name('URI'));
      if (!(uri instanceof PDFString || uri instanceof PDFHexString)) continue;
      const marker = uri.decodeText().replace(/^https:\/\/ivo-pdf\.invalid\/annotation\//, '');
      const spec = links.get(marker);
      if (!spec) continue;
      // Use the original link's logical position, but only keep rectangles that
      // passed Ivo's page, frame and mask clipping checks.
      const parentKey = annot.lookupMaybe(name('StructParent'), PDFNumber)?.asNumber();
      const ref = entries.get(parentKey);
      if (ref) {
        const obj = ctx.lookup(ref, PDFDict);
        const kids = obj.lookup(name('K'));
        const pointsAtOldAnnotation = (kid) => {
          const dest = ctx.lookup(kid);
          return dest instanceof PDFDict && dest.get(name('Obj')) === oldRef;
        };
        if (kids instanceof PDFArray) {
          for (let k = kids.size() - 1; k >= 0; k--)
            if (pointsAtOldAnnotation(kids.get(k))) kids.remove(k);
        } else if (pointsAtOldAnnotation(obj.get(name('K')))) obj.delete(name('K'));
        if (obj.get(name('S')) === name('Link')) {
          obj.set(name('Alt'), PDFHexString.fromText(spec.label));
          tags.set(marker, { ref, obj });
        }
        entries.delete(parentKey);
        added = true;
      }
      action.delete(name('URI'));
      ctx.delete(oldRef);
    }
  }
  const marksBySource = new WeakMap();
  return {
    frame(token, value) {
      const frame = paragraphs.get(value.marker);
      if (
        frame &&
        tags.has(value.marker) &&
        frame.token === token &&
        frame.sourcePageIndex === value.sourcePageIndex &&
        frame.destinationPageIndex === value.destinationPageIndex
      )
        return frame;
    },
    attachFrame(frame, sourcePage, formRef) {
      const source = sourcePage.doc;
      let pages = marksBySource.get(source);
      if (!pages) {
        pages = new Map();
        // Core Graphics emits one Span for each tagged CTLineDraw. Marked content
        // IDs belong to the source stream and remain valid inside its copied form.
        const walk = (object) => {
          if (object instanceof PDFArray) {
            for (const child of object.asArray()) walk(source.context.lookup(child));
            return;
          }
          if (!(object instanceof PDFDict)) return;
          const kid = object.lookup(name('K'));
          if (kid instanceof PDFNumber && object.get(name('S')) === name('Span')) {
            const pg = object.get(name('Pg')).toString();
            if (!pages.has(pg)) pages.set(pg, []);
            pages.get(pg).push(kid.asNumber());
          } else walk(kid);
        };
        walk(source.catalog.lookup(name('StructTreeRoot')));
        marksBySource.set(source, pages);
      }
      const marks = pages.get(sourcePage.ref.toString());
      if (marks?.length !== frame.lineCount)
        throw Error('The native PDF did not retain the composed line tags.');
      const form = ctx.lookup(formRef),
        parents = ctx.obj([]);
      for (const part of frame.paragraphs) {
        const tag = tags.get(part.key);
        const pg = tag.obj.get(name('Pg'));
        for (const mcid of marks.slice(part.firstLine, part.through)) {
          while (parents.size() <= mcid) parents.push(ctx.obj(null));
          parents.set(mcid, tag.ref);
          appendKid(ctx, tag.obj, ctx.obj({ Type: 'MCR', Pg: pg, Stm: formRef, MCID: mcid }));
        }
      }
      form.dict.set(name('StructParents'), ctx.obj(next));
      entries.set(next++, ctx.register(parents));
      added = true;
    },
    link(page, annotation, annotationRef, link) {
      if (!link.marker) return;
      let tag = tags.get(link.marker);
      if (!tag) {
        const parentRef =
          tags.get(link.paragraph)?.ref ||
          pageParents.get(page.ref.toString()) ||
          root.get(name('K'));
        const parent = ctx.lookup(parentRef);
        if (!(parent instanceof PDFDict)) return;
        const obj = ctx.obj({
          Type: 'StructElem',
          S: 'Link',
          P: parentRef,
          Pg: page.ref,
          Alt: PDFHexString.fromText(link.label),
        });
        tag = { obj, ref: ctx.register(obj) };
        appendKid(ctx, parent, tag.ref);
        tags.set(link.marker, tag);
      }
      appendKid(ctx, tag.obj, ctx.obj({ Type: 'OBJR', Pg: page.ref, Obj: annotationRef }));
      annotation.set(name('StructParent'), ctx.obj(next));
      entries.set(next++, tag.ref);
      page.node.set(name('Tabs'), name('S'));
      added = true;
    },
    finish() {
      if (!added) return;
      parentTree.delete(name('Kids'));
      parentTree.delete(name('Limits'));
      parentTree.set(name('Nums'), ctx.obj([...entries].sort(([a], [b]) => a - b).flat()));
      root.set(name('ParentTreeNextKey'), ctx.obj(next));
    },
  };
}
