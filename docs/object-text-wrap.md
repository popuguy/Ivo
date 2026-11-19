# Object text wrapping

Object wrapping is a high-priority prerequisite for Paul to make representative notes and layouts. It precedes requesting those fixtures and remains ahead of unrelated interface work. The first usable increment applies exclusions in actual page composition, editing and PDF; it is not full InDesign wrap parity.

## Using the increment

Select an object and open **Properties → Text Wrap**. The five modes are **None**, **Box**, **Shape**, **Jump**, and **Next**. Box uses four offsets; Jump uses top/bottom offsets; Shape and Next use a uniform offset. Side choices include both sides, left, right, largest area, toward spine and away from spine. Box/Shape can invert their boundary. Text frames expose **Ignore Text Wrap**. No Selection exposes document stacking/spine policy, and Layer Options can suppress wrapping when that layer is hidden.

Shape follows a polygon's vertices or an image/text frame's edges. It does not detect an image subject or alpha channel. Mode labels and classic tooltips are functional controls in Ivo's existing palette/font; a dedicated reference-matched Text Wrap panel and artwork remain interface work. Smooth object dragging is retained; text recomposes at the completed geometry edit rather than rebuilding the whole flow on every pointer sample.

The public behavior contracts used for the implementation are Adobe's [wrapping guide](https://helpx.adobe.com/indesign/desktop/format-and-style-text/composition-and-text-wrapping/apply-text-wrap.html), [object preferences](https://developer.adobe.com/indesign/uxp/dom/api/t/text-wrap-preference/), [frame preferences](https://developer.adobe.com/indesign/uxp/dom/api/t/text-frame-preference/) and [layer policy](https://developer.adobe.com/indesign/uxp/dom/api/l/layer/). Private reference measurements and the local reference map remain outside Git. Declarations and bounded geometry witnesses do not certify InDesign's complete line-breaking policy or physical behavior.

## Source and layout ownership

- Authored settings live on objects/frames and document/layer policy under **archive 9 / canvas 8**. Older readers reject the capability rather than drop it. Existing archive-8 documents open without conversion or writes. Folder manifest 1 and browser IndexedDB 4 remain unchanged.
- An actual wrap edit adopts affected independent area text into canonical flows in that same undo transaction, preserving frame IDs, exact HTML and typography. Point text remains unchanged. New or moved area frames and pasted wrapping objects follow the same authoring boundary. Rendering, selection and opening do not adopt or rewrite text.
- One pure contour validator governs commands, schema and geometry. Transform-aware exclusions project the entire line band, including stroke/offsets. Two available regions can receive consecutive source fragments on one baseline. Source intervals/provenance remain continuous across segments, columns and pages; overset stays explicit.
- Existing-layout text uses browser font shaping in a disposable, unscaled measurement surface. Wrapped segments own visible ink. One retained canonical input owns typing, IME and clipboard. Navigation joins segments of a physical row and retains upstream/downstream affinity. The painted caret and native query anchor derive from preview geometry. No line fragments or whitespace/caret paint are saved as source.
- Display and PDF call the same layout plan. Object movement/order, layer policy, parent definitions and wrap preferences invalidate composition; camera movement and save bookkeeping do not. Mutations, formatting, text input and completed geometry edits roll back on unsupported layout, including source/derived pages/history. Parent-definition commits use the same authoring boundary.
- Line-fragment clipping includes raised/lowered glyph ink, rather than only its nominal line box. A side area too narrow for a whole grapheme is skipped; the character waits for a usable region or remains overset instead of being cropped. Grapheme-boundary lookup is lazy and does not allocate a paragraph-sized array for each measured row.

## Explicit first-slice limits

The native **Paragraph/Single-line Preview** composers do not yet accept affected object wrapping. Preflight rejects it before authoring or worker calls; choose **Existing layout** for those flows. Ignored and unrelated/off-page wrap do not block native preview. Every frame routed through the browser wrap composer currently requires **Top alignment and no text-frame/group rotation**. Rotated wrapping objects remain supported. First-baseline policy, insets, physical columns and source-owned relative baseline shifts are retained. Superscript/subscript tags, hyphenation and explicit paragraph-keep/widow/orphan overrides reject; default widow/orphan protection is still composition work. Mixed-font row choices are conservative rather than a certified InDesign paragraph optimizer.

Current Shape offsets support convex straight contours with positive/negative offsets, and unstroked simple concave polygons at zero offset. Rounded frames, crossing/self-overlapping paths, concave stroke expansion/nonzero buffering and inverse Jump/Next reject explicitly. Imported combinations use the same validator. A contracted inverted contour with no interior admits no text; it does not disable exclusion. Largest-area choice, offset joins/scaling, tangent-line tolerance and individual hidden-object policy remain bounded Ivo policies pending comparative qualification. Parent artwork can exclude actual page text; inherited parent text itself remains readonly template display until overridden.

The browser composer bounds work to 200,000 source positions and 4,096 attempted rows per flow. Budget failures preserve the authored transaction and show an error; overset is a distinct, visible outcome. Native/mobile device performance and physical IME are not qualified by hidden renderer tests. A fonts-ready 240-word diagnostic was about 22–70 ms across local runs; this is neither a process-cold benchmark nor an input-latency guarantee.

## Next work, still high priority

1. Image alpha/detect-edge contours, threshold/tolerance/interior holes, existing clipping paths and supported imported path channels; independently editable wrap paths. No AI subject-generation feature is requested.
2. Native variable-width/multiple-fragment composition, paragraph decisions around exclusions, rotated text/caret/navigation, vertical justification, robust concave buffering/curves and readonly parent-text composition.
3. Anchored-object exclusion timing, parent-only wrap and complete justification/skip-by-leading/indent/keep policies; complete stacking/hidden/group/spread qualification.
4. A dedicated dockable Text Wrap panel, reference artwork/spacing, wrap-outline interaction and physical Mac/iPhone/iPad input, accessibility and large-document checks.

Representative user documents will help after the necessary wrap features exist; their absence is not a reason to defer wrapping.
