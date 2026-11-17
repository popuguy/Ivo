# Page operations

Pages can be reordered, named, resized and removed. New pages inherit the preceding size. Selection can be explicitly assigned to another page or transferred there on pointer release. Whole-object/mask transfer preserves source, descendant local geometry and world placement as appropriate to the command. Page-origin guide geometry remains separate from camera coordinates.

These commands share the document undo timeline and retain stable document/page/object/text-flow references. Canonical text can span multiple pages; reordering and safe automatic continuation must not duplicate or discard its source. See [text flow](text-flow.md).

Pure page-operation tests and the real scene fixture cover source/ID retention, masks, inspector assignment, cross-page dragging, reorder and undo/redo. General page arrangement, richer affine transforms, parent frames and physical page/region link targets remain in the [backlog](backlog.md).
