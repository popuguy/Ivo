import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardImages, prepareImages } from '../../src/features/editor/assets/image-import.js';

test('clipboard bitmap items are preferred over duplicate files and file-list fallback works', () => {
  const file = new File(['bitmap'], 'image.png', { type: 'image/png' });
  assert.deepEqual(
    clipboardImages({
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      files: [file],
    }),
    [file],
  );
  assert.deepEqual(
    clipboardImages({ files: [file, new File(['text'], 'a.txt', { type: 'text/plain' })] }),
    [file],
  );
  assert.deepEqual(clipboardImages({ items: [], files: [], getData: () => '' }), []);
});

test('image preparation preserves original bytes, MIME and measured dimensions', async () => {
  const file = new File(['original bytes'], 'photo.png', { type: 'image/png' });
  const readFile = async (blob) =>
    `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
  const [prepared] = await prepareImages([file], {
    readFile,
    measureImage: async () => ({ width: 640, height: 480 }),
  });
  assert.equal(prepared.asset.mimeType, 'image/png');
  assert.equal(prepared.asset.name, 'photo.png');
  assert.equal(
    Buffer.from(prepared.asset.data.split(',')[1], 'base64').toString(),
    'original bytes',
  );
  assert.deepEqual(prepared.size, { width: 640, height: 480 });
});

test('oversized/unsupported/undecodable images fail before returning an insertion batch', async () => {
  let reads = 0;
  const options = {
    readFile: async () => {
      reads++;
      return 'data:image/png;base64,eA==';
    },
    measureImage: async () => ({ width: 0, height: 4 }),
  };
  await assert.rejects(
    prepareImages([{ type: 'image/png', size: 21 * 1024 * 1024 }], options),
    /20 MB/,
  );
  await assert.rejects(prepareImages([{ type: 'image/svg+xml', size: 2 }], options), /PNG/);
  assert.equal(reads, 0);
  await assert.rejects(prepareImages([{ type: 'image/png', size: 2 }], options), /decoded/);
});
