import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeFonts } from '../../scripts/build-native-fonts.mjs';
import { createSystemFonts } from '../../desktop/system-fonts.mjs';
import { inspectFont } from '../../src/domain/text/fonts.js';

test(
  'Core Text enumerates available faces and exports exact, portable collection faces',
  { skip: process.platform !== 'darwin' },
  async () => {
    const fonts = createSystemFonts(await buildNativeFonts()),
      rows = await fonts.list();
    assert(rows.length > 0);
    assert.equal(new Set(rows.map((f) => f.postscript)).size, rows.length);
    assert(rows.every((f) => !('path' in f)));
    await assert.rejects(fonts.read('../../etc/passwd'), /installed font list/);
    for (const name of ['ArialMT', 'Georgia', 'HelveticaNeue']) {
      assert(
        rows.some((f) => f.postscript === name),
        'Missing standard system face ' + name,
      );
      const exported = await fonts.read(name),
        bytes = Buffer.from(exported.data, 'base64'),
        metadata = inspectFont(bytes);
      assert.equal(metadata.postscript, name);
      assert.equal(metadata.weight, 400);
      assert(
        !bytes.subarray(0, 4).equals(Buffer.from('ttcf')),
        'Collection was not converted to one portable face',
      );
      if (name === 'HelveticaNeue') {
        let sum = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          let word = 0;
          for (let j = 0; j < 4; j++) word = ((word << 8) | (bytes[i + j] || 0)) >>> 0;
          sum = (sum + word) >>> 0;
        }
        assert.equal(sum, 0xb1b0afba, 'Rebuilt SFNT checksum is invalid');
        assert.deepEqual(
          await fonts.read(name),
          exported,
          'Repeated collection reads changed immutable font bytes',
        );
      }
    }
  },
);
