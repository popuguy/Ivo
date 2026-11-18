# Architecture

Ivo is a shared document engine with platform-specific hosts. Precise page composition, long-form text and a document knowledge graph must survive changes to the interface and operate on Mac, iPhone and iPad. The browser build remains useful for development.

## Source structure

```text
src/
  app/                 window application, document session, passive refresh fencing, workspace/library command services
  domain/
    documents/         construction, schema, migrations, capabilities, scene commands,
                       text flows, copying/templates and library metadata
    geometry/          layout/snapping, selection and viewport math
    history/           document undo timeline
    knowledge/         stable links, search, backlinks, graph projection and ranking
    text/              pure rich-text inspection, typography constraints and glyph-scale math
    workspace/         tab/pane/navigation state, named layout snapshots, chrome preferences and spatial focus
  features/
    editor/            live DOM/pointer controller, image import, inspector
    workspace/         pure views, tab gestures, quick switcher, layout and menus
    graph/             GPU renderer, motion transport and module physics worker
    links/             reading-view previews
    export/            immutable PDF plan/renderer and Markdown serialization
  rendering/           shared object markup, page camera, typography and flow layout
  storage/             store facade, IndexedDB, file-vault transaction engine, save queue, profile workspace preferences
  platform/            native startup/lifecycle integration
  shared/              HTML sanitization, DOM text utilities, controls, reference icons, tooltips, async queue
  styles/              application styles and font declarations

desktop/               Electron main/preload, native windows, menus, vault byte IO and PDF
ios/                  Capacitor/Swift host, confined byte IO and lifecycle bridge
scripts/               builds, generated reference assets, offline shell and checks
tests/                 unit, runtime, native and frozen fixtures
```

## Dependency and ownership rules

The domain has no imports from the renderer, storage, platform, feature or application layers. Geometry and document commands are directly testable without a window. The knowledge index is derived from document sources; it never owns a second copy of the notes. Storage depends on the domain and its injected byte IO port. Shared utilities depend only on shared/domain modules; rendering depends only on rendering/shared/domain modules. Features use domain commands and supplied callbacks; application orchestration joins them. The module graph is acyclic. These are executable checks, not just directory conventions.

`app/main.js` only starts a window. `app/application.js` coordinates views and commands. `document-session.js` owns per-document undo instances, preservation of pre-upgrade revisions and the save lifecycle. `passive-refresh.js` owns delayed-read cancellation and generation fences across native writer handoffs. Pure workspace markup and inspector markup are separate from these lifecycles. The main editor controller retains tightly coupled live DOM, input/composition and gesture state so extraction does not replace that state on every frame.

Three distinct kinds of state must stay distinct:

| State             | Authority                                                                            | Lifetime / transport                                         |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Authored document | Stable document ID, pages, objects, canonical text flows, links, semantic extensions | Validated portable revisions; shared across devices          |
| Original assets   | Stable references plus content-digested bytes                                        | Immutable files; retain originals through masks/crops/copies |
| View state        | Tabs, splits, cameras, selections, local undo and window placement                   | Device/window-local; not cloud conflict resolution input     |

Canvas coordinates are fractional points. Pages may differ in size. Mask descendants retain local coordinates and stable vertex/object identities. Text flows keep one rich HTML source and ordered frame references; visible fragments and pagination are derived. Export works on a frozen snapshot. It cannot repaginate the live source as a side effect of printing.

## Persistence and native ownership

`storage/contracts.js` defines `VaultStore` and `VaultIO`. The shared file-vault engine validates references, hashes immutable objects, serializes changes and commits one manifest with an expected-hash guard. Desktop Node and iOS Foundation implement confined byte IO; neither interprets editor state. Browser IndexedDB uses transactional stores. A native initialization failure must not silently select an unrelated browser collection.

A native vault currently has one acknowledged focused-window writer lease. Passive windows refresh canonical data, fence late reads, and invalidate undo for externally changed documents. A failed save prevents handing the lease away. This solves local window ownership; it is not a multi-device synchronization protocol.

[Data formats](data-format.md) specify migrations. [The synchronization decision](decisions/0002-sync-boundary.md) describes the future Google Drive/provider boundary. Never use the document revision counter or modification time alone to choose a winner across devices.

## Build and checks

Served/native builds copy source ESM with original assets. esbuild follows normal imports for the standalone build, embeds font bytes and supplies an inline module worker. Offline shell contents and its cache digest are generated from the build tree. No file-order registry or import/export rewriting remains.

Prettier, ESLint, the architecture check, domain/storage regressions, real Electron interactions, native windows, PDF inspection and actual Swift byte interoperability cover different risks. See [verification](verification.md). Desktop and physical mobile rendering/performance still require measurements.

## Extension seams

| Backlog area                                | Extend here                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Richer curves, groups, transforms and masks | Versioned document scene commands/schema and geometry; editor tools/rendering consume them                     |
| Long notes, styles and advanced composition | Canonical text flows, typography/layout and live text controller; derived fragments stay disposable            |
| OCR and region links                        | Preserve asset originals; add versioned positional text and stable destination semantics before UI             |
| Google Drive / other providers              | Storage synchronization service plus a provider transport; validate through the same schema/IO contracts       |
| iPhone/iPad                                 | Shared domain/storage/rendering; native file picker/lifecycle and touch input in their platform/feature owners |
| Workspace reskin/navigation                 | Pure workspace state/views and editor inspector; preserve authored data and save ownership                     |
| Larger graph/media collections              | Derived knowledge indexing, worker/render budgets and lazy asset delivery; measure before claiming scale       |

These are implemented ownership boundaries, not placeholder implementations of the queued features. See the [complete backlog](backlog.md) for status and limits.

Named layout snapshots use domain/workspace normalizers and device/profile-local storage. They exclude source, media and live undo/input payloads. Logical library commands plan immutable metadata changes in `domain/documents/library-commands.js`; native and browser stores commit the document updates and explicit folder tree atomically through `changeLibrary`. Application services publish results only after persistence. See [workspace layouts/library operations](workspace-layouts.md).

Workspace group containers and visible tab controllers are retained separately, allowing sliding stacks without duplicating authored sources. Linked auxiliary views resolve stable source-tab identities. Incoming native window tabs pass through a view-only command and acknowledged, persist-first receiver. Context panel partitions and preset semantics live in domain/workspace; profile storage is injected into their retained UI controller. See [workspace views](workspace-views.md) and [panels](workspace-panels.md).

## Publishing increment

The [publishing foundation](publishing-foundation.md) adds domain-owned layers/parents/styles and typed text attributes. Parent-instance artwork, named-style CSS and column fragments are derived. Isolated parent editing commits through the same document history/save owner. Font bytes use the existing vault asset transaction before selection; renderers register imported faces without OS installation. The stylesheet entry declares legacy/base then publishing order explicitly. No Drive transport, proprietary composer or complete mobile input engine is implied.
