# PDF sharing

The Mac application exports a frozen document from **File → Export PDF…** (⌘⇧E) or Document options. Include linked documents follows outgoing stable-ID/wiki links recursively, once per document, in deterministic order. Each document contributes its actual pages. Export flushes pending input/media first and makes no document/history change. A canceled Save panel writes nothing.

The editor and export view share authored object markup and typography in `src/rendering/page-content.js`. The export renderer has no editing UI, camera transform, source scripts, network requests or PDF viewer. It loads original atlas images and bundled fonts, waits for decoding/font readiness, and prints browser-shaped text and vector paths. A 4/3 CSS layout zoom maps the editor's logical pixels to authored physical points, including rich spans, captions and nonuniform point type.

Electron45.2.2 prints named pages with differing sizes. Its measured rounding (for example800.25×500 becoming799.91998×499.91998) is corrected by `desktop/pdf-export.mjs`, using pinned MIT-licensed pdf-lib1.17.1. The final MediaBox/CropBox matches authored dimensions; content receives only the corresponding small origin translation. Text is neither photographed nor redrawn with a second font-layout engine.

Links are rebuilt from semantic targets and measured visible line rectangles. Included document targets become PDF page destinations; HTTP(S) links become URI annotations. Outside/unresolved targets remain visible text and are reported after export. Rectangular frame/page clipping restricts hit regions. A link line crossing a polygon mask is conservatively omitted and reported; fully contained lines retain links, including nested masks. Native print annotations are removed before rebuilding, so local file/Ivo URLs and invisible browser annotations do not leak into clickable regions.

The PDF is written atomically to the user-selected path. A separate sandboxed/context-isolated renderer has a temporary nonpersistent session, narrowly guarded snapshot/result IPC, restrictive content policy and no external navigation. The owner waits for an active export before closing. The normal atlas and original media are not rewritten by export. JSON backup remains the editable archive.

## Verification

`npm run test:pdf` builds and exports a real three-page fixture:612×792,800.25×500,300×400. Tests check exact final dimensions, linked closure, bidirectional internal destinations, external URI, safe omission at a mask, unchanged snapshot and rendered glyph position. It includes CMU regular/bold/italic/bold-italic, Greek/accented Unicode, rich color/size, nonuniform point text, paragraphs, a clipped text link, polygons and a cropped1024×512 original image/caption. Pure tests cover validation, source immutability and concave/self-intersecting link masks.

Independent pypdf/pdfplumber checks found all four embedded CMU TrueType subsets with ToUnicode, selectable `Alpha Ω café`, source image dimensions1024×512, x≈71.999997pt for an authored72pt glyph and font size≈19.995pt for20pt browser text. Every page was rendered with Poppler and visually inspected. These tolerances describe the browser's text/print quantization, not perfect Illustrator glyph metrics. The renderer capture and PDF agree in layout; no print chrome or extra pages appeared.

Native CUA in a separate Ivo PDF Test app/profile/atlas checked File hotkey, Save, Cancel, linked inclusion and the three-page result/warning. The output's dimensions were independently checked and original test documents/assets remained byte-equivalent through the vault. The test app was closed; the normal Ivo session/atlas were untouched. Private ledgers: parent `work/pdf-export/{structure-verification,native-verification}.json`.

## Explicit remaining work

- PDF-within-PDF composition is canceled. New PDF placement and the embedded viewer are removed; old records show recoverable original-file attachments. Export rejects those legacy objects clearly. See [compatibility cleanup](link-previews.md).
- External images must first be stored in the atlas. Export does not silently fetch remote content. Original source resolution is used; the PDF engine may re-encode image bytes.
- Source page/region targets and richer PDF navigation depend on the linked-page target model. Current portable destinations are documents' first included pages.
- Link rectangles intersecting a polygon boundary need more precise polygon/quad annotation support if retaining those partial links becomes necessary.
- Tagged PDF generation is experimental and does not establish PDF/UA or accessibility conformance. Spot colors, CMYK/ICC, bleed, crop marks, PDF/X and prepress are not implemented.
- Export is capped at256 pages. Large media/page stress, crash recovery and independent viewers need broader testing.
- Native Save-panel menu actions use macOS roles, with a first-responder fallback for commands received during a native dialog. Save-panel Select All works from the native menu. Repeated automated ⌘A did not select the filename, without reaching the custom menu handler; physical keyboard/OS-responder validation remains open. Explicit native accelerators and unchanged-state menu guards do not by themselves prove that gap resolved.
- iPhone/iPad export is not implemented. The planned separate WKWebView vector-PDF capture/assembly needs full Xcode and device fidelity tests; synchronized web assets are not a mobile export claim.

The route and its boundaries follow the version-pinned [Electron print API](https://github.com/electron/electron/blob/v45.2.2/docs/api/structures/print-to-pdf-options.md), [named-page specification](https://www.w3.org/TR/css-page-3/#using-named-pages), [Skia PDF design](https://skia.org/docs/dev/design/pdftheory/) and the actual output checks above. Native menu roles and first-responder actions follow [Electron's menu documentation](https://www.electronjs.org/docs/latest/tutorial/menus) and [Menu API](https://github.com/electron/electron/blob/main/docs/api/menu.md); those sources are not proof of this host's automated shortcut behavior.

## Flowing notes

Continuous text flows are composed before page rendering inside the isolated export snapshot. Derived rich fragments, including numbered-list/paragraph context, use the editor typography. Automatic pages added for export never change the atlas. A manual text flow with overset text produces a warning; the canonical source remains in its editable document. The fixture exports24 rich paragraphs across12 exact360×300pt pages. Independent extraction matches canonical text after NFKC/whitespace normalization (CMU fl ligature), with each paragraph present once, and every page was rendered for visual review. See text-flow.md for current Document text editor/inline and composition limits.
