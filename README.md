# Ivo

A personal atlas of rich documents and connected ideas. An original, local-first editorial prototype inspired by magazine composition and informed by a documented study of Obsidian 1.15.0.

## Run

Requires Node.js 22 or later. No package installation is needed.

```sh
npm run dev
```

Open `http://127.0.0.1:4173`. Use `PORT=4174 npm run dev` to choose another port. Browser data belongs to that origin: switching hostname, port, or browser creates a different local atlas.

```sh
npm test
npm run build
```

`dist/` is a static web app suitable for HTTPS hosting. `dist/Ivo.html` is an additional single-file build; browsers differ in whether they permit persistent storage on local files. The served app is the primary development path.

## First edition

- Create editorial, essay, and blank documents; edit text directly on the page.
- Compose on a 12-column grid. Move and resize blocks, change typeface/size/alignment, and adjust image crops and captions.
- Upload images and PDFs. Original upload bytes are saved locally and included in atlas backups.
- Link documents with the link tool or `[[Document title]]`; use tags, nested tags, aliases, backlinks, and title/body search.
- Explore the mandatory global/local graph, with tag nodes, neighborhood depth, filtering, pan, zoom, and node dragging.
- Autosave to IndexedDB; undo/redo within a document session; restore up to 20 editing-session snapshots.
- Export/import a complete JSON atlas. Export a readable Markdown document, with layout and local asset packaging limitations described below.
- Read a reflowed page on narrow screens. Desktop editing retains the composition grid; on a phone, this grid scrolls horizontally.

The six example documents are original demonstration content. Sample photographs are credited in [asset-attribution.md](docs/asset-attribution.md).

## Ownership and present limits

This prototype stores documents **in your browser**, not in a filesystem vault. Export backups regularly. Clearing site data removes that browser's atlas. No document content is sent to an Ivo server. External sample images are fetched from Unsplash; user uploads stay in local storage.

Google Drive/Dropbox sync, native filesystem storage, concurrent editing, PDF annotations/editing, audio/video blocks, mathematical rendering, citations, and full Obsidian import are **not implemented**. A responsive page is not cross-device sync. Backups can be transferred manually.

The graph currently displays at most 500 nodes, including tags. Its physics runs in a worker and settles when idle. Larger-vault speed and physical-phone behavior still need measurement. Editing uses a deliberately small native rich-text layer; robust IME, advanced paste, tables, and full document transactions need a mature editor integration.

The link tool stores stable document IDs and survives renames. Typed wiki links resolve by current title/alias; changing a title can leave a typed link unresolved. Heading/block syntax contributes to document-level relationships but does not yet jump to a heading or embed another document. Unresolved links are recorded by the model and styled in reading view; they are not yet graph nodes.

Markdown export preserves reading order and basic formatting, but cannot represent editorial layout. Media references point to companion asset paths; use the JSON atlas for a complete restorable backup. Version history is local and excluded from the archive.

## Reference and design documents

- [Obsidian behavior and acceptance reference](docs/obsidian/behavior-reference.md)
- [Inspected architecture](docs/obsidian/architecture.md), [evidence ledger](docs/obsidian/evidence-ledger.json), and [sources](docs/obsidian/sources.md)
- [Runtime observations and REA limitations](docs/obsidian/runtime-verification.md)
- [Ivo architecture and data contract](docs/architecture.md)
- [Visual direction and MVP scope](docs/design.md)
- [Development roadmap](docs/roadmap.md)
- [Verification record](docs/verification.md)

This is a bounded reference investigation, not a reconstruction of every Obsidian subsystem. Obsidian's proprietary code and artwork are not included in Ivo. All implementation here is original.
