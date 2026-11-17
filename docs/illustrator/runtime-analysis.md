# Illustrator controlled geometry measurements

The root investigator executed the original Ivo fixture through Illustrator's **File → Scripts → Other Script…** on 5 November 2026. The script created one new sacrificial document and saved only its own `.ai` and JSON under the workspace. This is actual Illustrator execution, separate from the static declarations in [contracts](contracts.md).

Run: `1793921557535-846630`. All **nine** native operation steps returned successfully, the report has `completed:true` and no step/fatal errors, and the `.ai` was saved. Optional property reads report their own unavailability and are not silently treated as successful matrix observations.

The exact 12,102-byte executed JSX was unchanged from its original provenance, SHA-256 **`fae600d95d4deb2219213b94c597f2ce1539e385239ecf6768a89dc0e44f84be`**. A frozen copy is retained with the raw report in `work/illustrator-deep/runtime/run-1793921557535-846630/`. Derived numeric comparisons and report/source hashes are in `work/illustrator-deep/contracts/runtime-derived-checks.json`. The initial blank-document/no-report observation was premature: Illustrator finished the fixture asynchronously, and its final successful report is the evidence used here. No fixture code was changed in response to that temporary state.

## Coordinate basis and simple transforms

The recorded scripting coordinate system is `DOCUMENTCOORDINATESYSTEM`, artboard rectangle `[0,760,1000,0]`, ruler origin `[0,0]`, and page origin `[100,80]`. These are distinct values. For the recorded path geometry, bounds are `[left,top,right,bottom]`, positive X is right, and positive Y is up. This is the measured fixture basis; screen coordinates and all possible artboard/ruler configurations should not be conflated with it.

| Native operation | Measured geometric bounds / result |
|---|---|
| Translation `(40,-25)` | `[240,700,340,630]` → `[280,675,380,605]`; width/height unchanged. |
| Resize 150% X, 50% Y about center | `[440,700,520,640]` → `[420,685,540,655]`; center stays `[480,670]`, width 80→120, height 60→30. |
| Resize with line-width percentage 100 | Stroke stays 10 points while geometry scales nonuniformly. |
| Rotate 90° about center | A 90×50 path becomes approximately 50×90, preserving geometric center `[665,655]`. |
| Rotate 90° about top-left | The original top-left `[800,650]` remains an anchor; resulting bounds are approximately `[800,740,850,650]`. |

The rotation results contain errors of a few millionths of a point, so treating the displayed decimal values as exact integer equality would be inappropriate.

The 12-point stroked rectangle has geometric bounds `[50,700,170,620]` and visible bounds `[44,706,176,614]`: a six-point expansion on each edge in this fixture. **Control bounds varied by snapshot phase**: the first unselected read matched geometric bounds; later selected/transformed reads matched stroke-visible bounds. The fixture did not isolate selection effects from deferred cache/redraw effects. A universal invariant for `controlBounds` is therefore not established by this run.

## Matrix order and an explicit affine formula

For the native path transforms about document origin, these six coefficients matched measured anchors:

```text
x' = a*x + c*y + tx
y' = b*x + d*y + ty
```

The custom matrix `[a=1.2,b=0.25,c=-0.15,d=0.8,tx=30,ty=-20]` maps the fixture's first triangle anchor `[80,450]` to `[58.5,360]`. All three anchors match that formula exactly in the saved numeric report. Applying its native inverse returns all three anchors to the originals with zero recorded difference.

Concatenation order was measured, rather than inferred from a name. With translation `T=(40,-20)` and scale `S=(1.25,0.75)`:

- `concatenateMatrix(T,S)` reports translation `[50,-15]` and matches **apply T, then apply S** on all fixture anchors, with zero difference.
- `concatenateMatrix(S,T)` reports translation `[40,-20]`; reversing the sequential operations produces a maximum ten-point anchor difference from the first result.

Under the column-vector formula above, Illustrator's measured `concatenateMatrix(T,S)` corresponds to the composite **S·T**. This statement covers the tested native constructor/transform route and document-origin reference point. It does not by itself specify every UI pivot or placed-image matrix conversion.

## Groups expose document coordinates

The group/child snapshots captured both direct children correctly. A group translation `(30,20)` shifts both children's reported path anchors and bounds by the same document-space delta. A subsequent independent child translation `(15,-10)` moves only child A; child B stays fixed, and the group union bounds are recomputed.

The returned child positions are therefore useful document-space observations, not a serialized local-coordinate transform tree. `PathItem.matrix` and `GroupItem.matrix` were unavailable in this scripting surface and were recorded as such. Ivo should keep its own explicit parent-local transforms if it needs a persistent scene hierarchy; it cannot infer such a hierarchy merely by storing these global path bounds.

## Mask, image content, and group bounds are different

The rectangular clip contains two captured children: a clipping PathItem and a linked PlacedItem. Translating content `(25,-15)` changed its reported bounds from `[500,440,740,280]` to `[525,425,765,265]` while leaving the mask at `[520,420,680,320]`. Translating the mask `(-10,10)` then moved it to `[510,430,670,330]` while leaving content fixed. Group clipping remained enabled.

After rotating the group by 10°:

| Basis | Bounds | Width × height |
|---|---|---|
| API group geometry | `[497.6110,445.9627,777.3890,246.7179]` | `279.7779 × 199.2448` |
| Clipping path geometry | `[497.6110,434.3902,672.5451,308.1257]` | `174.9341 × 126.2645` |

The root's companion UI observation in **Edit Clipping Path** mode showed Transform-panel dimensions `174.9341 × 126.2645` points, matching the **mask**, while the ordinary API group bounds include the larger content. This is a concrete warning against using the generic clipped group's union bounds as the visible frame's selection rectangle. It does not establish every UI selection mode: Edit Contents and group selection must be observed separately.

There is a second distinction: the scripted `group.rotate(10,…,CENTER)` used the **full API group's pre-rotation center** `[637.5,347.5]`. Rotating mask anchors around that pivot predicts the measured coordinates to about `6.8×10⁻⁷` points. Using the mask center `[590,380]` instead misses by approximately `8.742` points. The mask center consequently shifts to `[585.0781,371.2580]`. A generic GroupItem CENTER operation and a UI command targeting the clipping path are therefore not interchangeable assumptions.

The custom polygon clip also retained a clipping PathItem and a larger content path with distinct bounds. Its group clipping flag and polygon anchors were recorded. A screenshot/UI observation is still the authority for the precise visible silhouette and hit region; the API's bounding rectangles alone do not establish them.

The PlacedItem exposes a matrix and intrinsic bounding box, but the intrinsic box is not zero-origin pixel coordinates in this fixture. It reports `[7691,8587,7715,8571]` for the 24×16 test image. Before group rotation its matrix includes scale/axis conversion and large translations. Normalizing arbitrary native placed-image matrices into a portable image-local coordinate convention was not established. Ivo should define that convention explicitly rather than copying the raw native numbers.

## Selection and remaining checks

Document selection reported one PathItem for the object-selection case, one GroupItem for the group case, and one child PathItem for independent child selection. The final fixture selection is the rectangular clip group. The original point-selection step selected the whole path first, so all four anchors were already marked selected; assigning the first anchor's selected state does **not** prove an isolated single-anchor selection. Direct Selection needs its own UI/capture observation.

The read-only inspector was subsequently extended to capture owned-document view zoom, center point, and bounds when available. Its revision-2 SHA-256 is `f4fc90476e6e67f240d19219da3e2a3b570815cfa95785a6497bcb1c0a66bde5`; revision 1 is separately frozen. The main executed fixture remains unchanged.

A separate native UI Direct Selection click on the stroked rectangle's top-left anchor was captured in snapshot `1793922301145-650373`. Exactly one point, `[50,700]`, reports `ANCHORPOINT`; its two neighboring points report adjacent `RIGHTDIRECTION`/`LEFTDIRECTION` states, and the opposite corner reports `NOSELECTION`. This establishes an anchor-level selection distinct from the original whole-path selection, while retaining the actual neighboring-handle states. The Transform UI exposed X=50, Y=60, with W/H zero and disabled in this state. Its displayed Y is not the raw document-coordinate anchor Y.

The snapshot reports view zoom `1.42`, center `[500,380]`, and view bounds; the window title separately showed `67.49%`. These surfaces were not calibrated against screen pixels, so this pass derives no zoom/tolerance conversion from them. View-menu controls for grid, pixel, point, glyph snapping and Smart Guides were observed, but accessibility did not expose their checked states. Application preferences were not toggled.

Repeated automated drag attempts on the owned clip and a verified selected stroke edge produced no geometry change. These are automation limitations of this observation, not measurements of Illustrator's drag engine or snapping. No interactive snapping threshold, undo boundary, latency or modifier parity is claimed. The original Selection tool was restored, and only the saved owned fixture was closed, without a save prompt; existing documents were left untouched.

This run establishes native object/matrix/clipping behavior for a controlled document. Interactive body hit testing, Shift/Option modifiers, snap thresholds/priority/latching, cursor-speed dependence, drag undo boundaries, and screen-to-document movement require the root's separate UI observations. Nine successful script steps are not evidence that those gestures or every Illustrator operation were tested.
