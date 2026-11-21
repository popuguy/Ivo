import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createInteractiveTextPort } from '../../../src/rendering/text/retained-geometry.js';
import { restoreTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';
const assert = (ok, message) => {
  if (!ok) throw Error(message);
};
const tick = () => new Promise((r) => requestAnimationFrame(r));
window.study = async () => {
  const { doc, assets, spec, trials } = await window.nativeEditorTest.load();
  const host = document.getElementById('host'),
    ids = doc.textFlows[0].frameIds;
  const urls = new Map();
  for (const asset of assets) {
    const bytes = Uint8Array.from(atob(asset.data.split(',')[1]), (c) => c.charCodeAt(0));
    urls.set('asset:' + asset.id, URL.createObjectURL(new Blob([bytes], { type: asset.mimeType })));
  }
  let portMs = 0;
  const results = new Map(),
    port = createInteractiveTextPort(window.nativeEditorTest);
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (s) => urls.get(s) || s,
    assets: () => assets,
    fonts: () => [],
    editing: true,
    canWrite: () => true,
    initialState: { tool: 'select', selection: [ids[0]] },
    textComposition: {
      compose: async (request) => {
        const begin = performance.now();
        const result = await port.compose(request);
        portMs += performance.now() - begin;
        if (result.layout) results.set(result.token, { text: request.text, result });
        return result;
      },
    },
    onChange: () => {},
    onCommit: () => {},
  });
  function current() {
    const svgs = ids.map((id) =>
      host.querySelector('[data-flow-frame="' + id + '"] svg[data-composed-text]'),
    );
    const token = svgs[0]?.dataset.compositionToken;
    if (!token || !svgs.every((el) => el?.dataset.compositionToken === token)) return null;
    return results.get(token);
  }
  async function ready(check, desc) {
    const existing = current();
    if (existing && check(existing)) return existing;
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const painted = current();
        if (painted && check(painted)) finish(resolve, painted);
      });
      function finish(done, value) {
        clearTimeout(timer);
        observer.disconnect();
        done(value);
      }
      const timer = setTimeout(
        () =>
          finish(
            reject,
            Error(
              'Reflow timed out: ' +
                desc +
                '; ' +
                (host.querySelector('[data-composition-error]')?.dataset.compositionError ||
                  current()?.text.slice(0, 55) ||
                  'no painting'),
            ),
          ),
        18000,
      );
      observer.observe(host, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-composition-token'],
      });
    });
  }
  function frames({ text, result }) {
    let end = 0,
      maxFragments = 0;
    const strings = ids.map((id) => {
      const lines = result.layout.lines.filter((l) => l.frame === id + '-column-0');
      if (!lines.length) return '';
      const counts = new Map();
      for (const l of lines) {
        const y = l.baseline.toFixed(3);
        counts.set(y, (counts.get(y) || 0) + 1);
      }
      maxFragments = Math.max(maxFragments, ...counts.values());
      const start = lines[0].start;
      assert(start === end, 'Non-contiguous frame boundary ' + [start, end]);
      end = lines.at(-1).end;
      return text.slice(start, end);
    });
    return { frames: strings, overset: !!text.slice(end).trim(), maxFragments };
  }
  const first = await ready(() => true, 'initial layout');
  const baseline = frames(first),
    original = first.text;
  const canonical = spec.paragraphs.join('\u2029') + '\u2029';
  assert(
    original === canonical && baseline.frames.join('') === canonical && !baseline.overset,
    'Baseline lost authored text',
  );
  const images = [...host.querySelectorAll('img')].filter((el) =>
    [...urls.values()].includes(el.src),
  );
  await Promise.all(images.map((img) => img.decode()));
  assert(
    images.length === 36 &&
      images.every((i) => i.naturalWidth === 3072 && i.naturalHeight === 2048),
    'Expected 36 decoded masked image placements; found ' + images.length,
  );
  assert(
    baseline.frames.length === 12 && baseline.frames.every(Boolean),
    'Empty baseline frame: ' + baseline.frames.map((s) => s.length),
  );
  assert(baseline.maxFragments >= 3, 'Concave masks did not split any row three ways');
  const report = {
    baseline: baseline.frames,
    baselineOverset: baseline.overset,
    fragmentsPerRow: baseline.maxFragments,
    decodedImages: images.length,
    edits: [],
  };
  await editor.command('document-text');
  function select(end) {
    const input = host.querySelector('.canvas-flow-input');
    input.focus();
    const offset = textIndexMap(input).segments.find(
      (s) => s.node.nodeType === Node.TEXT_NODE,
    ).start;
    const point = (n) => ({
      path: [],
      offset: 0,
      index: offset + n,
      kind: 'text',
      affinity: 'forward',
    });
    assert(
      restoreTextSelection(input, { anchor: point(0), focus: point(end) }),
      'Cannot select source',
    );
    document.dispatchEvent(new Event('selectionchange'));
  }
  for (const edit of spec.edits.slice(0, trials)) {
    select(0);
    await tick();
    const start = performance.now(),
      startPortMs = portMs;
    await window.nativeEditorTest.insert(edit);
    const after = await ready((p) => p.text === edit + original, 'insert ' + edit.slice(0, 10));
    const ms = performance.now() - start,
      sample = frames(after);
    assert(
      !sample.overset && sample.frames.join('') === edit + canonical,
      'Edited flow lost source',
    );
    assert(
      sample.frames.every((s, i) => s !== baseline.frames[i]),
      'Early edit did not change ink in every frame',
    );
    report.edits.push({
      ms,
      portMs: portMs - startPortMs,
      frames: sample.frames,
      overset: sample.overset,
    });
    select(edit.length);
    await tick();
    assert(
      window.getSelection().toString() === edit,
      'Unexpected selected source: ' + JSON.stringify(window.getSelection().toString().slice(-16)),
    );
    await window.nativeEditorTest.key('Backspace');
    const reset = frames(await ready((p) => p.text === original, 'restore'));
    assert(
      JSON.stringify(reset.frames) === JSON.stringify(baseline.frames),
      'Unstable frame breaks after deleting insertion',
    );
  }
  const mask = doc.blocks.find((b) => b.type === 'polygon'),
    initialX = mask.x;
  editor.restoreView({ tool: 'select', selection: [mask.id] });
  await tick();
  const firstGeometry = (p) =>
    JSON.stringify(
      p.result.layout.lines
        .filter((l) => l.frame === ids[0] + '-column-0')
        .map((l) => [l.start, l.end, l.originX, l.availableWidth]),
    );
  const originalGeometry = firstGeometry(current());
  async function move(x) {
    const field = host.querySelector('[data-object-prop="x"]');
    assert(field, 'Missing X position');
    const before = current().result.token,
      start = performance.now();
    field.value = String(x);
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const done = await ready((p) => p.result.token !== before && p.text === original, 'move');
    const ms = performance.now() - start;
    assert(mask.x === x, 'Moving mask did not update authored coordinates');
    return { ms, ...frames(done) };
  }
  report.move = await move(initialX + 18);
  assert(firstGeometry(current()) !== originalGeometry, 'Moving mask did not affect nearby lines');
  assert(
    JSON.stringify((await move(initialX)).frames) === JSON.stringify(baseline.frames),
    'Moved mask did not restore',
  );
  assert(firstGeometry(current()) === originalGeometry, 'Restored mask changed line geometry');
  editor.destroy();
  for (const url of urls.values()) URL.revokeObjectURL(url);
  return report;
};
