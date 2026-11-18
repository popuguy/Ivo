import { composedSVG } from '../../src/rendering/text/composed-svg.js';
const ns = 'http://www.w3.org/2000/svg';
try {
  const data = JSON.parse(document.querySelector('#preview-data').textContent),
    width = document.querySelector('#width'),
    zoom = document.querySelector('#zoom'),
    showLines = document.querySelector('#show-lines'),
    showCarets = document.querySelector('#show-carets'),
    selected = document.querySelector('#selection');
  for (const value of data.layouts) {
    const option = document.createElement('option');
    option.value = value.width;
    option.textContent = value.width + ' pt';
    width.append(option);
  }
  width.value = '160';
  function paint() {
    const current = data.layouts.find((l) => l.width === Number(width.value)),
      scale = Number(zoom.value) / 100;
    document.querySelector('#zoom-value').textContent = Number(zoom.value).toFixed(0) + '%';
    for (const mode of ['single-line', 'paragraph']) {
      const result = current[mode],
        frame = { id: 'sample', width: current.width, height: 360 },
        paper = document.getElementById(mode);
      paper.innerHTML = composedSVG({ ...result, vectors: data.vectors }, frame, {
        text: data.source.text,
        styles: data.source.runs,
        idPrefix: 'preview-' + mode,
      });
      const svg = paper.querySelector('svg');
      svg.style.width = frame.width * scale + 'px';
      svg.style.height = frame.height * scale + 'px';
      for (const line of result.layout.lines) {
        if (showLines.checked) {
          const rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('class', 'line-boundary');
          for (const [k, v] of Object.entries({
            x: 0,
            y: line.baseline - line.ascent,
            width: frame.width,
            height: line.ascent + line.descent,
          }))
            rect.setAttribute(k, v);
          svg.append(rect);
        }
        if (showCarets.checked)
          for (const caret of line.carets) {
            if (caret.index > line.contentEnd) continue;
            const marker = document.createElementNS(ns, 'line');
            marker.setAttribute('class', 'caret-marker');
            for (const [k, v] of Object.entries({
              x1: caret.primary,
              x2: caret.primary,
              y1: line.baseline - line.ascent,
              y2: line.baseline + line.descent,
            }))
              marker.setAttribute(k, v);
            svg.append(marker);
          }
      }
      document.getElementById(
        mode === 'paragraph' ? 'paragraph-caption' : 'single-caption',
      ).textContent = result.layout.lines.length + ' lines · CMU Serif';
    }
  }
  for (const element of [width, zoom, showLines, showCarets])
    element.addEventListener('input', paint);
  document.querySelector('#reset').addEventListener('click', () => {
    width.value = '160';
    zoom.value = '160';
    showLines.checked = showCarets.checked = false;
    paint();
  });
  document.querySelector('main').addEventListener('pointerover', (event) => {
    const glyph = event.target.closest?.('[data-composed-index]');
    if (!glyph) return;
    const start = Number(glyph.dataset.composedIndex),
      end = Number(glyph.dataset.composedEnd),
      text = data.source.text.slice(start, end),
      count = [...text].length;
    selected.textContent =
      '“' +
      text +
      '” — ' +
      count +
      ' source character' +
      (count === 1 ? '' : 's') +
      ', one drawn shape.';
  });
  document.querySelector('main').addEventListener('click', (event) => {
    const glyph = event.target.closest?.('[data-composed-index]');
    if (!glyph) return;
    document.querySelectorAll('use.selected').forEach((node) => node.classList.remove('selected'));
    glyph.classList.add('selected');
  });
  paint();
  globalThis.ivoCompositionPreviewReady = true;
} catch (error) {
  const message = document.querySelector('#error');
  message.hidden = false;
  message.textContent = 'The preview could not open: ' + error.message;
  console.error(error);
}
