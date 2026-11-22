# Tables in text

Place the text caret and choose **Insert Table**. The table occupies one character in that paragraph. A sentence before and after the insertion wraps above and below the table. Editing earlier text can move it to a different frame or page. Using Insert Table with the Selection tool creates a free-standing page table.

Double-click a cell to edit it. Select a word and use Bold, Italic, or Underline. Paste formatted text or a rectangular range of spreadsheet cells to retain supported colors and character emphasis. Tab moves to the next cell, Shift-Tab moves back, and Escape returns to object selection. Find/Change and spelling corrections preserve formatting on surrounding words.

Under **Table Options**, choose **Define cell style** to name a fill, text color, inset and vertical alignment. Choose **Apply cell style** to reuse that style elsewhere in the same table. Editing the definition updates its assigned cells. Table-wide rules, row heights, headers, footers and keep-with-next remain in Table Options.

## Pagination and recovery

An inline table travels as a unit. If it fits in a later text frame, it moves there. If every remaining frame is too short, the flow reports overset. Enlarge a text frame or thread a deeper one into the flow. The complete table and its source position are retained while overset. For a long grid that needs different rows on different pages, insert a free-standing table, then choose **Continue on Next Page** in Properties. That workflow also repeats headers and footers.

Automatic row-by-row division of a table embedded in ordinary prose, document-wide named cell-style libraries, and applying the full prose typography engine inside a cell remain outside the tested surface. Inline tables currently support bold, italic, underline, strikethrough, text color and highlight runs. Named cell styles belong to their table and accompany object copies.

## Verification

The desktop publishing fixture exercises a real caret between two words, cell formatting and undo, rich spreadsheet paste, editing a shared style, cross-page movement, saving and reopening, a rendered print page, and semantic EPUB reading order. The PDF fixture checks a deliberately too-tall table, enlarges the second frame and reads the actual PDF page text through PDFKit. It runs for browser composition and both native composers on macOS.

The table keeps one string per cell. Rich character ranges address UTF-16 offsets in that string, so moving a row, merging a cell, or correcting an earlier word moves its formatting with it. Rich or anchored tables use archive 38 and canvas 37. Existing plain page tables retain their original format requirements.
