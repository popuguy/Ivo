import assert from 'node:assert/strict';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

export async function verifyTaggedBook(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const n = PDFName.of;
  const ctx = pdf.context;
  const root = pdf.catalog.lookup(n('StructTreeRoot'), PDFDict);
  const nums = root.lookup(n('ParentTree'), PDFDict).lookup(n('Nums'), PDFArray);
  const parents = new Map();
  for (let i = 0; i < nums.size(); i += 2)
    parents.set(nums.lookup(i, PDFNumber).asNumber(), nums.get(i + 1));
  const semantic = new Map();
  for (const [ref, tag] of ctx.enumerateIndirectObjects()) {
    if (!(tag instanceof PDFDict) || tag.get(n('Type')) !== n('StructElem')) continue;
    const text = tag.lookup(n('ActualText'))?.decodeText();
    if (!text) continue;
    const kids = tag.lookup(n('K'));
    const items = (kids instanceof PDFArray ? kids.asArray() : [kids]).map((k) => ctx.lookup(k));
    const lines = items.filter((k) => k instanceof PDFDict && k.get(n('Type')) === n('MCR'));
    assert(lines.length > 0, 'Native paragraph has no searchable marked text: ' + text);
    for (const line of lines) {
      const form = line.lookup(n('Stm'), PDFRawStream);
      const key = form.dict.lookup(n('StructParents'), PDFNumber).asNumber();
      const mcid = line.lookup(n('MCID'), PDFNumber).asNumber();
      assert.equal(ctx.lookup(parents.get(key), PDFArray).get(mcid), ref, 'Incorrect text parent');
      assert.match(
        Buffer.from(decodePDFRawStream(form).decode()).toString('latin1'),
        new RegExp('/MCID\\s+' + mcid + '(?!\\d)'),
        'Tag does not reference drawn text',
      );
    }
    semantic.set(text, String(tag.get(n('S'))));
  }
  assert.equal(semantic.get('Woven surfaces'), '/H2');
  assert.equal(semantic.get('Fibre index'), '/P');
  assert(!semantic.has('Unprinted entry'), 'Overset heading leaked into the reading order');
  const frontPage = pdf.getPage(0).ref;
  const order = [];
  function walk(item, inheritedPage) {
    if (item instanceof PDFArray) {
      for (const kid of item.asArray()) walk(ctx.lookup(kid), inheritedPage);
      return;
    }
    if (!(item instanceof PDFDict) || item.get(n('Type')) !== n('StructElem')) return;
    const page = item.get(n('Pg')) || inheritedPage;
    if (page === frontPage) order.push(String(item.get(n('S'))));
    walk(item.lookup(n('K')), page);
  }
  walk(root.lookup(n('K')));
  assert(
    order.includes('/P') && order.includes('/H2') && order.indexOf('/P') < order.indexOf('/H2'),
    'The book did not honor the authored reading order on its first page',
  );
  for (const page of pdf.getPages()) {
    for (const ref of page.node.Annots().asArray()) {
      const annot = ctx.lookup(ref, PDFDict);
      const parent = ctx.lookup(
        parents.get(annot.lookup(n('StructParent'), PDFNumber).asNumber()),
        PDFDict,
      );
      assert.equal(parent.get(n('S')), n('Link'));
      assert(annot.lookup(n('Contents')).decodeText().trim());
      const kids = parent.lookup(n('K'));
      assert(
        kids instanceof PDFArray &&
          kids.asArray().some((value) => {
            const kid = ctx.lookup(value);
            return (
              kid instanceof PDFDict && kid.get(n('Obj')) === ref && kid.get(n('Pg')) === page.ref
            );
          }),
        'Clickable annotation lost its reading-order reference',
      );
    }
  }
}
