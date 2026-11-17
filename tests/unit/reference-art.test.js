import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareReferenceArt } from '../../scripts/reference-art.mjs';

test('public build can supply every current control from exact licensed Obsidian icon files', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ivo-reference-art-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const output = path.join(folder, 'art.js');
  const result = await prepareReferenceArt({
    privateRoot: path.join(folder, 'no-installed-reference'),
    output,
  });
  assert.equal(result.cursors, 0);
  assert.equal(result.illustratorIcons, 0);
  const text = await fs.readFile(output, 'utf8'),
    art = JSON.parse(
      text
        .slice(text.indexOf('=') + 1)
        .trim()
        .replace(/;$/, ''),
    );
  for (const name of [
    'select',
    'direct',
    'text',
    'rectangle',
    'polygon',
    'hand',
    'image',
    'inside',
    'undo',
    'redo',
    'link',
    'book',
    'reading',
    'search',
    'plus',
    'minus',
    'close',
    'pin',
    'edit',
    'menu',
    'dots',
    'graph',
    'fit',
    'bold',
    'italic',
    'folder',
    'folder-open',
    'folder-plus',
    'bookmark',
    'settings',
    'sort-asc',
    'panel-left',
    'panel-right',
  ]) {
    assert.equal(art.icons[name].source, 'Obsidian/Lucide');
    const svg = Buffer.from(art.icons[name].url.split(',')[1], 'base64').toString();
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /<script\b|\bonload\s*=/i);
  }
  const license = await fs.readFile(
    new URL('../../public/icons/obsidian/LICENSE.txt', import.meta.url),
    'utf8',
  );
  assert.match(license, /ISC/);
  assert.match(license, /MIT/);
});
