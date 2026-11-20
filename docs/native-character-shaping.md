# Native character shaping

The explicit native text preview now carries baseline shift, horizontal/vertical character scale and eight additional OpenType feature switches through exact-font measurement, paragraph scheduling, vector ink, caret/range geometry, editing and PDF. Existing documents retain their chosen composer. This is a bounded shaping increment, not complete InDesign text parity.

## Character metrics and source

Baseline shift and vertical scale change the painted glyphs and their ink envelopes. They do not enlarge the untransformed line strut, alter the first-baseline metric or silently change fixed leading. Horizontal scale changes advances, tracking and line fitting. Protocol 4 retains separate signed ink metrics and untransformed line metrics, including entirely raised or lowered runs. Glyph transforms are applied once. Selection, highlights, underlining and strike-through use the affected run's geometry; physical navigation rows continue to use their composition baselines.

Source HTML and UTF-16 boundaries remain authoritative. Effective character styles project to sparse shaping fields; resetting a value removes it rather than retaining an earlier run's feature settings. Default source continues to use protocols 2/3. Advanced source selects protocol 4; older workers cannot silently accept it. The desktop and iOS project share the Swift implementation, but physical iPhone/iPad qualification remains open.

The admitted OpenType tags are discretionary ligatures (`dlig`), small capitals (`smcp`), oldstyle figures (`onum`), tabular figures (`tnum`), slashed zero (`zero`), fractions (`frac`), ordinals (`ordn`) and stylistic alternates (`salt`). An enabled tag must exist in the exact selected face's verified bytes. A Roman face's metadata cannot authorize its Italic variant. Missing features produce a source-preserving rejection; there is no synthetic small-cap or font substitution fallback. Oldstyle figures request proportional figures only when that same face declares the supporting tag. A feature's presence does not promise a visible substitution for every string.

## Rendering and export

Core Text can combine adjacent source spans into a single glyph run even when their highlight or decoration differs. Paint now intersects each authored interval with native carets rather than styling the combined run wholesale. Primary/secondary caret edges retain visual ownership for partial ligatures and directional runs. Missing interior geometry is an explicit error rather than a guessed character width.

The retained native PDF uses the same composed lines. The export tests compare source, placements, vector paths, scaled/shifted selection bounds, decorations and independent raster output. Ordinary `ffi` ligatures reveal a reader compatibility gap: the PDF contains the correct `/ActualText (ffi)` replacement and Poppler recovers the original ASCII `office`, while Apple's PDFKit exposes U+FB03 and fails an ASCII `office` search. The later [native PDF encoding stage](native-pdf-encoding.md) now corrects eligible ASCII copying/search from that existing source authority. Conflicting literal/ASCII code reuse remains explicitly unsupported. A reader's normalization is not accepted as source-preservation evidence, and the correct glyph/ActualText stream is preserved in this increment.

## Admission and remaining work

Native object wrapping supports horizontal scaling and qualified OpenType settings alongside changes of face, size and leading within one paragraph. Vertical scaling and baseline shifts also work with Wrap Around Bounding Box and Jump to Next Column. Ink and caret coordinates follow the transformed run while the text frame keeps the ordinary line band. Other wrap modes still require unshifted, vertically unscaled text. Off-frame shifted/scaled ink, extreme overlapping lines, complete bidi/complex scripts, variable fonts, case conversion, language-specific shaping, font fallback and full cross-device qualification remain open. Existing shape masks and transformed PDF placements retain their prior contracts.

This increment changes no saved document/vault format, generated text or composer defaults. Font bytes and original source remain portable assets; helper requests retain byte-only resource ownership and bounded caches. The [verification record](verification.md) states the actual checks, and the [66-capability programme](indesign/text-parity-programme.md) remains the scope for progress estimates.
