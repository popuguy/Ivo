# Native paragraph layout

The native composer previews now implement paragraph alignment, the four justification/last-line variants, left/right indents, hanging first-line indents within the column, and space before/after paragraphs. The Properties controls edit canonical paragraph settings; native glyphs, carets, selection, continuation and selectable PDF consume one resulting geometry plan. Existing documents keep their selected composer. This is a paragraph-layout foundation, not complete InDesign composition parity.

## Behavior and ownership

Select a linked text frame and choose **Properties → Text Flow → Composer → Ivo Paragraph · Preview** or **Ivo Single-line · Preview**. Paragraph controls work on the selected paragraph range during text editing and across the whole flow when its frame is selected. Named styles retain sparse direct overrides; formatting does not rewrite the style definition or replace text with positioned fragments.

- Left, center, right and LTR start/end alignment position actual native lines. Justify uses full nonfinal lines, including forced soft returns; paragraph endings can remain left, centered, right or fully justified. A fully justified single word can expand between letters.
- Left/right indents reduce available width. First-line indent applies only at the paragraph's source start; it does not repeat after a soft return or at a linked continuation. A negative first-line value can hang within the positive left indent. Absolute overhang outside the column rejects before source/history/backend changes because the current frame renderer clips that area.
- Space Before and the preceding paragraph's Space After add between paragraphs in the same physical column. Both are suppressed at a physical column top. Soft returns do not create paragraph spacing, and a final Space After does not consume frame-fitting height.
- Literal tabs remain source characters, with default half-inch stops anchored to the physical text-column origin. Indented left/start-aligned tab paragraphs use native offset-aware measurement and line construction. Other tab/alignment combinations reject until their policies are qualified.

Source projection resolves paragraph-mark styles, inherited definitions, sparse resets, implicit/root paragraphs, empty paragraphs and soft breaks without editing HTML. Literal U+2029 separators retain their original text spans and acquire separate native paragraph ranges; selection recognizes those boundaries. Range formatting within a single HTML block containing literal separators currently rejects explicitly rather than formatting an unintended neighbor. Ordinary separate HTML paragraphs and whole-flow formatting remain supported. Conflicting paragraph properties on inline character spans reject rather than silently flattening them.

## Transport, fitting and recovery

Internal composition protocol **2** requires contiguous paragraph ranges and the six existing paragraph layout fields. The [frame scheduler](native-flow-scheduling.md) uses protocol **3** for Paragraph mode, retaining exact break/frame/baseline/area placements. Single-line retains protocol 2; protocol 1 retains its legacy default geometry and rejects paragraph payloads. Responses must match the requested protocol, source identity, paragraph boundaries and independently computed areas. Glyph and caret x positions include the final aligned origin; retained PDF lines use that same origin and CTLine. An older native worker rejects the new protocol instead of ignoring layout fields.

The source archive remains **9 / canvas 8** when wrapping is used; native composition remains the existing archive-8/canvas-7 capability. No new stored field, format migration, vault write on read or default-composer migration is introduced. Native paragraph metadata, positions, vectors, tokens and PDF lines remain disposable derived results.

The owned paragraph optimizer now fits unequal physical columns with exact per-alternative widths and vertical metrics. Layout-only changes reuse exact-font measurements; tab-containing paragraphs additionally key measurements by their first/rest tab origins. Decisions retain at most four geometry/cursor keys per paragraph, with bounded caches and whole-flow work limits. Indents outside all available frames reject synchronously; a narrow unusable frame can hand source to a wider following frame.

The Paragraph preview still uses its declared ragged-right quadratic fitting policy before default native line justification. This is not Adobe's complete justified-paragraph cost function. Both native previews support unequal column widths. Native contour exclusions, spacing min/desired/max and glyph-scale constraints, hyphenation, keeps, grids, custom tabs/leaders, advanced shaping, structured content, physical input and cross-device qualification remain open. Native wrapping remains the next composition priority.

## Verification

Domain, byte-transport, real Core Text and actual-editor regressions cover the source/layout boundaries above. The new independent PDFKit witness checks shifted selectable text, while the production export fixture retains rotated/scaled/masked mixed-face text with paragraph alignment. Trusted typing, exact undo/redo, archive/cold reopening, transformed caret queries, sparse style definitions and rejected-width/overhang/ambiguous-scope transactions use disposable CMU data. The [verification record](verification.md) contains the final run and package results; native reference captures and generated artifacts stay outside Git.
