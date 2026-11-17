# Native followup: Smart Guides and bounding-box controls

This focused static pass follows the 5 November screenshots and extends [native-analysis.md](native-analysis.md). It examines the same installed Illustrator 30.8.2 Snapomatic image and the directly imported `dvaai` framework, rather than treating the old metadata inventory as behavioral reconstruction. Runtime observations and Ivo's implementation are separate evidence.

## Sources and method

Snapomatic remains SHA-256 `cebbbd19af24c879e02e63d05067243dbd1ea909acbb03c82b7dca3b8b8db303`. The newly selected framework is `Contents/Frameworks/dvaai.framework/Versions/A/dvaai`, an 8,584,480-byte ARM64 Mach-O with SHA-256 `859edf1b9bf0b13876030af528e5b0f34914abff4192938f8d7cca9c915d9ac2`. BoundingBox imports its named `UI_FreeTransform` methods. Native symbol and indirect-symbol tables corroborate those names; actual REA/Hopper dossiers and focused LLVM instruction transcripts establish the observations below.

Full raw records, private source identities, transcripts and the deduplicated Evidence ledger are under the parent workspace's `work/illustrator-fidelity/native/`. Public notes contain original explanations, not Adobe implementation code. No target application was executed by this native track, and no application preferences or personal documents were read or modified. A restricted Hopper launch failed; the same scoped static workflow succeeded with process-ownership/cleanup approval, without global permission changes.

This pass retained **30 function dossiers and 10 cross-reference queries**, plus a complete new LLVM `dvaai` instruction transcript. All 6,677 distinct instruction addresses in the new dossiers were found in their corresponding LLVM transcripts. Both installed source hashes were rechecked unchanged and exact source copies retained privately. The public CLI workflows completed their owned native-session cleanup successfully; no native query remains running.

## Eight handle locations are real native geometry

`ai::controls::UI_FreeTransform::DrawBoundingBox`, `dvaai:0x197248`, loops four times. Each iteration submits a corner to `DrawAnchorPoint` with type 1 and a corresponding edge control with type 2. Edge-control submission is conditional on the widget's mode/size. The boundary is subsequently processed as an eight-point ring. This supports four corner controls and four side controls in the ordinary bounding-box presentation; it does not establish that every native tool or compact/disabled mode always shows all eight. [B1]

`ai::FreeTransformGeom::HitTest`, `0x1f0110`, initializes distinct hit metadata and checks corner and edge-control boxes using a caller-supplied tolerance. Mask bits can exclude either control family. It records the control type/index when one hits; after the control checks it evaluates the quadrilateral interior with a crossing/parity test. Handle hit regions and object-body hit regions therefore have separate native paths. This routine alone does not supply an exact CSS-pixel target size for Ivo. [B2]

## Corner constraints and edge resizing are different operations

`DoScaleCorner`, `0x1993cc`, copies the starting quad, chooses neighboring/opposite corner indices, and updates the corner control. When modifier flag bit 0 is set, instructions at `0x199474–0x1994a8` calculate a projection onto the original diagonal:

`t = dot(pointer − fixedCorner, diagonal) / dot(diagonal, diagonal)`

`newCorner = fixedCorner + t × diagonal`

This is the proportional-diagonal constraint observed in these instructions, not a choice between whichever axis moved farther. Modifier flag bit 1 additionally changes the opposite controls symmetrically about the original midpoint. The result goes through `QuadAdjustEdges`, and the routine calculates two scale ratios from changed/original edge lengths before submitting transform info with drag mode 2. [B3]

`DoScaleEdge`, `0x199620`, updates an edge control, changes its opposite symmetrically when modifier flag bit 1 is set, then calls `QuadAdjustEdges`. It submits drag mode 3 with a different transform-info vector. It does not execute the corner projection branch. Thus an edge control and a corner control must not share a generic two-axis size delta. [B4]

The capture path obtains initial/current positions and `PointerEvent::GetModKey`, then forwards them through `DoPointerMoved` and `DoTransform` to the operation-specific methods. These calls were verified against the framework's indirect-symbol table. This establishes modifier routing; keyboard names for individual bits should be corroborated by the user-facing command behavior rather than inferred merely from a bit number. [B5]

`QuadAdjustEdges`, `0x1efd08`, constructs the four side lines with homogeneous vector cross products, intersects adjacent lines, divides nonzero homogeneous coordinates, sets W=1, and calls `QuadAdjustCorners`. There is no positive width/height clamp in that helper or in the two inspected scale routines. Therefore Ivo's minimum-size pinning is not evidence of Illustrator crossing behavior. Reflections and the host art engine's treatment of a crossing still require their own observations; this pass does not claim complete crossing/mirroring parity. [B6]

## Smart Guide candidates have separate eligibility

The preference loader `Snapomatic:0x660c4` separately reads endpoint, midpoint, center-point and artboard-guide settings into four separate fields at `0x912ae–0x912b1`. It also independently reads alignment-guide display, cursor snapping, active-artboard content, tolerance, sensitivity and angular tolerance. Those are actual preference-service calls and stored values, not just string names. No current/default preference value was established by the static pass. [S1]

The point-candidate path `0x333f4` first checks the artboard-guide flag. It separately tests the endpoint/midpoint/center-point category flags, then range-tests the candidate against a stored rectangle before forwarding it to a consumer. The segment path `0x33808` also checks the artboard-guide flag and calls an intersection helper before forwarding the result. Artboard references therefore have their own enable/filter path. An unconditional page-center target mixed into every Ivo snap is not established as Illustrator behavior. This does not imply that Illustrator never snaps to an artboard center when that feature is enabled. [S2–S3]

## Tolerance is converted through a view-dependent factor

The candidate-window path `0x6524`, at `0x6578–0x65a0`, reads the Smart Guide tolerance integer, multiplies by literal 1.3, converts to an integer with truncation, and passes it to helper `0x71cf4`. The helper acquires **AI Document View Suite** through `0x43e08`, queries slot `0x20` for a double, and computes `integerTolerance / factor` for a positive factor. Its nonpositive-factor branch multiplies by the negative factor instead. The converted distance is then used to expand a candidate window. [S4–S5]

This directly establishes view-dependent conversion in that candidate-window branch. It does not establish a universal snap acquisition radius, the exact native UI tolerance units for every category, release hysteresis, or the full candidate ranking. In particular, the earlier `2^-16` geometric comparison epsilon must not be substituted for this preference or used as a user-visible snap distance. Ivo should keep screen and document units explicit and verify acquisition/release behavior separately.

A second, narrower path makes the broad-phase/final-test distinction concrete. `0x28e0c`, at `0x291d0–0x291dc`, passes the **uninflated** tolerance integer through the same view conversion and then supplies that converted value to predicate `0x77100` at `0x29294–0x292a0`. The predicate obtains the segment direction through `atan2` and helper `0x77380` (sin/cos or exact cardinal values), computes the absolute perpendicular residual of the point relative to the line, and accepts when the residual is **less than or equal to** the supplied tolerance (`0x77184–0x7718c`). [S7–S8]

Consequently, a tolerance value of 4 yields a `4 / positiveViewFactor` perpendicular acceptance band in this particular segment/angle route, while the earlier candidate-window path uses `trunc(4 × 1.3) / positiveViewFactor`. This is not evidence that every bounding-box alignment category follows this route or that acquisition and release share one threshold. The root's separate GUI observation of a 4pt preference can be compared with this result without silently converting that UI label into universal CSS-pixel parity.

## Drawing is a separate path from constraint choice

The actual `AI Draw` dispatch at `0x527f4` invokes `0x47f50` and `0x580f0`. Those paths consume current draw/constraint state and delegate geometry and annotation work through consumers; guide visibility and labels have separate gates. The draw consumer `0x617c0` reaches active-result drawing `0x59798`. [S6]

The pass also located the `Canvas` RTTI/vtable and annotation-drawer forwarding methods. Several initially selected routines, including `0x6841c`, `0x6970c` and `0x69e1c`, concern rounded annotation backgrounds or label layout. They were not relabeled as recovery of the Smart Guide line-span algorithm merely because they call drawing services. Raw filenames such as `guide-line-renderer` are search labels, not recovered function names.

The complete policy for category ties, dwell/velocity response and removing a guide remains distinct from the low-level draw primitive. A further pass recovered the actual axis-alignment extent route below; its simpler branches support finite unions, with explicit category-dependent exceptions.

### Actual alignment endpoint dataflow

The active-result loop at `0x59798` invokes virtual slot `0x30` on its address objects. Original-file RTTI and chained-fixup records identify separate `LineAddress`, `AlignGuideAddress` and `LineSegmentAddress` tables. Their draw methods are `0x54aa0`, `0x56f84` and `0x579a0` respectively. This follows the actual result object to its draw operation instead of selecting a routine merely because it references an annotation service. The private `guide-address-vtables.json` retains the exact table/string addresses. [G1–G3]

`LineAddress:0x54aa0` initializes two point outputs from stored fields `+0x28` and `+0x38`, calls virtual slot `0x60` to adjust those outputs, then converts each returned point to view coordinates and emits separate move/line calls at Canvas slots `0x38` and `0x40`. Its base endpoint-adjustment method, `0x54d3c`, is a no-op. `LineSegmentAddress:0x579a0` converts and draws its two stored endpoints directly, gated by its own visibility field. These are finite endpoint pairs, not implicit whole-canvas axis lines. [G1, G3, G5]

`AlignGuideAddress` overrides endpoint adjustment with **`0x5594c`**, a 1,106-instruction routine. It uses the two point fields, a stored rectangle at `+0x1a8`, angle `+0x160`, category `+0x1a0`, and optional updated rectangle/category fields at `+0x180`/`+0x178` with flag `+0x1c8`. The constructor `0x54d40` copies the fixed rectangle/category into those stored fields; updater `0x54e44` replaces a point and, when supplied, copies a second rectangle/category and sets the update flag. The dataflow therefore retains a fixed/source extent and a separately updated extent rather than recomputing all guides from a page rectangle. Full public enum names for every category were not recovered. [G4]

The routine maps points and rectangles into **integer view-coordinate intervals** before applying extent rules. In the horizontal angle-zero branch at `0x55f68–0x55f9c`, it combines the initial endpoint interval and mapped stored rectangle interval:

```text
left  = min(endpointLeft, rectangleLeft)
right = max(endpointRight, rectangleRight)
```

The aligned Y coordinates are retained. With the updated rectangle present, the min/max sequence at `0x55e34–0x55e94` combines **three** intervals: the adjusted endpoints, stored rectangle and updated rectangle. Its outer guide interval is therefore the union of those intervals. The corresponding quarter-turn branch operates on Y. The angle constant read at `0x85138` is approximately π/2 (`1.57079632675`). This provides positive instruction-level support for a finite source/current bounding-box union in the simple axis-alignment case. [G4]

It is not the whole policy. Earlier branches adjust an endpoint by a rectangle's whole or half width/height depending on category, orientation, endpoint order and coincidence. Later branches can accumulate additional points for markers. Several extended paths are gated by the actual feature-manager query `SnappingImprovements2025` at `0x42f1c`; this pass does not establish that gate's runtime value. A union of all object rectangles is therefore not proven correct for every point, glyph, construction-angle or artboard gesture.

The final adjusted view points return to document coordinates through helper `0x71a68`, which calls **AI Document View Suite slot `0x1b8`**. Point-to-view helper `0x719d4` calls slot `0x1b0`; rectangle helper `0x71b04` calls slot `0x1d0`; the final ordinary draw projection `0x718a4` calls slot `0x38`. The endpoint policy is implemented in the inspected plug-in; precise native view mapping and rounding cross this explicit external-suite boundary. Those service calls do not establish all native coordinate-conversion semantics by themselves.

For Ivo's screenshot case, drawing the guide on the same geometric edge as the selection frame and limiting its extent to the participating source/current objects has a stronger basis than the former whole-page cross. An artboard guide may legitimately include the artboard's extent when that candidate is enabled; the existence of artboard filters does not prove that the user's artboard setting is off. Exact artboard-center acquisition and every category-specific extension remain separate checks.

## Evidence

| Ref | Routine / private record | REA Evidence ID |
|---|---|---|
| B1 | `bbox-draw-eight.json`, `0x197248` | `ev_04ff3e392d0cba4a15b14bde15f6a845a1671abb2154b9d666769177e8c87b9d` |
| B2 | `bbox-hit-test.json`, `0x1f0110` | `ev_7dcfb95c2b7cd7a45cbfa66c00b7e2b7a8e27799c44cf9884a8a390e06cac304` |
| B3 | `bbox-scale-corner.json`, `0x1993cc` | `ev_f9449762d40c27d5057681ea89c3fdd09f0c9a8bcec9e21b0e65119d34454cab` |
| B4 | `bbox-scale-edge.json`, `0x199620` | `ev_2d0c773a74d6e042e3cf855b4880698e805f2fb2c09659400b672eed9b819fe8` |
| B5 | `bbox-mouse-modifiers.json`, plus capture/transform/indirect-symbol transcripts | `ev_8e2e8613c011593ccb63525cf2ea3833091c7e443e8a13772453c2f59b24b707` |
| B6 | `bbox-adjust-edges.json`, `0x1efd08` | `ev_64dd7f4b21a5a64bb96d98ac206909ece866cfbf1e8f0458f0efde2790598309` |
| S1 | `guide-preferences.json`, `0x660c4` | `ev_dd5fd9b9145a8dc406a11a276788548e5b82976f719e645f078058430f4e9399` |
| S2 | `guide-artboard-point-filter.json`, `0x333f4` | `ev_8d0f46d62eb47aee6620a59df476ef8fd5f8d792083136899158aec59974133f` |
| S3 | `guide-artboard-segment.json`, `0x33808` | `ev_1d0e6a290b52100488ebb8fe1371b56b61ab72d143d6d8b1a3cfbd2358f03ae6` |
| S4 | `guide-candidate-window.json`, `0x6524` | `ev_26afbde129c21e71b93fbe4f27d72540e69b3bd6154ca4b6ea8c35d8c5578848` |
| S5 | `guide-tolerance-conversion.json`, `0x71cf4` | `ev_026b517050985c20755c2c3f4f0edd990bdbfe68bed8ce46cdf1584c671ddb4d` |
| S6 | `guide-draw-scene.json`, `0x47f50`; `guide-draw-consumer.json`, `0x617c0` | `ev_fc8cc0e891ccd6521a580ed06620e3e4e52d8a45ff4ec1ad4fa1b0ed0e9e1ab4`, `ev_a6ee65ef7eda18ca6fac57e82620ce48c4bc87b73ad66ce230d05e5a765f8228` |
| S7 | `guide-nominal-threshold.json`, `0x28e0c` | `ev_d8acdcbc83df39a879b6aa55962e386e14a6dbc26acd13ea03e05a7b7a2be532` |
| S8 | `guide-segment-predicate.json`, `0x77100` | `ev_ce732849b1c330673ca643cc6c57963b63bb7172ce632f66919a5036a6b92724` |
| G1 | `guide-line-address-draw.json`, `0x54aa0` | `ev_358c0953b9a129c03db22c58e3e4e3256e4a9f17e0dc50d39c0c298aa7287332` |
| G2 | `guide-align-address-draw.json`, `0x56f84` | `ev_97ba852dbdbacf1533fb7f19a24d7cf598e0dd19063344757d1b0d830ae4bb4e` |
| G3 | `guide-segment-address-draw.json`, `0x579a0` | `ev_2d142304322738e3635478c75d3545c93f093da8e57a89217cfb135240c3af70` |
| G4 | `guide-align-endpoints.json`, `0x5594c`, plus constructor/updater/view-helper instruction slices | `ev_77246643f474d56bd91409256ec5ef10d8d67963c69809973680f393db4e4399` |
| G5 | `guide-line-endpoints.json`, `0x54d3c` | `ev_1d9d0cdc9155459366efe21cb68ac2d830a29f680a53176bb7c9c69fb0963b7d` |

Hopper's pseudocode contains duplicated branches, inferred types and occasional omitted expressions. For example, its tolerance-conversion pseudocode obscures the positive-factor division; the actual `fdiv` instruction was checked. Conclusions above use the relevant instructions and pointer/fixup identities. Static code reachability is not runtime execution coverage.

## Question status

| Question | Status |
|---|---|
| Four corner and four side-control geometry? | Answered for the ordinary inspected Free Transform widget, including conditional small/mode exceptions. |
| Corner proportional solver and center-resize mechanism? | Answered at instruction level; the native keyboard names for flag bits require companion UI confirmation. |
| Edge controls differ from corners? | Answered: separate methods and transform-info paths. |
| Minimum-size clamping and crossings? | No positive clamp in inspected geometry helpers; full host reflection/degeneracy behavior remains unresolved. |
| Artboard target always eligible? | Answered negatively: separate artboard/category/range/intersection gates exist. |
| Nominal versus enlarged tolerance? | Answered for two specific candidate/predicate paths; universal object-alignment and release policy remains unresolved. |
| Simple axis-aligned guide span? | Answered for specific native interval-union branches, including optional updated-rectangle dataflow and explicit view-mapping boundary. |
| Smart Guide span/priority/persistence for every gesture? | Category-dependent whole/half-extent rules and feature gates exist; complete policy remains unresolved. |
