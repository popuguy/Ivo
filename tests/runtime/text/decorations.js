import { applyNamedTextStyles } from '../../../src/rendering/text/styles.js';
import { applyFrameTypography } from '../../../src/rendering/text/format.js';
import { applyTextDecorations } from '../../../src/rendering/text/decorations.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';
import { flowInputHTML } from '../../../src/rendering/text/flow-input.js';
import { createSceneDocument } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import { captureTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';

/** Exercise real decoration cascade, view-only wrappers and composition guards. */
export async function verifyTextDecorations() {
  const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    },
    root = document.createElement('div'),
    doc = createSceneDocument('Effective decorations');
  root.className = 'rich-text canvas-text';
  root.contentEditable = 'true';
  root.style.cssText = 'position:fixed;left:-10000px;top:0;width:500px';
  document.body.append(root);
  const before =
    '<p><u>Underlined <span data-ivo-underline="false">plain</span> again</u></p><p><s>Struck <span data-ivo-strike="false">clear</span> again</s></p>';
  root.innerHTML = cleanHTML(before);
  const source = cleanHTML(root.innerHTML),
    originalText = root.textContent,
    nodes = textIndexMap(root).segments.map(({ node, start, end }) => ({ node, start, end }));
  const range = document.createRange();
  range.setStart(root.querySelector('u'), 0);
  range.setEnd(root.querySelector('u'), 2);
  root.focus({ preventScroll: true });
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const bookmark = captureTextSelection(root);
  try {
    applyFrameTypography(root, {
      textStyle: 'cmu-serif',
      fontSize: 16,
      underline: false,
      strikethrough: false,
    });
    const metric = root.getBoundingClientRect();
    applyNamedTextStyles(root, doc);
    assert(
      getComputedStyle(root.querySelector('u')).textDecorationLine === 'none',
      'Semantic underline still paints on the ancestor',
    );
    assert(
      getComputedStyle(root.querySelector('s')).textDecorationLine === 'none',
      'Semantic strike still paints on the ancestor',
    );
    const plain = root.querySelector('[data-ivo-underline="false"]'),
      clear = root.querySelector('[data-ivo-strike="false"]');
    assert(
      !plain.querySelector('[data-ivo-decoration-run]') &&
        !clear.querySelector('[data-ivo-decoration-run]'),
      'Explicit false runs remain decorated',
    );
    assert(
      root.querySelector('u > [data-ivo-decoration-run]').style.textDecorationLine === 'underline',
      'Effective underline run is not painted',
    );
    assert(
      root.querySelector('s > [data-ivo-decoration-run]').style.textDecorationLine ===
        'line-through',
      'Effective strike run is not painted',
    );
    const afterNodes = textIndexMap(root).segments;
    assert(
      nodes.every(
        (part, i) =>
          part.node === afterNodes[i].node &&
          part.start === afterNodes[i].start &&
          part.end === afterNodes[i].end,
      ),
      'Decoration wrapping changed canonical text indices or text-node identity',
    );
    const restored = captureTextSelection(root);
    assert(
      restored.anchor.index === bookmark.anchor.index &&
        restored.focus.index === bookmark.focus.index,
      'Decoration wrapping changed parent-offset selection endpoints',
    );
    assert(
      root.getBoundingClientRect().height === metric.height,
      'Decoration wrappers introduced line metrics',
    );
    assert(
      root.textContent === originalText &&
        cleanHTML(root.innerHTML) === source &&
        flowInputHTML(root) === source,
      'Derived decoration paint entered canonical source',
    );
    const firstRun = root.querySelector('[data-ivo-decoration-run]');
    assert(
      !applyTextDecorations(root, doc) &&
        root.querySelector('[data-ivo-decoration-run]') === firstRun,
      'Stable decoration rendering rebuilt the live input',
    );

    root.innerHTML = cleanHTML(
      '<p>Frame underlined <span data-ivo-underline="false">except here</span> and <span data-ivo-strike="true">strike</span>.</p>',
    );
    applyFrameTypography(root, { textStyle: 'cmu-serif', fontSize: 16, underline: true });
    applyNamedTextStyles(root, doc);
    assert(
      getComputedStyle(root).textDecorationLine === 'none',
      'Frame underline still paints on the root',
    );
    assert(
      !root.querySelector('[data-ivo-underline="false"] [data-ivo-decoration-run]'),
      'False run failed beneath frame underline',
    );
    assert(
      root.querySelector('[data-ivo-strike="true"] [data-ivo-decoration-run]').style
        .textDecorationLine === 'underline line-through',
      'Combined effective decorations were not retained',
    );

    const style = saveTextStyle(doc, 'paragraph', {
      name: 'Ruled',
      attributes: { underline: true, strikethrough: true, fontSize: 23, textStyle: 'cmu-serif' },
    });
    const namedSource = `<p data-ivo-pstyle="${style.id}">Named <span data-ivo-underline="false" data-ivo-strike="false">clear</span>.</p>`;
    root.innerHTML = cleanHTML(namedSource);
    applyFrameTypography(root, { textStyle: 'cmu-serif', fontSize: 16 });
    applyNamedTextStyles(root, doc);
    assert(
      root.querySelector('p > [data-ivo-decoration-run]').style.textDecorationLine ===
        'underline line-through',
      'Named style decoration was not resolved',
    );
    assert(
      !root.querySelector('p span[data-ivo-underline="false"] [data-ivo-decoration-run]'),
      'Named style false override remains decorated',
    );
    const serialized = cleanHTML(root.innerHTML),
      holder = document.createElement('div');
    holder.innerHTML = serialized;
    assert(
      !holder.querySelector('p').hasAttribute('data-ivo-size') &&
        !holder.querySelector('p').hasAttribute('data-ivo-font'),
      'Resolved named style CSS became a direct source override',
    );
    assert(serialized === cleanHTML(namedSource), 'Named style paint changed canonical source');

    root.innerHTML = '<p><span data-flow-text="1"><u>Mapped text</u></span> outside</p>';
    applyFrameTypography(root, { textStyle: 'cmu-serif', fontSize: 16 });
    applyNamedTextStyles(root, doc);
    const mapped = root.querySelector('[data-flow-text]');
    assert(
      mapped.textContent === 'Mapped text' &&
        mapped
          .querySelector('[data-ivo-decoration-run]')
          .firstChild.parentElement.closest('[data-flow-text]') === mapped,
      'Decoration wrappers broke flow text provenance',
    );

    root.innerHTML = '<p><u>Composing</u></p>';
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'x' }));
    applyNamedTextStyles(root, doc);
    assert(
      !root.querySelector('[data-ivo-decoration-run]'),
      'Decoration renderer changed the input DOM during composition',
    );
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }));
    await Promise.resolve();
    assert(
      root.querySelector('u > [data-ivo-decoration-run]'),
      'Composition-end repaint did not resolve effective decoration',
    );
    assert(
      !cleanHTML(
        '<span data-ivo-decoration-run style="font-size:99px;text-decoration:underline"><span data-ivo-italic="false">Safe</span><script>bad()</script></span>',
      ).includes('99'),
      'Derived wrapper styles leaked into canonical source',
    );
    return {
      falseDecorationOverrides: true,
      frameAndNamedDecorations: true,
      sourceUnchanged: true,
      logicalIndicesStable: true,
      parentOffsetSelectionStable: true,
      compositionDeferred: true,
      flowProvenanceStable: true,
    };
  } finally {
    root.remove();
  }
}
