# Ivo release text parity

The [current development state](../development/STATE.md) records the latest engineering estimate. Milestone updates report progress toward the [63 release capabilities](text-parity-programme.md#capability-acceptance-ledger), including their editing, layout, export and device checks.

On 20 November 2026 the estimate was rebased from **~48% across the original 66 capabilities** to **~50% of Ivo release text parity**. Three largely unfinished specialist publishing capabilities moved to the [broader-edition wishlist](text-parity-programme.md#broader-edition-wishlist). The same implementation and verification evidence underlies both estimates. As a rough check on the scale of the adjustment, 48% × 66 / 63 is about 50%. The individual capabilities vary in size, so future estimates still require engineering judgment about the work remaining.

## Page tables, index references and portable preflight profiles

A document can now contain editable page tables. Double-click a cell to type. Tab and Shift-Tab move between uncovered cells. Tab at the end appends a row. Dragging a divider changes that column’s width. Shift-dragging transfers width to or from its neighbor while keeping the table width fixed. Column widths can also be set in points. [Adobe’s table resizing reference](https://helpx.adobe.com/indesign/desktop/add-tables-and-data/format-tables/resize-columns-rows-and-tables.html) Table Options supports structural edits, merging, splitting, headers, footers, inset, rule weight and vertical alignment. Pasting tab-separated spreadsheet cells expands the table as a single undoable edit.

A Mac editor fixture covers cell editing, divider cancellation, undo/redo, spreadsheet paste, reading view, locks and archive reopen. A second test writes a table into a disposable Mac vault, edits it through Ivo’s Swift iOS storage adapter, then reopens the vault on the Mac. PDFKit reads cell text from the exported PDF. The EPUB fixture inspects actual XHTML header cells, spans and escaped text. Table content extending below its frame is reported by Preflight and PDF export. The same editing fixture ran inside the iOS WebKit view on disposable iPhone and iPad simulators. These checks use scripted input. Physical touch, hardware keyboard and IME qualification remain open. Tables remain independent page objects. Rich text and nested selections inside cells, table and cell styles, flowing tables across pages, and repeating header and footer rows still require implementation.

Generated indexes now support custom sort keys and See/See also entries, including destinations under a parent topic. Each reference links to the first printed page of its target. Indexing also searches printed table cells. Preflight profiles can be exported, validated and imported under a new name.

Of the 63 included capabilities, 31 are recorded as foundations, 18 as partial implementations and 14 as open. This gives a reproducible breadth measure of **49/63 with implementation evidence**. The previous ~90% was an informal engineering estimate. The ledger does not provide a verified fraction of total effort or a basis for declaring 95% or 100%. See the remaining acceptance criteria for each capability.

## Preflight profiles for print layouts

**Release estimate ~90% across 63 capabilities.** Preflight now locates broken page references and checks the effective resolution of a placed picture at its printed size. The same artwork can pass at one size and fail after enlargement. The Print preset uses 300 ppi. Named local profiles control six checks and the minimum resolution. In the Mac editor a 72-pixel square in a 144-point frame measured 36 ppi, passed a 30 ppi threshold and failed at 150 ppi. Undecoded images and unavailable layout appear as incomplete checks. Profile exchange and color/separation checks remain open.

## Subject indexes

**Release estimate ~89%.** Generate Index searches for the exact words or phrases specified at the last level of each topic path. Printed occurrences are grouped by topic, sorted and linked to their pages. Ranges end at section boundaries. Generating again updates the selected index and excludes generated material. The five-page editor fixture checks overlapping terms, formatted phrases, duplicates, overset text, and a removed reference. Independent PDFKit inspection verifies the two destinations of a printed range. Individual persistent index markers, custom sort keys, See/See also references and book-wide indexing remain open.

## Generated tables of contents and page links

**Release estimate ~88% across 63 capabilities.** A single document can generate an editable contents flow from visible headings and named paragraph styles. Placement, regeneration, undo, section folios and persistent settings are exercised in the editor. PDFKit verifies that a linked folio goes to the printed page containing the heading, including a continuation frame in an ordered book. Overset headings are excluded. Page links also work independently through Insert > Page Link. Book-wide contents, named anchors and cross-reference formats remain open.

## Placed picture outlines, parent fields and heading bookmarks

**Release estimate ~86% across the same 63 capabilities.** The picture and parent-field milestones account for the intermediate estimate of about 84%. The remaining progress covers working case conversion and nested PDF heading destinations. The document zoom limit is separate from the text estimate.

- Placed images can use transparency or detected edges on a light background. Include Inside Edges lets text into a cutout. The editor and PDF use the placed picture’s crop, masks and signed offset. A 2048-pixel ring fixture exercised the editor controls. The PDF test measures glyph positions in the opening with the option on and off. Sampling starts at a maximum of 512 pixels per side and reduces detail for complex artwork. Embedded Photoshop paths, custom thresholds and editable outlines remain open.
- On a parent page, Insert running text adds the current folio, last folio, section marker or document name. Independent PDFKit inspection found selectable printed footers on two consecutive pages with section numbering. Overriding the parent frame on a page turns the displayed value into local editable text. Inline flow variables and style-based running headers remain open.
- The Type menu changes the case of selected characters. The editor test changes part of a bold run and undoes it in place. The language tests cover Turkish dotted I, Greek final sigma and German sharp S.
- PDF bookmarks nest headings within their printed pages and chapters. PDFKit verified a paragraph-style heading that flowed onto a second page, nested semantic headings and the omission of a heading beyond the final frame. Printed contents pages, index generation and tagged PDF remain open.

## Word breaks, shared styles and numbered publications

**Release estimate ~81% across the same 63 capabilities.** This pass moved from ~73% through ~77% with stylistic sets, editorial reading order and Data Merge. The further gains cover document hyphenation, reusable styles, section numbering and fixed-page book export. These are engineering estimates of scope covered. Side-by-side composition and physical input acceptance remain open.

- The document dictionary records a word’s allowed breaks or forbids breaks, independently for each language. Both native composers immediately recompute threaded text after an edit. Changing or undoing an entry preserves the original characters. Czech joins the offline pattern dictionaries. A language without built-in patterns can still use authored entries.
- Load Text Styles imports selected paragraph and character definitions from another document in the vault. Based On and Next Style dependencies are included. A conflict can keep the local definition, replace it under the same ID, or give the incoming definition a distinct name. The Mac editor exercised the dialog, undo and redo.
- A section can restart or continue numbering, add a prefix and use Arabic, Roman, alphabetic or zero-padded folios. A saved prefix can be hidden. The start stays on its page through reordering and survives automatic text shrinkage. A PDF book uses its saved chapter order. An independent PDFKit read verified a Unicode chapter name, nested bookmark destinations and three folios: `i`, `A–7`, `A–8`. A windowless InDesign 22.0 comparison also exercised both kinds of page deletion. Removing the first page preserves its section when the successor has none. Deleting a later section start resumes the preceding numbering. Alphabetic folios roll from Z to AA. A folio in the Pages panel or PDF reader does not add a printed page-number marker to the artwork.
- A built-app test imports a two-record data file through the document menu, checks the preview, rejects a malformed second record, then reopens the original template and both formatted results from storage.

## Font alternates, book order and merge records

**Release estimate ~77% across 63 capabilities.** The Mac editor exercised a selected stylistic set through native shaping, caret placement, editing, undo and reopening. The CMU Serif substitutions for Á and É matched independent HarfBuzz glyph IDs. The Explore More Type Options control offers the numbered sets declared by a face.

Publication order stores the order of whole threaded passages and illustrations, exclusions, book chapters and heading levels for named paragraph styles. EPUB resolves links against the chosen chapters. Missing chapters stop export. A two-page template produced independent editable records with split-style placeholders, literal multiline Unicode values and masked vault images. Its reordered two-chapter book passed EPUBCheck 5.4.0 without errors or warnings. Multiple records on one sheet, synchronized styles across book documents, in-document generated contents and tagged PDF remain open.

## Structured text and reflowable publishing

**Ivo release text parity is estimated at ~73% across the same 63 capabilities, up from ~65%.** This is an engineering estimate. The largest gains are in structured paragraph editing and publishing. Specialist language exemptions and the release denominator are unchanged.

- Native flows support left, center, right and decimal stops with custom alignment characters and patterned leaders. The live type controls, named styles, undo, archive reopen, selectable decimal positions and independently rasterized PDF leaders were exercised. An editor test exercises dragging stops, cancelling, removing a stop and repeating it to the active column edge. Right-indent tab characters and magnetic panel placement remain open.
- Ordered and bulleted paragraphs have editable levels, restart and continue commands. A numbering sequence can continue across ordinary paragraphs in one flow. Markers have their own paint and caret mapping. Named counters spanning separate flows and compound numbering remain open. A Mac and a headless iPhone 17 Pro simulator produced the same source ranges and outlines on all 36 combined tab, leader and list-label layouts. The largest numeric geometry difference was below 0.00004 pt.
- A paragraph style can specify its successor. Return at the end of a paragraph advances to it. Apply Style Sequence formats existing consecutive paragraphs in one undo operation. Style references survive document duplication and vault import.
- Page margins, grid-aligned Center, Bottom and Justify and the bottom inset were checked against InDesign. All 760 clear-frame cases and 396 earlier grid and wrap cases matched. Overlapping objects matched 104 of 120 cases. Page three of the six-page fixture separates paragraph-composer line choices from contour geometry. See [frame composition](../frame-composition.md).
- Desktop Check Spelling uses the system dictionary for suggested corrections, Skip, Ignore All, Change and Change All. The editable range and history are shared with Find/Change. A dockable Preflight panel reports overset text, incomplete layout and missing vault resources. Its Digital publication profile also checks document links and image descriptions.
- Reflowable EPUB export includes linked chapters on request, chapter and heading navigation, actual text and lists, and cropped, masked illustrations. Hidden source stays out. The test export passed EPUBCheck, with zero errors and warnings. Tagged PDF, reading-order authoring, advanced preflight and independent physical reader and phone qualification remain open.

## Editorial search and frame grids

**Engineering estimate on the 63-capability release scope is ~65%, up from ~60%.** Editorial search adds an estimated two points. Frame grids and grid-aware wrapping add three. The estimate includes the remaining structured text, font, publishing and physical-device work.

- Edit → Find/Change supports Text and GREP, named queries on this device, and searching or changing character formatting. A saved query can target a named paragraph style or apply a named character style. Captured groups carry their formatting and links into reordered text. Change All creates one undo entry across eligible flows. Tests cover protected ranges, stale results, paragraph/soft returns, zero-width matches, query cancellation, time limits and a match spanning two native pages. Advanced ICU syntax, glyph-ID search, spelling and searches spanning documents remain open. [Adobe GREP workflow](https://helpx.adobe.com/ca/indesign/desktop/language-and-proofing/glyphs-characters-and-expressions/find-and-replace-with-text-patterns-grep.html)
- Native text flows support different grid spacing in each frame and wrapping around an object while the lines stay on the grid. A comparison with InDesign matched 168 of 168 aligned layouts. Independent PDF checks also measured the words that move to the side of an obstruction. The comparison and the separate unaligned controls are described in [frame composition](../frame-composition.md#custom-frame-grids-and-wrapping-objects).

## Magazine columns and long notes

**Engineering estimate on the 63-capability release scope: ~60%, up from ~50%.** The estimate reflects new editing, composition and export behavior and cross-device evidence. A fixture match rate measures that test corpus only.

- **Column fitting.** Word spacing, letter spacing and glyph scaling each have minimum, desired and maximum settings in native flows. The editor and selectable PDF use the same fitted positions. A one-character edit and all five resulting line endings matched InDesign. Ivo reproduced every line ending in 28 of the original 30 magazine layouts, up from 16. Across an additional 180 previously unseen layout cases it matched 141. Narrow columns can still choose a different set of lines. [Justification measurements](../native-word-spacing.md)
- **Frames and grids.** Moving text to the center or bottom of a frame recomposes it around the wrap geometry. All 66 rectangular-wrap cases matched the reference line endings. Some sloped outlines still differ. Vertical Justify and its paragraph spacing limit matched all 108 qualified reference layouts within 0.05 pt. Document baseline alignment matched 108 further opted-in cases across three columns and two pages. Page-relative grids currently support top-aligned native flow. Frame-level grids, rotated frames and combining grids with overlapping objects remain open. [Frame qualification](../native-object-wrap.md) · [Grid qualification](../frame-composition.md)
- **Language.** Six widths and two composers reproduced every line ending for one word each in Spanish, Italian, Modern Greek, Russian and Turkish. British English matched five of twelve, for **65/72** total. The actual export also preserved Czech and Hungarian example text. Automatic dictionaries for those two languages, fallback between fonts, and broader prose samples remain open.
- **Variable fonts.** The editor uses exact declared coordinates from the bundled or vault font in its outlines, line widths and caret positions. The weight slider, undo and archive reopen were exercised with Geist. An independent PDF reader found each repeated word at three weights and measured its ink and selection width. Named and interpolated weights were tested. Broader multi-axis and optical-size qualification remains open.
- **Find/Change.** Literal text, paragraph returns and tabs can be found forward or backward within the document, active flow or selection. Tests covered a selection crossing linked pages, styles and links, protected content and a 500-paragraph Change All reverted with one Undo. GREP, glyph/format searches, spelling and saved queries remain open.
- **Apple runtimes.** The Mac and iPhone simulator replayed 363 synthetic native editor requests. All 233 final layouts had identical outlines and source breaks. The largest numeric difference across layout and measurement was below 0.00015 pt. The iPhone and iPad simulators separately opened a two-page note in Ivo’s WebKit editor, drew the selected variable fonts, exported a native PDF and recovered the same six lines after cold relaunch from their own local vaults. These checks exercised the bridges and storage. Physical touch, keyboard and Pencil input remain open.

## Earlier estimates on the original scope

The two nonbreaking spaces now bind words across linked columns and take their distinct widths in justified text. Fifty reference layouts matched their row endings, columns and baselines. Two equivalent fixtures differed at the final invisible caret. PDF selection and in-frame authoring bring the estimate to **~43%**.

An authored discretionary line break now offers a wrap position inside a word or reference. The original character survives editing and reopening. Nine reference layouts matched InDesign, and an independent PDF reader verified the visible lines. The estimate moves to **~42%**.

The **Keep Options** command edits multiple selected paragraphs in a single undo step. This improves the existing paragraph controls and leaves the overall estimate at **~41%**.

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

## Earlier composition milestones

The [frame-scheduling milestone](../native-flow-scheduling.md) fits unequal native columns with exact line metrics, one owned break/baseline plan and cooperative preparation/search. It advances the same broad estimate from ~24% to ~26%; the justification objective and reference/device gates remain incomplete.

The [native-wrap milestone](../native-object-wrap.md) integrates planned exclusion fragments with one physical navigation row, pointer geometry, source/history and independent selectable PDF. The shared contour fix and interval sweep improve both composers. This advances the same estimate from ~26% to ~28%; mixed-metric native rows, centered/tabbed wrapping and the wider reference/device gates remain open.

The [native character milestone](../native-character-shaping.md) adds exact-face OpenType switches and character transforms to the shared measurement/placement/ink/input/PDF authority, with independent line struts and source-range decorations. This advances the same estimate from ~28% to ~31%. It does not certify the whole shaping capability: fallback, variable/language/complex-script policy, advanced wrapping, off-frame ink, PDF reader compatibility and physical devices remain open.

The [native keep milestone](../native-paragraph-keeps.md) connects All/Next1 to measured unequal-column reflow, local relaxation, source/history and publication. It advances the same estimate from ~31% to ~33%; partial/count/chain/start policies, wrapping interactions and the complete reference/device gates remain open.

The [native PDF encoding correction](../native-pdf-encoding.md) improves eligible PDFKit source copying/search without repainting, with explicit original-byte fallback for ambiguous literal/ASCII cases. This is a correction within the existing composition/publication foundation; the overall estimate remains ~33%.

The [native word-spacing milestone](../native-word-spacing.md) adds measured minimum/desired/maximum preferences, soft-bound full and condensed-final composition, source-correct carets, paragraph/style controls and selectable PDF. Actual editor tests cover range isolation, one-step undo, paragraph entry, full-paragraph paste capability promotion and cold archive10 reopen. This advances the same estimate from ~33% to ~35%; letter/glyph constraints, hyphenation, the complete paragraph objective, wrapped/script-specific spacing and devices remain open. It does not certify the justification capability.

## Remaining release work

1. Complete paragraph composition: custom/decimal/right-indent tabs and leaders, justification constraints, hyphenation, keeps, grids and native wraps.
2. Qualify font fallback, OpenType, variable fonts and source mapping for the [early language priorities](text-parity-programme.md#early-language-and-math-priorities). The release includes ordinary mixed-script editing and later equation layout. The three specialist publishing capabilities stay on the broader-edition wishlist.
3. Structured text and layout: tables, lists/numbering, anchored objects, paths, notes, fields and the page/parent scheduler.
4. Editorial and publication systems, including scoped search/proofing, references, generated matter and accessible reading order.
5. Physical Mac/iPhone/iPad input, IME, accessibility, performance, persistence and comparative reference qualification.

Source contracts and test evidence remain in the programme and [verification record](../verification.md). Update the estimate only when an engineering milestone materially closes these dependencies, explaining the reason against the release scope in effect. Record any explicitly agreed scope change separately from work delivered. App appearance has its own backlog and should not inflate this text-engine estimate.
