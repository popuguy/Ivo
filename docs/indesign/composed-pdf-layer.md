# Native text over an outline-based PDF

18 November 2026. This bounded adoption experiment answers one presentation question from [the text-composition decision](../decisions/0004-text-composition-authority.md): can Chromium retain the editor's visible object paint order while a native composition result supplies searchable PDF text? The answer is **yes for the controlled Latin fixture and affine placements tested here**. It does not certify the live editor, reader selection behavior, tagged export or all scripts.

## Ownership and integration contract

Visible ink can come from glyph paths produced by the retained native lines. Chromium prints those paths together with ordinary page objects, backgrounds, masks and occluding foreground objects. A second PDF contains invisible text drawn from those **same immutable `CTLine` objects**, with their original font resources and source mappings. The merge copies these native pages as Form XObjects; it never asks another engine to reshape or wrap the text.

[`desktop/composed-pdf.mjs`](../../desktop/composed-pdf.mjs) implements the merge boundary through `embedComposedTextLayers(pdf, layers)`. Each layer contains native PDF bytes and explicit placements:

```js
{
  bytes: nativeInvisiblePDF,
  placements: [{
    sourcePageIndex: 0,
    destinationPageIndex: 0,
    matrix: [1, 0, 0, 1, 80, 602],
    clips: [[
      { x: 80, y: 602 }, { x: 240, y: 602 },
      { x: 240, y: 692 }, { x: 80, y: 692 },
    ]],
  }],
}
```

Matrices map native frame PDF coordinates into destination PDF coordinates, both measured in points from the bottom left. Optional clips are destination-space polygons, applied with the nonzero winding rule and intersected in order before the matrix. Source pages must have unrotated, zero-origin media/crop boxes matching their frame bounds. The helper validates every layer and placement before adding target resources or content, reuses a source-page embedding within each layer, and skips blank frames with no content stream. Graphics state is isolated per placement.

The exporter must derive placements from a frozen canonical export snapshot, rather than a live camera, DOM rectangle, zoom ratio or an independently remeasured layout. Given a frame height `H`, destination page height `P`, and a canonical top-down affine matrix `[a,b,c,d,e,f]`, the corresponding native-PDF-to-destination-PDF matrix is:

```text
[a, -b, -c, d, c*H + e, P - d*H - f]
```

Clips must undergo the same canonical page-coordinate conversion. A native cache token, source/font hashes and geometry generation must still be bound by the integration layer; the PDF helper cannot establish those identities. The caller owns a disposable target `PDFDocument` and saves it only after successful completion.

The helper accepts **trusted native invisible output**, not arbitrary attached PDFs. Geometry validation is not PDF sanitization and does not prove that supplied content is invisible. The native worker is responsible for drawing with Core Graphics' invisible text mode. PDF clipping and foreground occlusion do not delete text from extraction: this mechanism must never be treated as redaction.

## Controlled proof and observed evidence

An isolated Swift probe loads the shipped public CMU Serif Roman bytes through process-local Core Graphics/Core Text objects. It creates four immutable lines across two differently sized frame pages (260 × 90 and 220 × 80 points), including `office affine` ligatures. The same retained lines produce native visible PDF, native invisible PDF and glyph-outline SVG. No fonts are globally registered and no personal document or application profile is used.

A hidden, isolated Chromium window prints those outlines over colored page art, including a foreground stripe that covers part of a line. The proof merges the native invisible pages at three placements: translation, 90-degree rotation, and nonuniform scale/shear. Every placement also has a polygon clip. The two destination pages are 612 × 792 points.

Independent inspection with pypdf and pdfplumber, followed by Poppler rasterization, establishes:

- The Chromium base contains outline ink and extracts no text; the merged output extracts the expected native source for all three placements.
- Every embedded text-show operation uses rendering mode 3. The native invisible pages rasterize completely white.
- Embedded CMU font bytes, font encoding/Unicode resources and original ligature `ActualText` survive the merge. Some extractors report a compatibility ligature scalar from the font map; the preserved `ActualText` contains the original `ffi` source. This distinction remains explicit.
- Every extracted character's complete affine text matrix matches the native source matrix composed with its declared placement, to four decimal places. This includes the rotated and sheared cases, rather than only axis-aligned bounding boxes.
- The before/after RGB rasters at 144 dpi are **pixel-identical on both pages** (1,224 × 1,584 pixels each). Background art, actual outline ink and foreground occlusion are unchanged. The pages contain thousands of dark ink pixels, so this is not a blank-page comparison.

Private generated evidence, including the owned probe, HTML, PDFs, raster comparisons and `verification.json`, is retained outside the repository under parent `work/composed-pdf-2026-11-18/`. Only the original helper, unit tests and this report are source artifacts. The public font is already licensed and shipped with Ivo; no proprietary fonts, binaries or extracted code enter the fixture.

The check was then repeated through the actual persistent service in `desktop/text-composition.mjs`, the shared native engine and `composedSVG`. A structured four-paragraph CMU source produces four lines across two 260 × 48 point frames, with 26 distinct outline vectors and no fallback/overset diagnostics. Visible SVG and invisible PDF come from the same cached composition token. The same three-placement Chromium merge passes all extraction, exact transformed-matrix and pixel-invariance checks. Its two pages contain 4,405 and 3,397 dark ink pixels respectively; their before/after rasters are identical. This second evidence set is under the private `worker/` subdirectory. It exercises the actual transport and display primitive, while remaining separate from the live editor export path.

A further run against the updated worker uses 80-point frames with a minimum first baseline of 18 points and bottom alignment on the second frame. The returned first baseline is exactly 18; the final bottom-aligned baseline plus descent equals 80. Source extraction, full transformed text matrices and pixel-identical before/after output all pass again. This alignment witness is retained under the private `worker-alignment/` subdirectory.

## Verification and remaining adoption gates

[`tests/unit/composed-pdf.test.js`](../../tests/unit/composed-pdf.test.js) covers resource/text preservation, affine and clip operators, unchanged input bytes, invalid geometry/page rejection before destination mutation, blank frames and an empty request. The focused Node tests, lint and formatting checks pass. The controlled native/Chromium proof is additional independent evidence, not a replacement for runtime tests.

Before adoption, integrate and verify the real cached composition token and frozen editor export geometry. Test stale-result rejection, native-worker failure, nested object masks and repeated source placements against actual editor output. Search/copy/selection must be checked in the intended PDF readers, including cross-line/page ranges, ligatures, RTL and complex scripts. Export reading order, accessibility tags and document semantics require a separate policy: appending invisible Form XObjects does not supply them automatically. Physical iPhone/iPad output and text input are separate qualification gates.

The proof establishes that native searchable text can be added **without changing visible paint order or pixels**. It does not mean browser layout, paragraph optimization, full script coverage or complete InDesign text parity has been delivered.

## Primary references

- Apple, [Core Graphics invisible text drawing mode](https://developer.apple.com/documentation/coregraphics/cgtextdrawingmode/invisible); the local macOS SDK `CGContext.h` independently declares `kCGTextInvisible`.
- pdf-lib, [PDFDocument.embedPages](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedpages) and [PDFPage.pushOperators](https://pdf-lib.js.org/docs/api/classes/pdfpage#pushoperators). The pinned 1.17.1 implementation was also inspected to confirm explicit embedding matrices and preservation of source content/resources.
- Ivo's earlier [native text geometry and same-line PDF proof](native-composition-prototype.md), which records source-map and font-identity boundaries independently of this invisible-layer presentation experiment.
