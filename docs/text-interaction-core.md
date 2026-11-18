# Linked text selection and command ownership

This increment implements one logical selection across a threaded text flow. It is a text-core milestone in the [InDesign parity programme](indesign/text-parity-programme.md), not completion of that programme. Frame order follows the source thread even when page positions differ. Another flow cannot silently join the selection.

The source keeps the existing UTF-16 position contract, including its virtual block boundaries. `domain/text/flow-selection.js` owns direction, affinity, interval clipping and Unicode navigation without a DOM. Cached grapheme/word segmentation is reused while the source is unchanged. Paragraph navigation uses structural paragraph ranges; a soft line break remains inside its paragraph. No persisted format change is required for selection.

`features/editor/text/flow-selection.js` maps native glyph hits in disposable frame previews to the canonical source. Pointer selection, Shift extension, word/paragraph granularity, reverse selection, autoscroll and final mouse-up coordinates use the same range. Escape, lost capture, blur, source changes and a different flow cancel the old gesture. Selection and painting create no document history or save entry.

The retained native input remains the keyboard/IME owner. While a range spans previews, the CSS Highlight API paints corresponding source intervals across frames and columns; a rectangle fallback supports hosts without that API. The input is visually hidden for that range, preserving its native selection and clipboard behavior. Derived paint wrappers and provenance never become authored source.

Measured native caret stops supply Up/Down and line-boundary movement through unequal frames. The geometry adapter removes camera scale/translation and tracks source affinity at shared boundaries. Rotated/sheared text, mixed bidirectional affinity and unsupported inline baseline arrangements explicitly retain native fallback behavior. This is not a complete bidi/vertical-writing engine. Touch selection and physical iPhone/iPad qualification remain open.

## Formatting and persistence

Command/Control-B/I/U, native Type-menu actions and browser formatting intents route through Ivo's source/history commands. A selected range, a collapsed insertion position and a whole-frame selection remain distinct command scopes. Moving the caret or selecting another run clears stale pending insertion marks. Native menu tokens bind a command to the current document revision, frame, flow and logical range; title/numeric fields and stale targets cannot borrow that permission.

Native inline formatting that can be represented safely becomes validated source attributes, including explicit normal/false values. Named-style generated CSS is not imported as a direct override. Underline and strike paint follows effective leaf styles because CSS ancestor text decoration cannot be canceled by a descendant. View-only decoration spans are removed before serialization. Quote defaults belong to an unthreaded frame or, after threading, its shared flow; a blanket italic wrapper must not override explicit regular text.

The regression reported on 18 November is part of this milestone: select part of a flow, use the actual Command-I path, deselect, then save and reopen in a fresh renderer. Tests compare effective regular/italic runs, untouched source outside the range, preview versus editing and undo. Earlier preview-only corrections were insufficient evidence for this native shortcut route.

## Verification and limits

`test:flow-selection` uses trusted Electron pointer and keyboard input on synthetic linked frames. It checks forward/backward cross-page selection, exact painted-range text, copy/delete/undo, measured keyboard movement, paragraph/blank-line boundaries, cancellation, insertion inheritance and saved-document reopening. The text runtime also covers native formatting normalization, derived decoration paint and camera-independent caret geometry. Domain tests cover Unicode boundaries and cached navigation equivalence. Native Type-menu and document-clipboard fixtures exercise production IPC with isolated vaults and restore clipboard contents.

The controlled InDesign reference confirms one source range across linked frames/pages using native Shift selection. Its attempted drag automation did not establish exact physical drag timing; that uncertainty remains explicit. Existing browser composition still supplies line breaks. A complete paragraph composer, baseline grids, full vertical justification, tables/notes/anchors, complete input/IME/accessibility and device performance remain in the parity programme. Passing this milestone's tests does not certify those features.
