# Ivo architecture and data contract

Schema version: **1**. Implementation: dependency-free browser ES modules, IndexedDB, a canvas graph, and a module worker. Static hosting is sufficient. `scripts/portable.mjs` also bundles the modules into scoped closures for a single-file build; source modules remain authoritative.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `model.js` | Document construction, link resolution/indexing, tag/text search, archive validation, Markdown interchange |
| `storage.js` | IndexedDB transactions for documents, original assets, and session snapshots |
| `sanitize.js` | Allowlisted HTML, safe URL handling, display of wiki links using the same resolver as the index |
| `app.js` | Document editing, layout manipulation, navigation, persistence coordination, export/import |
| `graph.js` | Derived graph selection, canvas rendering, camera, gestures, accessible companion navigation |
| `graph-worker.js` | Bounded force simulation and transferable position buffers; no document mutation |
| `seed.js` | Original demonstration documents and templates |

The authoritative relationship is in document content. Backlinks, tag counts, and graph edges are derived. Graph coordinates are session view state, separate from editorial block coordinates.

## Document

```json
{
  "id": "doc-immutable-id",
  "title": "A thought",
  "kicker": "FIELD NOTES",
  "subtitle": "An introduction",
  "tags": ["form/structure"],
  "aliases": ["An alternate title"],
  "layout": {"columns": 12, "rows": 36},
  "blocks": [],
  "createdAt": "2026-11-04T00:00:00.000Z",
  "updatedAt": "2026-11-04T00:00:00.000Z",
  "version": 1,
  "template": "editorial"
}
```

IDs are stable, unique alphanumeric/underscore/hyphen strings. The `version` counter is a local revision counter, **not** a conflict-resolution clock. Rename changes `title`; ID-backed links remain valid. Typed wiki links resolve by exact ID, then case-insensitive unique title, then unique alias. Ambiguity stays unresolved. Tag search includes slash descendants and respects boundaries (`form` includes `form/structure`, not `formal`).

## Block and asset

A block has `id`, `type`, `x`, `y`, `w`, `h`, plus typed content and styling. Geometry is 12 columns by 20–100 rows, with a 22px row in the desktop renderer. Blocks must stay within the page. Text uses sanitized rich HTML plus `textStyle`, `fontSize`, and `align`. Image/PDF placements use `src`, `caption`, `alt`, `fit`, and `crop` percentages. Current types are `text`, `image`, `quote`, `pdf`, `rule`, and reserved `equation`/`citation` types.

An asset has `{id, name, mimeType, data}` where `data` is a validated base64 image/PDF data URL. A placement references it as `asset:<id>`. Multiple placements can share an asset while cropping independently. External image URLs are supported for demonstration content and are not copied into a backup.

`extensions` can retain bounded JSON scientific metadata. Future equation source, citation identifiers, figure provenance, and PDF page/region coordinates belong here or in new typed block contracts with a schema migration. The MVP displays reserved scientific blocks as placeholders; it does not imply math rendering or citation management exists.

## Archive

`{schemaVersion:1, exportedAt, documents:[...], assets:[...]}` is the complete portable atlas payload. Import validates IDs, dates, geometry, enums, URL schemes, asset references, MIME consistency, data bounds, and unsafe content before committing documents/assets in one transaction. Existing IDs are replaced; history snapshots are made first. Nonmatching existing documents remain.

Limits: 5,000 documents; 1,000 blocks per document; 50,000 blocks total; 2,000 assets; 30 MiB per imported asset and 100 MiB total asset bytes. The upload UI is limited to 20 MiB per file. The file picker accepts JSON backups up to 120 MiB; base64 overhead means the practical atlas limit may be lower than the sum of model limits.

## Persistence and failure behavior

Writes debounce at 180ms and complete on IndexedDB transaction completion. Failed writes retain pending data and show a visible error. Navigation flushes pending writes. Unload protection is best-effort; a browser or OS crash can still lose an uncommitted edit. Session undo is held in memory. Up to 20 snapshots per document are stored at editing boundaries and before an import replacement or history restore.

The shell service worker uses a versioned cache and network-first retrieval with cached fallback. Documents and assets are never put in the service-worker cache. HTTPS/localhost are required for normal service-worker behavior. Externally hosted demonstration images are not guaranteed offline. Browser quotas, clearing site storage, private browsing, and multiple tabs are current constraints. There is no cross-tab write coordination yet.

## Performance and evolution

Text input updates the active DOM and schedules storage without rebuilding the page. Geometry drags update CSS variables directly. Graph physics runs off-thread, publishes positions, and stops after settling; drawing is invalidation-driven. Graph view is capped at 500 nodes, including tags. The MVP rebuilds a simple index on view changes; larger collections should replace this with incremental indexing and cached search results.

For durable desktop/phone ownership, introduce a filesystem-capable shell and storage adapter: per-document versioned JSON, separate content-addressed asset files, rebuildable metadata, and device-local workspace state. A Markdown projection remains useful for search and interchange, but cannot be the sole source for free editorial layout without a structured sidecar.

Drive/Dropbox synchronization must not sync a live IndexedDB or SQLite database file. Sync document revisions and asset objects, detect concurrent edits using base revisions, retain conflict copies, and use explicit tombstones for deletion. Start with foreground sync and visible state; mobile background execution and OAuth scopes need platform-specific investigation. CRDT/operation merging is a later decision to make after measuring real concurrent-edit needs.
