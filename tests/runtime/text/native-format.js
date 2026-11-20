import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { applyFrameTypography, formatRange } from '../../../src/rendering/text/format.js';
import { summarizeTextStyle } from '../../../src/rendering/text/selection-style.js';
import { createSceneDocument } from '../../../src/domain/documents/scene.js';

/** Isolated DOM regression; caller schedules it inside the sequential text runner. */
export function verifyNativeTextFormatting() {
  const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    },
    host = document.createElement('div'),
    doc = createSceneDocument('Native format normalization');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:500px';
  document.body.append(host);
  const render = (html) => {
    host.innerHTML = cleanHTML(html);
    applyFrameTypography(host, {
      textStyle: 'cmu-serif',
      fontSize: 16,
      italic: false,
      bold: false,
    });
    return host;
  };
  try {
    render(
      '<p><em>Italic above <span style="font-style: normal">Regular within</span></em></p><p><b>Bold above <span style="font-weight: normal">Regular weight</span></b></p>',
    );
    const regularItalic = host.querySelector('em span'),
      regularBold = host.querySelector('b span');
    assert(
      regularItalic.dataset.ivoItalic === 'false' &&
        getComputedStyle(regularItalic).fontStyle === 'normal',
      'Native Normal italic was lost during sanitization',
    );
    assert(
      regularBold.dataset.ivoBold === 'false' && getComputedStyle(regularBold).fontWeight === '400',
      'Native Normal weight was lost during sanitization',
    );
    assert(
      getComputedStyle(host.querySelector('em')).fontStyle === 'italic',
      'Normal override changed the surrounding italic source',
    );
    const source = host.innerHTML,
      text = host.textContent;
    render(source);
    assert(
      host.textContent === text && host.innerHTML === source,
      'Native normal marks changed during canonical remount',
    );
    const summary = summarizeTextStyle(host, doc, { textStyle: 'cmu-serif' });
    assert(
      summary.mixed.includes('italic') && summary.mixed.includes('bold'),
      'Source style reflection disagrees with normalized native marks',
    );

    render(
      '<p><em style="font-style: normal">Regular semantic tag</em><span style="font-style:italic;font-weight:700">Both marks</span></p><p style="font-style:italic"><br></p>',
    );
    assert(
      host.querySelector('em').dataset.ivoItalic === 'false' &&
        getComputedStyle(host.querySelector('em')).fontStyle === 'normal',
      'Semantic-tag native Normal did not survive',
    );
    assert(
      host.querySelector('span').dataset.ivoItalic === 'true' &&
        host.querySelector('span').dataset.ivoBold === 'true',
      'Native positive character marks were not canonicalized',
    );
    const blank = host.querySelectorAll('p')[1];
    assert(
      blank.dataset.ivoItalic === 'true' && blank.querySelector('br'),
      'An explicitly italic empty paragraph lost its insertion mark',
    );

    const authored =
      '<p><span data-ivo-italic="false" data-ivo-bold="false" data-ivo-leading="0" data-ivo-underline="false" style="font-style:italic;font-weight:700;line-height:120px;text-decoration:none">Authored wins</span></p>';
    render(authored);
    const span = host.querySelector('span');
    assert(
      span.dataset.ivoItalic === 'false' &&
        span.dataset.ivoBold === 'false' &&
        span.dataset.ivoLeading === '0',
      'Derived/native CSS replaced authoritative source attributes',
    );
    assert(
      !span.hasAttribute('data-ivo-strike'),
      'Generated underline CSS invented an unrelated strike override',
    );
    const clean = host.innerHTML;
    assert(
      cleanHTML(clean) === clean,
      'Typed source is not idempotent after native-format normalization',
    );

    render(
      '<p><span style="font-family:UnknownFamily;font-size:22px;line-height:28px;letter-spacing:0.01em;color:rgb(12, 34, 56);position:fixed;left:0;background-image:url(https://example.invalid/);transform:scale(500)" onclick="bad()">Safe text</span><script>bad()</script><img src=x onerror=bad()></p>',
    );
    const safe = host.querySelector('span');
    assert(
      !safe.hasAttribute('data-ivo-font'),
      'Unknown family silently substituted a shipped font',
    );
    assert(
      safe.dataset.ivoSize === '22' &&
        safe.dataset.ivoLeading === '28' &&
        safe.dataset.ivoTracking === '10',
      'Representable absolute character metrics were not preserved',
    );
    assert(safe.dataset.ivoColor === '#0c2238', 'Opaque native color was not normalized');
    assert(
      !/url\(|position:|left:|transform:|onclick|onerror|script|img/i.test(host.innerHTML),
      'Native-format normalization admitted active or arbitrary CSS/HTML',
    );
    const features = cleanHTML(
      '<p><span data-ivo-onum="true"><span data-ivo-salt="true"><span data-ivo-onum="false">sample</span></span></span>' +
        '<span data-ivo-salt="false"><a data-doc-id="target">linked</a> end</span></p>' +
        '<p><span data-ivo-salt="true"><span data-ivo-cstyle="special"><br></span></span></p>',
    );
    render(features);
    const run = host.querySelector('span');
    assert(
      run.textContent === 'sample' &&
        run.children.length === 0 &&
        run.dataset.ivoSalt === 'true' &&
        run.dataset.ivoOnum === 'false',
      'Effective OpenType flags changed',
    );
    assert(
      host.querySelector('a[data-doc-id="target"]').parentElement.dataset.ivoSalt === 'false' &&
        host.querySelector('[data-ivo-cstyle="special"] > br'),
      'Compaction crossed a link or named insertion style',
    );
    const range = document.createRange();
    range.selectNodeContents(run);
    for (let i = 0; i < 24; i++)
      formatRange(host, range, i % 2 ? 'oldstyleFigures' : 'ligatures', Boolean(i % 3));
    assert(
      run.firstChild.nodeType === Node.TEXT_NODE &&
        run.dataset.ivoLiga === 'true' &&
        run.dataset.ivoOnum === 'true' &&
        range.toString() === 'sample',
      'Reapplying flags grew the run or changed the selection',
    );
    range.setStart(run.firstChild, 1);
    range.setEnd(run.firstChild, 3);
    formatRange(host, range, 'stylisticAlternates', false);
    assert(
      run.dataset.ivoSalt === 'true' &&
        run.querySelector('[data-ivo-salt="false"]').textContent === 'am',
      'Changing part of a run changed the surrounding letters',
    );
    assert(cleanHTML(features) === features, 'Compacted feature settings changed on reopen');
    const nativeDecoration = cleanHTML(
      '<p><span style="text-decoration:underline line-through">Decorated</span><span style="text-decoration:none">No local decoration</span></p>',
    );
    const decoration = document.createElement('div');
    decoration.innerHTML = nativeDecoration;
    assert(
      decoration.firstChild.firstChild.dataset.ivoUnderline === 'true' &&
        decoration.firstChild.firstChild.dataset.ivoStrike === 'true',
      'Native decoration marks were lost',
    );
    assert(
      decoration.firstChild.lastChild.dataset.ivoUnderline === 'false' &&
        decoration.firstChild.lastChild.dataset.ivoStrike === 'false',
      'Native local decoration clears were lost',
    );
    // These source checks do not claim CSS none can cancel an ancestor's painted
    // underline. Effective decoration runs need their own rendering authority.
    return {
      nativeNormalMarks: true,
      nativePositiveMarks: true,
      explicitEmptyParagraph: true,
      authoredAttributesWin: true,
      remountStable: true,
      boundedNativeCss: true,
    };
  } finally {
    host.remove();
  }
}
