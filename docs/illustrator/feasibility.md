# Illustrator reference feasibility

A bounded read-only baseline, captured 5 November 2026. It is feasible to investigate selected Illustrator interactions to guide an original Ivo implementation. Full reconstruction of Illustrator is a substantially different, open-ended task; this baseline does not claim it.

## Installed target and actual REA result

The selected installation is `/Applications/Adobe Illustrator 2026/Adobe Illustrator.app`, bundle identifier `com.adobe.illustrator`, version/build **30.8.2**. The main executable is `Contents/MacOS/Adobe Illustrator`: a thin **arm64 Mach-O**, 44,546,768 bytes, SHA-256 `8436271e53fe7778dab0eeeea5d8cb6c4b87d0ff28cce77857a534b4fc5fe1ad`.

REA 6.7.0 `inspect-macho` completed for the main executable and three focused plugins, without launching Illustrator or its plugins:

| Image | Bytes | REA Evidence ID |
|---|---:|---|
| Main executable | 44,546,768 | `ev_03ce710e61345fd943d3dea315298b97c5dbed1cd2a8652fb1aa9d3e32a5c877` |
| `Snapomatic.aip` | 639,792 | `ev_99ba0a32a6508ce742cce680efdb9ce9c800a642b73384af025fc33617d2bf79` |
| `Transform.aip` | 131,680 | `ev_a38840639c4e00d119344542a451dad29b37e58206370af5c8a999471eafc0f0` |
| `ScriptingSupport.aip` | 4,176,496 | `ev_99ffd5ab2a5a1dc0ebfcf9e3ece0e1567f23cb7ce1aabee48926f4669463ee22` |

All four selected images are arm64. The main executable records 86 direct library dependencies, 3,310 retained import rows and two retained export rows. REA marks import/export coverage nonexhaustive. Its Mach-O build metadata specifies macOS 13.0; the outer plist reports a different minimum, 10.13.0. The plist alone is therefore not sufficient to infer actual OS compatibility.

A path-only installation inventory found 22,841 regular files, including 263 `.aip` plugin bundles and 33 sample JavaScript `.jsx` files. This gives useful boundaries for a focused study; it is not a full code inventory or native call graph. Complete raw REA records, hashes, source locators, and the baseline summary are private in the parent workspace under `work/illustrator-feasibility/`, outside this repository.

## Useful shipped contracts

The installed `Contents/Resources/Adobe Illustrator.sdef` is an AppleScript scripting dictionary with 17 suites, 136 commands, and 124 classes. It directly declares the following surfaces. These are packaged interface declarations, not runtime test results:

| Ivo concern | Observed declaration | What remains unknown |
|---|---|---|
| Image and object placement | Page items expose position, width, height, geometric bounds excluding stroke, visible bounds including stroke, and control bounds. Placed and raster items expose matrices and file-related properties. | Coordinate conventions and results for particular transformed/clipped objects need fixtures. |
| Transforms | Rotate, scale, translate, and transform operations; optional object/fill/stroke behavior and reference-point arguments; a six-component matrix record and matrix construction, concatenation, inversion, and singularity operations. | Multiplication order, pivot behavior across UI tools, modifier keys, snapping interaction, and numerical edge cases were not executed. |
| Clipping masks | A path item's `clipping` flag and a group item's `clipped` flag, alongside editable path and group objects. | UI creation/release order, compound masks, clipping bounds, and image-transform interactions require controlled behavior tests. AI-generated pixel masking is a separate surface. |
| Snapping | Shipped menu/UI resources declare grid, pixel, point, glyph, and cursor snapping, visual alignment/distance guides, object and point tolerances, and a Smart Guide response setting. | Candidate ranking, hysteresis, screen/document units, zoom dependence, modifier bypass, and drag performance remain unestablished. |

The focused `SnappingAndSmartGuides.eve` resource binds separate object and point tolerance controls and a response selector. Its control declarations contain numeric ranges 0–10 and 1–8 respectively; these are UI resource constraints, not verified engine thresholds or units, current user preferences, or guarantees that the corresponding feature flags are enabled. No general-purpose object-snapping API was established by the bounded scripting-dictionary search.

The installation has scripting support and samples. The selected root contained no `.h` or `.hpp` files; an installed C/C++ SDK header tree was not established. Plugin names and UI resources help locate later native work, but do not prove which module implements an algorithm or that a displayed feature is currently active.

## A practical next investigation

Start with a small contract: independent image-content and frame transforms, rectangular/path clipping, free object placement, and optional edge/center alignment guides. Build sacrificial documents containing known geometry and inspect resulting object/matrix/bounds state through the shipped scripting interface. Observe mouse and keyboard behavior against those fixtures, then trace narrowly selected native routines where that evidence leaves a concrete ambiguity. Keep native disassembly, declarations, and observed UI behavior distinct.

For Ivo, retaining original image bytes, recording placement/crop separately, and applying optional snapping to otherwise free coordinates are reasonable original design choices. The six-coefficient transform and clipping-group declarations make Illustrator a useful behavioral reference; copying Adobe's implementation is unnecessary for those features. Exact Illustrator parity is not established by this feasibility baseline.

No Illustrator launch, user-document access, Adobe/account/profile changes, new dependencies, or function decompilation occurred in this pass. The four actual REA metadata inspections completed successfully using scoped process-inspection access. Any deeper interactive or native-function study should be reported as a separate stage with its own fixtures, evidence, and coverage.
