# InDesign text parity progress

Current overall engineering estimate, 19 November 2026:

`[████████░░░░░░░░░░░░] ~41%`

This is a rough assessment of implementation and integration across the [66 included capabilities](text-parity-programme.md), not a measured completion percentage, a schedule prediction or a count of controls. Foundation implementations have substantial fidelity, international-input, publication and device acceptance work left. No capability is yet certified against every reference and device gate. Report this bar after each completed milestone, keeping this full scope consistent. Small interface corrections need not move the rounded estimate.

**No Break** protects selected phrases in native text, follows them into a wider linked frame and preserves overset source when no frame can fit them. Thirteen reference cases matched InDesign. This brings the engineering estimate to **~41%**.

Split paragraphs can protect opening and closing lines independently in both native composers. Twenty InDesign layouts matched all 143 line endings, occupied columns and baselines. Editor, archive and PDF checks bring the engineering estimate to **~40%**.

Section starts now target the next column, text frame, page, odd page or even page. A live comparison exercised first paragraphs, full columns, conflicting keeps and successive starts; the 25 layouts matched InDesign’s occupied columns and overset behavior. The overall engineering estimate is **~39%**.

The native composers now support keeping one to five following lines and keeping a caption with the preceding paragraph. These settings work through Properties, named paragraph styles, undo, vault storage and searchable PDF. This brings the estimate to **~38%**.

Linked heading chains, following whole paragraphs and physical wrap rows now share keep placement across unequal native frames. Editor and searchable PDF regressions cover chained headings. This moves the engineering estimate from ~36% to ~37%.

New documents now use the reference type size, automatic leading and paragraph spacing. Keyboard formatting covers relative point sizes in mixed selections, insertion points and selected frames. These refinements keep the overall estimate at **~36%**.

Repeated horizontal and vertical scale edits now use the final percentage for each selected run. Saved documents with nested scale resets regain their original left edge. These fixes and the compact publishing panels keep the estimate at **~36%**.

## Milestones reflected in this baseline

- Shared canonical flow source, linked selection, typography/history corrections and portable fonts.
- Native glyph/caret/source geometry, on-page editing, automatic continuation and same-line searchable PDF as an explicit preview.
- Independent paragraph decisions and unchanged-paragraph measurement/decision reuse.
- Contextual Tab behavior, ordinary half-inch text tabs, native arrangement commands, menu-owned Smart Guides and compact page/zoom navigation. These improve daily use and the command/input foundation; they do not complete paragraph tab composition or reference parity.
- Literal leading-space preservation through rich/plain clipboard insertion, saved paint and linked/native source/history. This is an input correction within the current foundation; it does not move the rounded overall estimate.
- [Object wrapping](../object-text-wrap.md) now excludes boxes/polygon contours in actual layout, on-page input, continuation and selectable PDF, with source/history protection. This closes a fixture-enabling geometry/input dependency and advances the broad estimate from ~20% to ~22%. Image/path contours, native wrap composition and full reference/device qualification remain open; no complete wrap capability is certified.
- The disposable-layout follow-up corrects masked graphic contour ownership, clip-before-offset projection, whole-word contour flow and two mask-domain rotation operations. These fix the existing foundation and leave the rounded estimate at ~22%; advanced wrap and physical transform qualification remain open.

- [Native paragraph layout](../native-paragraph-layout.md) now implements paragraph alignment and justification endings, indents, spacing and indented default tabs in the shared glyph/caret/PDF authority, with actual edit/undo/reopen and source guards. This closes an integrated paragraph-layout dependency and advances the broad estimate from ~22% to ~24%. Native variable-area/wrap scheduling, the full justified-paragraph optimizer and device gates remain open.

- [Document text operations](../text-interaction-core.md#document-text-operations) now own ordinary rich-text edits across frames, including paragraph joins, replacement and Unicode deletion. Marked-text cancellation and source/selection undo are covered in the desktop editor. This strengthens the editing foundation within the existing ~35% estimate. Structured editing, layout fidelity and physical device qualification remain open.

- Desktop navigation now distinguishes page scrolling, caret movement and selection in the visible composition. Word deletion crosses frame edges and flat list edits retain formatting. This advances the broad estimate from ~35% to ~36%. Native list composition, complex-script movement and device qualification remain open.

## Major work still driving the estimate

The [frame-scheduling milestone](../native-flow-scheduling.md) fits unequal native columns with exact line metrics, one owned break/baseline plan and cooperative preparation/search. It advances the same broad estimate from ~24% to ~26%; the justification objective and reference/device gates remain incomplete.

The [native-wrap milestone](../native-object-wrap.md) integrates planned exclusion fragments with one physical navigation row, pointer geometry, source/history and independent selectable PDF. The shared contour fix and interval sweep improve both composers. This advances the same estimate from ~26% to ~28%; mixed-metric native rows, centered/tabbed wrapping and the wider reference/device gates remain open.

The [native character milestone](../native-character-shaping.md) adds exact-face OpenType switches and character transforms to the shared measurement/placement/ink/input/PDF authority, with independent line struts and source-range decorations. This advances the same estimate from ~28% to ~31%. It does not certify the whole shaping capability: fallback, variable/language/complex-script policy, advanced wrapping, off-frame ink, PDF reader compatibility and physical devices remain open.

The [native keep milestone](../native-paragraph-keeps.md) connects All/Next1 to measured unequal-column reflow, local relaxation, source/history and publication. It advances the same estimate from ~31% to ~33%; partial/count/chain/start policies, wrapping interactions and the complete reference/device gates remain open.

The [native PDF encoding correction](../native-pdf-encoding.md) improves eligible PDFKit source copying/search without repainting, with explicit original-byte fallback for ambiguous literal/ASCII cases. This is a correction within the existing composition/publication foundation; the overall estimate remains ~33%.

The [native word-spacing milestone](../native-word-spacing.md) adds measured minimum/desired/maximum preferences, soft-bound full and condensed-final composition, source-correct carets, paragraph/style controls and selectable PDF. Actual editor tests cover range isolation, one-step undo, paragraph entry, full-paragraph paste capability promotion and cold archive10 reopen. This advances the same estimate from ~33% to ~35%; letter/glyph constraints, hyphenation, the complete paragraph objective, wrapped/script-specific spacing and devices remain open. It does not certify the justification capability.

1. Complete paragraph composition: custom/decimal/right-indent tabs and leaders, justification constraints, hyphenation, keeps, grids and native wraps.
2. Complete shaping/source maps: fallback capture, full OpenType/variable/language support, bidi/complex scripts/CJK and deterministic cross-device behavior.
3. Structured text and layout: tables, lists/numbering, anchored objects, paths, notes, fields and the page/parent scheduler.
4. Editorial and publication systems, including scoped search/proofing, references, generated matter and accessible reading order.
5. Physical Mac/iPhone/iPad input, IME, accessibility, performance, persistence and comparative reference qualification.

Source contracts and test evidence remain in the programme and [verification record](../verification.md). Update the estimate only when an engineering milestone materially closes these dependencies, explaining the reason and retaining prior scope. App appearance has its own backlog and should not inflate this text-engine estimate.
