# Native PDF source encoding

Desktop export now improves eligible native font ToUnicode mappings before embedding the frozen native text layer. Ordinary ASCII ligatures such as `ffi` remain the original letters when copied or searched in PDFKit, while glyph drawing, positioning, masks and font programs remain unchanged. Existing correct ActualText is retained. This is a conservative compatibility stage for Ivo's freshly generated native output, not an imported-PDF repair feature.

## Source authority and transaction

An encoded character can acquire a replacement only from an existing, valid ActualText span covering exactly one encoded character use. Every observed use of that same indirect font object and character code must agree. The scan follows page resources, graphics/text state, marked-content scopes and admitted recursive Forms. It handles the native simple one-byte TrueType subset as well as admitted two-byte Identity-H fonts; a glyph number or resource name alone does not identify a source character.

The entire scan completes before any mapping is changed. A new ToUnicode stream belongs only to the affected font; an original stream shared by different fonts is never edited in place. Existing compressed/decoded streams, font programs, widths, encodings and paint operators remain unchanged. There is no source lookup, text normalization, synthetic text overlay or glyph reconstruction.

A source containing both ASCII `ffi` and literal U+FB03 can use the same font/code for different meanings. A single font-wide map cannot represent both. Conflicting, unannotated or multi-code claims keep the exact original bytes and receive an unsupported diagnostic. Load, admission, parsing and serialization failures also retain the original bytes; a failed compatibility pass cannot replace a valid native layer with partial output. The export manifest reports bounded counts/status, and unresolved encoding receives a compatibility warning. Broader per-use font encoding remains open.

## Ownership and bounds

The production entry is reached only after requester-owned immutable native tokens resolve through `composition-pdf-layers.mjs`. It runs before those source pages are embedded; it never opens a path or processes a user-imported PDF. Source snapshots, helper tokens and original PDF bytes remain unchanged.

The stage admits a narrow known CMap/content grammar and checks byte, operation, character-use, mapping and Form-depth budgets. Unknown grammar, annotation appearances, patterns, soft-mask traversal, unsupported font encodings and ambiguous resources retain the original. The pinned pdf-lib parser's allocation/inflation happens before some checks: these are acceptance limits for known helper output, not a hostile-PDF allocation guarantee. Internal parser dependencies are isolated behind the desktop module and pinned dependency tests.

The [verification record](verification.md) covers synthetic structural oracles, real native output, independent readers, exact stream/font preservation, raster identity and the production transformed/wrapped/kept PDF path. Complete PDF reading order/accessibility, international text, per-component ligature selection and mixed-source reader compatibility remain publication work. Saved formats and editor composer defaults are unchanged; this correction remains within the existing ~33% engineering estimate.
