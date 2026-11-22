import {
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
} from 'pdf-lib';
import { improveNativePDFEncoding } from './native-pdf-encoding.mjs';

const MAX_LAYERS = 256,
  MAX_PLACEMENTS = 4096,
  MAX_BYTES = 100 * 1024 * 1024,
  MAX_COORDINATE = 1_000_000;
const plain = (value) =>
  value &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value, limit = MAX_COORDINATE) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
const fail = (message) => {
  throw new TypeError('Invalid composed PDF layer: ' + message);
};
function placement(value, destinationCount) {
  if (!plain(value)) fail('placement must be plain data.');
  for (const key of ['sourcePageIndex', 'destinationPageIndex'])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail('invalid page index.');
  if (value.destinationPageIndex >= destinationCount) fail('destination page is unavailable.');
  if (
    !Array.isArray(value.matrix) ||
    value.matrix.length !== 6 ||
    !value.matrix.every((v) => finite(v))
  )
    fail('matrix must contain six finite PDF affine coefficients.');
  const [a, b, c, d] = value.matrix;
  if (
    Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) > 10_000 ||
    Math.abs(a * d - b * c) < 1e-12
  )
    fail('matrix is singular or exceeds the composition scale budget.');
  const clips = value.clips ?? [];
  if (!Array.isArray(clips) || clips.length > 16) fail('use up to 16 polygon clips.');
  for (const polygon of clips)
    if (
      !Array.isArray(polygon) ||
      polygon.length < 3 ||
      polygon.length > 256 ||
      !polygon.every((p) => plain(p) && finite(p.x) && finite(p.y))
    )
      fail('polygon clips require 3–256 finite PDF points.');
  return {
    sourcePageIndex: value.sourcePageIndex,
    destinationPageIndex: value.destinationPageIndex,
    matrix: value.matrix.slice(),
    marker: value.marker,
    clips: clips.map((polygon) => polygon.map(({ x, y }) => ({ x, y }))),
  };
}

/**
 * Append trusted native *invisible* text PDFs to an existing frozen export.
 * CT font programs and paint operators are copied, never reshaped. Eligible
 * Unicode mappings use the exact existing ActualText for reader compatibility.
 * The source worker must have rendered with text drawing mode invisible; this
 * validates placement, not arbitrary PDF content or the worker's rendering mode.
 *
 * Placement matrix maps source PDF bottom-left points into destination PDF points.
 * `clips` are destination-space nonzero polygons, intersected before that matrix.
 * Source pages must have an unrotated, zero-origin media/crop box (frame bounds).
 * All data is validated before target resources/content are added. The caller
 * owns this disposable PDFDocument and saves it only after successful completion.
 */
export async function embedComposedTextLayers(pdf, layers, structure) {
  if (!(pdf instanceof PDFDocument)) fail('destination must be a PDFDocument.');
  if (!Array.isArray(layers) || layers.length > MAX_LAYERS) fail('too many text layers.');
  const destinationPages = pdf.getPages();
  if (!destinationPages.length || destinationPages.length > 256)
    fail('invalid destination page count.');
  let bytes = 0,
    placementCount = 0;
  const prepared = [];
  for (const layer of layers) {
    if (!plain(layer) || !(layer.bytes instanceof Uint8Array) || !layer.bytes.length)
      fail('native PDF bytes are required.');
    bytes += layer.bytes.byteLength;
    if (bytes > MAX_BYTES) fail('native PDF byte budget exceeded.');
    if (!Array.isArray(layer.placements)) fail('placements must be an array.');
    placementCount += layer.placements.length;
    if (placementCount > MAX_PLACEMENTS) fail('too many placements.');
    const placements = layer.placements.map((value) => placement(value, destinationPages.length));
    // Production layers come only from requester-owned frozen worker tokens.
    // This conservative stage must never become an imported-PDF repair route.
    const encoding = await improveNativePDFEncoding(layer.bytes),
      source = await PDFDocument.load(encoding.bytes, { updateMetadata: false });
    if (source.getPageCount() > 256) fail('too many native source pages.');
    const pages = source.getPages();
    for (const value of placements) {
      const page = pages[value.sourcePageIndex];
      if (!page) fail('source page is unavailable.');
      const box = page.getMediaBox(),
        crop = page.getCropBox();
      if (
        !finite(box.width, 14400) ||
        box.width <= 0 ||
        !finite(box.height, 14400) ||
        box.height <= 0 ||
        box.x !== 0 ||
        box.y !== 0 ||
        crop.x !== 0 ||
        crop.y !== 0 ||
        crop.width !== box.width ||
        crop.height !== box.height ||
        page.getRotation().angle % 360 !== 0
      )
        fail('source must have an unrotated zero-origin frame box.');
    }
    prepared.push({ source, pages, placements, encoding, token: layer.token });
  }
  let drawnPlacements = 0,
    emptyPlacements = 0;
  for (const { pages, placements, token } of prepared) {
    const embedded = new Map();
    for (const value of placements) {
      const source = pages[value.sourcePageIndex];
      // Blank native frames can legitimately have no PDF content stream.
      if (!source.node.Contents()) {
        emptyPlacements++;
        continue;
      }
      const tagged = structure?.frame(token, value);
      let page = tagged ? undefined : embedded.get(value.sourcePageIndex);
      if (!page) {
        const { width, height } = source.getSize();
        [page] = await pdf.embedPages(
          [source],
          [{ left: 0, bottom: 0, right: width, top: height }],
          [[1, 0, 0, 1, 0, 0]],
        );
        if (tagged) {
          await page.embed();
          structure.attachFrame(tagged, source, page.ref);
        } else {
          embedded.set(value.sourcePageIndex, page);
        }
      }
      const destination = destinationPages[value.destinationPageIndex],
        operators = [pushGraphicsState()];
      for (const polygon of value.clips) {
        operators.push(moveTo(polygon[0].x, polygon[0].y));
        for (const p of polygon.slice(1)) operators.push(lineTo(p.x, p.y));
        operators.push(closePath(), clip(), endPath());
      }
      destination.pushOperators(...operators, concatTransformationMatrix(...value.matrix));
      destination.drawPage(page, {
        x: 0,
        y: 0,
        xScale: 1,
        yScale: 1,
      });
      destination.pushOperators(popGraphicsState());
      drawnPlacements++;
    }
  }
  return {
    layers: layers.length,
    placements: placementCount,
    drawnPlacements,
    emptyPlacements,
    textEncoding: prepared.map(({ encoding }, layerIndex) => ({
      layerIndex,
      changed: encoding.changed,
      supported: encoding.supported,
      substitutions: encoding.audit.reduce(
        (count, row) => count + (row.status === 'patched' ? row.updates.length : 0),
        0,
      ),
      ...(encoding.reason ? { reason: encoding.reason.slice(0, 240) } : {}),
    })),
  };
}
