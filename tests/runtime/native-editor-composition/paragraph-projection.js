import {
  compositionSource,
  UnsupportedComposition,
} from '../../../src/rendering/text/composition-source.js';
import { TEXT_DEFAULTS, ALIGNMENTS } from '../../../src/domain/text/typography.js';
import { textParagraphRanges } from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const fields = [
  'align',
  'paragraphBefore',
  'paragraphAfter',
  'leftIndent',
  'rightIndent',
  'firstLineIndent',
];
const policy = (value) => Object.fromEntries(fields.map((key) => [key, value[key]]));
const equal = (actual, expected, message) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);

/** Source-only witnesses; no font requests, native worker, focus or source edits. */
export function verifyParagraphProjection() {
  const doc = {
      publishing: {
        paragraphStyles: [
          {
            id: 'paragraph-base',
            attributes: { align: 'center', leftIndent: 18, paragraphAfter: 11 },
          },
          {
            id: 'paragraph-derived',
            basedOn: 'paragraph-base',
            attributes: { rightIndent: 9, firstLineIndent: -6, paragraphBefore: 7 },
          },
        ],
        characterStyles: [{ id: 'character-emphasis', attributes: { italic: true } }],
      },
    },
    beforeDocument = JSON.stringify(doc);
  function project(html, settings = {}) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const original = root.innerHTML,
      result = compositionSource(root, {
        id: 'paragraph-projection',
        doc,
        settings,
        fontFor: (style) => (style.italic ? 'exact-italic' : 'exact-regular'),
      });
    assert(
      root.innerHTML === original && result.sourceHTML === original,
      'Projection changed HTML',
    );
    assert(result.protocol === 2, 'Paragraph policy was sent using the old transport protocol');
    assert(result.paragraphs[0]?.start === 0, 'Paragraph policy lost its first native boundary');
    let end = 0;
    for (const paragraph of result.paragraphs) {
      assert(paragraph.start === end, 'Paragraph policies lost native source continuity');
      assert(
        paragraph.end === paragraph.contentEnd + 1 &&
          result.text[paragraph.contentEnd] === '\u2029',
        'Paragraph policy does not end at its actual transported separator',
      );
      assert(
        !result.text.slice(paragraph.start, paragraph.contentEnd).includes('\u2029'),
        'A literal paragraph separator was hidden inside another paragraph policy',
      );
      end = paragraph.end;
    }
    assert(end === result.text.length, 'Paragraph policies do not cover the native source');
    return result;
  }

  const inherited = {
    align: 'right',
    paragraphBefore: 5.25,
    paragraphAfter: 9.75,
    leftIndent: 24.5,
    rightIndent: 12.25,
    firstLineIndent: -6.125,
  };
  for (const align of ALIGNMENTS) {
    const result = project('<p>Complete <em>paragraph</em>.</p>', { ...inherited, align });
    equal(
      policy(result.paragraphs[0]),
      { ...inherited, align },
      'Flow paragraph defaults were lost',
    );
  }

  const styled = project(
    '<p data-ivo-pstyle="paragraph-derived" data-ivo-align="justify-right" data-ivo-before="0">' +
      '<span data-ivo-cstyle="character-emphasis">Italic</span> regular</p>',
  );
  equal(
    policy(styled.paragraphs[0]),
    {
      align: 'justify-right',
      paragraphBefore: 0,
      paragraphAfter: 11,
      leftIndent: 18,
      rightIndent: 9,
      firstLineIndent: -6,
    },
    'Named paragraph inheritance or sparse direct resets were flattened',
  );
  assert(
    styled.runs.some((run) => run.font === 'exact-italic'),
    'Character style was lost',
  );
  assert(
    styled.runs.at(-1).font === 'exact-regular',
    'Paragraph mark inherited final inline style',
  );

  const structured = project(
    'Lead <strong>words</strong><div data-ivo-align="right">Second<br>soft</div>' +
      '<div data-ivo-after="4"><br></div>' +
      '<div data-ivo-left="24"><div data-ivo-first="-8">Nested leaf</div></div>tail',
  );
  assert(
    structured.text === 'Lead words\u2029Second\u2028soft\u2029\u2029Nested leaf\u2029tail\u2029',
    'Implicit/soft/blank/nested paragraph text changed',
  );
  equal(
    structured.paragraphs.map(policy),
    [
      policy(TEXT_DEFAULTS),
      { ...policy(TEXT_DEFAULTS), align: 'right' },
      { ...policy(TEXT_DEFAULTS), paragraphAfter: 4 },
      { ...policy(TEXT_DEFAULTS), leftIndent: 24, firstLineIndent: -8 },
      policy(TEXT_DEFAULTS),
    ],
    'Paragraph properties escaped their structural owner',
  );
  const literal = project('<p data-ivo-left="12">First\u2029Second</p>');
  assert(literal.text === 'First\u2029Second\u2029', 'Literal paragraph source was changed');
  assert(literal.paragraphs.length === 2, 'Literal separator did not create a policy boundary');
  assert(
    literal.paragraphs.every((p) => p.leftIndent === 12),
    'Literal separator lost its policy',
  );
  assert(
    literal.spans.some((span) => span.kind === 'text' && span.start === 0 && span.end === 12),
    'Literal separator was rewritten as generated source',
  );
  assert(literal.paragraphs[0].logicalEnd === 7, 'Literal separator lost its canonical boundary');
  const literalRoot = document.createElement('div');
  literalRoot.innerHTML = '<p>First\u2029Second</p>';
  equal(
    textParagraphRanges(literalRoot),
    [
      { start: 0, end: 7, contentStart: 1, contentEnd: 6 },
      { start: 7, end: 14, contentStart: 7, contentEnd: 13 },
    ],
    'Literal Unicode paragraph selection crossed its separator',
  );
  equal(
    policy(project('', inherited).paragraphs[0]),
    inherited,
    'Empty root lost its intentional paragraph policy',
  );
  equal(
    policy(project('<p data-ivo-left="12"><span data-ivo-left="12">Same</span></p>').paragraphs[0]),
    { ...policy(TEXT_DEFAULTS), leftIndent: 12 },
    'A redundant inline property changed paragraph authority',
  );
  for (const html of [
    '<p><span data-ivo-align="right">Conflicting inline paragraph</span></p>',
    '<p data-ivo-left="12"><span data-ivo-left="0">Conflicting reset</span></p>',
    '<span data-ivo-pstyle="paragraph-derived">Inline-only named paragraph</span>',
    '<p data-ivo-hyphens="true">Unsupported hyphenation</p>',
    '<p>Text <span data-ivo-keepedges="true">inline</span></p>',
    '<p data-ivo-dir="rtl">Unsupported direction</p>',
  ]) {
    let failed = false;
    try {
      project(html);
    } catch (error) {
      failed = error instanceof UnsupportedComposition;
    }
    assert(failed, 'Unsupported paragraph source was silently flattened: ' + html);
  }
  assert(JSON.stringify(doc) === beforeDocument, 'Projection modified named style definitions');
  return {
    paragraphPoliciesProjected: true,
    paragraphNamedStylesAndSparseResets: true,
    implicitBlankSoftAndLiteralParagraphs: true,
    conflictingInlineParagraphPropertiesRejected: true,
    paragraphProjectionNoWrites: true,
  };
}
