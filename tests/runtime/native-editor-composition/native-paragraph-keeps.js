import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { enablePublishing } from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { TEXT_DEFAULTS } from '../../../src/domain/text/typography.js';
import {
  createDocumentHistory,
  documentContent,
} from '../../../src/domain/history/document-history.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { restoreTextSelection, textIndexMap } from '../../../src/shared/dom/text-selection.js';

const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  near = (actual, expected, message) =>
    assert(
      Number.isFinite(actual) && Math.abs(actual - expected) < 0.001,
      `${message}: ${actual} versus ${expected}`,
    ),
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  stable = (value) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item,
    );

const allHTML =
    '<p>PRE1</p><p>PRE2</p><p>A1 alpha<br>A2 beta<br>A3 gamma<br>A4 delta</p><p>N1 next<br>N2 next<br>N3 next</p>',
  allRows = [
    'PRE1\u2029',
    'PRE2\u2029',
    'A1 alpha\u2028',
    'A2 beta\u2028',
    'A3 gamma\u2028',
    'A4 delta\u2029',
    'N1 next\u2028',
    'N2 next\u2028',
    'N3 next\u2029',
  ],
  nextHTML =
    '<p>A1 alpha<br>A2 beta<br>A3 gamma</p><p>N1 next</p><p>T1 tail<br>T2 tail<br>T3 tail<br>T4 tail<br>T5 tail</p>',
  nextRows = [
    'A1 alpha\u2028',
    'A2 beta\u2028',
    'A3 gamma\u2029',
    'N1 next\u2029',
    'T1 tail\u2028',
    'T2 tail\u2028',
    'T3 tail\u2028',
    'T4 tail\u2028',
    'T5 tail\u2029',
  ],
  impossibleHTML =
    '<p>A1 alpha<br>A2 beta<br>A3 gamma<br>A4 delta</p><p>T1 tail<br>T2 tail<br>T3 tail<br>T4 tail<br>T5 tail</p>',
  impossibleRows = [
    'A1 alpha\u2028',
    'A2 beta\u2028',
    'A3 gamma\u2028',
    'A4 delta\u2029',
    'T1 tail\u2028',
    'T2 tail\u2028',
    'T3 tail\u2028',
    'T4 tail\u2028',
    'T5 tail\u2029',
  ];

/** Actual-editor keep controls with independent forced-row source/frame/baseline expectations.
 * Optional readKeepViolations receives the current editor/document/native result so
 * root can bind the eventual derived-view diagnostic API without persisting it.
 */
export async function verifyNativeParagraphKeeps({
  host,
  compose,
  insert,
  save,
  load,
  capture = async () => {},
  readKeepViolations,
}) {
  let doc,
    editor,
    frameIds,
    history,
    commits,
    changes,
    writable = true,
    mountCount = 0,
    composeOwned,
    authoredBoxes,
    authoredPages,
    diagnosticsChecked = false;
  const calls = [],
    notices = [],
    input = () => host.querySelector('.canvas-flow-input'),
    source = () => doc.textFlows[0].html;
  function ownFixture(name, html, { capacities = [3, 4, 5], automaticPages = false } = {}) {
    editor?.destroy();
    doc = createSceneDocument(name, { width: 500, height: 400 });
    enablePublishing(doc);
    const first = insertObject(doc, 'text', doc.pages[0].id, {
        x: 40,
        y: 40,
        w: 180,
        h: capacities[0] * 20,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
        frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 16, verticalAlign: 'top' },
        html,
      }),
      flow = startTextFlow(doc, first.id, { automaticPages }),
      frames = [first];
    for (const [index, width] of [
      [1, 240],
      [2, 320],
    ]) {
      const page = addPage(doc, doc.pages.at(-1).id),
        next = insertObject(doc, 'text', page.id, {
          x: 40,
          y: 40,
          w: width,
          h: capacities[index] * 20,
          frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 16, verticalAlign: 'top' },
        });
      threadFrame(doc, frames.at(-1).id, next.id);
      frames.push(next);
    }
    enableNativeComposition(doc, flow, 'paragraph');
    // The same complete publishing/schema state as a vault open, before snapshots.
    doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
      .documents[0];
    frameIds = frames.map((frame) => frame.id);
    resetOwner();
    return flow.id;
  }
  function resetOwner() {
    history = createDocumentHistory();
    commits = changes = 0;
    writable = true;
    authoredBoxes = stable(doc.blocks);
    authoredPages = stable(doc.pages);
    notices.length = 0;
    composeOwned = async (request) => {
      const result = await compose(request);
      calls.push({ request, result });
      return result;
    };
  }
  function moveHistory(direction) {
    const result = history[direction](doc);
    if (result) {
      doc = result.document;
      editor.restoreView(result.view);
    }
  }
  function mount({ editing = true } = {}) {
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (value) => value,
      editing,
      canWrite: () => writable,
      textComposition: { compose: composeOwned },
      assets: () => [],
      fonts: () => [],
      initialState: { tool: 'select', selection: [frameIds[0]] },
      sessionId: 'native-paragraph-keeps-' + ++mountCount,
      onNotify: (message) => notices.push(message),
      onChange: () => changes++,
      onCommit: (before, metadata) => {
        if (history.record(before, doc, metadata)) commits++;
      },
      onUndo: () => moveHistory('undo'),
      onRedo: () => moveHistory('redo'),
    });
  }
  async function settle() {
    await tick();
    await editor.flush();
    await tick();
    const error = host.querySelector('[data-composition-error]')?.dataset.compositionError;
    assert(!error, 'Native paragraph keep composition failed: ' + error);
  }
  function painted() {
    const token = host.querySelector('svg[data-composed-text]')?.dataset.compositionToken,
      call = calls.findLast((item) => item.result.token === token);
    assert(call, 'Native paragraph keeps have no matching painted source plan');
    return call;
  }
  function geometry() {
    const { request, result } = painted();
    return stable({
      placements: request.placements,
      lines: result.layout.lines,
      vectors: result.vectors,
    });
  }
  function verifyPlan(rows, byFrame, { overset = false } = {}) {
    const { request, result } = painted(),
      lines = result.layout.lines,
      expectedRows = byFrame.flat(),
      expectedSource = rows.join('');
    assert(
      request.protocol === 3 && result.protocol === 3 && request.mode === 'planned-lines-proof',
      'Keep-only authoring changed the native character protocol or bypassed its exact plan',
    );
    assert(
      request.text === expectedSource,
      'Keeps inserted, removed or normalized authored source',
    );
    assert(request.frames.length === 3, 'Keep fixture lost its three actual authored columns');
    assert(
      lines.length === expectedRows.length,
      'Keep fixture physical row count differs: ' +
        JSON.stringify({
          rows: lines.map((line) => request.text.slice(line.start, line.end)),
          byFrame,
        }),
    );
    const sourceEnds = [];
    let cursor = 0;
    for (const row of rows) {
      cursor += row.length;
      sourceEnds.push(cursor);
    }
    let lineIndex = 0;
    for (const [frame, rowNumbers] of byFrame.entries()) {
      near(request.frames[frame].width, [180, 240, 320][frame], 'Unequal keep column width');
      for (const [rowOrder, rowNumber] of rowNumbers.entries()) {
        const line = lines[lineIndex],
          placement = request.placements[lineIndex],
          expectedStart = rowNumber ? sourceEnds[rowNumber - 1] : 0;
        assert(
          line.start === expectedStart && line.end === sourceEnds[rowNumber],
          'Keep line source interval differs from the independent row fixture',
        );
        assert(
          line.frame === frameIds[frame] + '-column-0' &&
            line.placementIndex === lineIndex &&
            placement.frame === frame,
          'Keep changed its independently expected physical owner',
        );
        near(line.baseline, 16 + 20 * rowOrder, 'Keep row baseline');
        near(line.baseline, placement.baseline, 'Frozen native keep baseline');
        assert(
          request.text.slice(line.start, line.end) === rows[rowNumber],
          'Keep row contents crossed a soft/paragraph boundary',
        );
        assert(
          line.runs.every((run) => run.size === 16 && run.font === 'CMUSerif-Roman'),
          'Keep source changed its exact CMU font/size',
        );
        assert(
          line.baseline + line.descent <= request.frames[frame].height + 0.001,
          'Keep row exceeds its actual frame',
        );
        lineIndex++;
      }
    }
    const covered = expectedRows.length ? sourceEnds[expectedRows.at(-1)] : 0;
    assert(
      result.layout.coveredLength === covered,
      'Keep actual source coverage includes phantom/future columns',
    );
    assert(
      result.diagnostics.includes('overset') === overset,
      'Keep capacity overset was confused with a relaxed constraint',
    );
    assert(
      covered < expectedSource.length === overset,
      'Keep fixture overset source interval is wrong',
    );
    assert(
      stable(doc.blocks) === authoredBoxes && stable(doc.pages) === authoredPages,
      'Derived keeps changed authored frames/pages',
    );
    assert(
      !stable(doc).includes('"keepViolations"'),
      'Derived keep violations leaked into the document',
    );
    assert(!notices.length, 'Unexpected keep notification: ' + notices.join('; '));
    return { request, result };
  }
  async function diagnostics(expected = []) {
    if (typeof readKeepViolations !== 'function') return;
    const values = await readKeepViolations({ editor, document: doc, ...painted() });
    assert(Array.isArray(values), 'The derived keep diagnostic hook did not return an array');
    const actual = values.filter((value) => !value.future);
    if (!expected.length) assert(actual.length === 0, 'A satisfiable keep was marked as violated');
    for (const item of expected)
      assert(
        actual.some(
          (value) =>
            value.kind === item.kind && value.reason === item.reason && value.frame === item.frame,
        ),
        'Missing derived keep violation: ' + JSON.stringify(item),
      );
    for (const item of actual)
      assert(
        Number.isInteger(item.paragraphIndex) &&
          item.start < item.end &&
          Number.isInteger(item.frame),
        'Malformed derived keep violation',
      );
    diagnosticsChecked = true;
  }
  async function selectWord(word, { collapsed = true } = {}) {
    await editor.command('document-text');
    await settle();
    const segment = textIndexMap(input()).segments.find((part) => part.node.data.includes(word));
    assert(segment, 'Canonical keep source lacks: ' + word);
    const start = segment.start + segment.node.data.indexOf(word);
    input().focus();
    assert(
      restoreTextSelection(input(), {
        anchor: { path: [], offset: 0, kind: 'text', index: start, affinity: 'forward' },
        focus: {
          path: [],
          offset: 0,
          kind: 'text',
          index: collapsed ? start : start + word.length,
          affinity: collapsed ? 'forward' : 'backward',
        },
      }),
      'Keep source selection could not be restored',
    );
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
  }
  async function property(name, enabled) {
    const control = host.querySelector(`[data-object-prop="${name}"]`);
    assert(
      control?.type === 'checkbox' && !control.disabled,
      'Production Paragraph Properties lacks: ' + name,
    );
    for (let owner = control.parentElement; owner && owner !== host; owner = owner.parentElement)
      if (owner.tagName === 'DETAILS') owner.open = true;
    control.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 87, button: 0 }),
    );
    control.focus();
    control.checked = enabled;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  function paragraphMark(index, name) {
    const root = document.createElement('div');
    root.innerHTML = source();
    return root.querySelectorAll('p')[index]?.getAttribute('data-ivo-' + name);
  }
  try {
    ownFixture('Native keep paragraph controls', allHTML);
    mount();
    await settle();
    assert(
      TEXT_DEFAULTS.widows === 2 && TEXT_DEFAULTS.orphans === 2,
      'Keep fixture default counters changed',
    );
    verifyPlan(allRows, [
      [0, 1, 2],
      [3, 4, 5, 6],
      [7, 8],
    ]);
    await diagnostics();
    assert(
      commits === 0 && changes === 0 && history.size === 0,
      'Initial default-count keep layout authored history',
    );
    const originalHTML = source(),
      originalGeometry = geometry(),
      originalContent = documentContent(doc);
    await selectWord('A1');
    assert(
      source() === originalHTML && documentContent(doc) === originalContent && commits === 0,
      'Entering keep source changed document/history',
    );
    await property('keepTogether', true);
    verifyPlan(allRows, [
      [0, 1],
      [2, 3, 4, 5],
      [6, 7, 8],
    ]);
    await diagnostics();
    assert(
      paragraphMark(2, 'keep') === 'true' && paragraphMark(0, 'keep') !== 'true',
      'Inspector All keep did not target only the selected paragraph',
    );
    assert(commits === 1 && history.size === 1, 'Inspector keep change was not one authored edit');
    const keptHTML = source(),
      keptGeometry = geometry();
    await editor.command('undo');
    await settle();
    assert(
      source() === originalHTML && geometry() === originalGeometry,
      'Undo did not restore exact default-count source and placements',
    );
    await editor.command('redo');
    await settle();
    assert(
      source() === keptHTML && geometry() === keptGeometry,
      'Redo did not restore exact All source and placements',
    );
    await selectWord('A2', { collapsed: false });
    const beforeTyping = source(),
      beforeTypingGeometry = geometry(),
      beforeTypingCommits = commits;
    await insert('Edited');
    await settle();
    const editedRows = [...allRows];
    editedRows[3] = 'Edited beta\u2028';
    verifyPlan(editedRows, [
      [0, 1],
      [2, 3, 4, 5],
      [6, 7, 8],
    ]);
    assert(
      paragraphMark(2, 'keep') === 'true' && commits === beforeTypingCommits + 1,
      'Typing in a kept paragraph lost policy or transaction ownership',
    );
    const editedHTML = source(),
      editedGeometry = geometry();
    await editor.command('undo');
    await settle();
    assert(
      source() === beforeTyping && geometry() === beforeTypingGeometry,
      'Kept typing undo changed source/placements',
    );
    await editor.command('redo');
    await settle();
    assert(
      source() === editedHTML && geometry() === editedGeometry,
      'Kept typing redo changed source/placements',
    );
    await capture();
    await save({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] });
    editor.destroy();
    doc = validateImport(await load()).documents[0];
    resetOwner();
    mount();
    await settle();
    verifyPlan(editedRows, [
      [0, 1],
      [2, 3, 4, 5],
      [6, 7, 8],
    ]);
    assert(
      source() === editedHTML && geometry() === editedGeometry && commits === 0 && changes === 0,
      'Cold archive keep reopen changed source, placement or history',
    );

    const chainRows = [
      'Preface\u2029',
      'Title\u2029',
      'Deck\u2029',
      'Body one\u2028',
      'Body two\u2029',
      'Tail\u2029',
    ];
    ownFixture(
      'Threaded heading, deck and caption',
      '<p>Preface</p><p>Title</p><p>Deck</p><p data-ivo-keep="true">Body one<br>Body two</p><p>Tail</p>',
    );
    mount();
    await settle();
    await selectWord('Title');
    await property('keepWithNext', true);
    await selectWord('Deck');
    await property('keepWithNext', true);
    verifyPlan(chainRows, [[0], [1, 2, 3, 4], [5]]);
    await diagnostics();
    const joinedHTML = source();
    await editor.command('undo');
    await settle();
    verifyPlan(chainRows, [[0, 1, 2], [3, 4, 5], []]);
    await editor.command('redo');
    await settle();
    assert(source() === joinedHTML, 'Redo lost the authored heading chain');
    verifyPlan(chainRows, [[0], [1, 2, 3, 4], [5]]);

    ownFixture('Native keep final row with next', nextHTML);
    mount();
    await settle();
    verifyPlan(nextRows, [
      [0, 1, 2],
      [3, 4, 5, 6],
      [7, 8],
    ]);
    await selectWord('A1');
    await property('keepWithNext', true);
    verifyPlan(nextRows, [
      [0, 1],
      [2, 3, 4, 5],
      [6, 7, 8],
    ]);
    await diagnostics();
    assert(
      paragraphMark(0, 'next') === 'true' && paragraphMark(1, 'next') !== 'true',
      'Inspector Next did not target only the containing paragraph',
    );
    assert(commits === 1 && history.size === 1, 'Inspector Next was not one authored edit');

    ownFixture('Native local empty-frame All relaxation', impossibleHTML);
    mount();
    await settle();
    verifyPlan(impossibleRows, [
      [0, 1, 2],
      [3, 4, 5, 6],
      [7, 8],
    ]);
    await selectWord('A1');
    await property('keepTogether', true);
    verifyPlan(impossibleRows, [
      [0, 1, 2],
      [3, 4, 5, 6],
      [7, 8],
    ]);
    await diagnostics([{ kind: 'keepTogether', reason: 'empty-column-capacity', frame: 0 }]);
    assert(
      paragraphMark(0, 'keep') === 'true',
      'An impossible local keep was silently cleared instead of retained',
    );

    const priorityRows = [
      'A1 alpha\u2028',
      'A2 beta\u2029',
      'N1 next\u2029',
      'T1 tail\u2028',
      'T2 tail\u2028',
      'T3 tail\u2029',
    ];
    ownFixture(
      'Native All priority over impossible Next',
      '<p>A1 alpha<br>A2 beta</p><p>N1 next</p><p>T1 tail<br>T2 tail<br>T3 tail</p>',
      { capacities: [2, 2, 2] },
    );
    mount();
    await settle();
    verifyPlan(priorityRows, [
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    await selectWord('A1');
    await property('keepTogether', true);
    await selectWord('A1');
    await property('keepWithNext', true);
    verifyPlan(priorityRows, [
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    await diagnostics([{ kind: 'keepWithNext', reason: 'all-priority', frame: 0 }]);
    assert(
      paragraphMark(0, 'keep') === 'true' && paragraphMark(0, 'next') === 'true',
      'A relaxed Next rewrote authored All/Next policy',
    );

    const overflowLabels = Array.from(
        { length: 18 },
        (_, i) => 'O' + String(i + 1).padStart(2, '0') + ' overflow',
      ),
      overflowRows = overflowLabels.map((value, i) => value + (i === 17 ? '\u2029' : '\u2028'));
    ownFixture(
      'Passive native kept overset',
      '<p data-ivo-keep="true">' + overflowLabels.join('<br>') + '</p>',
      { automaticPages: true },
    );
    writable = false;
    const passiveBefore = stable(doc);
    mount({ editing: false });
    await settle();
    verifyPlan(
      overflowRows,
      [
        [0, 1, 2],
        [3, 4, 5, 6],
        [7, 8, 9, 10, 11],
      ],
      { overset: true },
    );
    await diagnostics([{ kind: 'keepTogether', reason: 'empty-column-capacity', frame: 0 }]);
    assert(
      stable(doc) === passiveBefore &&
        doc.pages.length === 3 &&
        changes === 0 &&
        commits === 0 &&
        history.size === 0,
      'Passive kept overset created pages/source/history',
    );
    return {
      nativeKeepDefaultCountersInactive: true,
      nativeKeepAllInspectorHandoff: true,
      nativeKeepNextFinalRowInspectorHandoff: true,
      nativeKeepEmptyFrameRelaxation: true,
      nativeKeepAllPriorityOverNext: true,
      nativeKeepSourceTypingUndoArchive: true,
      nativeKeepPassiveOversetNoWrites: true,
      ...(diagnosticsChecked ? { nativeKeepDerivedViolations: true } : {}),
    };
  } finally {
    editor?.destroy();
  }
}
