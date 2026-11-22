# Footnotes

Place the caret in a text frame and choose **Type → Insert Footnote**. Enter the note and apply. Double-click a note on the page to edit it, or put the caret beside its reference and choose **Edit Footnote**. **Delete Footnote** removes the reference and its text in one undo step. The footnote editor accepts paragraphs and line breaks.

A footnote follows its reference as the body moves through linked frames. Each physical column reserves its own space below the body, including the gap and optional rule. With **Allow Split Footnotes** enabled, a long note can continue in the following column. Switch it off in **Document Footnote Options** to keep the reference and the complete note together. The same panel controls starting number, type size, leading, minimum space, spacing between notes, and rule width and weight. Numbering runs in source order within each text flow.

Ivo stores the note at its reference in the canonical document text. The rendered note at the bottom of a column is derived from that source. PDF preserves selectable text on the printed pages. A reflowable EPUB provides a link from the number to the note and a return link.

## Qualification

The desktop editor fixture inserts, edits and removes a note, switches between split and kept placement, changes numbering, recomposes two columns and reopens the archive. The PDF fixture compares browser and native paragraph output with an independent PDF reader. In the native split specimen, the reference and the first two note lines occupy page one. The remaining two note lines occupy page two. A separate editor fixture combines a footnote, inline table and anchored artwork in one body flow.

The body of an individual footnote currently accepts plain text. Its type styling comes from document footnote options and the flow’s font family. Separate rich character runs and images inside notes, notes authored inside table cells, spanning a note across all columns, and restarting numbering by page or section remain outside this review fixture.
