# Illustrator text frame controls

This focused study supports the requested Illustrator-style bounding box and right-side text control. The target remains installed Illustrator 30.8.2. Shipped declarations and primary Adobe instructions establish the distinctions below; runtime fixture observations are recorded separately and must not be inferred from declarations.

## Point type and area type are different editing models

**Area type:** the frame constrains wrapping. Moving an edge or corner with the Selection tool changes the text area, and the text reflows at its existing size. An undersized frame can contain overset text. Adobe describes both corner/edge resizing and Direct Selection path reshaping in [Resize the text area](https://helpx.adobe.com/illustrator/desktop/design-with-text/add-manage-text/resize-the-text-area.html). Its [desktop text tutorial](https://www.adobe.com/learn/illustrator/web/text-basics) demonstrates unchanged type size during area resizing and a red plus for text that does not fit.

**Point type:** lines expand with the text rather than soft-wrapping at a frame width. Explicit returns start new lines. Bounding-box resizing scales the text, including stretching if the dimensions change nonuniformly; Shift constrains proportions in Adobe's desktop tutorial. This is different from changing a paragraph frame's width. See [Add text to vector artwork](https://helpx.adobe.com/illustrator/desktop/design-with-text/add-manage-text/add-text-to-vector-artwork.html) for the two line-flow models and the [desktop tutorial](https://www.adobe.com/learn/illustrator/web/text-basics) for the resize distinction.

The text contents, their formatting and the transformation of the glyphs need separate state. A rectangle-only resize function plus a single font-size field cannot express independent horizontal and vertical point-text scaling.

## The right-side control converts the text kind

The requested control is the text-container conversion widget, not a shortcut for entering text editing or fitting the frame height. Adobe's [typographic flyer tutorial](https://www.adobe.com/learn/illustrator/web/typographic-flyer-design) demonstrates double-clicking this widget to convert point type to area type, as an alternative to the Type menu command.

The installed scripting dictionary independently declares conversion in both directions:

| Dictionary command | Event code |
|---|---|
| Convert area object to point object | `AiTXCATP` |
| Convert point object to area object | `AiTXCPTA` |

The dictionary also declares a read-only text-frame kind, its affine matrix, its point-text baseline anchor and a text path for area/path text. These are genuine shipped interface contracts; their presence does not measure a mouse gesture or prove that every converted layout is lossless.

The root's subsequent controlled UI observation showed a **filled area-type circle** attached by a short stem at the right-edge midpoint. Its screen size was approximately eight CSS pixels and its position approximately eighteen CSS pixels outside that edge in the observed display setup; those are visual measurements, not recovered universal native constants. Double-clicking it changed the selected area frame from `285×165` points to a point-text bounding box of approximately `279.4761×141.7402` points. A subsequent reverse double-click restored Area Type controls without changing those dimensions. The exact hit region and point-type filled/hollow appearance were not separately measured and should not be claimed as direct runtime observations.

## Overset text requires special care

The installed main executable contains a conversion warning that area-to-point conversion can discard overset text and requests confirmation. It separately contains point/area conversion menu labels and auto-sizing labels/preferences. This establishes a product-level distinction between conversion and auto-sizing, not the internal conversion algorithm or every control binding.

Ivo should retain the complete source HTML, emphasis, links and explicit breaks when switching text kind. Any visual-line conversion must preserve hidden/overset source content too. The proposed baseline should make the difference between frame reflow and glyph scaling visible without silently destroying note content.

## Ivo document state

The model now accepts optional schema-1 text/quote fields:

```json
{ "textKind": "area", "textScale": { "x": 1, "y": 1 } }
```

`textKind` is `area` or `point`; existing text/quote blocks default to `area`. `textScale` stores independent glyph-axis factors and defaults to identity. Each factor must be finite and between `0.01` and `100`. These values remain independent of the original rich HTML and frame geometry. New model tests verify legacy defaults, exact round trips, stable links and malformed-scale rejection. Renderer/control behavior and desktop interaction checks belong to the root implementation pass.

## Original fixture and evidence

Private files are under the parent workspace's `work/illustrator-fidelity/text/`. No Adobe implementation is copied into Ivo source.

- `create-text-controls.jsx`: original 4,730-byte fixture, SHA-256 `90401c1a68a36f276170c6ea2231c3a18b8c96c46cf5fe89b5735c275f70c78f`. It creates and saves only one new named document with three named rectangles, one area text frame and one two-line point text frame. It attempts conversion on an owned duplicate and records caught errors. It does not inspect existing documents or change application preferences.
- `inspect-text-controls.jsx`: guarded read-only inspector, revision 2 SHA-256 `0bd06c15c9f13f0dcc925e800262c672af2e2314d766b000d634fb0cd549ac94`. It rejects active documents unless their workspace path, filename and owned-layer marker match. It records text kind, original contents, line strings, bounds, character size/scales, matrices and named rectangle geometry. Revision 1 is frozen separately.
- `sdef-contracts.json`: source hash and exact dictionary line locators. Main dictionary SHA-256 `ca752fed3129e592670b7a2cb16393cb89acdf89e65f56422d0308e0e95afaa9`; conversion commands are at lines 1601–1607 and text-frame declarations at 843–875.
- `native-text-string-contracts.json`: source identity and exact byte offsets in the main executable. Conversion menu labels occur at offsets `37489839` and `37489902`; the overset-conversion warning is at `37543642`. Main executable SHA-256 `8436271e53fe7778dab0eeeea5d8cb6c4b87d0ff28cce77857a534b4fc5fe1ad`. These are inert string observations, not native execution traces.

Both original scripts pass syntax checking. The root invoked creation through File → Scripts → Other Script. Run `1793939345101-331331` completed and saved its own `.ai` and report. Its original area frame measured `285×165` points with 20-point type and six composed lines; its point frame had two explicit-return lines, 25-point type, and bounds approximately `[469.9751,310.9248,692.2217,253.75]`.

The creation probe was **not** an all-successful test. The area-to-point call returned null; the subsequent snapshot of that return threw a caught `TypeError` at line 19. Thus no converted-frame snapshot or reverse conversion is established by `created.json` itself. The executed creation source is retained unchanged.

A separately guarded capture/removal script recovered the surviving duplicate in snapshot `1793939635266-58705`, then removed only that named owned duplicate. The capture establishes that the first conversion **did occur** despite its null return. The recovered duplicate reports `POINTTEXT`, the same 20-point size and 100% horizontal/vertical character scales, and the same six line strings. Its contents contain five inserted U+0003 line separators at the former automatic wraps. Removing those inserted separators yields the original source text exactly; these are forced line breaks, not new paragraphs. Its bounds shrink to approximately `279.4761×141.7402` points with top Y `302.5400`, rather than the original area's `285×165` frame and top Y `300`. Font-metric bounds and the frame are therefore distinct. Exact comparisons and the capture digest are retained in `conversion-derived-checks.json`.

The root executed additional owned-only probe `measure-owned-text-api.jsx`; run `1793939889048-795979` returned `ok:false`. Its area→point and reverse-conversion steps could not reacquire the expected named duplicate and failed explicitly. No reverse-conversion result is established by that run.

Its **point_nonuniform_scale** step succeeded. Scaling the two-line point object by 200% horizontally and 150% vertically about the top-left kept its contents and line strings intact. Native character size changed from `25` to `37.5` points, horizontal character scale from `100` to approximately `133.3333373` percent, and vertical character scale stayed at `100` percent. The reported text-frame matrix stayed the same. The resulting bounds were approximately `444.4937×85.7627` points versus `222.2466×57.1748`, with the same top-left. Thus this route normalizes vertical scaling into font size and represents the remaining relative horizontal stretch in the character scale; it does not simply expose a changed frame matrix. Bounds have small font-metric rounding differences and should not be treated as mathematically exact doubled dimensions.

The final owned snapshot, `1793940356478-659714`, corroborates the successful **GUI** reverse conversion independently of the failed named-duplicate API steps. `IVO_area_original` is again `AREATEXT`, with dimensions `279.47607421875×141.740234375`, size `20`, and character scales `100/100`. Its contents retain all five U+0003 forced line separators inserted during the forward conversion. The six line strings remain identical. Reverse conversion therefore did **not** recover the original larger frame or remove those forced breaks in this fixture. Exactly two text frames remained; the unrelated original point frame and the three named rectangles retained their original geometry. Cleanup of the owned study document is handled by the root; this track did not close any application document.

This track opened no native disassembler session and performed no GUI actions. Native UI control/resize observations and any successful conversion measurements belong to the root's companion ledger.
