# Interface direction

These constraints reflect the reviewed screenshots and ongoing pass/review workflow. The [backlog](backlog.md) owns feature status; this guide owns design intent.

- Use Obsidian’s compact ribbon, navigation/sidebar, document tabs, useful context menus and pane-local controls around Ivo’s composition view. Keep document creation immediate with an editable title. Support keyboard navigation, open-to-right and detached views; preserve ownership when menus act on background tabs/documents.
- Use professional, direct labels: document, page, properties, outgoing links, backlinks and tags. Hide occasional metadata behind appropriate panels. No promotional creation copy or blog framing.
- Pages have fixed independent dimensions and can share a text flow. New pages normally inherit the preceding page size. Keep page geometry separate from viewport zoom and native window dimensions. General page arrangement remains an extension.
- Object selection, eight bounding-box handles, direction-specific resizing, direct polygon point selection, masks/draw-inside, snapping and Option-drag copying follow the Illustrator baseline where measured. Retain fractional placement. Special handles and tools need appropriate sourced cursors.
- Text editing must preserve a live caret/selection, rich source, paragraphs and undo. Clicking away exits an active text edit without immediately creating another frame. Long text must flow through linked frames/pages and remain editable as continuous document text. Typography and advanced composition have their own reference gaps.
- Pan/zoom needs immediate feedback, an anchored camera, two-decimal zoom display and sharp text/vector geometry throughout the gesture. Physical trackpad/iPhone/iPad latency and exact remaining native gesture phases must be measured.
- Context panels use compact tabs/icons and narrow microbars, with clear application tooltips. Floating, grouping and docking should remain independent of document DOM. The final reskin may change presentation while preserving command semantics.
- Source interface artwork from Illustrator first and licensed Obsidian/Lucide fallback second during this phase. Keep exact source identity/hotspot evidence and license notices. The final coherent custom aesthetic is future work.
- Reading-view links have bounded previews. The knowledge graph, stable document identity and recoverable source remain central even as physical pages, scan regions and richer destinations are added.
- Mac, iPhone and iPad edit the same document semantics. Device-local tabs/selection/undo stay separate from shared revisions. Google Drive and other providers must preserve offline work, conflicts and original media; synchronization has not been implemented yet.

Scanned-note OCR, region links, richer paths, shared document PDF output and native mobile behavior are explicit requirements. PDF-within-PDF composition is canceled. Detailed acceptance, dependencies, native reference gaps and queued requests remain in the backlog; newly noticed behavior can enter that list without forcing a change of task.
