import {
  compositionSource,
  UnsupportedComposition,
} from '../../../src/rendering/text/composition-source.js';
import { effectiveTextStyle } from '../../../src/domain/documents/publishing.js';
import { TEXT_DEFAULTS } from '../../../src/domain/text/typography.js';
import { nativeCharacterStyle } from '../../../src/domain/text/native-character-style.js';

const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  equal = (actual, expected, message) =>
    assert(JSON.stringify(actual) === JSON.stringify(expected), message),
  advanced = (run) => nativeCharacterStyle(run);

/** Source-only real-DOM witnesses; no native request, font load, focus or editing. */
export function verifyNativeCharacterProjection() {
  const doc = {
      publishing: {
        paragraphStyles: [
          {
            id: 'paragraph-characters',
            attributes: { baselineShift: -2, horizontalScale: 125, oldstyleFigures: true },
          },
        ],
        characterStyles: [
          {
            id: 'character-base',
            attributes: {
              baselineShift: 3,
              horizontalScale: 150,
              smallCaps: true,
              oldstyleFigures: true,
            },
          },
          {
            id: 'character-derived',
            basedOn: 'character-base',
            attributes: { verticalScale: 125, fractions: true },
          },
        ],
      },
    },
    beforeDocument = JSON.stringify(doc);
  function project(html, settings = {}) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const original = root.innerHTML,
      effective = effectiveTextStyle(doc, settings),
      resolved = Object.fromEntries(
        Object.keys(TEXT_DEFAULTS)
          .filter((key) => effective[key] !== undefined)
          .map((key) => [key, effective[key]]),
      ),
      result = compositionSource(root, {
        id: 'character-projection',
        doc,
        settings: resolved,
        fontFor: (style) => (style.italic ? 'exact-italic' : 'exact-regular'),
      });
    assert(
      root.innerHTML === original && result.sourceHTML === original,
      'Character projection changed HTML',
    );
    let native = 0,
      logical = 0;
    for (const span of result.spans) {
      assert(
        span.start === native && span.logicalStart === logical,
        'Character style changed source-map continuity',
      );
      native = span.end;
      logical = span.logicalEnd;
    }
    assert(
      native === result.text.length && logical === result.logicalLength,
      'Character style lost source coverage',
    );
    return result;
  }

  const legacy = project('<p>A<span>B</span>C</p>');
  assert(
    legacy.protocol === 2 && legacy.runs.length === 1,
    'Default source changed protocol/run identity',
  );
  equal(advanced(legacy.runs[0]), {}, 'Default source acquired advanced character fields');
  const liga = project('<p data-ivo-liga="false">A<span>B</span>C</p>');
  assert(
    liga.protocol === 2 && liga.runs.length === 1 && !liga.runs[0].ligatures,
    'Existing ligature policy incorrectly requires protocol4',
  );

  const markedHTML =
      '<p data-ivo-baseline="4" data-ivo-hscale="150" data-ivo-vscale="125" ' +
      'data-ivo-dlig="true" data-ivo-smcp="true" data-ivo-onum="true" data-ivo-tnum="true" ' +
      'data-ivo-zero="true" data-ivo-frac="true" data-ivo-ordn="true" data-ivo-salt="true">' +
      'A <span>B</span> C\u2029D<br>E<a data-doc-id="linked-doc">link</a></p><p><br></p>',
    marked = project(markedHTML),
    plain = project(
      '<p>A <span>B</span> C\u2029D<br>E<a data-doc-id="linked-doc">link</a></p><p><br></p>',
    );
  assert(marked.protocol === 4, 'Advanced source did not select protocol4');
  equal(marked.spans, plain.spans, 'Character styles changed native/logical source spans');
  assert(
    marked.text === plain.text && marked.logicalLength === plain.logicalLength,
    'Character styles inserted or removed source characters',
  );
  equal(marked.links, plain.links, 'Character styles changed linked document source');
  equal(
    advanced(marked.runs[0]),
    {
      baselineShift: 4,
      horizontalScale: 150,
      verticalScale: 125,
      features: {
        dlig: true,
        frac: true,
        onum: true,
        ordn: true,
        salt: true,
        smcp: true,
        tnum: true,
        zero: true,
      },
    },
    'Character transport omitted a scalar or OpenType toggle',
  );

  const coalesced = project(
    '<p><span data-ivo-smcp="true">A</span><span data-ivo-smcp="true">B</span>C</p>',
  );
  equal(
    coalesced.runs.map(({ start, end }) => [start, end]),
    [
      [0, 2],
      [2, 4],
    ],
    'Equal feature dictionaries did not coalesce by value',
  );
  equal(
    advanced(coalesced.runs[0]),
    { features: { smcp: true } },
    'Coalesced feature policy changed',
  );
  equal(advanced(coalesced.runs[1]), {}, 'The reset after a feature run inherited its predecessor');
  const reset = project(
    '<p data-ivo-smcp="true" data-ivo-baseline="4" data-ivo-hscale="150">' +
      'A<span data-ivo-smcp="false" data-ivo-baseline="0" data-ivo-hscale="100">B</span>C</p>',
  );
  equal(
    reset.runs.map(({ start, end }) => [start, end]),
    [
      [0, 1],
      [1, 2],
      [2, 4],
    ],
    'A sparse scalar/feature reset merged into an advanced run',
  );
  equal(advanced(reset.runs[1]), {}, 'An explicit false/zero/default reset was lost');
  equal(
    advanced(reset.runs[0]),
    advanced(reset.runs[2]),
    'Paragraph-owned character style did not resume after reset',
  );
  const raised = project('<p>A<span data-ivo-baseline="4" data-ivo-smcp="true">B</span>C</p>');
  assert(raised.runs.length === 3, 'A trailing default run inherited sparse advanced fields');
  equal(advanced(raised.runs.at(-1)), {}, 'A trailing default run did not reset to identity');

  const named = project(
    '<p><span data-ivo-cstyle="character-derived" data-ivo-hscale="100" data-ivo-frac="false">Styled</span> plain</p>',
  );
  equal(
    advanced(named.runs[0]),
    { baselineShift: 3, verticalScale: 125, features: { onum: true, smcp: true } },
    'Named character inheritance or direct default resets changed',
  );
  equal(
    advanced(named.runs.at(-1)),
    {},
    'Paragraph mark inherited the last inline character style',
  );
  const flowNamed = project('<p>Flow style</p>', {
    characterStyle: 'character-derived',
    textOverrides: { horizontalScale: 100, fractions: false },
  });
  assert(
    flowNamed.protocol === 4 && flowNamed.runs.length === 1,
    'Effective flow character styles lost their paragraph mark',
  );
  equal(
    advanced(flowNamed.runs[0]),
    advanced(named.runs[0]),
    'Effective named flow and inline character styles disagree',
  );
  const paragraph = project(
    '<p data-ivo-pstyle="paragraph-characters">Paragraph style</p><p data-ivo-pstyle="paragraph-characters"><br></p>',
  );
  assert(
    paragraph.protocol === 4 && paragraph.runs.length === 1,
    'Empty paragraph lost named character policy or coalescing',
  );
  equal(
    advanced(paragraph.runs[0]),
    { baselineShift: -2, horizontalScale: 125, features: { onum: true } },
    'Named paragraph character policy was discarded',
  );
  const clearParagraph = project(
    '<p data-ivo-pstyle="paragraph-characters" data-ivo-baseline="0" data-ivo-hscale="100" data-ivo-onum="false">Reset</p>',
  );
  assert(
    clearParagraph.protocol === 2,
    'All-default named-style resets retained a needless protocol4 policy',
  );

  const marks = project(
    '<p data-ivo-frac="true">Before<span data-ivo-frac="false">plain</span></p><p data-ivo-smcp="true"><br></p>',
  );
  const firstMark = marks.runs.find(
    (run) =>
      marks.paragraphs[0].contentEnd >= run.start && marks.paragraphs[0].contentEnd < run.end,
  );
  equal(
    advanced(firstMark),
    { features: { frac: true } },
    'Paragraph mark inherited final inline false reset',
  );
  equal(
    advanced(marks.runs.at(-1)),
    { features: { smcp: true } },
    'Placeholder paragraph lost its own feature mark',
  );
  const empty = project('', { baselineShift: 4, smallCaps: true });
  assert(
    empty.protocol === 4 && empty.logicalLength === 0 && empty.text === '\u2029',
    'Empty source changed its virtual text/transport ownership',
  );
  equal(
    advanced(empty.runs[0]),
    { baselineShift: 4, features: { smcp: true } },
    'Empty root lost insertion character style',
  );
  const emptyDefault = project('', TEXT_DEFAULTS);
  assert(emptyDefault.protocol === 2, 'Default empty source changed protocol identity');

  for (const html of [
    '<p data-ivo-caps="true">Unsupported case mapping</p>',
    '<p data-ivo-axes="wght:650">Unsupported variation axes</p>',
    '<p data-ivo-lang="fr-FR">Unsupported shaping language</p>',
    '<p data-ivo-optical="false">Unsupported optical size policy</p>',
    '<p data-ivo-dir="rtl">Unsupported direction</p>',
    '<p data-ivo-hyphens="true">Unsupported hyphenation</p>',
  ]) {
    let failed = false;
    try {
      project(html);
    } catch (error) {
      failed = error instanceof UnsupportedComposition;
    }
    assert(failed, 'A gated feature was silently sent as native character support: ' + html);
  }
  for (const settings of [
    { baselineShift: Number.NaN },
    { horizontalScale: 0 },
    { verticalScale: 1001 },
    { fractions: 'true' },
  ]) {
    let failed = false;
    try {
      project('<p>Strict input</p>', settings);
    } catch (error) {
      failed = error instanceof TypeError;
    }
    assert(failed, 'Invalid effective character style silently became a default');
  }
  assert(JSON.stringify(doc) === beforeDocument, 'Projection mutated named style definitions');
  return {
    nativeCharacterConditionalProtocol: true,
    nativeCharacterDeepRunCoalescing: true,
    nativeCharacterNamedStylesAndResets: true,
    nativeCharacterEmptyAndParagraphMarks: true,
    nativeCharacterSourceAndUTF16Unchanged: true,
    nativeCharacterUnsupportedPoliciesGated: true,
  };
}
