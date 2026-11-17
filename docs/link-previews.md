# Reading link previews

Implemented 15 November 2026. In reading view, hovering a resolved document link briefly opens a Wikipedia-style popover with the target title, page count, a bounded text excerpt and an optional local image. Keyboard focus opens it immediately; Down enters its controls, Escape closes it and returns focus. The title opens the document, with Command/Ctrl-click or middle-click retaining new-tab behavior. Ordinary link clicks and touch taps continue to open the document.

The popover lives outside the transformed/clipped page, stays within the window and remains usable when moving the pointer from link to preview. Camera movement, navigation suspension, outside clicks, focus loss and removal of the owning link dismiss it. Editing links and unresolved targets do not open previews. Touch has ordinary tap navigation; a dedicated touch-preview gesture remains a possible extension.

`src/features/links/previews.js` reads canonical text flows once, limits excerpts, preserves Unicode and paragraph breaks, and resolves wiki aliases to readable labels. It neither paginates nor edits the target. Images are restricted to local stored or bundled sources; remote image blocks are not fetched just because a link was hovered. This is a semantic summary, not a live miniature editor or full page thumbnail. Stable page/region targets remain separate backlog work.

`npm run test:previews` uses an active, isolated Electron window to verify hover intent, actual DOM focus events, keyboard entry/Escape, modified opening, touch tap preservation, local media, viewport bounds, dismissal and unchanged source. A hidden window does not emit the required native focus events; that initial test condition was corrected rather than weakening keyboard acceptance.

# Removed PDF placement

PDF-within-PDF composition is canceled. Image placement no longer accepts PDFs; dropping a PDF rejects before asset writes/history changes. The obsolete picker/viewer/replace paths are removed.

Compatibility reading retains old PDF object records and their original assets. They display a small attachment record with **Save original PDF** rather than an embedded viewer. No automatic migration, source deletion or asset garbage collection occurs. Legacy attachment records can be removed as objects through ordinary undoable editing; their original bytes remain available in vault backups/history. Ordinary document PDF export remains supported. It rejects legacy attachment objects clearly instead of emitting blank content or silently nesting PDFs.

The preview runtime fixture also verifies removed import controls, rejection without writes, unchanged legacy documents, recoverable original data and explicit PDF-export rejection. Original asset/file format support remains intentionally readable so older notes/backups are not lost.
