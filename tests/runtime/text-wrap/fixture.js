import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import {
  setTextWrap,
  setIgnoreTextWrap,
  setTextWrapPreferences,
} from '../../../src/domain/documents/text-wrap.js';
import { arrangeObjects } from '../../../src/domain/documents/arrange.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import {
  layoutDocumentTextFlows,
  prepareTextFlowFonts,
} from '../../../src/rendering/text/flow-layout.js';
import { sceneObjectHTML, applySceneTypography } from '../../../src/rendering/page-content.js';
import {
  textIndexMap,
  captureTextSelection,
  restoreTextSelection,
} from '../../../src/shared/dom/text-selection.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { validateNativeFlowSource } from '../../../src/rendering/text/native-flow-layout.js';
import { verifyWrappedNavigation } from './navigation.js';
import { verifyAdditionalComposition } from './additional-composition.js';
import { verifyWrapLayoutFailureFences, verifyWrappedTransactionFailure } from './review-fences.js';

const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  report = (value) => console.log('IVO_TEXT_WRAP_RESULT:' + JSON.stringify(value));
window.addEventListener('error', (event) => report({ error: event.error?.stack || event.message }));
window.addEventListener('unhandledrejection', (event) =>
  report({ error: event.reason?.stack || String(event.reason) }),
);
const parser = (html) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};
function lineParts(layout, id) {
  return (layout.fragments.get(id)?.columns || []).filter((part) => part.wrap && part.html);
}
function signature(layout, id) {
  const fragment = layout.fragments.get(id);
  return JSON.stringify({
    html: fragment?.html,
    start: fragment?.start,
    end: fragment?.end,
    columns: fragment?.columns?.map(({ left, top, width, height, start, end, html }) => ({
      left,
      top,
      width,
      height,
      start,
      end,
      html,
    })),
  });
}
function verifyCoverage(doc, layout) {
  const flow = doc.textFlows[0],
    source = parser(flow.html),
    expected = new Map(),
    found = new Map();
  for (const part of textIndexMap(source).segments)
    for (let i = 0; i < part.node.length; i++) expected.set(part.start + i, part.node.data[i]);
  for (const id of flow.frameIds) {
    const root = parser(layout.fragments.get(id)?.html || '');
    for (const marker of root.querySelectorAll('[data-flow-text]')) {
      assert(!marker.querySelector('[data-flow-text]'), 'Nested provenance duplicated text');
      const start = Number(marker.dataset.flowText);
      for (let i = 0; i < marker.textContent.length; i++) {
        const index = start + i;
        assert(!found.has(index), 'Text-wrap source character painted twice at ' + index);
        assert(
          expected.get(index) === marker.textContent[i],
          'Wrapped text/provenance diverged at ' + index,
        );
        found.set(index, marker.textContent[i]);
      }
    }
  }
  assert(
    !layout.status.get(flow.id)?.overset,
    'Fixture unexpectedly overset instead of flowing to its second frame: ' +
      JSON.stringify({
        status: layout.status.get(flow.id),
        sourceCharacters: expected.size,
        coveredCharacters: found.size,
        frames: flow.frameIds.map((id) => ({
          id,
          start: layout.fragments.get(id)?.start,
          end: layout.fragments.get(id)?.end,
          fragments: layout.fragments.get(id)?.columns?.length,
        })),
        firstUncovered: [...expected.keys()].filter((index) => !found.has(index)).slice(0, 12),
      }),
  );
  assert(
    found.size === expected.size,
    'Text-wrap source coverage lost characters: ' + found.size + '/' + expected.size,
  );
}
function verifyBox(parts, box) {
  for (const part of parts)
    if (part.top < box.bottom - 0.01 && part.top + part.height > box.top + 0.01)
      assert(
        part.left + part.width <= box.left + 0.05 || part.left >= box.right - 0.05,
        'A text line segment intersects the independently specified box exclusion: ' +
          JSON.stringify({ part, box }),
      );
}
function rowPairs(parts) {
  return parts.flatMap((part, index) =>
    parts
      .slice(index + 1)
      .filter(
        (other) =>
          Math.abs(other.top - part.top) < 0.01 && Math.abs(other.height - part.height) < 0.01,
      )
      .map((other) => [part, other].sort((a, b) => a.left - b.left)),
  );
}
function paintFrame(doc, layout, id) {
  const root = document.querySelector('#paint'),
    frame = doc.blocks.find((b) => b.id === id);
  root.innerHTML = sceneObjectHTML(frame, { document: doc, source: (s) => s, flow: layout });
  applySceneTypography(root, doc);
  return root;
}
function verifyInkOutside(root, box, minimumInk = 100) {
  const origin = root.getBoundingClientRect(),
    walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node,
    ink = 0;
  while ((node = walker.nextNode())) {
    if (!node.parentElement.closest('[data-flow-text]')) continue;
    for (let i = 0; i < node.length; i++) {
      if (/\s/.test(node.data[i])) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      for (const r of range.getClientRects()) {
        const segment = node.parentElement.closest('.flow-wrap-segment'),
          clip = segment?.getBoundingClientRect();
        if (clip)
          assert(
            r.left >= clip.left - 0.5 &&
              r.right <= clip.right + 0.5 &&
              r.top >= clip.top - 0.5 &&
              r.bottom <= clip.bottom + 0.5,
            'Wrapped source character is clipped by its own line fragment: ' +
              JSON.stringify({
                char: node.data[i],
                text: segment.textContent,
                rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                clip: { x: clip.x, y: clip.y, w: clip.width, h: clip.height },
              }),
          );
        const x = r.left - origin.left,
          y = r.top - origin.top;
        assert(
          !(
            x < box.right - 0.2 &&
            x + r.width > box.left + 0.2 &&
            y < box.bottom - 0.2 &&
            y + r.height > box.top + 0.2
          ),
          'Actual painted text intersects wrap exclusion: ' +
            JSON.stringify({ char: node.data[i], x, y, width: r.width, height: r.height, box }),
        );
        ink++;
      }
    }
  }
  assert(ink > minimumInk, 'The real page renderer did not paint the wrapped text');
}
let coldWrapLayoutMs = null;
try {
  await prepareTextFlowFonts();
  const host = document.querySelector('#host'),
    phase = new URL(location.href).searchParams.get('phase');
  if (phase === 'reopen') {
    const saved = await window.wrapTest.load(),
      doc = validateImport(saved.archive).documents[0],
      before = JSON.stringify(doc),
      layout = layoutDocumentTextFlows(doc, { allowPages: false });
    assert(doc.textFlows[0].html === saved.source, 'Reopen altered authored wrapped text');
    assert(
      signature(layout, saved.frame) === saved.geometry,
      'Fresh renderer did not reproduce saved wrap geometry',
    );
    verifyCoverage(doc, layout);
    const box = doc.blocks.find((b) => b.id === saved.obstacle);
    assert(
      box.textWrap.mode === 'bounds' && box.textWrap.offsets.left === 10,
      'Wrap settings were not saved',
    );
    assert(JSON.stringify(doc) === before, 'Opening/measuring wrap rewrote the archive');
    report({
      ok: true,
      boundsAndOffsets: true,
      sameBaselineBothSides: true,
      actualInkExclusion: true,
      polygonContour: true,
      jumpAndNextFrame: true,
      ignoreWrap: true,
      moveAndReorderReflow: true,
      sourceCoverage: true,
      inspectorCommands: true,
      editorUndoRedo: true,
      trustedTyping: true,
      archiveFreshRenderer: true,
      independentAreaPromotion: true,
      nextPhysicalColumn: true,
      nativeWrapFence: true,
      wrappedVerticalNavigation: true,
      wholeRowHomeEnd: true,
      pointerAcrossWrapGap: true,
      coldWrapLayoutMs: saved.coldWrapLayoutMs,
      ...saved.additionalComposition,
      ...saved.reviewFences,
    });
  } else {
    const additionalComposition = verifyAdditionalComposition({
      verifyCoverage,
      verifyInkOutside,
      paintFrame,
    });
    const independent = createSceneDocument('Unthreaded area wrap', { width: 600, height: 660 }),
      independentSource =
        '<p><em>' +
        'Independent area text wraps around the placed object. '.repeat(10) +
        '</em></p>',
      independentFrame = insertObject(independent, 'text', independent.pages[0].id, {
        x: 40,
        y: 40,
        w: 440,
        h: 420,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
        html: independentSource,
      }),
      independentObstacle = insertObject(independent, 'image', independent.pages[0].id, {
        x: 190,
        y: 100,
        w: 140,
        h: 100,
        stroke: 'none',
        strokeWidth: 0,
      });
    assert(!independentFrame.textFlowId, 'Independent fixture started threaded');
    const independentGeometry = ['id', 'x', 'y', 'w', 'h', 'fontSize', 'textStyle', 'leading'].map(
      (key) => independentFrame[key],
    );
    setTextWrap(independent, [independentObstacle.id], { mode: 'bounds' });
    const independentFlow = independent.textFlows.find((f) =>
      f.frameIds.includes(independentFrame.id),
    );
    assert(
      independentFlow?.html === independentSource && independentFlow.automaticPages === false,
      'Enabling wrap did not preserve/promote the independent area source',
    );
    assert(
      JSON.stringify(independentGeometry) ===
        JSON.stringify(
          ['id', 'x', 'y', 'w', 'h', 'fontSize', 'textStyle', 'leading'].map(
            (key) => independentFrame[key],
          ),
        ),
      'Wrap promotion altered independent frame identity, geometry or typography',
    );
    const independentLayout = layoutDocumentTextFlows(independent, { allowPages: false });
    verifyCoverage(independent, independentLayout);
    assert(
      lineParts(independentLayout, independentFrame.id).length > 4,
      'Promoted independent frame did not visually wrap',
    );
    verifyInkOutside(paintFrame(independent, independentLayout, independentFrame.id), {
      left: 190,
      top: 100,
      right: 330,
      bottom: 200,
    });
    let doc = createSceneDocument('Text-wrap component', { width: 600, height: 660 });
    const words = Array.from({ length: 240 }, (_, i) => 'w' + String(i).padStart(3, '0')).join(' '),
      source = '<p><strong>' + words.slice(0, 34) + '</strong>' + words.slice(34) + '</p>',
      frame = insertObject(doc, 'text', doc.pages[0].id, {
        x: 40,
        y: 40,
        w: 440,
        h: 420,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
        html: source,
      }),
      page = addPage(doc, doc.pages[0].id),
      second = insertObject(doc, 'text', page.id, {
        x: 40,
        y: 40,
        w: 440,
        h: 580,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
      }),
      obstacle = insertObject(doc, 'polygon', frame.pageId, {
        x: 190,
        y: 100,
        w: 140,
        h: 160,
        stroke: 'none',
        strokeWidth: 0,
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 1, y: 0 },
          { id: 'c', x: 1, y: 1 },
          { id: 'd', x: 0, y: 1 },
        ],
      });
    startTextFlow(doc, frame.id, { automaticPages: false });
    threadFrame(doc, frame.id, second.id);
    const offsets = { top: 10, right: 10, bottom: 10, left: 10 },
      zero = { top: 0, right: 0, bottom: 0, left: 0 };
    setTextWrap(doc, [obstacle.id], { mode: 'bounds', offsets });
    const layoutFences = verifyWrapLayoutFailureFences(doc, second.id);
    const original = JSON.stringify(doc);
    const nativeDocument = structuredClone(doc),
      nativeFlow = nativeDocument.textFlows[0];
    enableNativeComposition(nativeDocument, nativeFlow, 'single-line');
    const nativeBefore = JSON.stringify(nativeDocument);
    let nativeError = '';
    try {
      validateNativeFlowSource(nativeDocument, nativeFlow);
    } catch (error) {
      nativeError = error.message;
    }
    assert(
      /object text wrapping.*native preview/i.test(nativeError),
      'Native preview did not explicitly reject intersecting wrap before worker execution: ' +
        nativeError,
    );
    assert(
      JSON.stringify(nativeDocument) === nativeBefore,
      'Native wrap rejection mutated authored source',
    );
    nativeDocument.blocks.find((block) => block.id === frame.id).ignoreTextWrap = true;
    assert(
      validateNativeFlowSource(nativeDocument, nativeFlow).sourceHTML === source,
      'Ignoring wrapping incorrectly rejected otherwise supported native text',
    );
    nativeDocument.blocks.find((block) => block.id === frame.id).ignoreTextWrap = false;
    nativeDocument.blocks.find((block) => block.id === obstacle.id).x = 2000;
    assert(
      validateNativeFlowSource(nativeDocument, nativeFlow).sourceHTML === source,
      'An unrelated off-page obstacle incorrectly rejected native text',
    );
    const coldWrapStarted = performance.now();
    let layout = layoutDocumentTextFlows(doc, { allowPages: false }),
      parts = lineParts(layout, frame.id);
    coldWrapLayoutMs = performance.now() - coldWrapStarted;
    assert(parts.length > 4, 'Affected text frame did not receive real wrapped line fragments');
    verifyCoverage(doc, layout);
    const exclusion = { left: 140, right: 300, top: 50, bottom: 230 };
    verifyBox(parts, exclusion);
    assert(
      rowPairs(parts).some(
        ([a, b]) =>
          a.left < exclusion.left &&
          b.left >= exclusion.right &&
          a.top >= exclusion.top &&
          a.top < exclusion.bottom,
      ),
      'Text did not occupy both sides on a shared baseline',
    );
    assert(JSON.stringify(doc) === original, 'Wrap layout changed authored source or geometry');
    const short = structuredClone(doc);
    short.textFlows[0].frameIds = [frame.id];
    short.blocks = short.blocks.filter((block) => block.id !== second.id);
    short.blocks.find((block) => block.id === frame.id).h = 120;
    const shortSource = short.textFlows[0].html,
      shortLayout = layoutDocumentTextFlows(short, { allowPages: false });
    assert(
      shortLayout.status.get(short.textFlows[0].id)?.overset &&
        shortLayout.fragments.get(frame.id).end <
          shortLayout.status.get(short.textFlows[0].id).characters,
      'Genuine wrapped overset was hidden or consumed the missing source',
    );
    assert(
      short.textFlows[0].html === shortSource,
      'Overset composition deleted hidden source text',
    );
    verifyInkOutside(paintFrame(doc, layout, frame.id), {
      left: 180,
      right: 340,
      top: 90,
      bottom: 270,
    });
    const boxSignature = signature(layout, frame.id);
    obstacle.points = [
      { id: 'a', x: 0.5, y: 0 },
      { id: 'b', x: 1, y: 1 },
      { id: 'c', x: 0, y: 1 },
    ];
    setTextWrap(doc, [obstacle.id], { mode: 'contour', offsets: zero });
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    parts = lineParts(layout, frame.id);
    verifyCoverage(doc, layout);
    assert(
      rowPairs(parts).some(
        ([a, b]) => a.top >= 60 && a.top < 100 && a.left + a.width > 160 && b.left < 280,
      ),
      'Triangle contour was reduced to its bounding rectangle',
    );
    setTextWrap(doc, [obstacle.id], { mode: 'bounds', offsets, side: 'left' });
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    assert(
      lineParts(layout, frame.id)
        .filter((p) => p.top < 230 && p.top + p.height > 50)
        .every((p) => p.left + p.width <= 140.05),
      'Left-only wrap placed text on the other side',
    );
    setTextWrap(doc, [obstacle.id], { side: 'right' });
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    assert(
      lineParts(layout, frame.id)
        .filter((p) => p.top < 230 && p.top + p.height > 50)
        .every((p) => p.left >= 299.95),
      'Right-only wrap placed text on the other side',
    );
    setTextWrap(doc, [obstacle.id], { side: 'both' });
    setTextWrap(doc, [obstacle.id], { mode: 'jump', offsets });
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    parts = lineParts(layout, frame.id);
    assert(
      !parts.some((p) => p.top < 230 && p.top + p.height > 50),
      'Jump-object wrap left text beside the object',
    );
    verifyCoverage(doc, layout);
    setTextWrap(doc, [obstacle.id], { mode: 'next-column', offsets: zero });
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    parts = lineParts(layout, frame.id);
    assert(
      parts.length && parts.every((p) => p.top + p.height <= 60.05),
      'Next-column wrap continued below the obstacle in its original frame',
    );
    assert(
      layout.fragments.get(second.id).end > layout.fragments.get(second.id).start,
      'Next-column wrap did not continue in the next threaded frame',
    );
    verifyCoverage(doc, layout);
    frame.frameOptions = { columns: 2, gutter: 20 };
    obstacle.x = 90;
    obstacle.w = 80;
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    parts = lineParts(layout, frame.id);
    assert(
      parts.some((p) => p.left >= 229.95 && p.top > 80),
      'Next-column wrap skipped the available second physical column',
    );
    assert(
      parts.filter((p) => p.left < 210).every((p) => p.top + p.height <= 60.05),
      'Next-column wrap continued in the blocked first physical column',
    );
    verifyCoverage(doc, layout);
    delete frame.frameOptions;
    obstacle.x = 190;
    obstacle.w = 140;
    setTextWrap(doc, [obstacle.id], { mode: 'none' });
    const noWrap = signature(layoutDocumentTextFlows(doc, { allowPages: false }), frame.id);
    setTextWrap(doc, [obstacle.id], { mode: 'bounds', offsets });
    setIgnoreTextWrap(doc, [frame.id], true);
    assert(
      signature(layoutDocumentTextFlows(doc, { allowPages: false }), frame.id) === noWrap,
      'Ignore-wrap did not restore normal composition',
    );
    setIgnoreTextWrap(doc, [frame.id], false);
    obstacle.x = 700;
    assert(
      signature(layoutDocumentTextFlows(doc, { allowPages: false }), frame.id) === noWrap,
      'Moving the obstacle away retained stale exclusions',
    );
    obstacle.x = 250;
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    assert(
      signature(layout, frame.id) !== boxSignature,
      'Obstacle movement reused stale line composition',
    );
    verifyBox(lineParts(layout, frame.id), { left: 200, right: 360, top: 50, bottom: 230 });
    obstacle.x = 190;
    setTextWrapPreferences(doc, { onlyBelow: true });
    arrangeObjects(doc, [obstacle.id], 'send-back');
    assert(
      signature(layoutDocumentTextFlows(doc, { allowPages: false }), frame.id) === noWrap,
      'Beneath-only wrap ignored stacking order',
    );
    setTextWrapPreferences(doc, { onlyBelow: false });
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    assert(
      lineParts(layout, frame.id).length > 4,
      'All-layer wrap incorrectly ignored an object below the text',
    );
    const history = createDocumentHistory(),
      notices = [];
    let editor,
      commits = 0;
    const step = (direction) => {
      const next = history[direction](doc);
      if (next) {
        doc = next.document;
        editor.restoreView(next.view);
      }
    };
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (s) => s,
      editing: true,
      initialState: { tool: 'select', selection: [obstacle.id] },
      onChange: () => {},
      onNotify: (m) => notices.push(m),
      onCommit: (before, meta) => {
        commits++;
        history.record(before, doc, meta);
      },
      onUndo: () => step('undo'),
      onRedo: () => step('redo'),
    });
    await tick();
    await window.wrapTest.capture();
    const command = host.querySelector('[data-text-wrap-mode="jump"]');
    assert(command && !command.disabled, 'Actual Properties text-wrap controls are missing');
    command.click();
    await tick();
    await editor.flush();
    await tick();
    assert(
      doc.blocks.find((b) => b.id === obstacle.id).textWrap.mode === 'jump' && commits === 1,
      'Properties wrap command was not one authored transaction',
    );
    assert(doc.textFlows[0].html === source, 'Changing object wrap rewrote text source');
    await editor.command('undo');
    await tick();
    assert(
      doc.blocks.find((b) => b.id === obstacle.id).textWrap.mode === 'bounds',
      'Undo did not restore wrap settings',
    );
    await editor.command('redo');
    await tick();
    assert(
      doc.blocks.find((b) => b.id === obstacle.id).textWrap.mode === 'jump',
      'Redo did not restore wrap settings',
    );
    await editor.command('undo');
    await tick();
    editor.restoreView({ tool: 'text', selection: [frame.id], activePage: frame.pageId });
    await editor.command('document-text');
    await tick();
    const input = host.querySelector('.canvas-flow-input');
    assert(input, 'Wrapped flow lost its canonical input owner');
    await verifyWrappedNavigation({
      host,
      getDocument: () => doc,
      layout: layoutDocumentTextFlows(doc, { allowPages: false }),
      frameId: frame.id,
      input,
    });
    input.focus();
    const range = textIndexMap(input).segments.find((s) => s.node.data.includes('w008'));
    assert(range, 'Canonical source vanished while editing a wrapped frame');
    const index = range.start + range.node.data.indexOf('w008');
    restoreTextSelection(input, {
      anchor: { path: [], kind: 'text', offset: 0, index, affinity: 'forward' },
      focus: { path: [], kind: 'text', offset: 0, index: index + 4, affinity: 'backward' },
    });
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    assert(
      window.getSelection().toString() === 'w008' && captureTextSelection(input),
      'Wrapped canonical range could not select source text',
    );
    await window.wrapTest.insert('Edited');
    await tick();
    await editor.flush();
    await tick();
    assert(
      doc.textFlows[0].html.includes('Edited') && !doc.textFlows[0].html.includes('w008'),
      'Trusted wrapped text input failed',
    );
    await editor.command('undo');
    await tick();
    assert(doc.textFlows[0].html === source, 'Wrapped typing undo lost source or emphasis');
    const transactionFences = await verifyWrappedTransactionFailure({
      host,
      getDocument: () => doc,
      editor,
      history,
      getCommits: () => commits,
      notices,
    });
    await editor.command('tool-select');
    await tick();
    await editor.flush();
    await tick();
    assert(!notices.length, 'Unexpected editor wrap notice: ' + notices.join('; '));
    layout = layoutDocumentTextFlows(doc, { allowPages: false });
    verifyCoverage(doc, layout);
    await window.wrapTest.save({
      archive: { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] },
      source,
      frame: frame.id,
      obstacle: obstacle.id,
      geometry: signature(layout, frame.id),
      coldWrapLayoutMs,
      additionalComposition,
      reviewFences: { ...layoutFences, ...transactionFences },
    });
    editor.destroy();
    report({ phase: 'edit' });
  }
} catch (error) {
  report({ error: error.stack || String(error), coldWrapLayoutMs });
}
