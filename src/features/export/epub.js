import { publicationHeadingLevel } from './publication-headings.js';
import { orderPublicationEntries } from '../../domain/documents/publication-order.js';
import { objectAvailable, effectiveTextStyle } from '../../domain/documents/publishing.js';
import { frameTextSettings } from '../../domain/documents/text-flows.js';
import { upgradeDocument, worldRect } from '../../domain/documents/scene.js';
import { createDocumentResolver, textLinkTargets } from '../../domain/knowledge/index.js';
import { readableHTML } from '../../shared/html/sanitize.js';
import { applyNamedTextStyles } from '../../rendering/text/styles.js';
import { epubImage } from './epub-image.js';

// XML 1.0 permits tab, LF and CR among C0 characters.
const xmlText = (value) =>
  String(value)
    .toWellFormed()
    .replace(
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,
      '',
    );
const xml = (s) =>
  xmlText(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const xhtml = (title, lang, body) =>
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' +
  xml(lang) +
  '" xml:lang="' +
  xml(lang) +
  '"><head><title>' +
  xml(title) +
  '</title><link rel="stylesheet" href="book.css" /></head><body>' +
  body +
  '</body></html>';
const encoder = new TextEncoder();

export function readingOrder(doc, { editingOrder = false } = {}) {
  const visible = doc.blocks.filter((item) => objectAvailable(doc, item, { editing: false }));
  const frames = new Set(visible.map((b) => b.id));
  const flows = new Map((doc.textFlows || []).map((f) => [f.id, f]));
  const pages = new Map(doc.pages.map((p, i) => [p.id, i]));
  const order = visible
    .map((item) => ({ item, position: worldRect(doc, item) }))
    .sort(
      (a, b) =>
        pages.get(a.item.pageId) - pages.get(b.item.pageId) ||
        a.position.y - b.position.y ||
        a.position.x - b.position.x,
    );
  const entries = order.flatMap(({ item }) => {
    const flow = flows.get(item.textFlowId);
    if (
      !editingOrder &&
      flow &&
      !doc.publication?.excluded.includes(flow.id) &&
      flow.frameIds.some((id) => !frames.has(id))
    )
      throw Error(
        'A text flow in “' +
          doc.title +
          '” crosses visible and hidden frames. Make its visibility consistent before exporting.',
      );
    if (flow && flow.frameIds[0] !== item.id) return [];
    if (!editingOrder && item.type === 'pdf' && !doc.publication?.excluded.includes(item.id))
      throw Error(
        '“' +
          doc.title +
          '” contains a PDF attachment. It cannot be included in a reflowable book.',
      );
    if (item.type === 'polygon') return [];
    return [
      {
        id: flow?.id || item.id,
        item,
        html: flow?.html ?? item.html ?? '',
        style: effectiveTextStyle(doc, frameTextSettings(doc, item)),
      },
    ];
  });
  return orderPublicationEntries(entries, doc.publication, { includeExcluded: editingOrder });
}

function selectedChapters(documents, id, linked, useBook) {
  const resolver = createDocumentResolver(documents),
    book = useBook && resolver.byId.get(id)?.publication?.chapters,
    pending = book?.length ? [...book] : [id],
    included = new Set(pending),
    chapters = [];
  for (const key of pending) {
    const source = resolver.byId.get(key);
    if (!source)
      throw Error(
        'A book chapter is missing from the vault. Update the book order before exporting.',
      );
    const doc = upgradeDocument(source),
      entries = readingOrder(doc);
    chapters.push({ doc, entries });
    if (!linked || book?.length) continue;
    for (const entry of entries)
      for (const link of textLinkTargets(entry.html)) {
        const dest = link.canonical
          ? resolver.byId.get(link.target)?.id
          : resolver.resolve(link.target, key);
        if (dest && !included.has(dest)) {
          included.add(dest);
          pending.push(dest);
        }
      }
  }
  return chapters;
}

function chapterText({ item, html, style }, doc, documents, paths, headings) {
  const root = document.createElement(item.type === 'quote' ? 'blockquote' : 'div');
  root.innerHTML = readableHTML(html, documents, doc.id);
  applyNamedTextStyles(root, doc);
  if (style.language) root.lang = style.language;
  if (style.direction === 'rtl') root.dir = 'rtl';
  if (style.bold) root.style.fontWeight = 'bold';
  if (style.italic) root.style.fontStyle = 'italic';
  if (style.align && style.align !== 'left') root.style.textAlign = style.align;
  if (doc.publication?.headings) {
    for (const p of root.querySelectorAll('p,div')) {
      const level = publicationHeadingLevel(p, doc.publication, style.paragraphStyle);
      if (!level) continue;
      const heading = document.createElement('h' + level);
      for (const attribute of p.attributes) heading.setAttribute(attribute.name, attribute.value);
      heading.append(...p.childNodes);
      p.replaceWith(heading);
    }
  }
  for (const node of root.querySelectorAll('*')) {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      const dest = node.dataset.docId
        ? paths.get(node.dataset.docId)
        : /^https?:\/\//i.test(href)
          ? href
          : null;
      if (!dest) {
        node.replaceWith(...node.childNodes);
        continue;
      }
      node.setAttribute('href', dest);
    }
    const lang = node.getAttribute('data-ivo-lang');
    if (lang) node.lang = lang;
    // Flowable readers govern the font size, baseline and available line width.
    const css = node.style;
    for (const key of [...css])
      if (
        ![
          'font-weight',
          'font-style',
          'text-decoration',
          'text-decoration-line',
          'text-align',
          'color',
          'background-color',
          'font-variant-caps',
          'direction',
          'vertical-align',
        ].includes(key)
      )
        css.removeProperty(key);
    for (const attribute of [...node.attributes])
      if (!['href', 'style', 'lang', 'dir', 'start', 'value'].includes(attribute.name))
        node.removeAttribute(attribute.name);
    if (!css.length) node.removeAttribute('style');
  }
  for (const heading of root.querySelectorAll('h2,h3,h4,h5,h6')) {
    if (!heading.textContent.trim()) continue;
    heading.id = 'heading-' + (headings.length + 1);
    headings.push({
      id: heading.id,
      level: Number(heading.tagName[1]),
      title: heading.textContent.trim(),
    });
  }
  return xmlText(new XMLSerializer().serializeToString(root));
}

function headingNavigation(headings, path) {
  const root = { children: [], level: 0 },
    stack = [root];
  for (const heading of headings) {
    while (stack.at(-1).level >= heading.level) stack.pop();
    const node = { ...heading, children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  const render = (nodes) =>
    nodes
      .map(
        (node) =>
          '<li><a href="' +
          path +
          '#' +
          node.id +
          '">' +
          xml(node.title) +
          '</a>' +
          (node.children.length ? '<ol>' + render(node.children) + '</ol>' : '') +
          '</li>',
      )
      .join('');
  return render(root.children);
}

/** Build a publication from a frozen set of authored sources, independent of zoom or editing selection. */
export async function exportReflowableBook(
  documents,
  id,
  { includeLinked = false, useBook = false, getSource },
) {
  const chapters = selectedChapters(documents, id, includeLinked, useBook);
  const paths = new Map(chapters.map(({ doc }, i) => [doc.id, 'chapter-' + (i + 1) + '.xhtml']));
  const title = chapters.find(({ doc }) => doc.id === id).doc.title,
    lang = chapters[0].entries.find((e) => e.html)?.style.language || 'en';
  const files = { mimetype: [encoder.encode('application/epub+zip'), { level: 0 }] };
  const add = (path, data) => {
    files[path] = encoder.encode(data);
  };
  add(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  add(
    'EPUB/book.css',
    'body{line-height:1.4;margin:5%}figure{margin:1em 0}img{max-width:100%;height:auto}figcaption{font-size:.85em}p{orphans:2;widows:2}',
  );
  const manifest = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="css" href="book.css" media-type="text/css"/>',
    ],
    spine = [],
    nav = [];
  let mediaCount = 0,
    mediaBytes = 0;
  for (const [i, { doc, entries }] of chapters.entries()) {
    const path = paths.get(doc.id),
      headings = [],
      body = ['<h1>' + xml(doc.title) + '</h1>'];
    for (const entry of entries) {
      const { item } = entry;
      if (item.type === 'image') {
        if (!item.src) continue;
        const image = await epubImage(doc, item, getSource),
          key = 'image-' + ++mediaCount,
          file = key + '.png';
        mediaBytes += image.byteLength;
        if (mediaBytes > 100 * 1024 * 1024)
          throw Error('Image data exceeds 100 MB. Export fewer linked documents.');
        files['EPUB/' + file] = [image, { level: 0 }];
        manifest.push('<item id="' + key + '" href="' + file + '" media-type="image/png"/>');
        body.push(
          '<figure><img src="' +
            file +
            '" alt="' +
            xml(item.alt || '') +
            '"/>' +
            (item.caption ? '<figcaption>' + xml(item.caption) + '</figcaption>' : '') +
            '</figure>',
        );
      } else if (item.type === 'rule') body.push('<hr/>');
      else body.push(chapterText(entry, doc, documents, paths, headings));
    }
    add(
      'EPUB/' + path,
      xhtml(doc.title, entries.find((e) => e.html)?.style.language || lang, body.join('\n')),
    );
    manifest.push(
      '<item id="ch' + i + '" href="' + path + '" media-type="application/xhtml+xml"/>',
    );
    spine.push('<itemref idref="ch' + i + '"/>');
    const sub = headingNavigation(headings, path);
    nav.push(
      '<li><a href="' +
        path +
        '">' +
        xml(doc.title) +
        '</a>' +
        (sub ? '<ol>' + sub + '</ol>' : '') +
        '</li>',
    );
  }
  add(
    'EPUB/nav.xhtml',
    xhtml(
      'Contents',
      lang,
      '<nav epub:type="toc"><h1>Contents</h1><ol>' + nav.join('') + '</ol></nav>',
    ),
  );
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  add(
    'EPUB/book.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="pub-id">' +
      xml('ivo:' + id) +
      '</dc:identifier><dc:title>' +
      xml(title) +
      '</dc:title><dc:language>' +
      xml(lang) +
      '</dc:language><meta property="dcterms:modified">' +
      modified +
      '</meta></metadata><manifest>' +
      manifest.join('') +
      '</manifest><spine>' +
      spine.join('') +
      '</spine></package>',
  );
  const { zipSync } = await import('../../../public/vendor/epub-zip.js');
  return zipSync(files, { level: 4 });
}
