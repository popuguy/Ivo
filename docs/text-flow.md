# Text flowing across pages

A long document can contain one canonical rich-text source threaded through ordered area frames across pages. Current names are `document.textFlows` and `frame.textFlowId`. `domain/documents/text-flows.js` owns threading, automatic continuation, safe generated-page removal and independent copies. The [format decoder](data-format.md) preserves earlier saved documents.

`rendering/text/flow-layout.js` derives fragments using native browser layout, retained paragraph/list context and grapheme-aware boundaries. Source HTML is authoritative; fragments are disposable. The nonmodal **Document text** editor edits the continuous source while the page preview updates. Formatting, text, geometry and structural changes share document undo. Frame geometry remains independently editable. Overset text remains in the source.

Automatic continuation copies the frame/page context as needed. Empty generated pages are removed only under explicit ownership/policy checks; authored objects must not disappear. Page order/transfer, masks, duplicated frames and templates retain stable references. Export composes a frozen snapshot, so pagination during PDF sharing does not mutate the open document.

Foundation regressions cover Unicode, lists, blank paragraphs, shared-source identity, masks, automatic pages, copying/templates, undo and persistence. `npm run test:text-flows` runs layout and application fixtures. Direct inline cross-page editing, parent/primary frames, advanced composition, richer styles and physical iOS input validation remain backlog work. These foundations do not establish full InDesign equivalence.
