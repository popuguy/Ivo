# Page and object engine

`src/domain/documents/scene.js` owns pure page/object commands. `domain/geometry/` owns snapping, selection and camera math. `domain/documents/text-flows.js` owns canonical text threading. `domain/documents/schema.js` validates references and capabilities; storage uses it before committing. See [data-format.md](data-format.md) for the current writer and compatibility versions.

Pages have stable IDs and independent dimensions in points. Objects retain fractional x/y/w/h, a page ID and optional mask parent. Polygon vertices have stable IDs and normalized local coordinates. A mask carries clipped descendants; duplication remaps owned identities while retaining immutable original media. Page reorder/transfer changes containment and placement without duplicating canonical text.

`rendering/page-content.js` and typography/layout helpers supply shared authored markup to the editor and frozen PDF renderer. Camera translation and requested-scale painting remain separate. Selection controls, handles, guides, previews and inspector UI stay outside authored page content. Derived text fragments are never a second source of truth.

Legacy grid documents are upgraded without mutating the supplied original. A pre-upgrade revision is retained before the first edited replacement is saved. Existing native revisions and asset bytes remain immutable. A read migration alone never rewrites the vault.

The current engine supports translation, axis-aligned resize, polygon point editing, clipping trees, multi-selection, Option-drag copies, mixed pages and text threading. General affine matrices, arbitrary pivots/rotation/reflection, Bézier segments, persistent groups/isolation, region destinations and advanced composition remain extensions requiring explicit schema/command tests.

Quick switching, splits, tab/window navigation, document menus and library metadata are separate workspace features. They must not acquire ownership of page source. Tests cover domain/geometry commands plus real scene, interaction, text-flow, rendering and PDF paths; see [verification](verification.md).
