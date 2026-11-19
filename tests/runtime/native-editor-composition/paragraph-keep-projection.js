import { compositionSource } from '../../../src/rendering/text/composition-source.js';

const assert = (condition, message) => {
  if (!condition) throw Error(message);
};

/** Paragraph-mark policy stays separate from shaping and from source text. */
export function verifyParagraphKeepProjection() {
  const doc = {
    publishing: {
      paragraphStyles: [{ id: 'kept', attributes: { keepTogether: true } }],
      characterStyles: [],
    },
  };
  function project(html, settings = {}) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const before = root.innerHTML,
      result = compositionSource(root, {
        id: 'paragraph-keeps',
        doc,
        settings,
        fontFor: () => 'exact-regular',
      });
    assert(
      root.innerHTML === before && result.sourceHTML === before,
      'Keep projection edited HTML',
    );
    assert(result.protocol === 2, 'Paragraph keeps leaked into the character protocol');
    assert(
      result.runs.every((run) => !('keepTogether' in run) && !('keepWithNext' in run)),
      'Paragraph keep flags leaked into character runs',
    );
    return result;
  }
  const source = project(
    '<p data-ivo-keep="true">A<span>B</span><br>C</p><p data-ivo-next="true">N</p><p>Z</p>',
  );
  assert(source.text === 'AB\u2028C\u2029N\u2029Z\u2029', 'Keep projection changed text/breaks');
  assert(
    JSON.stringify(
      source.paragraphs.map(({ keepTogether, keepWithNext }) => [keepTogether, keepWithNext]),
    ) ===
      JSON.stringify([
        [true, false],
        [false, true],
        [false, false],
      ]),
    'Keep policy did not belong to its paragraph mark',
  );
  const reset = project('<p>Inherited</p><p data-ivo-keep="false">Reset</p>', {
    keepTogether: true,
  });
  assert(
    reset.paragraphs[0].keepTogether && !reset.paragraphs[1].keepTogether,
    'Explicit All reset was lost',
  );
  const named = project('<p data-ivo-pstyle="kept">Named</p><p>Default</p>');
  assert(
    named.paragraphs[0].keepTogether && !named.paragraphs[1].keepTogether,
    'Named paragraph keep leaked',
  );
  const literal = project('<p data-ivo-keep="true">A\u2029B</p>');
  assert(
    literal.paragraphs.length === 2 && literal.paragraphs.every((p) => p.keepTogether),
    'Literal paragraph marks lost keep ownership',
  );
  for (const html of [
    '<p data-ivo-keep="true">A<span data-ivo-keep="false">B</span></p>',
    '<p>A<span data-ivo-next="true">B</span></p>',
    '<p>Text <span data-ivo-widows="3">inline</span></p>',
  ]) {
    let rejected = false;
    try {
      project(html);
    } catch (error) {
      rejected = /paragraph properties on inline text|widows/.test(error.message);
    }
    assert(rejected, 'Unqualified paragraph policy was silently discarded');
  }
  return { nativeKeepParagraphMarkProjection: true, nativeKeepSourceResetsAndNamedStyles: true };
}
