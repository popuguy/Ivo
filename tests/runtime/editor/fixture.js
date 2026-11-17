import {
  applyTextLayout,
  preserveTextLines,
  measuredPointSize,
  textIsOverset,
} from '../../../src/rendering/text/layout.js';
try {
  await document.fonts.ready;
  const text = document.querySelector('.rich-text'),
    original = text.textContent;
  if (!textIsOverset(text)) throw new Error('Fixture did not contain overset area text');
  preserveTextLines(text);
  const breaks = text.querySelectorAll('br').length;
  if (!breaks || text.textContent !== original)
    throw new Error('Forced-line conversion lost content');
  if (
    text.querySelector('strong')?.textContent !== 'Area text' ||
    text.querySelector('em')?.textContent !== 'inline emphasis'
  )
    throw new Error('Inline formatting lost');
  applyTextLayout(text, { textKind: 'point', textScale: { x: 1, y: 1 } });
  const point = measuredPointSize(text);
  if (textIsOverset(text) || point.height <= 70)
    throw new Error('Point text did not retain overflow');
  applyTextLayout(text, { textKind: 'area', textScale: { x: 1, y: 1 } });
  if (text.querySelectorAll('br').length !== breaks || text.textContent !== original)
    throw new Error('Reverse conversion lost forced lines');
  console.log(
    'IVO_EDITOR_RESULT:' +
      JSON.stringify({
        ok: true,
        forcedBreaks: breaks,
        pointSize: point,
        fullTextAndFormattingPreserved: true,
        oversetPreserved: true,
      }),
  );
} catch (error) {
  console.log('IVO_EDITOR_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
