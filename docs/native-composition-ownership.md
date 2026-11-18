# Native composition and derived page ownership

Native text composition is an explicit per-flow choice under [archive 8 / canvas 7](data-format.md#native-flow-composition-capability). Canonical HTML remains the source of truth. Native layout is a replaceable projection over that source and exact font bytes; it does not replace the document model or undo with an attributed-string copy.

## Owners and boundaries

| Owner                                              | Responsibility                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `domain/documents/text-flows.js`                   | Source/thread commands, native opt-in, continuation ownership, stable generated IDs and explicit deletion policy |
| `domain/documents/schema.js` and `capabilities.js` | Closed format gate and portable source/reference validation                                                      |
| `domain/documents/derived-text-layout.js`          | Authored comparison projection and promotion of intentionally edited continuation pages                          |
| `domain/history/document-history.js`               | One reversible timeline, comparing authored projections while retaining full physical snapshots                  |
| `rendering/text/composition-source.js`             | Read-only HTML projection into native UTF-16, effective supported runs, structural/source maps and links         |
| `rendering/text/native-flow-layout.js`             | Exact font resources, native column slots, paragraph decisions, fragments and bounded automatic continuation     |
| `features/editor/text/composition-session.js`      | Asynchronous request coalescing and delivery fences over immutable document snapshots                            |
| `platform/apple/TextComposition.swift`             | Bounded exact-font native line/glyph/caret geometry and same-line PDF emission                                   |
| Platform bridges                                   | Byte-only transport, native worker lifetime/authorization and process-local font/cache ownership                 |

The native adapter must reject unsupported source/typography rather than silently flatten it. Existing HTML, logical boundaries, blank paragraphs, soft breaks, source styles and font references remain authored data. The returned source map describes aliases between structural HTML positions and native text positions; it is neither a migration nor a saved second source.

The editor, reading view and export consume the same line decision and exact glyph result. The visible renderer may use glyph outlines; searchable PDF text must come from the same retained native lines. Cache tokens are transient and generation-bound. See the [bounded invisible PDF-layer experiment](indesign/composed-pdf-layer.md) for verified evidence and remaining reader/accessibility boundaries.

## Full persistence, semantic undo

Automatic composition can append or trim physical continuation pages after a source edit. Persist those pages and their frames so reopening/exporting has a coherent physical layout. Store complete snapshots in history too: undo must not restore a deliberately incomplete projection.

For equality only, `authoredLayoutDocument(document)` removes a continuation when all of these hold:

- The owning flow explicitly uses a supported version-1 native composition policy.
- Its ownership references resolve to one member frame on that page, with no competing page/frame claim.
- The frame is root area text with an empty frame HTML source; its text belongs solely to the flow.
- That frame is the page's only physical object.

The projection also removes those omitted frame IDs and ownership tuples from the flow references. It does not change the supplied document. Every other field remains part of strict authored equality, including source HTML, styles, authored page/object geometry, metadata and legacy-flow layout. `documentContent` still rejects unrelated external state during undo/redo; the exception is limited to this explicit derived ownership.

Before an intentional command enters history, the application calls `promoteTextLayout(before, after)`. It releases affected ownership on `after`, preserving `before`. Changed frame geometry/options, page metadata/relative order, rethreading and extra page objects become ordinary authored layout. Promoted pages survive later automatic shrink. Source/style-only edits do not promote. Intent is not inferred merely from missing continuation IDs: an asynchronous grow/shrink can finish inside an open typing batch. Thread comparison therefore ignores pure derived additions/removals while still detecting changes to authored thread membership and the relative order of existing frames.

Explicit `removeTextFlowFrames` commands turn off automatic continuation for affected native flows. This makes a deliberate deletion a real undoable source-policy change and prevents an immediate automatic replacement. Source HTML remains complete while other member frames remain; the result can be overset. Deleting all member frames removes the flow through the existing document command, with its complete original preserved in undo. Automatic `trimTextFlowPages` is a separate derived operation and does not change that policy. A document still requires at least one physical page.

## Asynchronous delivery and portability

An editor composition request uses a cloned source/layout snapshot. Superseded source, style or geometry must not receive the old result. Camera changes and revision/save bookkeeping do not change line decisions. Derived delivery must bypass authored history and must respect the window's acknowledged writer ownership before persisting page changes. Displaying a previous result temporarily must not make its stale source map authoritative for new text selection or native input anchoring.

Exact font bytes are supplied through the native byte port and remain process-local; no global font installation or font-path lookup is required by the composition engine. The shared Swift source is referenced by the Mac helper and the iOS App target. The iOS plugin dispatches composition/PDF work on a serial background queue. Current static validation confirms source references, method registration, bridge shape and Swift syntax; the absent iOS SDK prevents a full iPhone/iPad compile/device claim.

The [composition authority decision](decisions/0004-text-composition-authority.md) and [parity programme](indesign/text-parity-programme.md) retain the larger gates. This ownership contract does not certify complete paragraph fitting, every script, full publication scheduling, native input equivalence or physical-device performance.
