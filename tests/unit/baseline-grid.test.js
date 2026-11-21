import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineGridSettings, nextGridBaseline } from '../../src/domain/text/baseline-grid.js';
import { nativeFlowColumns } from '../../src/rendering/text/native-flow-layout.js';
import {
  archiveVersion,
  hasBaselineGrid,
  markTypographyVersion,
} from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { baselineGridFixture } from '../fixtures/text/baseline-grid.js';
import { saveTextStyle } from '../../src/domain/documents/publishing.js';

test('document grid does not invent lines before its origin or skip exact fractional grid positions', () => {
  assert.deepEqual(baselineGridSettings(), { start: 36, increment: 12 });
  assert.equal(nextGridBaseline(4, { start: 36, increment: 12 }), 36);
  const grid = { start: -2.3, increment: 4.2 };
  assert(Math.abs(nextGridBaseline(10.30000000001, grid) - 10.3) < 0.000001);
  assert(Math.abs(nextGridBaseline(10.31, grid) - 14.5) < 0.000001);
  for (const bad of [
    { start: -1, increment: 12 },
    { start: 4, increment: 0 },
    { start: 0, increment: 2001 },
    { start: 0, increment: 12, unexpected: true },
  ])
    assert.throws(() => baselineGridSettings(bad));
});
test('document grid follows the page origin through each scaled inset; unaligned frames keep their existing route', () => {
  const { doc, frames } = baselineGridFixture({ aligned: true });
  frames[0].textScale = { x: 1, y: 2 };
  const cols = nativeFlowColumns(doc, doc.textFlows[0], true);
  assert.deepEqual(
    cols.map((c) => c.grid),
    [
      { start: -8.5, increment: 9.5 },
      { start: -36, increment: 19 },
      { start: -46, increment: 19 },
    ],
  );
  assert(nativeFlowColumns(doc, doc.textFlows[0]).every((c) => !c.grid));
  frames[0].rotation = 30;
  assert.throws(() => nativeFlowColumns(doc, doc.textFlows[0], true), /rotated/);
});
test('only authored grid settings, rich grid attributes and named paragraph styles upgrade old archives', () => {
  const { doc } = baselineGridFixture();
  const flow = doc.textFlows[0];
  assert(!hasBaselineGrid(doc));
  flow.html = '<p>data-ivo-gridalign="all" is a label</p>';
  assert(!hasBaselineGrid(doc));
  flow.html = '<p data-ivo-gridalign="all">Grid</p>';
  assert(hasBaselineGrid(doc));
  assert.throws(
    () => validateImport({ schemaVersion: 15, documents: [doc], assets: [] }),
    /archive 16/,
  );
  markTypographyVersion(doc);
  assert.equal(archiveVersion([doc]), 16);
  const open = () =>
    validateImport({ schemaVersion: 16, documents: [doc], assets: [] }).documents[0];
  assert.equal(open().textFlows[0].html, flow.html);
  assert.equal(open().publishing?.baselineGrid, undefined);
  flow.html = '<p>Grid</p>';
  saveTextStyle(doc, 'paragraph', {
    name: 'Grid lines',
    attributes: { baselineAlignment: 'first' },
  });
  assert(hasBaselineGrid(doc));
  doc.publishing.baselineGrid = { start: 2, increment: 0 };
  assert.throws(open, /baseline grid start/);
});

test('frame grid uses the selected origin, frame insets and text scale without changing its neighbors', () => {
  const { doc, frames } = baselineGridFixture({ aligned: true });
  frames[0].textScale = { x: 1, y: 2 };
  const grid = (relativeTo) => {
    frames[0].frameOptions.baselineGrid = { relativeTo, start: 4, increment: 17 };
    return nativeFlowColumns(doc, doc.textFlows[0], true).map((c) => c.grid);
  };
  assert.deepEqual(grid('page')[0], { start: -15, increment: 8.5 });
  assert.deepEqual(grid('inset')[0], { start: 2, increment: 8.5 });
  assert.deepEqual(grid('frame'), [
    { start: 0.5, increment: 8.5 },
    { start: -36, increment: 19 },
    { start: -46, increment: 19 },
  ]);
  frames[0].y += 9;
  assert.equal(grid('frame')[0].start, 0.5);
  assert.equal(grid('page')[0].start, -19.5);
});

test('a frame grid upgrades on edit and round-trips only with a native owner and supported grid settings', () => {
  const { doc, frames } = baselineGridFixture({ aligned: true });
  frames[0].frameOptions.baselineGrid = { relativeTo: 'inset', start: 3.5, increment: 17 };
  const open = (version) =>
    validateImport({ schemaVersion: version, documents: [doc], assets: [] }).documents[0];
  assert.throws(() => open(16), /archive 17/);
  markTypographyVersion(doc);
  assert.equal(archiveVersion([doc]), 17);
  assert.equal(doc.canvasVersion, 16);
  assert.deepEqual(
    open(17).blocks[0].frameOptions.baselineGrid,
    frames[0].frameOptions.baselineGrid,
  );
  frames[0].frameOptions.baselineGrid.relativeTo = 'invalid';
  assert.throws(() => open(17), /grid origin/);
  frames[0].frameOptions.baselineGrid.relativeTo = 'page';
  delete doc.textFlows[0].composition;
  assert.throws(() => open(17), /native text flow/);
});

test('a frozen archive 16 retains its page grid and authored flow without adopting frame grids', async () => {
  const input = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v16.json', import.meta.url), 'utf8'),
  );
  const [doc] = validateImport(input).documents;
  assert.equal(archiveVersion([doc]), 16);
  assert.deepEqual(doc.publishing.baselineGrid, input.documents[0].publishing.baselineGrid);
  assert.equal(doc.blocks[0].frameOptions?.baselineGrid, undefined);
  assert.equal(doc.textFlows[0].html, input.documents[0].textFlows[0].html);
});
