import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentClipboard } from '../../desktop/document-clipboard.mjs';
class Item {
  constructor(values) {
    this.values = values;
  }
  get types() {
    return Object.keys(this.values);
  }
  async getType(type) {
    return new Blob([this.values[type]], { type });
  }
}
test('native document clipboard writes actual MIME items and escapes titles while retaining stable IDs', async () => {
  let written;
  const port = createDocumentClipboard({
    ClipboardItem: Item,
    clipboard: {
      write: async (items) => {
        written = items;
      },
    },
  });
  await port.copyLink({ id: 'doc-id', title: 'A <native> & "quoted" note' });
  assert.equal(written.length, 1);
  assert.ok(written[0] instanceof Item);
  assert.deepEqual(written[0].types.sort(), ['text/html', 'text/plain']);
  assert.equal(
    await (await written[0].getType('text/plain')).text(),
    '[[A <native> & "quoted" note]]',
  );
  assert.equal(
    await (await written[0].getType('text/html')).text(),
    '<a data-doc-id="doc-id" href="#doc=doc-id">A &lt;native&gt; &amp; &quot;quoted&quot; note</a>',
  );
});
test('native path and rich link commands await clipboard completion and propagate failed writes', async () => {
  for (const kind of ['path', 'link']) {
    let release,
      acknowledged = false,
      supplied;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const write = async (value) => {
      supplied = value;
      await gate;
    };
    const port = createDocumentClipboard({
      ClipboardItem: Item,
      clipboard: { write, writeText: write },
    });
    const pending =
      kind === 'path'
        ? port.copyPath(
            {
              relativePath: 'documents/revision.json',
              absolutePath: '/vault/documents/revision.json',
            },
            'relative',
          )
        : port.copyLink({ id: 'doc-id', title: 'Document' });
    pending.then(() => {
      acknowledged = true;
    });
    await Promise.resolve();
    assert.equal(acknowledged, false);
    assert.ok(supplied);
    release();
    await pending;
    assert.equal(acknowledged, true);
  }
  const port = createDocumentClipboard({
    ClipboardItem: Item,
    clipboard: {
      write: async () => {
        throw new Error('Clipboard unavailable');
      },
      writeText: async () => {
        throw new Error('Clipboard unavailable');
      },
    },
  });
  await assert.rejects(port.copyLink({ id: 'id', title: 'Document' }), /Clipboard unavailable/);
  await assert.rejects(port.copyPath({}, 'absolute'), /Clipboard unavailable/);
  await assert.rejects(port.copyPath({}, 'invalid'), /supported path/);
});
