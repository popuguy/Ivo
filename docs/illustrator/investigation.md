# Illustrator investigation for Ivo

See the subsequent [bounds, guides and text-control fidelity followup](fidelity-followup.md) for the latest implementation and investigation.

This is the entry point for the 5 November 2026 study of installed Illustrator 30.8.2. It extends the earlier metadata-only [feasibility pass](feasibility.md). It combines shipped contracts, actual ARM64 disassembly/function analysis, and an original controlled document executed in Illustrator. It is a focused investigation, not a complete reconstruction of Illustrator.

| Area | Established evidence | Remaining boundary | Ivo direction |
|---|---|---|---|
| Selection | Native down/drag/up dispatch and persistent gesture state; UI object and anchor selection; official body-drag interaction. | Complete hit testing, overlap ordering, marquee/multiple selection, touch behavior. | Direct body manipulation with explicit Select/Type modes. |
| Transforms | Nine/custom native reference-point calculation; affine construction; measured matrix order, inverse, center/top-left operations and independent child movement. | Every art type, stroke/effect policy, UI pivot behavior and placed-image normalization. | Explicit coordinate spaces, parent-local transforms and pivots. |
| Masking | Independent native mask/content/group movement; clipping-path selection dimensions differ from full API group bounds; recursive native helper traversal. | Core make/release implementation, nested masks, winding and precise hit regions. | Separate frame/path, original content and content transform. |
| Snapping | Actual gesture→Snapomatic suite call, angular calculations, displacement/rank decisions and distinct UI candidate families. | Full generation, category priority, tolerance/zoom conversion, hysteresis, release and latency. | A separate constraint engine with Ivo's own documented policy. |

Read [native analysis](native-analysis.md) for addresses, Evidence IDs and instruction-level conclusions; [contracts](contracts.md) for shipped declarations; and [runtime measurements](runtime-analysis.md) for nine successful native fixture steps and the companion selection observations. Full proprietary artifacts/transcripts remain outside the repository in the parent workspace's `work/illustrator-deep/`. All native provider sessions were closed; installed hashes were unchanged. Scoped process-inspection approval resolved REA cleanup checks without global permission changes.

## Applied now

Ivo's top movement strip is removed. In editing, **Select** moves an object directly from its body; clicking selects without changing geometry. A three-CSS-pixel movement threshold distinguishes a click from a drag. Double-clicking a text object enters **Type**. Escape returns to Select; V/T select tools outside editable fields. The subsequent fidelity pass adds all eight corner/side controls and a point/area text conversion circle. This is an incremental interaction change, not the final interface or a full Illustrator selection system.

Existing fractional coordinates, original bitmap assets, optional alignment snapping, frame-coalesced previews and one completed drag per undo operation are retained. The six-CSS-pixel snapping threshold and Option/Alt bypass are Ivo choices. Illustrator's own Selection status describes Option-drag duplication; modifier parity is not claimed. See [editor behavior and verification](../editor.md).

Adobe's [Selection tool documentation](https://helpx.adobe.com/illustrator/using/tool-techniques/selection-tool.html) corroborates direct body movement and bounding-box resizing; its [selection methods](https://helpx.adobe.com/illustrator/desktop/manage-objects/select-objects/object-selection-methods-and-preferences.html) distinguish object/group selection from point-level Direct Selection. The native evidence supplies additional internal structure, not a justification to copy Adobe code.

## Next document-engine design

These are proposed model boundaries, not fields already added to Ivo's schema:

- Retain stable object IDs and an ordered parent/child hierarchy. Represent selection independently as object, frame, content or path-point targets; selection and active tool are transient session state.
- Give each object an explicit local coordinate basis and six-component affine transform. Compute document transforms by composing ancestors. Convert pointer positions through the viewport and inverse object transform before editing local geometry. Define matrix order explicitly and test round trips.
- Distinguish geometric, painted and selection bounds. A clipped frame's selection bounds need not include its off-frame content. Do not compute every pivot from a generic union rectangle: the fixture's scripted group-center rotation demonstrably used a different basis from the UI's clipping-path dimensions.
- Store the original asset, an editable frame/path and a content-to-frame transform independently. Moving a frame, moving content inside it and transforming the entire object must be separate commands. Rectangular crops can precede arbitrary vector masks; neither should rewrite original pixels.
- Keep gesture start, preview, completion and cancellation explicit. Commit document commands at completion, while rendering previews from transient state. Screen handles and toolbar layout consume this state rather than owning document geometry.
- Separate snap candidate discovery, eligibility/ranking, constraint solving, latch/release state and guide rendering. Specify screen-space acquisition/release tolerances, zoom conversion and priorities for Ivo before adding anchors, angles and equal spacing. Do not treat the native geometric epsilon as a UI snap radius.

Introduce this model through a versioned, reversible migration of existing flat blocks. Preserve old documents, asset references, links and export order, with old/new readers and representative page fixtures before replacing the current schema. The storage adapter should remain independent of gesture/rendering code. This pass deliberately does not serialize unused speculative transform or clipping fields.

Scans/OCR and region links should use the same asset-local coordinate basis; page/text-flow links need stable frame/page targets. Shareable PDF export will consume the composed scene and clip paths. The mandatory knowledge graph remains a separate derived view of stable document links. Those requested features remain future work.

## Verification limits

The original Illustrator script completed all nine recorded operation steps without errors and saved only its own fixture. UI clicks selected an object, a clipping target and a direct-selection anchor. Automated Illustrator drag attempts produced no geometry change, so this pass does not claim measured interactive snap distances, modifier behavior, screen-to-document deltas or drag timing. It did not alter existing personal documents or application preferences. Only the owned fixture was closed afterward.

Ivo's revised behavior was tested in a distinct native desktop test bundle using a disposable copied atlas: body dragging text and image objects, click tolerance, undo/redo, double-click text entry, text-mode shortcut protection, tool switching and persistence. The iPhone/iPad web assets are synced; physical touch/Pencil behavior and a full native iOS build remain unverified locally.
