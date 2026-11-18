export const fixtures = [
  { id: 'kerning', html: '<p>AVATAR To WA</p>' },
  {
    id: 'paragraph',
    html: '<p>Professional typography needs careful choices across the whole paragraph. A good line depends on the lines that follow.</p>',
  },
  {
    id: 'latin',
    html:
      '<p>Office affine: <em>italic <span data-ivo-italic="false">regular</span></em> and <strong>bold</strong>.</p>' +
      '<p>Text is one source across unequal frames. Carets follow glyphs, while the source keeps its own paragraph marks.<br>Soft breaks stay inside the paragraph.</p>' +
      '<p><br></p><p data-ivo-size="18">A larger line</p>' +
      '<p>' +
      'A portable document keeps exact fonts and careful spacing. '.repeat(14) +
      '</p><p></p>',
  },
  {
    id: 'unicode',
    html: '<p>Office café e\u0301 👩🏽‍💻</p><p>العَرَبِيَّة العربية हिन्दी</p><p>English אבג English</p><p></p>',
  },
];
