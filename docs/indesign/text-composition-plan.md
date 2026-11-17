# InDesign reference pass for text composition

Prioritized 16 November 2026 after the repeated-font-size defect. The immediate defect and live note are repaired; the larger text revamp is planned, not implemented or reverse engineered yet.

## Reference questions

1. Measure selected characters versus frame defaults, typing style and paragraph-mark inheritance. Repeated 12→123→12 changes must preserve the effective style and avoid invisible metric owners. Include partially selected words, mixed sizes, empty paragraphs, Unicode and soft/hard breaks.
2. Separate automatic leading from fixed points. Measure the baseline rule for mixed runs, auto-leading percentage, paragraph-wide leading preference, baseline-grid alignment, frame insets, first baseline and vertical justification. A displayed computed number must not silently become an explicit setting.
3. Record character/paragraph style inheritance, local overrides, clearing overrides and applying a style across multiple paragraphs. Decide which semantic information belongs in Ivo's canonical source rather than its editable DOM.
4. Trace caret, selection direction, word/paragraph navigation, double/triple clicks, insertion formatting, undo/redo and composition transactions across format boundaries and threaded frames.
5. Measure reflow through unequal frames/pages, overset, automatic continuation and frame deletion. Editing, reading and PDF export must use the same composition authority; a camera transform must not change authored metrics.

## Evidence already available

Adobe's [leading documentation](https://helpx.adobe.com/indesign/desktop/format-and-style-text/character-formatting/adjust-line-spacing-with-leading.html) describes leading as a character attribute and says the greatest leading value on a line controls its spacing. It also identifies paragraph-style, auto-percentage, baseline-grid and vertical-justification interactions. These are documented rules, not observations of the installed runtime. The [official spacing tutorial](https://www.adobe.com/learn/indesign/web/adjust-letter-spacing) documents controls and the Auto shortcut. No production Ivo default has been changed merely to follow a tutorial recommendation.

Both InDesign2026 and InDesign2027 are installed. Before native work, bind one exact installed build and digest, use an owned disposable document, and capture source settings, baselines and frame geometry. Reuse the installed reverse-engineering skill/REA CLI or connected tools. Inspect scripting declarations/resources first; trace/disassemble a native routine only where it answers a remaining behavioral question. Never infer a complete composer from a string, symbol, screenshot or one script result. Preserve existing user documents/settings and do not copy proprietary implementation into Ivo.

## Engineering direction to validate

Keep a DOM-independent semantic text/style owner with stable text-flow identity, explicit paragraph settings, character-run overrides and an explicit Auto/fixed-leading distinction. The editor DOM, derived line fragments and PDF layout should consume that source rather than accumulating formatting containers as authority. Determine the exact run/style representation after the reference matrix, then use a versioned migration with frozen fixtures if the persisted format changes. Retain words, paragraphs, links, original assets, frame IDs/geometry and undo ownership.

Build the comparison fixture before broad replacement. Add incremental paragraph reflow, caret mapping and performance measurements as independent responsibilities; retain vector text during zoom and avoid rebuilding input DOM during composition. Test current known behavior alongside each new rule. Exact glyph shaping/composition, CJK/RTL breadth and mobile input remain evidence requirements, not implied by using an InDesign baseline.
