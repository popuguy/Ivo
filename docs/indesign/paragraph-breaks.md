# Owned paragraph decisions over native measurements

This is the next bounded slice of the [composition experiment](native-composition-prototype.md). `domain/text/paragraph-breaks.js` owns a pure paragraph decision; Core Text supplies measured alternatives and draws the chosen ranges. It is not yet the live editor backend, a hyphenator, a full justification engine or a certified InDesign composer.

## Contract and policy

`chooseParagraphBreaks` receives a source interval, ordered legal break opportunities, measured line alternatives and available widths for successive physical lines. The domain has no DOM, fonts, storage or native dependency. Its caller supplies validated shaping/Unicode opportunities; the function cannot invent a break inside a cluster or generate a hyphen. Mandatory breaks cannot be skipped. Nonnegative break penalties remain visible in each chosen line.

The versioned policy is `ragged-right-quadratic-v1`: each line costs 1 plus its break penalty; nonfinal lines add `100 * ((availableWidth - measuredWidth) / availableWidth) ** 2`. The final line has no raggedness penalty. A line wider than its slot is infeasible. This explicit initial policy is an Ivo algorithm, not recovered Adobe code or a claim about Adobe's private cost function.

`paragraph` mode finds the least-cost complete path across break-position/line-slot states. `single-line` mode greedily takes the furthest feasible opportunity in each slot, using the same measurements/cost for comparison. Unequal widths, break penalties and mandatory positions participate in both routes. Deterministic edge ordering removes dependence on backend result arrival order. Limits bound opportunities, measurements, slots and visited work; exceeding a budget or failing to fit returns an explicit unfit result. It never silently drops source or substitutes another composer.

## Native proof

The probe exposes a bounded ASCII/explicit-break `measure-lines-proof` query. It returns visible widths from actual Core Text lines; trailing whitespace does not count as painted width. It writes no PDF. A separate `explicit-lines-proof` request validates ordered, complete line decisions and rejects forced-break crossings or a line that exceeds its frame. The PDF emitter and glyph/caret output consume those exact decisions without rewrapping.

The controlled paragraph has 171 measured alternatives. At an 80-point width, the whole-paragraph path changes three earlier breaks and lowers the declared cost from 70.887535 to 61.037251. Native output preserves all chosen endpoints, and an independent PDF parser verifies the complete text and all ten visible baselines. Both greedy and optimized pages were rasterized and inspected. The costs are policy values, not user-facing quality scores or an InDesign equivalence tolerance.

The adapter now separates metrics kerning from tracking. Zero tracking leaves font-pair kerning active; only an explicit `none` kerning policy sets Core Text's disabling zero-kern attribute. A regression measures `AVATAR To WA` with metrics, no kerning and independent added tracking. This follows Apple's distinct [kerning](https://developer.apple.com/documentation/coretext/kctkernattributename) and [tracking](https://developer.apple.com/documentation/coretext/kcttrackingattributename) contracts. Measurement-only requests do not emit fonts/PDFs; PDF-producing modes retain their embedding checks.

Four domain tests cover a known greedy counterexample, unequal slots, mandatory breaks/penalties, source invariance, malformed input, work budgets and comparison with exhaustive feasible paths over 30 deterministic examples. The native proof tests actual font widths, requested break retention, separate kerning/tracking, malformed query ranges, incomplete/duplicate explicit breaks and overflowing decisions. Standard checks pass with 226 unit tests. Run `test:composition-prototype` as described in the parent experiment document; its Python PDF dependencies remain verification-only.

Controlled native application comparisons are retained privately, with exact font identities/digests and unresolved differences. Matching one family/paragraph over several widths does not establish a general composer. No native reference capture, installed font file or proprietary implementation enters this source tree.

## Remaining adoption work

The prototype has no justified word/letter/glyph fitting, dictionary/discretionary hyphenation, no-break/keep/widow scheduling, fitness transitions, optical/per-pair controls, script/CJK/vertical policy or complete paragraph/publication invalidation. Break candidates currently come from a controlled ASCII fixture; production candidates must come from the declared Unicode/language policy. The optimizer must run in the eventual bounded composition worker, not synchronously on the input thread by assumption.

Native presentation/input, accessible selection, same-authority export for the release languages, wrapped/anchored content, tables/notes and real device performance still gate replacing browser layout. This establishes an owned global decision and a repeatable native witness; it closes only that subset of P3 in [the architecture proposal](../decisions/0004-text-composition-authority.md#decisive-prototype-gate). The [release programme](text-parity-programme.md#capability-acceptance-ledger) remains open.
