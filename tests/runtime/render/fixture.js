import { applyPageCamera } from '../../../src/rendering/page-camera.js';
import { screenToWorld, worldToScreen } from '../../../src/domain/geometry/viewport.js';
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const world = document.querySelector('#world'),
  viewport = document.querySelector('#viewport');
const samples = [];
function sampleHTML(id = 'sample') {
  return `<div style="position:absolute;left:0;top:0;width:20px;height:2px;background:#ff00ff" aria-hidden="true"></div><div class="sample canvas-object object-text" id="${id}"><div class="rich-text canvas-text cmu-serif" data-text-kind="area" style="font-size:17px"><p contenteditable="true">Vector <em>notes</em></p></div><svg viewBox="0 0 70 20"><path d="M1 18L18 2 35 18 52 2 69 18" fill="none" stroke="#253c6e" stroke-width=".6"/></svg></div><div class="clipping"><img alt="Original image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGN49vorVmSUsgUrYhjVQBMNuCRwGTSqgSYaACk0CB+bcN8GAAAAAElFTkSuQmCC"></div>`;
}
let captureStage = 0;
const stageMarker = document.createElement('div');
stageMarker.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;z-index:1000';
document.body.append(stageMarker);
async function capture(name, rect, change) {
  const stage = [
    20 + ((++captureStage * 37) % 200),
    30 + ((captureStage * 53) % 200),
    40 + ((captureStage * 71) % 200),
  ];
  stageMarker.style.backgroundColor = `rgb(${stage})`;
  change?.();
  console.log(
    'IVO_RENDER_FRAME:' + JSON.stringify({ name, rect, stage, viewportWidth: window.innerWidth }),
  );
  await new Promise((resolve) => (window.__renderCaptureDone = resolve));
}
try {
  await document.fonts.load('17px "CMU Serif"');
  await document.fonts.ready;
  world.innerHTML = sampleHTML();
  await document.fonts.load('italic 17px "CMU Serif"');
  await document.fonts.ready;
  const initialHTML = world.innerHTML,
    original = world.querySelector('.sample'),
    text = original.querySelector('p'),
    vp = viewport.getBoundingClientRect();
  for (const zoom of [0.25, 0.735, 1, 1.125, 2.75, 7.75]) {
    const camera = { x: 130.25, y: 45.125, zoom };
    applyPageCamera(world, camera);
    const bounds = original.getBoundingClientRect(),
      expected = worldToScreen({ x: 12, y: 10 }, camera);
    assert(
      Math.abs(bounds.x - vp.x - expected.x) < 0.025 &&
        Math.abs(bounds.y - vp.y - expected.y) < 0.025,
      'Page position diverged at ' + zoom,
    );
    assert(
      Math.abs(bounds.width - 230 * zoom) < 0.025 && Math.abs(bounds.height - 100 * zoom) < 0.025,
      'Page size diverged at ' + zoom,
    );
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    assert(
      matrix.a === 1 && matrix.d === 1 && matrix.m33 === 1,
      'A compositor scale can enlarge cached pixels',
    );
    const range = document.createRange();
    range.setStart(text.firstChild, 0);
    range.setEnd(text.firstChild, 1);
    const glyph = range.getBoundingClientRect();
    const screen = { x: glyph.x - vp.x + glyph.width / 2, y: glyph.y - vp.y + glyph.height / 2 },
      point = screenToWorld(screen, camera);
    assert(
      point.x >= 12 && point.x < 28 && point.y >= 10 && point.y < 40,
      'Text range did not use document-space coordinates',
    );
    const caret = document.caretRangeFromPoint(
      glyph.x + glyph.width * 0.2,
      glyph.y + glyph.height * 0.5,
    );
    assert(
      caret && text.contains(caret.startContainer),
      'Native caret hit testing missed text at ' + zoom,
    );
    const mask = world.querySelector('.clipping').getBoundingClientRect(),
      image = world.querySelector('.clipping img').getBoundingClientRect();
    assert(
      Math.abs(mask.width - 50 * zoom) < 0.025 && Math.abs(image.width - 80 * zoom) < 0.025,
      'Mask/source dimensions diverged at ' + zoom,
    );
    samples.push({
      zoom,
      maxPositionError: Math.max(
        Math.abs(bounds.x - vp.x - expected.x),
        Math.abs(bounds.y - vp.y - expected.y),
      ),
      rangeWidth: glyph.width,
    });
  }
  assert(
    world.innerHTML === initialHTML && world.querySelector('.sample') === original,
    'Camera replaced editable content',
  );
  // Capture the first requested zoomed frame, then the same view after settling.
  applyPageCamera(world, { x: 25, y: 20, zoom: 0.5 });
  await frame();
  await frame();
  const crop = { x: 24, y: 24, width: 760, height: 240 };
  await capture('warmup', crop);
  await capture('first-frame', crop, () => applyPageCamera(world, { x: 25, y: 20, zoom: 3.125 }));
  for (let i = 0; i < 20; i++) await frame();
  await capture('settled', crop);
  const paragraph = world.querySelector('p'),
    paragraphBounds = paragraph.getBoundingClientRect(),
    textCrop = {
      x: Math.floor(paragraphBounds.x - 2),
      y: Math.floor(paragraphBounds.y - 2),
      width: Math.ceil(paragraphBounds.width + 4),
      height: Math.ceil(paragraphBounds.height + 4),
    };
  await capture('layout-text', textCrop);
  const reference = document.createElement('p');
  reference.innerHTML = paragraph.innerHTML;
  reference.style.cssText = `position:absolute;left:${paragraphBounds.x - vp.x}px;top:${paragraphBounds.y - vp.y}px;width:${paragraphBounds.width}px;margin:0;font:53.125px/1.5 'CMU Serif',Georgia`;
  viewport.append(reference);
  world.style.visibility = 'hidden';
  await frame();
  await capture('native-size-text', textCrop);
  reference.remove();
  world.style.visibility = '';
  // 500 editable/vector objects: layout zoom, not whole-document geometry mutation.
  world.innerHTML = '';
  for (let i = 0; i < 500; i++) {
    const element = document.createElement('div');
    element.className = 'shape';
    element.style.cssText = `left:${20 + (i % 20) * 27}px;top:${20 + Math.floor(i / 20) * 22}px;width:25px;height:20px`;
    element.innerHTML =
      i % 5
        ? '<svg viewBox="0 0 25 20" width="25" height="20"><path d="M1 1H24L20 19H4Z" fill="#e5e8ed" stroke="#536171" stroke-width=".6"/></svg>'
        : '<span style="font:9px/1.3 Georgia">Text</span>';
    world.append(element);
  }
  const before = world.innerHTML,
    times = [];
  for (let i = 0; i < 60; i++) {
    await frame();
    const start = performance.now();
    applyPageCamera(world, { x: 15 - i * 0.3, y: 20 + i * 0.2, zoom: 0.6 + (i % 30) / 60 });
    world.lastElementChild.getBoundingClientRect();
    times.push(performance.now() - start);
  }
  assert(world.innerHTML === before, 'Camera mutated the scene DOM');
  times.sort((a, b) => a - b);
  console.log(
    'IVO_RENDER_RESULT:' +
      JSON.stringify({
        ok: true,
        devicePixelRatio: window.devicePixelRatio,
        samples,
        editableNodeRetained: true,
        compositorTransformHasNoScale: true,
        objects: 500,
        applyAndLayoutMsP95: times[Math.floor(times.length * 0.95)],
        applyAndLayoutMsMax: times.at(-1),
      }),
  );
} catch (error) {
  console.log('IVO_RENDER_RESULT:' + JSON.stringify({ error: error.stack || error.message }));
}
