# Text formatting and document history

Implemented 6 November 2026, continuing the [interaction milestone](interaction-correctness.md). Paul explicitly authorized continuing through the ordered backlog without an approval/review stop at every increment. The interface and exact native text/gesture fidelity remain unfinished.

## One history and one command owner

`src/domain/history/document-history.js` owns an immutable per-document timeline for typing, composition, character/paragraph formatting, links, geometry and structural commands. Consecutive compatible insertions/backspaces can merge within 900 ms when their document and caret states are contiguous. A changed caret, different operation, explicit boundary or intervening edit separates them. New work clears the redo branch. Snapshots ignore revision timestamps for comparison; replay retains monotonically increasing saved revisions. The timeout is an explicit Ivo policy, not a measured Illustrator constant.

Text input is captured before the DOM edit, then committed through the same timeline as an object operation. Browser undo is retained for an inspector field while that field has uncommitted edits; once committed, document Undo applies even after Tab moves to another unedited field. Native and browser commands share the same logical ownership. Numeric Select All uses the input's own selection method. No physical undo/redo rail buttons return.

Undo/redo now applies synchronously to the existing editor/camera. It cancels unfinished pointer gestures and restores selection/tool/text bookmarks rather than destroying an editor after an asynchronous flush. Asynchronous navigation, mode changes, history restore and import submission are serialized with input suspended before their first wait. The outgoing editor is disposed while it still owns its original document. A delayed command cannot toggle the document opened by a later command.

Native menus cannot mutate the document behind an HTML modal or during composition/transitions. Their enabled states and operation labels follow the current history/context through a guarded main-frame bridge. Structural actions relinquish the old text owner; undo can restore that owner and selection. Composition is recorded as a unit; final connected DOM is read after blur, and flush waits for composition completion. Physical IME ordering remains an acceptance gap.

## Stable rich-text selections

`src/features/editor/text/dom-selection.js` accepts text-node and element-container carets, validates both range endpoints against the active surface, and records anchor/focus direction. Bookmarks contain a structural path plus logical text position, BR and paragraph boundaries. The logical fallback survives adjacent/empty text nodes being merged during HTML serialization. A stale range from a different frame is not reused.

Selected character changes reuse the live editable node. Range formatting wraps individual text leaves, preserving emphasis/links and valid paragraph structure across a multi-paragraph selection. Repeating an already-applied format makes no redundant history entry. At a collapsed caret, pending character settings affect subsequent typing. Whole-object selection changes the frame's typography; paragraph controls apply to the selected paragraph(s). Fitting a text frame updates geometry without losing its live edit. Link insertion also preserves the active surface and joins the document timeline.

Controls include font family/size, text color, leading, tracking, alignment and before/after spacing. Command-Shift-B/I/U formats bold/italic/underline; Command-Shift-L/R/C aligns paragraphs. Command-Left/Right and Command-Up/Down follow Illustrator's documented word/paragraph movement; Shift extends the selection. Native Return/Shift-Return retain paragraph/soft-break distinctions. Existing typography defaults are preserved. Explicit leading 0 selects 120% automatic leading; an absent value retains the old document style.

Manual pair kerning, baseline shift, advanced character/paragraph styling, hyphenation, advanced threaded inline editing, physical IME/RTL/accessibility and exact mixed-run native metrics are not completed. CSS leading/spacing is a bounded implementation; no full Adobe text-engine equivalence is claimed.

## Data/version boundary

The sanitizer accepts only explicit, bounded `data-ivo-*` typography on inert spans/paragraphs and regenerates its supported CSS. Arbitrary incoming position, URL, filter, event or script styling is not retained. Original words, inline emphasis, links, paragraph/BR source and IDs survive.

Documents using advanced typography have **canvasVersion 2**, carried in **archive schema 3**. Basic page scenes remain version 1/schema 2, and legacy archives remain readable. An early development version-1 scene containing these typography fields normalizes nonmutatingly to version 2. Older native clients reject the new document version rather than silently stripping its styling. Folder manifests retain schema 1; immutable revisions and original asset bytes remain unchanged.

Browser IndexedDB now uses **version 3** (version2 introduced typography; version3 adds text flows), preserving its existing document/asset/meta stores and closing stale connections. Older version-1/2 browser clients cannot reopen/write the upgraded database. Startup validates loaded documents/assets and rejects unsupported canvas versions before a legacy conversion. Keep a compatible backup and do not downgrade an upgraded collection.

## Evidence and verification

The [Illustrator baseline](illustrator/text-editing-baseline.md) separates primary documentation, shipped declarations and runtime gaps. The new native scripted fixture hit Illustrator error 1200/MRAP after creating an empty owned document; it produced no successful text trace. The error was acknowledged, the empty test document closed, Selection restored, and the temporary Finder window closed. Original documents remained open. No successful native comparison is inferred from that failed script.

- **99 Node tests pass**, covering history ordering/branching/immutability/merge boundaries, serialized transitions, bounded typography and forward version gates.
- `test:text` exercises the actual application with a disposable in-memory platform: typing/format/link/object history, forward/backward and root-container bookmarks, HTML normalization, range/paragraph scope, pending insertion style, native field Select All/Tab/Undo, modal menu state, composition, structural ownership, and deliberately delayed navigation while pointer input arrives.
- The prior interaction, scene, viewport and sharp-rendering fixtures pass. A scene regression showed Fit Frame prematurely ending text editing; the implementation now updates that geometry in place. First/settled zoom and independent-font captures remain pixel-identical in the rendering fixture.
- `test:browser-storage` upgrades a real isolated version-1 IndexedDB, retains documents/assets/history, closes the stale connection, rejects a version-1 reopen and round-trips version-2 typography.
- `test:native` passes the actual Swift Foundation byte adapter with rich typography, mixed-size pages, clipping, legacy documents/history and original assets. This does not verify UIKit or a physical iOS build.

Native CUA used only **Ivo Text Test**, `com.paulcantrell.ivo.texttest`, and `work/text-editor/{Atlas,Profile}`. Word replacement undid as a coherent operation and native Edit Redo reapplied it. A first inspector check exposed both numeric Select All appending digits and Undo after Tab targeting an old native field edit. Both were fixed, component-regressed, rebuilt and successfully retested. Native rapid redo→type→undo→undo→double-click selected Alpha without moving the frame. Right-click linking retained selection; native Edit Undo behind its modal did nothing; link Undo followed immediately by double-click selected bravo without movement. Save/quit/reopen retained only bravo at 28 pt inside the original 20 pt frame, complete source/bold/paragraphs, and unchanged text/polygon geometry. The test app was closed. Normal Ivo atlas/session and global permission settings were untouched.

Private logs, original/reproduction/reopened snapshots and reference identities are under parent `work/text-editor/`. Physical device/IME/trackpad evidence and complete Illustrator numerical/timing parity remain pending. Continue with PDF export and the next backlog dependencies; no user review stop is required for this checkpoint.

## Continuous text flows

Linked text flows now use canvasVersion3/archive4, one canonical source and the nonmodal continuous Document text editor. Text/page reflow joins the same history; the source owner is its stable text flow ID, independent of frames removed during shrink. See [text-flow.md](text-flow.md) for use, safe automatic pages, verification and explicit inline/native/device gaps. Independent rich text remains canvas2/archive3.
