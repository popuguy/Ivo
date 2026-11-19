# InDesign text parity progress

Current overall engineering estimate, 18 November 2026:

`[████░░░░░░░░░░░░░░░░] ~20%`

This is a rough assessment of implementation and integration across the [66 included capabilities](text-parity-programme.md), not a measured completion percentage, a schedule prediction or a count of controls. Foundation implementations have substantial fidelity, international-input, publication and device acceptance work left. No capability is yet certified against every reference and device gate. Report this bar after each completed milestone, keeping this full scope consistent. Small interface corrections need not move the rounded estimate.

## Milestones reflected in this baseline

- Shared canonical flow source, linked selection, typography/history corrections and portable fonts.
- Native glyph/caret/source geometry, on-page editing, automatic continuation and same-line searchable PDF as an explicit preview.
- Independent paragraph decisions and unchanged-paragraph measurement/decision reuse.
- Contextual Tab behavior, ordinary half-inch text tabs, native arrangement commands, menu-owned Smart Guides and compact page/zoom navigation. These improve daily use and the command/input foundation; they do not complete paragraph tab composition or reference parity.
- Literal leading-space preservation through rich/plain clipboard insertion, saved paint and linked/native source/history. This is an input correction within the current foundation; it does not move the rounded overall estimate.

## Major work still driving the estimate

1. Complete paragraph composition: alignment/spacing, custom/decimal/right-indent tabs and leaders, justification, hyphenation, keeps, grids, wraps and unequal columns.
2. Complete shaping/source maps: fallback capture, full OpenType/variable/language support, bidi/complex scripts/CJK and deterministic cross-device behavior.
3. Structured text and layout: tables, lists/numbering, anchored objects, paths, notes, fields and the page/parent scheduler.
4. Editorial and publication systems, including scoped search/proofing, references, generated matter and accessible reading order.
5. Physical Mac/iPhone/iPad input, IME, accessibility, performance, persistence and comparative reference qualification.

Source contracts and test evidence remain in the programme and [verification record](../verification.md). Update the estimate only when an engineering milestone materially closes these dependencies, explaining the reason and retaining prior scope. App appearance has its own backlog and should not inflate this text-engine estimate.
