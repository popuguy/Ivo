# Illustrator native selection, transforms, masking and snapping

This pass extends [the feasibility baseline](feasibility.md) with actual ARM64 disassembly and REA/Hopper function dossiers from the installed Illustrator 30.8.2. It establishes useful gesture and geometry contracts. It does **not** recover Illustrator’s complete selection, clipping or snapping implementation.

## Scope and identity

The target is `/Applications/Adobe Illustrator 2026/Adobe Illustrator.app`. This native track performed static analysis: it did not launch Illustrator, execute scripts or read user documents. Runtime fixtures from the parallel investigation are separate evidence. Project-local copies, snapshots and raw evidence are retained outside the Ivo repository at `work/illustrator-deep/native/`. Installed binaries and global permission/configuration settings were not changed.

| Principal module | Bytes | SHA-256 |
| --- | ---: | --- |
| Snapomatic | 639,792 | `cebbbd19af24c879e02e63d05067243dbd1ea909acbb03c82b7dca3b8b8db303` |
| BoundingBox | 272,640 | `1c567c428cfddccf198e2108463c920657ffe86b77eb8be053571227d3a134b2` |
| Transform | 131,680 | `c04acbe4c8f3ca59cbf179c1397b7face5795ed1ef9384237dc700b0fb0a19f8` |
| MaskHelper | 64,528 | `b9756395eb5eb0fdd24c379dfdf6b2c68dc0614c6bd660658dcb75c23af3118a` |

Nine candidate plugins received actual REA Mach-O inspection, including TransformUI, SelHat, SimpleTools, ToolSelector and MaskingAiCore. Five binaries have full `__text` disassembly transcripts and preserved source copies. There are 40 function dossiers covering **39 distinct module/address pairs**; the two profiling-label queries resolve to the same Snapomatic routine. These counts describe inspection scope, not a percentage of Illustrator recovered.

All addresses below are unslid virtual addresses within their named plugin, not runtime process addresses. Principal modules are thin ARM64 images. Source hashes were checked again after analysis.

## Selection and gesture lifecycle: answered in part

BoundingBox is a useful native entry point for Free Transform and bounding-box interactions. Its startup routine `0x20630` registers the Free Transform tool, bounding-box suite, annotation/timer work and preferences. This identification is supported by registration calls and imports, not just its filename. [B1]

The notifier dispatcher at `0x22edc` compares explicit event names and routes:

| Event | Dispatch callsite | Handler |
| --- | --- | --- |
| Selection mouse down | `0x23378` | `0x12194` |
| Selection drag | `0x233b0` | `0x13e44` |
| Selection mouse up | `0x233f4` | `0x14e0c` |

The down handler reads `scaleLineWeight` and `transformPatterns` and initializes gesture state. Drag dispatches on a stored operation mode. The up handler resets a gesture-state field and contains action-manager recording paths for `ai_plugin_bBox_scale` and `ai_plugin_bBox_rotate`. A separate dispatcher, `0x23eec`, handles tool selection/deselection, cursor tracking, drawing, timers and Transform Again. This is evidence of a persistent gesture lifecycle with distinct preview/update and completion paths. It does not prove a particular undo boundary or cancellation policy. [B2–B4]

The geometry helper `0x12ff8`, reached from drag, performs scale-ratio and matrix operations and reads `constrain/angle`, `smartGuides/isEnabled` and `smartGuides/showReadouts`. Its callsite at `0x13b84` invokes offset `0x90` of the acquired AI Cursor Position Suite. Snapomatic’s suite registration binds that slot to `0x4f298`, which forwards to `0x4e5d0`. This gives an actual cross-plugin gesture-to-snapping relationship. [B5, S1, S4]

**Unresolved:** the complete hit-test policy for filled interiors, unfilled paths, overlapping objects, direct selection, marquee selection and touch targets. SelHat’s packaged resources concern saved selections, and SimpleTools’ inspected entry routine registers line/arc/grid creation tools. Neither is evidence that those plugins implement general direct selection. BoundingBox’s imported `UI_FreeTransform` methods also place some control behavior in another native library.

## Transform geometry: answered for selected paths

Transform’s routine `0x8734` obtains an art rectangle through AI Art Suite and computes nine reference positions from the rectangle’s extrema and midpoints. For reference values at least nine, the instructions instead interpolate using two stored normalized coordinates:

`x = x0 + (x1 − x0) × u`, `y = y1 + (y0 − y1) × v`.

This establishes a pivot independent of a screen handle. Rectangle coordinate orientation and allowed custom-coordinate ranges are not established by this routine alone. [T1]

The caller `0x814c` obtains that pivot, builds a six-double matrix through `0x8854`, then applies it through `0x8c40`. The matrix builder calls AI Real Math Suite operations around negative and positive pivot translations, with separate scale/rotation/translation branches. It includes target-size divided by absolute current-extent calculations, explicit zero-extent branches selecting scale `1.0`, and optional axis sign changes. These are instruction-level observations; exact public enum names and every option bit have not been recovered. [T2–T3]

The application wrapper `0x8c40` combines option flags and delegates to **AI Transform Art Suite**. The lazy suite constructors at `0x95a0`, `0x9468` and `0x9780` independently identify AI Real Math, AI Art and AI Transform Art suites in the full instruction transcript. Consequently, these plugins establish matrix construction and delegation; they do not contain all art-type geometry mutations. [T3]

## Snapping and constraints: answered in part

Snapomatic initialization at `0x44480` allocates a `0x100`-byte table, registers **AI Cursor Position Suite version 1007**, and writes 31 function pointers into its 32 pointer-sized slots. One slot is not assigned in the inspected routine. Its native import records separately identify AI Cursor Snap Suite version 1016, AI Art, AI Group, AI Real Math and document/view services. Position tracking and lower-level snapping are separate suite boundaries. [S1]

The exported path `0x4bad0 → 0x4ab08 → 0x62c2c` reaches actual candidate decisions. In `0x62c2c`, instructions at `0x633a8–0x633dc` compute a candidate’s squared two-dimensional displacement, `(dx × dx) + (dy × dy)`, and compare it with an incumbent value alongside a candidate classification/rank check. This supports distance-sensitive candidate evaluation. It is insufficient to claim that every candidate is scored the same way, that the global winner is always the nearest, or that a complete tie-break order has been recovered. [S2]

The same routine reads `tws/SelectionTolerance` and `selectionTolerance`. Later branches compare a cross-product-style residual and a Euclidean point residual with the literal `2^-16` (`0x3ef0000000000000`, approximately `0.0000152587890625`). That constant is a geometric comparison epsilon in these branches; it has **not** been identified as the user’s snapping distance in pixels or points. Direction normalization and the relationship to UI tolerances remain unproven. [S2]

The gesture-linked routine `0x4e5d0` computes vector differences and calls `atan2` at `0x4ea10` and `0x4ea60`, with explicit coincident-vector checks. Together with the actual BoundingBox suite call, this establishes angular geometry in the tracking path. It does not establish the complete allowed-angle set or Illustrator’s visible angular snapping behavior. [S4]

An important negative finding: references to `SuiteAPI: Track` and `SuiteAPI: TrackAngularRotation` at `0x537c4` and `0x53800` both resolve to initialization routine `0x531d0`, where diagnostic/profiling labels are constructed. Those labels were **not** counted as recovery of the tracking algorithm. [S3]

**Unresolved:** complete candidate generation and visibility filtering, spatial indexing, exact category priority, tolerance units and zoom conversion, hysteresis/release behavior, guide persistence, modifier semantics and all degeneracies. Profiling/assertion strings about art/alignment constraints and incremental caches are useful breadcrumbs, not proof of the corresponding algorithms.

## Clipping masks: helper behavior answered; core engine unresolved

MaskHelper’s retained import table maps `0x83b0` to AI Art Suite, `0x83c8` to AI Group Suite and `0x83d0` to AI Path Style Suite. These mappings are corroborated with the native chained-fixup output, rather than interpreting encoded source pointers as plain addresses.

Its selection callback `0x1850` collects matching art, traverses groups/children through Art and Group suite calls, and invokes recursive helper `0x1cac`. That helper branches on art type, traverses child/sibling links, queries path style and updates art attributes. The filter callback `0x2308` also obtains matching art and path styles and has filtering/style-application branches. Together with the packaged “Clipping Masks” and “Create Fill&Stroke for Clipping Mask” resources, this identifies clipping selection and appearance-helper work. [M1–M2]

This does **not** establish the core make/release clipping-group algorithm, top-object selection ordering, nested clipping topology, winding rules, raster sampling or crop destructiveness. MaskingAiCore’s model-inference strings identify a separate candidate subsystem; it was inventoried but not treated as the ordinary clipping-mask engine.

## Implications for Ivo

These are original reconstruction choices informed by the evidence and the user’s requested interaction:

- Drag from the object’s body for ordinary movement. A top handle is unnecessary as the primary movement interaction. Keep the selected object, pointer capture, starting geometry and gesture completion explicit.
- Store content geometry, frame geometry, pivot and affine transform separately. This supports independent movement, resizing, rotation and masking without coupling them to a particular handle layout.
- Separate snapping candidate generation, geometric evaluation, final constraint choice and visual guides. Define and test Ivo’s own priority, screen-space tolerance and release policy rather than assuming Illustrator parity.
- Represent a clipping frame as explicit document state and expose content repositioning within it. The mask helper evidence does not justify copying an inferred hidden clipping algorithm.

## Evidence and limits

| Ref | Private evidence | REA Evidence ID |
| --- | --- | --- |
| B1 | `bbox-events.json`, `0x20630` | `ev_8a278d99ce27a8b4b2eee43864746fbadce2418a1f027b3ba46d66c969e12cba` |
| B2 | `bbox-callback-11.json`, `0x22edc` | `ev_24927050c456a610bfe342ae64415fd99113714f0502c37f91608f14a760d3a3` |
| B3 | `bbox-mouse-down.json`, `bbox-drag.json` | `ev_a21b5a5c222c7f035816bb60dfa6a3d91bdd2724cbd7d6e4ecc8a165f6b51647`, `ev_6f1aa83f46ca12f42b61680d01385a98ad739374e14261696e576be6462caeeb` |
| B4 | `bbox-mouse-up.json`, `0x14e0c` | `ev_ac75c6e8207e7805e9bf82ef5b2bf746e0c9a9e6ba6ff6a31ff2cac4a383e6bb` |
| B5 | `bbox-scale-track.json`, `0x12ff8` | `ev_f10359e98073b65eada65c506830e6725908d23bc424d33b75ce94d89c04c55a` |
| T1 | `transform-matrix.json`, `0x8734` | `ev_9d0fa14730b5a8c5056618590eebf39900664f0bbfd879d1fb1fc42025d2a287` |
| T2 | `transform-affine-core.json`, `0x814c` | `ev_97b76e110d530bcc513631d2fcf1dfa0f1cbff4dd166f8cb056226559c2e7f51` |
| T3 | `transform-matrix-build.json`, `transform-apply.json` | `ev_1e2511dae78c2fc6188a087343da691858797835f7977d567c4185e6a9c8cf61`, `ev_a2c6846cfd498fc6b46801cc5c55381fd1b8df1bd39caec10538830a0fc7cd6f` |
| S1 | `snap-suite-init.json`, `0x44480` | `ev_59895a96e485cd13d0f54dcfba6e34b1ca45ec24a78b6e68618b0a2eaf04e62f` |
| S2 | `snap-constraint-evaluate.json`, `0x62c2c` | `ev_86d0d2d940574b553a09cf624aa47fb05b4a7d8862699265579438dff236e031` |
| S3 | `snap-track-logging.json`, `0x531d0` | `ev_9406535cec7275a4e69392fea8f5c16a0b68de2fdfc5b3a4da457f95f412d1bb` |
| S4 | `snap-bbox-angular-bridge.json`, `snap-angular-core.json` | `ev_d63a62f22738f4d4c55309fb6787668656d0dd90221420b3ab3f164e25c17df4`, `ev_42d41ec861adfdecc3994ad7c7a1072b4aa63a4320ca828f0f251c19962f0a32` |
| M1 | `mask-operation.json`, `mask-clipping-check.json` | `ev_d8506ca6538c4e5780c24444410d32533cf1b4c02527b977780fbec4ab9c06c8`, `ev_d12d7aff6d8665d32bdb9178e1aa123bbb3b700e64ea022f6e0a48ecb1c42e19` |
| M2 | `mask-filter.json`, `0x2308` | `ev_a931628141b4b2b026025db7b5605f7d920cf8b6846cd23c56a3381e208426ad` |

Full transcripts, fixup tables, source hashes, query status and the deduplicated dossier ledger are private evidence in `summary.json`. Every instruction address returned in the 40 dossiers was also present in the corresponding LLVM transcript. LLVM prints some newer ARM64 encodings as `.long`; Hopper supplies decoded instructions for these sites. Hopper’s public API does not supply complete function body ranges; indirect suite calls lack full typed signatures. Several large pseudocode outputs contain duplicated branches, inferred types and misleading string/number renderings. Claims above were checked against the relevant instructions and original-file fixups; pseudocode was not treated as recovered source. Static analysis did not observe any of these paths executing.

Native-provider CLI operations closed their owned sessions. A metadata-only attempt inside the restricted sandbox hit process-inspection `EPERM`; the reported command PIDs were confirmed absent using scoped approval, then all nine metadata inspections succeeded with scoped approval. No global permissions were changed and no cleanup blocker remains.
