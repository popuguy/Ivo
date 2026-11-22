import { fittingRoomProof } from '../../fixtures/text-review/document.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { renderPDFSnapshot } from '../../../src/features/export/pdf-renderer.js';
import { exportReflowableBook } from '../../../src/features/export/epub.js';
import { unzipSync, strFromU8 } from '../../../node_modules/fflate/esm/browser.js';

export async function verifyReviewProof(assert) {
  const doc = fittingRoomProof();
  const reopened = validateImport({
    schemaVersion: archiveVersion([doc]),
    documents: [doc],
    assets: [],
  }).documents[0];
  const host = document.createElement('div');
  host.id = 'pdf-pages';
  document.body.append(host);
  try {
    await renderPDFSnapshot({ documents: [reopened], assets: [] });
    assert(
      host.querySelectorAll('[role=doc-footnote]').length === 1 &&
        host.textContent.includes('Measured after steaming'),
      'Review proof lost or duplicated its footnote',
    );
    assert(
      host.querySelectorAll('[data-anchored-artwork] polygon[fill="#4057ad"]').length === 1,
      'Review proof lost or duplicated its cobalt swatch',
    );
    assert(
      host.querySelectorAll('td em').length === 1 &&
        host.querySelector('td em').textContent === 'twill',
      'Review proof lost its italic cell text',
    );
    assert(
      host.textContent.includes('return the tested samples'),
      'Final paragraph of review proof is overset',
    );
  } finally {
    host.remove();
  }
  const bytes = await exportReflowableBook([reopened], reopened.id, {});
  const xml = new DOMParser().parseFromString(
    strFromU8(unzipSync(bytes)['EPUB/chapter-1.xhtml']),
    'application/xhtml+xml',
  );
  assert(
    xml.querySelector('[role=doc-noteref]') &&
      xml.querySelector('td em')?.textContent === 'twill' &&
      xml.querySelector('svg, img'),
    'Review proof EPUB lost a structured item',
  );
}
