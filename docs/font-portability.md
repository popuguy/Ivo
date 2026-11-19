# Font portability

New documents start with Minion Pro Regular at 12 pt, with 120% automatic leading and 0 pt before and after paragraphs. The new document’s [Basic Paragraph] style supplies these settings to subsequent frames and flows. Templates carry their own style definitions through duplication. Existing documents keep their authored typography.

Ivo first looks for the exact MinionPro-Regular face in the vault. The Apple bridge can supply a locally available face, including Minion from an existing Acrobat or InDesign installation on macOS. Ivo validates and saves it before creating the document. The app ships CMU Serif for devices and vaults without Minion. The interface uses Geist.

The picker combines shipped faces, faces contained in the vault and currently available system faces. Available families are represented by their individual named faces, including Medium/Semibold and italic variants. **Refresh installed fonts** updates the catalog. Fonts already contained in the vault remain usable when they are absent from the device.

## Persist before use

The installed-font catalog contains metadata and temporary picker identities only. Choosing a face reads that exact registered PostScript identity through a narrow native bridge, validates its SFNT metadata and browser decoding, then saves its bytes through the existing immutable vault asset transaction. Only after that acknowledgment does the editor write a `font-<SHA-256>` reference into source. Repeated use deduplicates by content. A failed save or a changed selection never applies the delayed font to another range/object. Font choice is one undo transaction.

Real bold/italic companions are packaged as needed. Rendering preserves an explicitly selected Medium/Semibold face, with bounded companion registrations rather than a Cartesian FontFaceSet for each family. Variable-font instance coordinates are retained when they differ from the font defaults; automatic weight/optical-size behavior is not pinned to default coordinates.

Older Georgia/Helvetica presets are also portable. Preparing a document adds the relevant family faces to the vault without changing document text or formatting. Those resources satisfy the existing preset names in the renderer and are included in archive/PDF sharing. Font preparation belongs to the current writer and joins pending-work/close fences; passive windows do not write resources.

## Owners

- `src/platform/apple/SystemFonts.swift`: Core Text catalog and exact-face export, shared by desktop/iOS. Original single-face bytes are preserved. Collection/resource faces preserve their tables in a standalone SFNT with reconstructed offsets and checksums.
- `desktop/native/font-catalog.swift`, `desktop/system-fonts.mjs`, preload/main: read-only catalog/face bridge. Renderer requests contain installed PostScript names, never paths. The helper is compiled/unpacked/verified during desktop packaging; it does not install or alter system fonts.
- `features/editor/assets/installed-fonts.js`: validate, persist, deduplicate and resolve a font selection through injected native/asset ports.
- `domain/text/font-catalog.js`, `font-references.js`: picker identities, shipped/legacy mappings and resource discovery.
- `rendering/text/fonts.js`: disposable FontFace registrations; document source remains authoritative.

System picker IDs never enter the saved format. This increment retains archive 6 / canvas 5 and native manifest 1. A font-bearing archive requires schema 6 even when the document source is older. No cloud provider or global permission setting is changed.

## Verification and limits

Isolated tests cover the full installed catalog, real single/collection face export, SFNT checksums, font choice, selected-word formatting/undo, real companions, immutable deduplication, failed saves, late-selection guards, vault reload and existing preset preservation/sharing. Native pointer review selected Graphik Medium from the populated picker and verified the resulting page and Properties value. Font files, catalogs and screenshots from the machine remain outside Git.

The existing editable-embedding metadata gate and 30 MB per-asset / 100 MB archive resource budgets remain in force. Some system faces cannot be included under those constraints; selection reports the problem and preserves the previous font. Direct collection-file/WOFF imports, full fallback-glyph font capture and physical iPhone/iPad testing remain open. Browser-only builds retain shipped/vault fonts and manual imports; automatic OS enumeration uses the Apple native bridge.
