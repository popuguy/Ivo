# Bounds, Smart Guides and text controls

This 5 November 2026 followup responds to Paul's three screenshots and request for a much closer Illustrator baseline. Read [native snapping/handle analysis](snapping-native.md) and [text controls](text-controls.md) for exact sources, addresses, Evidence IDs and controlled measurements.

## What caused the screenshots

Ivo snapped the stored object rectangle, but drew its blue outline with `outline-offset:2px`. The line and the displayed box consequently described different edges. Text also had a ten-pixel horizontal inset, while images had a five-pixel inset, so the frame, visible content and the inferred alignment appeared inconsistent.

The vertical line in the third screenshot has a separate cause. `alignmentTargets` unconditionally included `pageWidth/2`, allowed any object edge or center to match it, then discarded the target's identity. The selected X value, 449.5px, is consistent with half of the 899px composition width in the equivalent desktop fixture. The renderer extended every guide across the whole composition. That was an Ivo canvas-center attraction, not an observed Illustrator Smart Guide policy. The growing composition's height also made its vertical center a moving target.

The final endpoint investigation also traces the actual AlignGuideAddress draw path. Its ordinary horizontal/vertical branches combine the endpoint interval, source rectangle and optional updated rectangle with min/max in view coordinates. This positively supports a finite union span for the simple box-alignment baseline; category-specific whole/half-extent branches remain separate.

The corrected selection frame is drawn on the stored rectangle, including on hover; handle centers and alignment guides use that same geometry. Extra object padding is removed, so area text uses the authored width directly. Existing coordinates, source HTML and assets are preserved, although removing that inset can change automatic line wrapping.

Targets now retain object/artboard identity, bounds and anchor type. Object guides extend between the participating object extents, with endpoint/center labels, rather than across the whole canvas. Artboard edges remain separate references; the growing canvas's center is no longer an implicit default target. A real artboard-center policy can be enabled separately when Ivo has an explicit page/artboard model. This is a deliberate Ivo policy correction, not a claim that Illustrator's artboard-center setting was observed disabled.

## Observed Illustrator baseline

The new native pass examined 30 function dossiers and 10 cross-reference queries, including the real `dvaai` bounding-box drawing, hit-testing, edge and corner methods. Four corners and four edge controls are established by instructions. Proportional corner resizing projects onto the original diagonal; centered resizing changes opposite controls symmetrically. Edge controls follow a distinct operation. Source hashes remained unchanged and all owned native sessions closed.

The as-found Smart Guides preferences were read through the UI and cancelled without changes: alignment, geometric guides, object highlighting, distance/reference/measurement/spacing guides enabled; Transform Tools and Construction Guides disabled; scope Entire Canvas; object-guide color Magenta; Snapping Tolerance **4pt** and Snap To Point Tolerance **2px**. Scope is not the same as artboard-center eligibility.

Native instructions distinguish enlarged candidate windows (`trunc(tolerance×1.3)` with view conversion) from an uninflated tolerance/view-factor perpendicular acceptance test in a particular segment route. Ivo's nominal tolerance is now four screen CSS pixels, converted into composition units using the native desktop zoom factor or the mobile visual-viewport scale. A regression covers 0.5× through 4× scales. The native evidence motivates that choice but does not certify a universal four-CSS-pixel Illustrator acquisition/release rule.

The owned text fixture and UI established a filled circle at the right midpoint with a short stem, approximately eight CSS pixels in diameter and eighteen CSS pixels outside the frame in that display setup. Double-click converted area→point and back. Forward conversion preserved wraps as five U+0003 forced breaks; reverse conversion retained those breaks and the new bounds. Nonuniform point scaling by 200%×150% changed native size25→37.5 and horizontal character scale100→133.3333373%, retaining vertical100%. Ivo follows that normalization with font size plus independent glyph-axis scales.

The initial creation and additional API probes had caught conversion-return/name errors. Those failed steps are explicitly excluded; surviving converted content, actual UI conversion, final guarded snapshots and the successful native point-scaling step supply the conclusions above. Original executed sources and raw outcomes are preserved privately.

## Implemented behavior

- Eight small resize squares at corners and side midpoints, with diagonal, horizontal and vertical cursors. Side handles preserve the inactive dimension and opposite edge. Shift constrains proportions; Option/Alt resizes about the center and retains the prototype's temporary snap bypass.
- A filled area-type / hollow point-type circle with a stem. Double-click, or keyboard Enter/Space while focused, converts the kind. This is distinct from the existing Fit box to text command.
- Area frames reflow at their current type size and show a red overset marker instead of scrolling text inside the frame. Point text preserves explicit lines and scales glyphs during resizing. Area→point freezes visual wraps as `<br>` while preserving source text, emphasis and links, including overset content. Point→area retains those forced breaks.
- Optional `textKind` and `textScale` fields in the existing archive schema. Legacy text/quotes default to area type and identity scales; no document hierarchy migration is implied.

## Verification and limits

**73 tests pass.** Regressions cover eight directions, fixed anchors, side-axis constraints, centered/proportional resizing, target provenance, finite spans, blocked-snap guide rejection, legacy/archive text state and native-fixture point-scale normalization.

Native Ivo testing used `com.paulcantrell.ivo.boundstest` with a disposable atlas/profile. Eight controls and the circle were visible. Body dragging aligned the text frame to Y=0. A right-side resize changed width235.586→285.586px while height135.5 and size18 stayed fixed. A top-side resize moved Y0→20 and height135.5→115.5 while preserving the bottom edge and width. Point corner resize changed235.586×135.5→285.586×165.5 and size18→21.98524. Undo restored the point geometry/size in one operation; redo and native quit/reopen retained the result. Independent vault reads verified exact stored fractional values and full source text/formatting.

The first right-side check exposed the circle stem intercepting the handle. Its decorative stem no longer participates in hit testing; the right and top side operations passed after rebuilding. Final pure font-scaling extraction is covered by direct numeric tests. A hidden Electron component check uses the actual text module, stylesheet and isolated preload: four forced breaks, all source text/formatting and overset content preserved; native zoom reads matched 1×, 1.5× and 2×. Its first run lacked the real text-block class in the fixture; that fixture error was corrected before the passing result. Build/portable syntax and packaged/iOS byte comparisons complete the artifact checks.

Illustrator automated drag attempts still produced no geometry delta, even after held clicks successfully selected objects. Therefore interactive guide acquisition/release, velocity behavior and every visible guide span have not been measured end to end through that automation. The supplied Illustrator screenshot and recovered axis-aligned endpoint branch corroborate the simple finite box-alignment case, while the complete guide policy remains unresolved. The owned study document alone was closed with Don't Save after snapshots; existing personal documents were left open and application preferences unchanged.

This is substantially closer to the requested baseline, but **indistinguishable parity is not established**. Ivo still pins minimum sizes and confines objects to its existing page bounds; native inspected helpers do not contain that same positive size clamp. Crossing/reflection, full snap ranking/hysteresis, rotation, touch targets and Illustrator's complete typography engine remain separate work. The point/area circle's exact native hit box and point-circle fill were not separately measured. iPhone/iPad assets are synced; physical-device interaction and the full Xcode build remain unverified locally.
