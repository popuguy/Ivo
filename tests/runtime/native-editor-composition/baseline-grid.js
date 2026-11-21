import { baselineGridFixture, addGridWrap } from '../../fixtures/text/baseline-grid.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (v, m) => {
  if (!v) throw Error(m);
};
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
export async function verifyBaselineGrid({ host, compose }) {
  const fixture = baselineGridFixture(),
    ids = fixture.frames.map((f) => f.id);
  let doc = fixture.doc,
    editor,
    calls = [],
    notices = [];
  const history = createDocumentHistory();
  const open = () => {
    editor = mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      source: (v) => v,
      editing: true,
      canWrite: () => true,
      assets: () => [],
      fonts: () => [],
      sessionId: 'baseline-grid-' + calls.length,
      textComposition: {
        compose: async (req) => {
          const result = await compose(req);
          calls.push({ req, result });
          return result;
        },
      },
      onCommit: (before, metadata) => history.record(before, doc, metadata),
      onChange: () => {},
      onUndo: () => {
        const prev = history.undo(doc);
        if (prev) {
          doc = prev.document;
          editor.restoreView(prev.view);
        }
      },
      onNotify: (m) => notices.push(m),
      initialState: { tool: 'select', selection: [] },
    });
  };
  const settle = async () => {
    await tick();
    await editor.flush();
    await tick();
    assert(
      !host.querySelector('[data-composition-error]'),
      'Grid editor reported a composition error: ' + notices.join('; '),
    );
  };
  const set = async (selector, value) => {
    const control = host.querySelector(selector);
    assert(control && !control.disabled, 'Missing grid control ' + selector);
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };
  const check = (firstOnly) => {
    const token = host.querySelector(`[data-flow-frame="${ids[0]}"] svg`).dataset.compositionToken;
    const active = calls.findLast((c) => c.result.token === token);
    assert(active, 'Expected a real native result');
    const { req, result } = active,
      lines = result.layout.lines;
    assert(
      req.mode === 'planned-lines-proof' && req.frames.every((f) => f.baselineGrid),
      'Grid alignment did not use a native grid plan: ' + notices.join('; '),
    );
    assert(
      lines.length === 12 && result.layout.coveredLength === req.text.length,
      'Grid dropped or repeated lines',
    );
    const expected = firstOnly
      ? [
          [0, 55],
          [0, 69.4],
          [0, 83.8],
          [0, 98.2],
          [1, 65],
          [1, 79.4],
          [1, 93.8],
          [1, 108.2],
          [1, 122.6],
          [2, 75],
          [2, 89.4],
          [2, 103.8],
        ]
      : [
          [0, 55],
          [0, 74],
          [0, 93],
          [1, 74],
          [1, 93],
          [1, 112],
          [1, 131],
          [2, 93],
          [2, 112],
          [2, 131],
          [2, 150],
          [2, 169],
        ];
    for (const [i, line] of lines.entries()) {
      const [f, y] = expected[i],
        frame = doc.blocks.find((b) => b.id === ids[f]),
        actual = line.baseline + frame.y + frame.frameOptions.insetTop;
      assert(
        line.frame === ids[f] + '-column-0' && Math.abs(actual - y) < 0.05,
        'Grid frame or page position disagreed on row ' +
          i +
          ': ' +
          line.frame +
          ' / ' +
          actual +
          ' expected ' +
          f +
          ' / ' +
          y,
      );
    }
  };
  try {
    open();
    await settle();
    await set('[data-baseline-grid-setting="start"]', 17);
    await set('[data-baseline-grid-setting="increment"]', 19);
    const before = JSON.stringify(doc);
    host.querySelector('input[data-show-baseline-grid]').click();
    assert(
      host.querySelector('[data-show-baseline-grid] > .canvas-page') &&
        JSON.stringify(doc) === before,
      'Showing grid guides changed document storage',
    );
    editor.restoreView({ tool: 'select', selection: [ids[0]], activePage: doc.pages[0].id });
    await settle();
    const detail = host.querySelector('[data-property-disclosure="paragraph"]');
    if (detail && !detail.parentElement.open) detail.click();
    await set('[data-object-prop="baselineAlignment"]', 'all');
    check(false);
    await set('[data-object-prop="y"]', '32');
    check(false);
    await editor.command('undo');
    await settle();
    check(false);
    await set('[data-object-prop="baselineAlignment"]', 'first');
    check(true);
    editor.destroy();
    const opened = validateImport({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [],
    }).documents[0];
    doc = opened;
    open();
    await settle();
    check(true);
    editor.destroy();
    addGridWrap(doc);
    open();
    await settle();
    editor.restoreView({ tool: 'select', selection: [ids[0]], activePage: doc.pages[0].id });
    await settle();
    await set('[data-object-prop="baselineAlignment"]', 'all');
    const customGrid = async (index, origin, start, increment) => {
      editor.restoreView({ tool: 'select', selection: [ids[index]], activePage: doc.pages[0].id });
      await settle();
      host.querySelector('[data-frame-grid="enabled"]').click();
      await settle();
      await set('[data-frame-grid="relativeTo"]', origin);
      await set('[data-frame-grid="start"]', start);
      await set('[data-frame-grid="increment"]', increment);
    };
    await customGrid(0, 'frame', 4, 17);
    await customGrid(1, 'inset', 1, 11);
    const checkCustom = () => {
      const token = host.querySelector(`[data-flow-frame="${ids[0]}"] svg`).dataset
        .compositionToken;
      const { result } = calls.findLast((c) => c.result.token === token);
      const positions = result.layout.lines.map((line) => {
        const i = ids.findIndex((id) => line.frame === id + '-column-0');
        const frame = doc.blocks.find((b) => b.id === ids[i]);
        return [i, Math.round((line.baseline + frame.y + frame.frameOptions.insetTop) * 100) / 100];
      });
      const expected = [
        [0, 52],
        [0, 69],
        [0, 86],
        [0, 103],
        [1, 65],
        [1, 87],
        [1, 109],
        [1, 131],
        [2, 93],
        [2, 112],
        [2, 131],
        [2, 150],
      ];
      assert(
        JSON.stringify(positions) === JSON.stringify(expected),
        'Custom frame grid baseline or page mismatch: ' + JSON.stringify(positions),
      );
    };
    checkCustom();
    await set('[data-frame-grid="increment"]', 15);
    await editor.command('undo');
    await settle();
    checkCustom();
    editor.destroy();
    doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
      .documents[0];
    open();
    await settle();
    checkCustom();
    editor.restoreView({ tool: 'select', selection: [], activePage: doc.pages[0].id });
    await settle();
    await set('[data-baseline-grid-setting="relativeTo"]', 'margin');
    await set('[data-page-prop="topMargin"]', 21);
    host.querySelector('input[data-show-baseline-grid]').click();
    const guide = () =>
      host
        .querySelector(`[data-page="${doc.pages[0].id}"]`)
        .style.getPropertyValue('--baseline-grid-start');
    assert(guide() === '38px', 'Page guides lost the margin origin');
    await editor.command('undo');
    await settle();
    assert(guide() === '53px', 'Undo left old margin guides on the rendered page');
    await set('[data-page-prop="topMargin"]', 21);
    editor.restoreView({ tool: 'select', selection: [ids[1]], activePage: doc.pages[0].id });
    await settle();
    await set('[data-frame-grid="relativeTo"]', 'margin');
    editor.destroy();
    doc = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
      .documents[0];
    open();
    await settle();
    const frame = doc.blocks.find((b) => b.id === ids[1]);
    assert(
      doc.pages[0].topMargin === 21 && frame.frameOptions.baselineGrid.relativeTo === 'margin',
      'Page or frame margin origin did not survive reopening',
    );
    const reopenedToken = host.querySelector(`[data-flow-frame="${ids[1]}"] svg`).dataset
      .compositionToken;
    const reopenedResult = calls.findLast((c) => c.result.token === reopenedToken).result;
    const firstOnMargin = reopenedResult.layout.lines.find(
      (line) => line.frame === ids[1] + '-column-0',
    );
    assert(
      Math.abs(firstOnMargin.baseline + frame.y + frame.frameOptions.insetTop - 66) < 0.05,
      'Reopened editor did not align the first line to the page margin',
    );
    assert(!notices.length, 'Grid acceptance produced a notification: ' + notices.join('; '));
    return {
      nativeMarginRelativeGuidesAndText: true,
      nativeFrameGridsAndObjectWrap: true,
      nativeDocumentBaselineGrid: true,
      nativeFirstLineGridAcrossLinkedPages: true,
    };
  } finally {
    editor?.destroy();
  }
}
