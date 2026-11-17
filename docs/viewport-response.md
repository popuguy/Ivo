# Direct viewport response and sourced interface art

Implemented 6 November 2026 following Paul's report of delayed two-finger document movement/zoom and his preference for exact Illustrator, then Obsidian, icons. This is an interaction correction and provisional reference-art pass, not the final visual design.

The subsequent [interaction milestone](interaction-correctness.md) changes page painting to layout zoom to remove transient cached-bitmap enlargement, corrects the proven pinch half-gain error and adds two-decimal zoom display. Its rendering details supersede the original compositor-scale description below.

## Delay diagnosis and fix

The page layer already used `translate3d`/`scale` with `will-change: transform`. The main delay was deliberate software easing: each wheel event changed a target, then each animation frame moved the camera toward it with a 55 ms exponential time constant. Each input also reset the easing timestamp, reducing progress when events arrived near a display frame. Thus adding another GPU renderer would not remove that queue.

Wheel pan, wheel/trackpad pinch, touch pinch/pan, Hand movement, zoom commands and fit now assign the camera directly. A single pending animation frame coalesces the latest transform for the next display update. Native trackpad momentum is consumed as supplied; Ivo adds no second momentum/easing stage. Pixel wheel deltas retain fractional values. Line/page wheel events normalize their declared units explicitly. Zoom keeps the pointer's document point fixed.

Selection controls are cached until their object/tool/text state changes. Camera-only frames translate the existing overlay and update dimensions when magnification changes. They do not rebuild eight handles or repeatedly read text overflow geometry. Text input, font readiness, object changes, page changes and viewport resize still invalidate the appropriate overlay measurements. Stored document geometry, original media and save/history formats are unchanged.

## Measured scope

`npm run test:viewport` mounts the actual editor/CSS with 500 synthetic objects and a selected text object. It sends 60 wheel inputs, then focal zoom and two-touch pinch. The baseline camera lag reached about 63.64 CSS pixels behind its queued target. The revised camera equaled the requested camera in the same input handler. During camera-only movement, added selection nodes fell from 60 to zero and text overflow layout reads from 240 to zero. The revised input handler's measured p95 was about 0.2 ms on this host; the isolated runner reported GPU compositing enabled.

Those are application-state and handler measurements, not optical input-to-display latency, a physical trackpad benchmark, a guarantee on every document/device, or a measured equality with Illustrator. Display painting still occurs on the next available frame. Actual native scroll/zoom, selection persistence, resize after navigation, type conversion and undo were checked in a separate disposable desktop app. Physical iPhone/iPad gesture coverage and broader page workloads remain pending.

## Cursor evidence and mapping

Twenty exact Illustrator SVG cursor resources and their XML metadata were retained privately. Root width/height is normalized from 64-pixel @2x resources to 32 logical pixels; path geometry, viewBox, outlines, opacity and styles remain unchanged. CSS uses the supplied XML hotspots.

| State                          | Illustrator resource              | XML hotspot |
| ------------------------------ | --------------------------------- | ----------- |
| Selection / Direct Selection   | Cur_Select / Cur_DirectSelect     | 1,1         |
| Whole-object / direct movement | Cur_Move / Cur_DirectMove         | 1,1         |
| Anchor movement                | Cur_MoveAnchor                    | 1,1         |
| N/S resize                     | Cur_ScaleVertical                 | 7,7         |
| E/W resize                     | Cur_ScaleHorizontal               | 7,7         |
| NW/SE resize                   | Cur_ScaleTLBR                     | 7,7         |
| NE/SW resize                   | Cur_ScaleTRBL                     | 7,7         |
| Hand / active pan              | Cur_Hand / Cur_Fist               | 11,11       |
| Type placement / text editing  | Cur_HorizontalText / Cur_TextEdit | 1,1 / 4,12  |
| Polygon/rectangle placement    | Cur_Precise                       | 9,9         |
| Area circle → point            | Cur_ConvertToPointType            | 1,1         |
| Point circle → area            | Cur_ConvertToAreaType             | 1,1         |

Independent LLVM ARM64 disassembly confirms BoundingBox native IDs16024–16027 register the four scale resources, and IDs16029/16030 register the two conversion resources. The previously completed REA `AI Track Cursor` dispatcher evidence `ev_6371912ea5ac95bad69bbc0f3234bcefda52075ffe7f2de30a9d5a65f1080eff` reaches 0x9a1c. The conversion branch near0x9de4 selects those IDs and calls0x248d4; the setter passes the SVG resource type0x535647 at0x249c4–0x249cc. This establishes actual resource use, rather than filename inference alone.

The resize XML says7,7 although its filename suffix says9,9. Effective live cursor-service adjustment and Illustrator's full hover hit-zone policy were not measured. Ivo uses the explicit XML value; do not describe this as visually measured hotspot parity. The new REA probe failed before Hopper bridge readiness, so no new successful REA dossier is claimed. Its exact owned helper/runtime was subsequently verified inactive and removed; cleanup evidence preserves the missing authenticated shutdown acknowledgement. Installed files and global settings were unchanged. Raw results remain in parent `work/cursor-reference/`.

## Interface icons and builds

The handwritten control paths are removed. `src/shared/ui/icons.js` renders sourced SVG images and installs sourced cursor states. Nineteen distinct control assignments use Illustrator artwork: selection/direct/type, rectangle/polygon/hand, Draw Inside, image, undo/redo, link/document/search, plus/minus, close/edit/menu/more. Actual Obsidian/Lucide registry geometry supplies graph (`git-fork`), reading (`book-open`), fit (`maximize`) and bold/italic. The area/point circle, resize squares and overflow port remain dynamic frame geometry; the bounded resource search did not identify standalone matching icon assets.

`public/icons/obsidian/` contains 32 licensed fallback semantic assignments, their registry identities/hashes and ISC/Feather MIT notices. The installed application did not identify a Lucide version. No Obsidian application implementation code is copied. The standalone HTML embeds the icon notices.

`scripts/reference-art.mjs` compiles `src/shared/ui/reference-art-data.js`, which is ignored by Git. Local builds merge the private Illustrator-preferred icon manifest and cursor manifest from the parent work directory; these exact assets are included in static/portable/desktop/iOS outputs. Public-source builds without that private cache use the checked-in licensed Obsidian icons and platform cursor fallbacks. `IVO_REFERENCE_ART_DIR` can point to another explicitly supplied reference-art cache; no system-wide setting is changed.

Build/dev/runtime test scripts prepare that module. SVG data URLs are local, offline and predecoded; no hover-time network fetch occurs. Artwork identities remain separate from the control code, allowing Paul's later design pass to replace the art consistently. Vendor artwork and extracted proprietary resources have not been pushed or committed publicly.
