import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { restoreTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';

export async function verifyConditionalStyleTyping(host, compose, insert) {
  const doc = createSceneDocument('Automatic paragraph styles');
  const larger = saveTextStyle(doc, 'character', { name: 'Lead', attributes: { fontSize: 24 } });
  const smaller = saveTextStyle(doc, 'character', { name: 'Digits', attributes: { fontSize: 14 } });
  const body = saveTextStyle(doc, 'paragraph', {
    name: 'Body',
    attributes: { fontSize: 12 },
    nestedStyles: [{ style: larger.id, delimiter: 'word', count: 1, inclusive: true }],
    grepStyles: [{ style: smaller.id, pattern: '\\d+' }],
  });
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    x: 40,
    y: 40,
    w: 400,
    h: 180,
    textStyle: 'cmu-serif',
    fontSize: 12,
    html: '<p>23 cuts</p>',
  });
  const flow = startTextFlow(doc, frame.id);
  flow.style.paragraphStyle = body.id;
  enableNativeComposition(doc, flow, 'single-line');
  const calls = [];
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    onCommit: () => {},
    onChange: () => {},
    editing: true,
    source: (s) => s,
    sessionId: 'native-automatic-styles',
    initialState: { tool: 'select', selection: [frame.id] },
    textComposition: {
      compose: async (request) => {
        const result = await compose(request);
        calls.push({ request, result });
        return result;
      },
    },
  });
  const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const painted = async () => {
    await tick();
    await editor.flush();
    await tick();
    const token = host.querySelector('svg[data-composed-text]')?.dataset.compositionToken;
    const call = calls.findLast((c) => token && c.result.token === token);
    if (!call) throw Error('No painted native layout for automatic paragraph styles.');
    return call.request;
  };
  try {
    if ((await painted()).runs[0].size !== 24)
      throw Error('Native editor did not paint nested lead.');
    await editor.command('document-text');
    await tick();
    const input = host.querySelector('.canvas-flow-input');
    input.focus();
    const start = textIndexMap(input).segments[0].start,
      point = { path: [], offset: 0, kind: 'text', index: start, affinity: 'forward' };
    if (!restoreTextSelection(input, { anchor: point, focus: point }))
      throw Error('Could not position the native input caret.');
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    await insert('Four ');
    const changed = await painted(),
      index = changed.text.indexOf('23');
    if (
      index !== 5 ||
      changed.runs.find((r) => r.start <= index && r.end > index)?.size !== 14 ||
      flow.html.includes('data-ivo-rule-run')
    )
      throw Error('Native typing failed to move the numeric word from nested to GREP style.');
  } finally {
    editor.destroy();
  }
}
