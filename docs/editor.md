# Document editor

The current editor combines fixed pages, fractional-point object placement and Illustrator-informed interaction. `src/features/editor/canvas-editor.js` owns live input/gesture state. Pure document/geometry commands live in `src/domain/`; inspector markup lives in `features/editor/ui/properties.js`, while panel movement/docking lives in `ui/panels.js`.

Selection supports whole objects, a multi-object marquee, Shift toggles, common eight-handle transforms and polygon direct-point editing. Mask descendants retain local coordinates and move with their clipping parent. Option-drag creates independent copies with one undo action. Snapping is optional and independent of free placement. See [interaction correctness](interaction-correctness.md), [page operations](page-operations.md) and [duplication](option-drag.md).

Text entry keeps a live editable node and native word selection. The first click away ends editing without creating another frame; Escape exits and composition is guarded. Selected runs and frames support bounded rich typography. Area frames reflow; point text scales glyphs. The right-side type handle switches modes while preserving source. Canonical long-form document text flows through linked frames/pages; see [text flow](text-flow.md) and [text editing](text-editor.md).

Images can be pasted directly, dropped or placed from PNG/JPEG/WebP/GIF/AVIF files. Preparation captures the destination, queues decode/write work and retains original bytes. Navigation/suspension waits for pending placements. Undo removes placement while leaving original media available for recovery. Clipboard vector artwork is not yet editable vector import.

The page camera keeps translation separate from sharp requested-scale text/vector rendering. Reading mode retains composition and adds document-link previews. Local undo spans text, formatting, geometry and structure; selection/camera changes do not dirty the source. Exact vendor interaction timing, general affine transforms, rotation, richer paths, physical input and final styling remain in the [backlog](backlog.md).
