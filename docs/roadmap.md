# Roadmap

## 0.1 — author and connect

The implemented MVP validates the central experience: composed documents, images/PDF viewing, stable-ID links, tags/backlinks, a required global/local graph, local persistence, and portable archives. No subscription or app account is needed.

## Next — design with real material

Use representative pages from Paul's work and interests. Refine typography, default composition presets, image replacement/crop controls, mobile reading order, selection behavior, and keyboard navigation. Measure input latency, navigation, and graph behavior on the intended computer and phone. Add meaningful regression tests for selections, imports, reload recovery, and touch editing.

Replace the small native editing layer with a mature schema-based editor if composition/IME/paste testing warrants it. Preserve document IDs and typed blocks. Add keyboard block movement, recoverable document trash, cross-tab coordination, and automatic overflow feedback.

## Ownership and synchronization

1. Choose desktop/phone packaging after confirming the actual phone platform. Keep a common renderer and document model.
2. Store documents as individual open-format files with assets beside them. Add Markdown/Obsidian-vault import with an explicit compatibility report.
3. Implement **one** provider first, Drive or Dropbox, behind an adapter. Validate OAuth, offline work, foreground resume, interrupted transfers, renames, concurrent updates, asset deduplication, and delete/restore.
4. Preserve conflicted revisions and expose a clear recovery UI before describing sync as seamless. Offer Git-friendly text documents and separate transient workspace/cache state.

## Scientific and source support

Add equation blocks with editable TeX source and a renderer, citation keys/bibliography metadata, numbered figures, footnotes, and cross-references. Add PDF source-page viewing and region-linked excerpts before annotation editing. Keep annotations separate from original PDF bytes. Arbitrary PDF content editing is a larger subsystem, not an implied consequence of PDF embedding.

## Scale

Add incremental metadata/search indexing, lazy assets and thumbnails, a virtualized collection, and adaptive graph labels/spatial indexing. Establish budgets using 100/1,000/10,000 documents and representative asset volumes. Current worker design is a foundation, not evidence of Obsidian-scale performance.
