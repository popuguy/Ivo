# Repeated font changes and line metrics

Fixed 16 November 2026 after a reported large-size → small-size edit left exceptionally tall lines.

## Cause

Character formatting wrapped selected text in another styled span each time. Returning text to 12 pt could leave it inside an older 123 pt span. The glyphs inherited the inner 12 pt setting, while the ancestor still contributed a large inline line box. Range extraction could also leave empty, large-font spans at either selection boundary. These invisible boxes could inflate lines, selections, pagination and export even though the inspector showed the smaller type size. The reported source contained six such obsolete 123 pt wrappers; its actual leading setting was automatic.

## Change and ownership

`shared/dom/inline-metrics.js` resolves overriding size/leading spans to their effective text runs, preserves emphasis/links/other character styling, and removes empty obsolete metric boxes around actual text. Intentionally styled empty paragraphs, explicit leading/paragraph spacing and relative-size code/sup/sub scopes are retained. Structural blocks keep their scope. This is a bounded metrics correction, not a complete text-run/style or native composition engine.

The source sanitizer applies the same cleanup on reading/paste. The formatting command normalizes the live editor and restores its logical range without replacing the editable root. Authored words, Unicode, paragraph/soft-break structure and unrelated source properties stay intact. Canonical HTML remains idempotent. Reading an existing document does not automatically rewrite its immutable revision; normal edits persist the corrected representation. Archive5/canvas4, native manifest1 and IndexedDB4 are unchanged.

The inspector now retains automatic leading as the setting `0`, rather than presenting its computed pixel height as though it were fixed leading. Legacy absent-leading behavior and deliberately fixed values retain their existing semantics.

## Reported-note recovery

The explicitly requested live note was backed up and repaired through the current app's text editor as one undoable paste. No direct write bypassed the native vault/writer lease. Verification compared every character, rendered paragraph break and glyph style before/after, retained its first frame geometry and original immutable revision, and found no remaining obsolete 123 pt wrappers. Chromium added an equivalent first-block wrapper during paste; rendered breaks and glyph styles remained equal. Its automatic overflow page disappeared naturally when the repaired text fit in the first frame. No unrelated document or global permission setting was changed. Personal source/evidence stays in parent `work/text-leading-repair/`, outside the repository/package.

## Verification and next work

`npm run test:inline-metrics` reproduces the fault in a real browser: a generic fixture's first line changes from 149.09 px to 14.40 px. It covers mixed-size partial selection, explicit leading/paragraph spacing, styled empty paragraphs, links/emphasis/Unicode/blank lines, repeated 12→123→12→250→12 formatting in independent and threaded frames, unchanged editable roots, selection restoration, four real history undos/redos and idempotent reopening. Existing text, text flow, PDF, submitted-frame rendering and workspace regressions remain required.

The [InDesign reference pass](indesign/text-composition-plan.md) is next for deeper text correctness. Remaining concerns include canonical character/paragraph styles beyond metric spans, blank-paragraph/insertion style inheritance, mixed-run line boxes and baseline rules, inline pagination, IME/bidi/grapheme breadth and physical-device behavior. This fix does not establish Adobe-engine numerical equivalence.
