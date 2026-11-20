# Native object wrapping

The explicit native Paragraph and Single-line previews now compose around the existing object exclusions. Exact-font vector ink, source ranges, caret geometry, on-page editing and selectable PDF consume one planned result. Existing-layout flows retain their browser composer. No saved composer is migrated automatically.

## Composition and input

Native columns receive disposable, transformed exclusion paths in unscaled text coordinates. Insets and text scale are applied once. Box, polygon Shape, side/inverse, Jump and Next use the same object/layer/parent/clip geometry as the existing layout. Shape continues to mean the authored frame/path; image-alpha detection and custom wrap paths remain open.

The planner assigns consecutive source ranges to surviving fragments on one baseline. Mandatory paragraph/soft breaks advance to the next physical row, leaving later fragments unused. First-line indent belongs only to the first source fragment. Paragraph mode uses the declared Ivo quadratic objective; wrapped Single-line prefers the longest fitting fragment that respects the minimum word spacing when possible. Neither is a claim to Adobe's complete paragraph scoring policy.

Navigation joins same-baseline fragments into one physical row: Home/End span both sides; Up/Down move between rows. Pointer hits examine all fragments of the nearest row while retaining source affinity and primary/secondary native caret offsets. The invisible canonical input remains the keyboard/IME owner but cannot intercept native preview clicks. Trusted selection and replacement across a gap share that one source and undo timeline.

Object movement, order, layers, parent definitions, clipping and wrap preferences invalidate derived placement. Font measurements survive geometry-only changes. A fully excluded authored frame can continue into an empty owned page; future pages do not inherit the original page's obstacles. Passive views retain overset prefixes without creating pages. Unsupported source edits and failed composition preserve source, pages, selection and history.

## Bounds and remaining qualification

Wrapped paragraphs support left, right, center and the justified alignments. A centered fragment on its own row centers within its available space. When two or more fragments share a baseline, the first meets the right edge of its segment, the last meets the left edge and interior fragments center individually. Custom word spacing fits each of those widths independently. The editor, selection and selectable PDF share those origins. Horizontal character scaling and qualified OpenType settings can vary within a paragraph.

Runs in one paragraph can change font face, point size and leading. The composer measures each candidate physical line across all of its occupied segments. A taller run on the far side of an object can move the baseline for the entire line. Fixed leading preserves the specified advance. A shorter line can stay above an exclusion or in an earlier frame when the next run needs more clearance. Uniform paragraphs use the existing faster path. Exclusion columns still require Top alignment. With Wrap Around Bounding Box or Jump to Next Column, a baseline shift moves the glyphs and a vertical scale stretches them around the baseline. The original line band still determines the usable space around the box. A lowered or raised glyph can extend beyond that band. Signed ink coordinates drive carets, selections and vector output. Shape and Jump Object still require unshifted text at 100% vertical scale. Literal tabs around objects remain open.

Wrapped native flows use the Paragraph preview's existing 10,000 UTF-16 positions, 1,024 opportunities, 100,000 alternatives/states, 1,000,000 fitting checks, 2,048 placements and 128-column limits, including wrapped Single-line. Geometry additionally bounds vertices and inverse-slice complexity. Work exhaustion is an explicit rejection, not a fallback layout. Preparation and search yield bounded work. Full physical input, IME, rotated selection overlays, international shaping and iPhone/iPad qualification remain open.

Empty contour/inverse bands advance to find a usable interior instead of jumping to the contour's bounding-box bottom. Bounds/Jump restart from the exclusion boundary plus first-baseline offset; small offsets use conservative full-ascent clearance where needed. These bounded policies remain distinct from full comparative reference qualification.

The shared exclusion implementation now unions ordinary blocked intervals and subtracts them with one ordered sweep. Independent cell-coverage and mixed-constraint oracles, order permutations and 1,207 old/new differential cases preserve geometry. A private synthetic 1,024-rectangle case reduced its longest geometry slice from 13.8 ms to about 1.3 ms; this is a scoped CPU measurement, not physical input-latency or device qualification.

Wrapped flows use the existing planned-line protocols for ordinary text, advanced character settings and custom word spacing. No new persisted positions, generated text, format migration or vault write on read is introduced. See the [verification record](verification.md) and [object-wrap backlog](object-text-wrap.md) for evidence and remaining scope.
