# Native text geometry and PDF proof

18 November 2026. This is an isolated engineering experiment under `tests/prototypes/text-composition/`, following [the composition-authority proposal](../decisions/0004-text-composition-authority.md). The live editor still uses its existing browser layout. The experiment changes no saved document format, vault bytes, fonts installed on the machine or application preferences.

## Implemented contract

The browser adapter reads the current canonical DOM through Ivo's existing logical index map and source-owned style resolver. It preserves HTML unchanged and emits text, sparse effective runs and a complete map between logical UTF-16 positions and native attributed-string positions. Structural opening marks and empty-placeholder breaks remain explicit zero-width map entries. Soft breaks and paragraph terminators remain distinct atoms; empty and final paragraphs survive. Native positions that alias several virtual source boundaries return an interval rather than a guessed single position.

The proof currently accepts CMU paragraph text with real regular/italic/bold companions, size, tracking and ligatures. Unsupported structures, fonts and changed formatting outside this bounded contract fail explicitly. It does not flatten tables/lists/images or silently accept their absence. This adapter is disposable prototype code, not the new persisted semantic model.

The Swift executable validates the protocol, source/font hashes, face identity, resource budgets, source-map continuity, complete run coverage, geometry and surrogate boundaries. Font bytes feed process-local Core Graphics/Core Text objects without global registration. A declared greedy policy constructs native lines across three unequal frames and returns glyph IDs/positions/advances, font identities, source-cluster ranges, line metrics and primary/secondary caret offsets. Empty paragraph origins have an explicit source-derived measurement label. System fallback is either rejected or named in diagnostics.

Paragraph separators normalize to equal-length native line controls inside the probe. Native line drawing excludes control terminators while preserving their source interval, caret boundary and blank-line metrics. The first raster check caught visible paragraph symbols when the original separator was drawn as a font glyph; the corrected fixture now asserts that controls cannot appear in glyph output. This is why rendered inspection accompanies text extraction.

The PDF emitter draws the same retained `CTLine` objects that produced the geometry. It does not rewrap DOM strings or outline all glyphs. Independent pypdf/pdfplumber checks verify mixed page sizes, embedded real font subsets, supported encoding/Unicode maps, source-equivalent Latin text, preserved ligature `ActualText` and 25 visible native baselines. The three Latin pages and the mixed-script page were rendered with Poppler and visually inspected.

## Observed result and boundaries

On this Mac, identical requests produce identical geometry: the Latin fixture composes 27 lines/1,023 glyphs without fallback diagnostics; the mixed-script fixture composes four lines/56 glyphs and exposes real RTL runs and dual caret positions. The latter explicitly identifies Apple Color Emoji, Geeza Pro, Kohinoor Devanagari Medium and Lucida Grande as unpackaged fallback. Their bytes and the resulting private diagnostic PDFs are not committed. This is not portable fallback capture or a mobile result.

Quartz preserves the original `ffi` source in PDF `ActualText`, while pypdf's ordinary extraction returns the compatibility ligature scalar from the font map. The verifier checks that exact declared difference and its source-backed replacement; it does not broadly normalize arbitrary Unicode to hide errors. Reader-specific selection/copy, complete complex-script extraction, tags/reading order and accessible export remain adoption gates. Searchable glyphs alone do not close those gates.

Negative cases reject mismatched source/font hashes, a missing font, a discontinuous map, a surrogate-splitting run, forbidden fallback and a mismatched result generation. A deliberately undersized frame reports overset while retaining the complete source. The subsequent [owned paragraph decision](paragraph-breaks.md) now compares global and greedy choices over real measured alternatives and preserves the chosen lines in PDF. This remains a limited ragged-right policy; hyphenation/justification, tables/notes/wrap, native input and cross-device performance are not certified.

## Reproduce

Use macOS with Apple Command Line Tools, the pinned project dependencies, Python with pypdf/pdfplumber, and Poppler for raster review. The Python packages are verification dependencies only; none is added to the application. No global installation is required when the bundled Codex runtime is available.

```sh
IVO_PDF_PYTHON=/path/to/python-with-pypdf-and-pdfplumber \
IVO_COMPOSITION_PROOF_OUT=/absolute/temporary/artifact-directory \
npm run test:composition-prototype
```

Without an output override, the runner creates an isolated temporary artifact directory and reports it. It compiles the owned Swift executable there, opens a temporary source-adapter renderer, runs the bounded requests and independent PDF inspection, and writes a verification report. Native source/PDF/font captures remain outside Git and outside app packaging. The experiment is separate from the ordinary runtime suite and deliberately does not activate a production backend.

Private evidence is under parent `work/text-composition-proof-2026-11-18/` and `work/paragraph-composition-proof-2026-11-18/`; initial startup/transport, font-map, visible-control and kerning corrections remain recorded. Standard source checks now pass with 226 unit tests. The earlier text-core package and 33 desktop regression groups remain the production baseline. Next: complete paragraph fitting and native presentation/input, publication scheduling, resource portability and physical-device qualification. See [P1–P8](../decisions/0004-text-composition-authority.md#decisive-prototype-gate) before adopting this authority.
