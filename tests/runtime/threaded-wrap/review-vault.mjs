// Add a structured companion to a fresh copy of the paired contour fixture.
import path from 'node:path';
import { access } from 'node:fs/promises';
import { openVault } from '../../../desktop/vault.mjs';
import { fittingRoomProof } from '../../fixtures/text-review/document.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';

const folder = process.argv[2];
if (!folder) throw Error('Pass the directory containing the copied contour study.');
await access(path.join(folder, 'Contour study.indd'));
const vault = await openVault(path.join(folder, 'Ivo vault'));
const doc = fittingRoomProof();
const archive = validateImport({
  schemaVersion: archiveVersion([doc]),
  documents: [doc],
  assets: [],
});
const existing = await vault.loadDocuments();
if (existing.some((d) => d.title === doc.title))
  throw Error('This review vault already contains the fitting proof.');
await vault.saveImport(archive);
console.log(
  'Prepared ' +
    doc.title +
    ' with four frames, a column footnote, an inline swatch and a finish table.',
);
