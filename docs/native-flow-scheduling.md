# Native flow scheduling

The Paragraph preview now chooses source breaks **and physical column placements together**. Unequal frame widths and heights, line-specific font metrics, first-baseline policies, paragraph indents and spacing participate in the decision. Actual editor ink, caret geometry and selectable PDF use those same placements. Existing documents keep their composer choice.

## One owner for placement

`domain/text/paragraph-flow.js` is a pure, bounded optimizer. Each measured alternative supplies its actual width, ascent, descent, leading, advance, cap height and x height. The search retains distinct source/frame/baseline histories; a lower baseline is not always a better state when the next frame is wider. It only leaves a column when no alternative fits there. First-line indent follows the paragraph source start, and paragraph spacing is suppressed at a physical column top.

`rendering/text/paragraph-composition.js` owns source projection, exact-font measurement reuse, cooperative scheduling and final vertical alignment. Preparation and fitting yield after bounded work so pending camera/input tasks can run. Measurements survive geometry-only changes. Up to four geometry/cursor decisions per paragraph are retained within the existing 64-entry/8 MB cache; cached decisions contain flat line data, not search graphs. A rejected measurement or final native response cannot poison a retry.

The driver plans at most 128 columns, repeating the final authored column shape for potential continuation. The worker receives only actual columns. Future placements retain overset source without appearing in visible geometry or PDF; the existing owned-page loop materializes continuation and then requests that longer actual prefix. No source text, identifiers, original frame geometry or authored history is replaced by generated lines.

The actual-editor witness also found an older entry/selection defect: sanitized display CSS and reordered attributes could be mistaken for an edit to a valid older HTML spelling. Text finalization now checks sanitized equivalence before synthesizing an input transaction. Entering, selecting, leaving or flushing unchanged text retains the exact saved HTML and creates no undo step. A real authored edit still uses the existing validated serializer and exact undo source snapshot.

## Internal protocol 3

Paragraph requests use `planned-lines-proof` and ordered `{end, frame, baseline, left, width}` placements. The native worker validates complete grapheme-safe source coverage, forced breaks, frame order, nonoverlapping row fragments and actual frame areas. It shapes and paints the supplied ranges without choosing new breaks or moving baselines. Glyphs, carets and retained PDF lines share the final aligned origins.

The renderer checks protocol/source identity, paragraph ranges, placement indices, frame IDs, baselines, areas and complete visible-prefix coverage before accepting any derived page mutation. Protocols 1 and 2 retain their previous contracts. Single-line remains on protocol 2 in this increment. This is transport and disposable view data: archive 9/canvas 8, the archive-8 native composition capability, native folder manifest 1 and IndexedDB 4 do not change.

## Explicit limits

The Paragraph preview retains its 10,000 UTF-16 source positions, 1,024 opportunities, 100,000 alternatives/states, 1,000,000 fitting checks, 2,048 placements and 128-column bounds. Work exhaustion rejects explicitly; it never substitutes a greedy result. Its declared ragged-right quadratic objective is Ivo's policy, not Adobe's full paragraph justification/hyphenation algorithm.

[Native object wrapping](native-object-wrap.md) now extends this placement protocol with bounded fragments that share the baseline of the entire measured row, including rows with mixed sizes and faces. Custom tabs/leaders, keeps, grids, full justification constraints, advanced shaping, structured content and physical/device qualification remain separate programme items. Mixed-size alternatives are measured individually for this unwrapped scheduler. Cooperative yielding is a responsiveness boundary, not a guarantee against every platform pause.

The [verification record](verification.md) tracks the actual editor, worker, independent PDF and package checks. Private InDesign observations and generated fixtures remain outside Git.
