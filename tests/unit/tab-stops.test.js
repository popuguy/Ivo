import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tabStopsValue, tabStopSettings } from '../../src/domain/text/tab-stops.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { baselineGridFixture } from '../fixtures/text/baseline-grid.js';

test('tab alignments preserve fractional stops and delimiter or supplementary alignment characters', () => {
  const stops = [
    { position: 12.125, alignment: 'right' },
    { position: 80, alignment: 'decimal', character: ',', leader: '.-' },
    { position: 108.25, alignment: 'decimal', character: '💎' },
  ];
  const value = tabStopsValue(stops);
  assert.deepEqual(tabStopSettings(value), stops);
  assert.deepEqual(tabStopSettings('normal'), []);
  for (const bad of [
    '0:left',
    '20:down',
    '20:left,20:right',
    '20:left:46',
    '20:decimal:9',
    '20:decimal:0',
    '20:decimal:99999999',
    '20:right:1:2',
    '00.5:left',
    '14401:left',
    '20:left,',
  ])
    assert.throws(() => tabStopSettings(bad), undefined, bad);
});
test('custom tab stops round-trip in marked paragraphs and reject archives that cannot read them', () => {
  const { doc } = baselineGridFixture();
  const open = (schemaVersion) =>
    validateImport({ schemaVersion, documents: [doc], assets: [] }).documents[0];
  assert.ok(archiveVersion([doc]) < 18);
  doc.textFlows[0].html = '<p data-ivo-tabstops="80:decimal:44">Label\t2,50</p>';
  assert.throws(() => open(17), /tab stops/);
  markTypographyVersion(doc);
  assert.equal(archiveVersion([doc]), 18);
  assert.equal(doc.canvasVersion, 17);
  assert.equal(open(18).textFlows[0].html, doc.textFlows[0].html);
  doc.textFlows[0].html = '<p data-ivo-tabstops="40:left,22:right">Bad</p>';
  assert.throws(() => open(18), /tabstops/);
});

test('frozen archive 17 preserves its half-inch tabs and existing frame grid', async () => {
  const input = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v17.json', import.meta.url), 'utf8'),
  );
  const [doc] = validateImport(input).documents;
  assert.equal(archiveVersion([doc]), 17);
  assert.equal(doc.textFlows[0].html, '<p>Price\t123.45</p>');
  assert.equal(doc.textFlows[0].style.tabStops, undefined);
  assert.deepEqual(
    doc.blocks[0].frameOptions.baselineGrid,
    input.documents[0].blocks[0].frameOptions.baselineGrid,
  );
});
