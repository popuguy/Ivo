# Native paragraph keeps

In a text flow using either native composer, open Properties → Paragraph → More Options. **Keep paragraph together** keeps all the lines of one paragraph in one column. **Keep with next** holds its last line with one to five lines of the following paragraph. **Keep with previous** keeps the first line of the current paragraph with the last line above. A heading can carry body lines onto the next page, and a caption can stay with the paragraph it describes. Named paragraph styles can inherit and override these settings.

## Placement and impossible constraints

All moves an entire paragraph out of occupied column space when it cannot fit there. It recomposes for the destination width, retaining the first-line indent and suppressing incoming top spacing. It does not move a fixed list of narrow-column breaks into a wider frame.

Keep with next can leave earlier rows in place and move only the final row. That source suffix is recomposed for the new width with the rest-line indent; first-line indent and paragraph-before spacing are not applied again. The following paragraph contributes as many physical lines as requested, up to its actual length. Two fragments of one line around artwork count once. A later join brings an earlier heading along only if it would move one of the lines protected by that heading. Blank paragraphs count as physical strut rows.

An impossible keep relaxes locally at an empty column so text can progress. The scheduler does not search arbitrary later tall frames or backfill space it already left. All takes priority over Next when the two cannot fit together; in the qualified oversized-All cases, adding Next retains the All-only placements. These are observed placement rules, not a claim to have recovered a complete reference application's constraint solver. Keep flags remain authored and enabled. Derived `keepViolations` report source ranges, physical column indices and whether a column is still future; they are never written into a document.

The existing automatic-page owner consumes the planned continuation. It can add/remove only its owned blank continuations. A passive reader retains the actual covered prefix and overset source without writing pages or history. Keep violations and real capacity overset are separate results.

## Ownership, caching and bounds

Keep policy is renderer-owned, separately aligned with paragraph source ranges. It is stripped from native shaping requests. Single-line source with keeps uses planned protocol 3, or 4 for advanced characters; default Single-line source retains its earlier path. Font measurements survive policy-only changes. Primitive geometry decisions are cached, while successor-dependent keep scheduling is reevaluated against the current following paragraph. Each probe, failed constrained fit, retry and warm cache hit consumes the same whole-flow work allowance.

Focused frame/keep schedulers now own placement policy; the paragraph coordinator retains font measurements and its bounded LRU. Existing 10,000-source-position, 1,024-opportunity, 100,000-state/alternative, 1,000,000-fitting-check, 2,048-line and 128-column limits remain. A caller can lower work allowances, never raise production maxima. Budget exhaustion rejects rather than pretending a keep is geometrically impossible. Preparation/search retain cooperative yields.

## Chained paragraphs

Linked headings use the following paragraph’s actual placement, including its own keep-together setting. When a join would cross a column, the scheduler walks back through the connected rows and refits that source suffix at the destination width. If the connected group already starts in an empty column and cannot fit, it preserves earlier joins and reports the broken join. Around artwork, fragments on either side of the same physical row move together. Existing native wrap limits still apply.

## Starting a section

**Start Paragraph** offers Anywhere, In Next Column, In Next Frame, On Next Page, On Next Odd Page and On Next Even Page. A frame can hold several columns and a page can hold several frames. Each choice follows those actual boundaries. Page parity uses the document’s one-based page order. An explicit start takes precedence over a preceding keep. At the beginning of a flow the first available slot qualifies immediately when its page parity matches.

A flow with automatic continuation can create an intervening empty page to reach the requested side. Resetting to Anywhere can remove unused automatically created pages. A passive view reports overset when the requested page is beyond the existing thread.

## Remaining scope

Minimum first/last lines of a split paragraph, grids, tables/anchors/notes and wider script/device policies remain open. Existing nondefault widow/orphan counts stay gated until their distinct activation policy and scheduling are implemented. This bounded increment does not certify the whole keep capability or full InDesign parity.

The [verification record](verification.md) covers pure reference-derived fixtures, actual Properties/typing/undo/reopen, owned continuation handling and independent PDF source/page geometry. Original investigation artifacts remain private.
