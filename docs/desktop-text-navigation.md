# Desktop caret and selection across pages

## What to try

Thread a one-line frame on page one into a wider frame on page two. End the first paragraph with `Αθήνα.` and begin the second with `İzmir`. Click just before the dotted İ. Press Left once to reach the end of the preceding paragraph. Hold Shift and press Right twice to select the paragraph break and the İ. Reverse direction to shrink the selection back to its anchor. At the end of the first line, Command-Shift-Right selects the paragraph break.

Use a narrow first frame to force a page break in the middle of a paragraph. Start on the first glyph of the next page, extend the selection backwards across the break and type a replacement. Adjacent letters and punctuation should survive and the same paragraph should reflow.

## Results on Mac

InDesign 22.0 and Ivo were tested with the same two paragraphs containing Latin, Greek, Cyrillic, straight and accented letters, and words that change script without a space. The InDesign check invoked 12 editing commands from every one of its 84 insertion positions and recorded both resulting selection endpoints. The document was disposable. The reference data stays local.

The Ivo Paragraph Composer test checks eight equivalent character and line commands at every one of Ivo’s 80 grapheme boundaries. All **320 line cases matched**. Of the 320 character cases, **304 matched**. The other 16 expose an intentional difference. Left and Right in InDesign can put the cursor between a base letter and its combining accent. Ivo keeps the accented letter together. The test covers decomposed Latin é and Å, Cyrillic Й and Greek ά.

Ivo also replays 38 Mac key gestures through the desktop input path, including word movements for six words, forward and backward selection, shrinking a selection across pages, and selecting the break at the end of a line. A second two-page layout checks a real mouse hit, reverse selection and typed replacement across a soft wrap inside one paragraph. InDesign and Ivo both replaced exactly the selected two characters. With the same 87 pt first frame and 12 pt CMU Serif, InDesign placed the em dash on page two at offset 14. Ivo kept it on page one and began page two at offset 16. That observed difference concerns line fitting. A third fixture confirms that a styled empty paragraph contributes exactly one editable stop when traversed in either direction. All three documents use Ivo’s native composer.

## Desktop conventions

On Mac, Command-Left and Command-Right go to the ends of the visible line. Option-Left and Option-Right go to word boundaries. InDesign’s default shortcuts bind Command-Left and Command-Right to word movement. Moving forward one word in InDesign can also include horizontal space after the word and can stop at punctuation. Three of six forward word selections included a following space in InDesign. Ivo ended each at the last letter. All six backward word movements agreed. The project’s Windows conventions and the separate handling of right-to-left and complex scripts remain outside this Mac comparison.

The regression runs in the existing desktop composition suite with `npm run test:native-editor-composition`. It validates the anchor and focus separately so that a reversed range of the right length cannot pass in the wrong position.
