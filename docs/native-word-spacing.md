# Native paragraph word spacing

Word spacing is an explicit paragraph capability on the native composition preview. It changes the advances of ordinary and nonbreaking spaces using the exact portable font bytes. The canonical flow still owns the text, named styles and paragraph range; derived lines, glyphs, carets, adjustment diagnostics and PDF tokens are disposable. Existing documents keep their previous spacing policy and composer until an authored edit selects this capability.

## Source and controls

Paragraph Properties → More options → Word spacing opens minimum, desired and maximum percentages. The initial proposal is 80 / 100 / 133, matching the observed reference defaults; opening or cancelling does not author them. All three values apply as one edit, in the selected paragraphs, with one undo step. Mixed selections require explicit values. Reset writes `normal`, returning the affected paragraphs to the earlier composer behavior. Named paragraph styles can inherit or explicitly own the same atomic value.

The source representation is one normalized string: `wordSpacing: "80:100:133"`, or `data-ivo-wordspace="80:100:133"` on a paragraph. `normal` means no new policy. Each percentage is finite and between 0 and 1000 inclusive, with minimum ≤ desired ≤ maximum; fractions are retained. This avoids intermediate crossed triples during editing. The field never belongs to a character run and is not approximated with browser CSS `word-spacing`.

Any authored word-spacing value, including explicit `normal`, requires archive 10 / canvas 9. The capability remains after Reset so an older writer cannot unknowingly discard the field. Reads do not introduce it, enable native composition, rewrite source, or touch a vault. Manifest 1 and IndexedDB 4 are unchanged; the frozen archive-9 fixture retains its original normalization and bytes.

## Nonbreaking spaces

Type → Insert White Space offers Nonbreaking Space and Nonbreaking Space (Fixed Width). Both retain one Unicode source character and bind adjacent words. U+00A0 shares the line’s word-space adjustment. U+202F takes the font’s ordinary space at the desired percentage, even in a face whose narrow-space glyph has a different advance. On a fully justified line with only a fixed gap, the compositor can spread the shaped clusters. Default justified paragraphs with qualified hard spaces use a derived policy on the disposable projection. Opening a document does not add a spacing preference.

An existing single-line flow containing pasted hard spaces can exceed the bounded paragraph search. In that case its earlier native single-line layout remains available. Extended paragraph rules and explicitly authored word-spacing policies still require the bounded planner.

The native editor, Markdown export and the private source carried into PDF preparation preserve the original character. PDF readers can normalize whitespace in extracted text. In two reference fixtures ending in a fixed space followed by an ordinary space, the final invisible caret differed by 5.046 pt. Visible words, line endings and baselines agreed.

## Measured adjustment and line choice

The native worker measures a natural line at 100% and returns the nominal point advances of eligible ordinary and flexible nonbreaking spaces, plus minimum/desired/maximum widths. The paragraph planner validates this affine proof before caching it. Existing character tracking remains an independent contribution; horizontal scaling uses the actual transformed space advance. Glyph identities, clusters, outlines and non-space advances remain owned by the same shaping result. Untransformed struts continue to own line spacing.

The reference distinguishes three regimes:

| Line                                                       | Target                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary left/center/right/start/end alignment             | Desired spacing; wrap when it does not fit                                                                                                      |
| Last paragraph line with a ragged justification ending     | Desired spacing, with condensation to the available width when the measured preference minimum fits; never expand merely to fill the final line |
| Non-final justified line, soft-return line, or Justify All | Fill the line area; preference limits may be exceeded                                                                                           |

Minimum and maximum are preferences, not universal hard clamps. The owned planner uses a finite cubic adjustment cost, a measured zero-font-space floor for full lines, and explicit diagnostics when a selected line lies outside the preference range. This is an Ivo policy informed by bounded reference observations, **not a recovery of Adobe's full paragraph optimization objective**. Zero-capacity ratios remain finite/nullable; no Infinity or NaN enters a cached plan or saved data.

Leading ordinary spaces participate. Ragged lines retain trailing spaces at the desired setting. Fully justified and condensed final lines collapse trailing ordinary spaces; their source ranges remain selectable. Core Text's per-space tracking query otherwise places some insertion points half an adjustment behind their drawn letters. For space-only adjustments the worker retains the original 100% native caret, including ligature interpolation and authored tracking, and translates it by the prefix of actual retained space-advance changes. One monotonic sweep covers the line. Collapsed trailing boundaries instead use their actual zero-advance native run edge. These measurements are identified separately; no caret is placed at a guessed target width. The existing single-word letter-spreading fallback keeps its final native caret queries.

Single-word full justification retains the earlier native letter-spreading fallback when available. Under an explicit word-spacing policy, it receives the same worst finite badness as an extreme space adjustment, preventing the planner from creating many cheap single-word lines to avoid stretching ordinary spaces. This leaves the earlier no-policy objective unchanged. It does not implement authored letter-spacing limits. Blank lines stay blank. Soft returns are non-final lines; paragraph separators end the paragraph.

## Ownership and bounds

Internal native protocol 5 carries a typed three-number paragraph policy and retains protocol 4 character geometry. Only measured alternatives and owned planned lines use it. Protocols 1–4 reject the new field; their default identity remains unchanged. Existing placement records stay `{end, frame, baseline, left, width}`. A renderer-local measured plan checks final native spacing, visible width, source range and placement before results enter the bounded cache. App and PDF preloads use the same strict byte-only transport; paths, nested unknown fields, missing/crossed percentages and protocol downgrades reject.

An explicit spacing policy forces planned physical-frame scheduling, including single-line mode. Unequal columns, continuation ownership, exact first baselines, paragraph keeps and source/history protection retain their existing owners. Measurement identity includes the policy. Selected-line diagnostics distinguish actual and future columns, without leaking failed fitting probes into the result. The existing source, measurement, alternative, state, placement, cache and work budgets remain in force.

Initial admission is conservative: simple left-to-right Latin, Greek, Cyrillic, Common and Inherited script characters; ordinary U+0020 spaces, flexible U+00A0 and fixed U+202F nonbreaking spaces; and existing line/paragraph marks. Tabs, other special spaces, bidi controls, and negative tracking reject before font loading or native calls. Native run-direction checks provide an additional defense. Wrapped paragraphs fit each occupied fragment at its measured width. Single-line composition prefers a break within the minimum spacing preference and can compress further when necessary. An isolated glyph cluster retains its natural width, including when a trailing source space collapses. Mixed faces, point sizes and leading use the measured baseline of the whole physical row. Script-specific justification, shifted or vertically scaled ink with inverted contours and further special spaces remain open. UI authoring requires an already opted-in native text flow; it never opts an existing note in merely by opening a control.

## Remaining scope

Authored letter-spacing and glyph-scaling limits, full nine-field justification, hyphenation dictionaries/limits/discretionary mappings, Adobe's complete paragraph objective, spacing for the release languages, advanced wrap interactions and physical iPhone/iPad qualification remain open. The shared Apple source is included by the iOS project; Mac worker checks and copied iOS resources do not establish device parity. See the [release ledger](indesign/progress.md) for the current scope of language qualification.

Original runtime reference captures and native probes are private work artifacts. Public regressions use original synthetic documents and licensed shipped fonts; they do not contain extracted Adobe assets, code or personal notes. Current verification and the packaged review build are recorded in [verification](verification.md).
