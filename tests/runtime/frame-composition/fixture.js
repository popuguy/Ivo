import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { enableFrameComposition } from '../../../src/domain/documents/publishing.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { sceneObjectHTML, applySceneTypography } from '../../../src/rendering/page-content.js';
import {
  layoutDocumentTextFlows,
  prepareTextFlowFonts,
} from '../../../src/rendering/text/flow-layout.js';
import { measureFrameText } from '../../../src/rendering/text/frame-composition.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
const assert = (value, message) => {
    if (!value) throw new Error(message);
  },
  near = (actual, expected, message) =>
    assert(Math.abs(actual - expected) < 0.2, message + `: ${actual} vs ${expected}`),
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function baseline(root, last = false) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    nodes = [];
  let node;
  while ((node = walker.nextNode())) if (node.length) nodes.push(node);
  const text = last ? nodes.at(-1) : nodes[0],
    marker = document.createElement('span');
  Object.assign(marker.style, {
    display: 'inline-block',
    width: '0',
    height: '0',
    verticalAlign: 'baseline',
  });
  if (last) text.parentNode.insertBefore(marker, text.nextSibling);
  else text.parentNode.insertBefore(marker, text);
  const value = marker.getBoundingClientRect().top;
  marker.remove();
  return value;
}
try {
  await prepareTextFlowFonts();
  const container = document.querySelector('#measure'),
    doc = createSceneDocument('Baseline geometry'),
    frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 40,
      y: 100,
      w: 320,
      h: 300,
      fontSize: 16,
      leading: 24,
      html: '<p>First line<br>Second line<br>Third line</p>',
      frameOptions: {
        insetTop: 10,
        insetBottom: 10,
        insetLeft: 8,
        insetRight: 8,
        firstBaseline: 'fixed',
        minimumFirstBaseline: 18,
        verticalAlign: 'top',
      },
    });
  enableFrameComposition(doc);
  const render = (flow = null) => {
    container.innerHTML = sceneObjectHTML(frame, { document: doc, source: (s) => s, flow });
    applySceneTypography(container, doc);
    return container.querySelector('.canvas-text');
  };
  let text = render(),
    origin = container.getBoundingClientRect().top;
  near(baseline(text) - origin, 128, 'Fixed first baseline ignores inset or frame origin');
  const topFirst = baseline(text),
    topLast = baseline(text, true),
    before = JSON.stringify(doc);
  render();
  assert(JSON.stringify(doc) === before, 'Measuring frame composition changed authored data');
  for (const mode of ['center', 'bottom']) {
    frame.frameOptions.verticalAlign = mode;
    text = render();
    const first = baseline(text),
      last = baseline(text, true);
    near(last - first, topLast - topFirst, 'Vertical alignment rewrote line leading');
    if (mode === 'center') frame.centerBaseline = first;
    else near(frame.centerBaseline, (topFirst + first) / 2, 'Center alignment is not the midpoint');
  }
  delete frame.centerBaseline;
  frame.frameOptions.verticalAlign = 'top';
  frame.textScale = { x: 1.25, y: 2 };
  text = render();
  near(baseline(text) - origin, 128, 'Scaled glyphs changed the declared first-baseline distance');
  frame.textScale = { x: 1, y: 1 };
  frame.frameOptions.verticalAlign = 'top';
  const values = {};
  for (const policy of ['ascent', 'cap-height', 'x-height', 'leading']) {
    frame.frameOptions.firstBaseline = policy;
    frame.frameOptions.minimumFirstBaseline = 0;
    text = render();
    const measured = measureFrameText(text);
    values[policy] = baseline(text) - origin - 110;
    near(
      values[policy],
      measured.metrics[policy],
      'First-baseline ' + policy + ' did not use actual font/line metrics',
    );
    frame.frameOptions.minimumFirstBaseline = 30;
    text = render();
    near(baseline(text) - origin, 140, 'Minimum first baseline was not enforced');
  }
  assert(
    values['cap-height'] > values['x-height'],
    'Cap/x-height policies did not have distinct geometry',
  );
  frame.frameOptions.firstBaseline = 'fixed';
  frame.frameOptions.minimumFirstBaseline = 18;
  frame.frameOptions.verticalAlign = 'center';
  const source = frame.html,
    flow = startTextFlow(doc, frame.id, { automaticPages: false }),
    plan = layoutDocumentTextFlows(doc),
    part = plan.fragments.get(frame.id).columns[0];
  text = render(plan);
  const linkedFirst = baseline(text);
  assert(part.top > 10, 'Linked center alignment stayed at the top inset');
  near(
    linkedFirst - origin,
    110 + part.composition.alignmentShift + part.composition.baseline,
    'Linked fragment baseline differs from its derived geometry',
  );
  assert(flow.html === source, 'First-baseline composition rewrote source');
  const snapshot = createPDFSnapshot([doc], [], doc.id),
    frozen = snapshot.documents[0],
    frozenPlan = layoutDocumentTextFlows(frozen, { allowPages: false });
  near(
    frozenPlan.fragments.get(frame.id).columns[0].top,
    part.top,
    'PDF snapshot composes a different vertical offset',
  );
  const host = document.querySelector('#host'),
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing: true,
      source: (s) => s,
      initialState: { selection: [frame.id] },
      onCommit: () => {
        throw new Error('Entering text changed the document');
      },
      onChange: () => {},
      onNotify: (m) => console.warn(m),
    });
  await tick();
  await editor.command('document-text');
  await tick();
  const input = host.querySelector('.canvas-flow-input'),
    preview = host.querySelector(`[data-flow-frame="${frame.id}"] .flow-column`);
  near(baseline(input), baseline(preview), 'Live input and page preview first baselines differ');
  assert(flow.html === source, 'Entering the aligned frame changed text source');
  editor.destroy();
  frame.frameOptions.verticalAlign = 'top';
  const documentWithLongText = createSceneDocument('Unequal baselines'),
    f = insertObject(documentWithLongText, 'text', documentWithLongText.pages[0].id, {
      x: 20,
      y: 20,
      w: 180,
      h: 90,
      leading: 20,
      html: '<p>' + 'Text flows through different first-baseline policies. '.repeat(18) + '</p>',
      frameOptions: {
        firstBaseline: 'fixed',
        minimumFirstBaseline: 25,
        columns: 2,
        gutter: 8,
        insetTop: 5,
        insetBottom: 5,
      },
    });
  enableFrameComposition(documentWithLongText);
  const longFlow = startTextFlow(documentWithLongText, f.id, { automaticPages: true }),
    longSource = longFlow.html,
    longer = layoutDocumentTextFlows(documentWithLongText);
  assert(
    longFlow.frameIds.length > 1 && !longer.status.get(longFlow.id).overset,
    'Baseline capacity did not create continuation frames',
  );
  assert(longFlow.html === longSource, 'Continuation changed source');
  for (const id of longFlow.frameIds)
    for (const column of longer.fragments.get(id).columns)
      if (column.end > column.start)
        near(column.composition.baseline, 25, 'A later column lost its fixed baseline');
  console.log(
    'IVO_FRAME_COMPOSITION_RESULT:' +
      JSON.stringify({
        ok: true,
        fixedBaselineAndInset: true,
        fontMetricPolicies: values,
        minimumFirstBaseline: true,
        topCenterBottom: true,
        linkedColumnAlignment: true,
        livePreviewParity: true,
        pdfSnapshotParity: true,
        automaticContinuation: true,
        sourcePreserved: true,
      }),
  );
} catch (error) {
  console.log('IVO_FRAME_COMPOSITION_RESULT:' + JSON.stringify({ error: error.stack }));
}
