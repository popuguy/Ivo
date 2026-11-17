# Illustrator scripting, selection, and transform contracts

Target: installed Illustrator **30.8.2** on macOS, inspected 5 November 2026. This track reads shipped interface declarations, three selected sample scripts, and focused UI resources. Native disassembly and actual fixture results belong to the companion investigation; this document does not infer execution from a declaration.

## Evidence and scope

The shipped `Contents/Resources/Adobe Illustrator.sdef` has SHA-256 `ca752fed3129e592670b7a2cb16393cb89acdf89e65f56422d0308e0e95afaa9`. Its command/class descriptions are explicit packaged contracts. A second dictionary is shipped under ScriptingSupport. The baseline inventory found 33 standalone sample JSX files in the selected sample tree. It did not establish that every declaration corresponds to every UI gesture.

Actual REA 6.7.0 analysis of the original sample-script directory completed for:

- `Working With Paths/Make Star Group.jsx`
- `Working With Paths/MoveItem.jsx`
- `Working With Text/AlignText.jsx`

Evidence: **`ev_68f1228d611e4f0504dd5e8e1b423992ec3e794873131687c575a2017f2ca7d8`**. Three JSX sources parsed, 364 AST nodes visited, zero parse failures; 30 inventoried files excluded. The analyzer read inert source text and did not execute a sample. Its graph coverage remains partial. Complete raw records, source digests, focused declarations, UI identifiers/bindings, line/byte locators, and fixture source hashes are private under the parent workspace's `work/illustrator-deep/contracts/`.

The samples corroborate a transform/group surface: creating a document, groups and paths; constructing a rotation matrix; applying a transform about the center; marking a group clipped; duplicating and reparenting a page item; and directly setting object positions. They do not establish UI hit testing, modifier handling, snap ranking, or generalized masking behavior.

## Object geometry and selection

The dictionary separates three bounds:

| Property | Packaged description |
|---|---|
| Geometric bounds | Artwork bounds excluding stroke width. |
| Visible bounds | Artwork bounds including stroke width. |
| Control bounds | Artwork bounds including stroke width and controls. |

Position is the page item's top-left location; width and height are distinct properties. Page items expose selected state, editability, locking, isolation, parent container, and a UUID. Path points expose anchors, left/right direction handles, point type, and selected-point state. Document selection is declared as an unconstrained `any`, so treating every possible selection as a plain page-item array would be too narrow.

Document page origin, document ruler origin, artboard rectangle, and artboard ruler origin are separate fields. The artboard dictionary describes its ruler origin relative to the artboard's lower-left corner. That declaration is not sufficient to assume the sign/origin conventions of all JavaScript calls, mouse coordinates, or transformed object-local coordinates. The fixture records actual values without changing the application-wide coordinate system.

Placed art and raster art separately expose an intrinsic bounding box and a transformation matrix. A transformed axis-aligned artwork bound is therefore not a replacement for the object's intrinsic content rectangle and affine transform. This distinction is useful for Ivo's image-content versus frame geometry.

## Affine transforms and pivots

The matrix contract has six real components: A, B, C, D, TX, TY. The shipped interface includes identity, rotation, translation, and scale constructors; matrix concatenation, inversion, singularity, and equality operations; and object rotate/scale/translate/transform methods. The reference-point enumeration contains center, eight perimeter positions, and document origin.

Rotate declares an angle in degrees and counter-clockwise rotation. Scale uses horizontal/vertical percentages. Transform operations can distinguish moving the object from transforming fill patterns, gradients, or stroke patterns. Line-width scaling is a separate numeric argument. These declarations support independent policies rather than a single opaque resize command.

The UI resources reinforce those separations. `TransformEachUI.eve` has separate controls for object transformation, patterns, stroke/effect scaling, shape corner-radius scaling, and X/Y reflection. The Transform panel includes a warning specifically for pattern-only transformations. Resource presence establishes selectable concepts, not their current settings or whether every feature gate is active.

Matrix multiplication order, the exact treatment of reference points, stroke-alignment effects on bounds, and object-versus-document coordinates must be measured. The original fixture compares concatenation against both sequential orders, applies a custom affine matrix about document origin, and records an inverse round trip; it does not label an order correct before Illustrator returns results.

## Clipping is a path/group relationship

The declarations distinguish a path item's `clipping` flag from a group item's `clipped` flag. A path can retain anchor geometry, direction handles, closed state, winding/even-odd information, and ordinary appearance properties. A group can contain content and a clipping path. These objects have separately addressable transforms.

This is a useful basis for an Ivo model with original content, a frame/path, and their relative transforms. It does not establish that a clipped group's ordinary bounds equal its visible mask bounds. The fixture deliberately records the group, mask, and content separately before and after each independent transform. It includes both a rectangular linked-image clip and a custom polygon path clip. Pixel segmentation or generative masking is outside this contract.

## Selection and snapping UI declarations

`SelectionPreference.eve` binds separate controls for selection tolerance, path-only object selection, selection behind another object, anchor highlighting, and handle display. The selection tolerance control declares a **1–8 range with a px suffix**. On macOS, the selection-behind label names Command-click. This is a shipped preference/resource contract, not proof of the user's current preference or a complete event-dispatch implementation.

`SnappingAndSmartGuides.eve` distinguishes the following candidate families:

- Object bounding-box endpoints, edge midpoints, and centers.
- Anchor-to-anchor point snapping.
- Artboard references, ordinary guides, and glyph references.
- Construction angles, transform guides, and equal spacing.
- Optional snapping to the previous location and to the cursor's position.

Smart Guide display is separate from grid, pixel, and point snapping. Distance-guide text names selecting an object then holding Alt/Option while hovering another object. A response-setting tooltip refers to guide appearance frequency based on cursor speed. That supports investigating movement-dependent presentation, but it does not establish a velocity threshold or hysteresis algorithm.

The newer object tolerance control declares a 0–10 range; the point tolerance control declares 1–8. The newer resource does not by itself establish the engine units or zoom conversion. Candidate prioritization, ties, latch/release distance, screen/document conversion, disabled-snap gestures, and drag latency remain runtime/native questions. No general-purpose scripting API that reproduces interactive snapping was established by this focused dictionary/resource pass.

For Ivo, body selection and free movement can be the primary interaction, with optional alignment feedback and separate mask/content editing. The evidence does not require a top-mounted move handle, and the requested final interaction should not be constrained by the prototype's current handle design.

## Original controlled fixture

The runtime scripts are original measurement code, outside the repository under `work/illustrator-deep/runtime/`:

| File | Purpose |
|---|---|
| `ivo-native-fixture.jsx` | Creates one new sacrificial document and native object/matrix/mask measurements. |
| `inspect-owned-fixture.jsx` | Reads only the active fixture after validating its workspace path, filename prefix, and owned layer marker; writes a fresh selection/geometry snapshot. |
| `ivo-fixture-content.png` | Original 24×16 RGB test content, with no external file or account dependency. |

The creation script captures stroke/geometric/control bounds, page-item and point selection, translation, center scaling, center/top-left rotation, matrix concatenation in both orders, inversion, a custom affine transform, group/child movement, and independent image-content/mask/group operations. Each step records success or its own error. Unsupported optional properties are reported as unavailable rather than replaced with guessed values.

Every run creates `runtime/run-<token>/`, writes `report.json`, and saves `IVO Illustrator Owned Fixture <token>.ai`. `runtime/latest-run.json` points to that run. The separate inspection script writes `owned-selection-<token>.json` and updates `latest-owned-snapshot.json`. A new named owned layer identifies the fixture. The creation script does not assume or read the preexisting active document. The inspector checks ownership before reading object contents. Neither script changes global preferences, closes a document, or saves an existing user document. The fixture remains active for controlled UI dragging.

Both JSX files pass Node's syntax-only check, including a JSON encoder that does not depend on native `JSON` support in old ExtendScript. That check is not an Illustrator execution result. The root investigator alone runs them through **File → Scripts → Other Script…** and records the actual report, UI state, modifier gestures, and any runtime limitations. Existing personal/recovered documents remain outside the fixture's data scope.

The main fixture was subsequently executed successfully by the root investigator: all nine operation steps completed and its own `.ai` was saved. See [controlled runtime measurements](runtime-analysis.md) for the actual bounds, matrix order, mask/content independence, UI comparison, and limits. The owned fixture was closed after the companion UI study. The static declarations above have not been silently relabeled as runtime proof.
