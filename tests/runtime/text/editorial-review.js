import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';

function check(value, message) {
  if (!value) throw Error(message);
}
async function waitFor(test) {
  for (let i = 0; i < 240; i++) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw Error('Editorial review did not reach the expected state.');
}
export async function verifyEditorialReview() {
  const doc = createSceneDocument('Proofs'),
    page = doc.pages[0].id;
  const a = insertObject(doc, 'text', page, { html: '<p>A <em>recieve</em> test.</p>' });
  const b = insertObject(doc, 'text', page, { html: '<p>Also recieve [[Unresolved]].</p>' });
  const locked = insertObject(doc, 'text', page, { html: '<p>recieve</p>' });
  locked.locked = true;
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:640px;position:relative;display:flex';
  document.body.append(host);
  const native = globalThis.ivoNative;
  const savedProfile = localStorage.getItem('ivo:preflight-profile');
  const before = structuredClone(doc),
    changes = [];
  globalThis.ivoNative = {
    spelling: {
      available: () => true,
      misspelled: (words) => words.filter((s) => s === 'recieve'),
      suggestions: () => ['receive'],
    },
  };
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    source: (v) => v,
    editing: true,
    onChange() {},
    onCommit(snapshot, meta) {
      changes.push({ snapshot, meta });
    },
    onUndo() {
      Object.assign(doc, changes.pop().snapshot);
    },
    onRedo() {},
  });
  try {
    await editor.command('check-spelling');
    const panel = host.querySelector('.canvas-spelling');
    await waitFor(() => panel.elements.term.value === 'recieve');
    check(
      panel.elements.replacement.value === 'receive',
      'System suggestions reach the correction field',
    );
    panel.elements.all.click();
    await waitFor(() => panel.querySelector('output').value === 'Spelling check complete.');
    check(
      a.html.includes('<em>receive</em>') &&
        b.html.includes('Also receive') &&
        locked.html.includes('recieve'),
      'Change All preserves markup and skips locked text',
    );
    check(
      changes.length === 1 && changes[0].meta.label === 'Correct All Spellings',
      'Multiple corrections are one undo entry',
    );
    panel.elements.done.click();
    await editor.command('undo');
    check(
      doc.blocks.find((i) => i.id === a.id).html === before.blocks.find((i) => i.id === a.id).html,
      'Undo restores styled source',
    );
    await editor.command('show-panel-preflight');
    const select = host.querySelector('[data-preflight-profile]');
    check(
      select && select.getClientRects().length,
      'Window command opens a visible Preflight panel',
    );
    select.value = 'digital';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const link = host.querySelector('[data-preflight-object="' + b.id + '"]');
    check(link?.textContent.includes('Unresolved'), 'Digital profile pinpoints an unresolved link');
    link.click();
    check(editor.getState().selected === b.id, 'Preflight selects the object on its page');
  } finally {
    editor.destroy();
    host.remove();
    globalThis.ivoNative = native;
    if (savedProfile === null) localStorage.removeItem('ivo:preflight-profile');
    else localStorage.setItem('ivo:preflight-profile', savedProfile);
  }
}
