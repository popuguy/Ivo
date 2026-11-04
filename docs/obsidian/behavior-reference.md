# Obsidian behavioral reference for Ivo

Research date: 4 November 2026. Installed reference: Obsidian Desktop 1.15.0 on macOS.

This reference describes the information behaviors Ivo can preserve while developing an original editorial document system. It is a bounded study, not a claim that every Obsidian feature has been reconstructed. The automatic knowledge graph is a required Ivo feature. Scientific document types remain part of the schema plan, with implementation deferred beyond the first MVP.

## Evidence and version boundary

- **Observed artifact:** the installed application's `Info.plist` reports version/build `1.15.0` and identifier `md.obsidian`. The archive identities are recorded in [sources.md](sources.md#installed-reference).
- **Documented:** behavior supported by the official documentation linked below. These web pages were retrieved on the research date and are living documents; they are not a version-pinned 1.15.0 manual.
- **Ivo design decision:** a proposed contract for our implementation. It is not an observation about Obsidian.
- **Unverified:** an edge case requiring a reproducible runtime experiment. Proposed tests below have not been executed by this research pass. Consult the parent investigation's runtime evidence for any subsequently verified cases.

## 1. Reading and editing

**Documented — [S01](sources.md#s01).** Obsidian distinguishes reading versus editing views. Editing has Live Preview and Source modes. Reading omits Markdown delimiters; Live Preview shows rendered formatting and reveals syntax near the cursor; Source exposes the underlying text. The user can configure defaults and view one note in editing and reading panes simultaneously.

**Ivo design decision.** Share one document model between reading and editing. Preserve composition, image crops and navigation position through the transition. A plain-source mode is useful for export/debugging but is not a prerequisite for the editorial MVP. Reading view must remain navigable with a keyboard, and editing controls must not move surrounding content unexpectedly.

**Unverified.** Exact selection, undo, scroll and caret preservation across Obsidian modes and split panes; handling of large pasted documents and input-method composition.

## 2. Links and addressable content

**Documented — [S02](sources.md#s02).** Obsidian accepts both wiki and Markdown internal links. Targets can be notes, attachments, headings or identified text blocks. A link can carry display text independent of its destination. Explicit folder destinations are vault-relative. Linking to an absent note can create it at the specified path. Block references use an Obsidian-specific extension to Markdown and are not universally portable.

**Ivo design decision.** Store stable document and block IDs separately from titles. Represent link target, optional anchor and display label as separate fields. A rename should preserve the destination. Keep unresolved links visible and repairable. Export both a readable label and enough structured identity to reconstruct the relation.

**Unverified.** Duplicate basenames, title collisions, case differences, Unicode normalization, heading renames, cyclic embeds and deleted anchors need explicit tests. A parser must distinguish actual links from link-like text inside code.

## 3. Aliases and discovery

**Documented — [S03](sources.md#s03).** Aliases are alternative names stored in a note's properties. Autocomplete can find the alias while writing a link. The generated link retains the canonical target and uses the alias as display text. Alias mentions can also be discovered as unlinked mentions.

**Ivo design decision.** Keep aliases as document metadata and search inputs. One-off link labels should not silently become aliases. If two documents share an alias, offer both with context rather than resolving arbitrarily.

## 4. Backlinks, outgoing links and unlinked mentions

**Documented — [S04](sources.md#s04), [S05](sources.md#s05).** Backlinks identify notes referencing the active note. Results can show surrounding text and be filtered or sorted. An outgoing-links view lists destinations referenced by the active note. Both views also support discovery of unlinked occurrences of note names or aliases. Unlinked mentions are suggestions, not existing relationships. Excluded files affect these discovery results.

**Ivo design decision.** Derive outgoing links, backlinks and graph edges from the same link index. Creating a link in a document should update all three views. Preserve source-block context so a backlink can return to the exact passage. Keep suggested links visually distinct and create them only through a user action.

**Unverified.** Token boundaries, capitalization, excluded code/HTML spans and ambiguous names in mention detection. The exact semantics of repeated references and graph edge weights need a fixture.

## 5. Tags

**Documented — [S06](sources.md#s06).** Tags can appear inline or in a tags property. Slash-separated tags form hierarchies. A parent-tag search includes descendants. Tags are case-insensitive, cannot contain spaces and must include at least one non-numeric character. Clicking a tag is a search/navigation action.

**Ivo design decision.** Store canonical tag values separately from display spelling. Clicking `research` should match `research` and `research/typography`, without matching `myresearch`. Share that behavior across the tag browser, document search and graph filtering. A tag may be rendered as a graph node when requested, but it remains a different entity type from a document.

## 6. Properties and structured metadata

**Documented — [S07](sources.md#s07).** Properties are structured note metadata stored in YAML frontmatter. Supported types include text, list, number, checkbox, date, date-time and tags. A property name has a consistent type across a vault. Default fields include tags, aliases and CSS classes. Internal links can occur in text/list properties. The visual property editor does not provide nested properties or rich Markdown formatting.

**Ivo design decision.** Keep essential metadata small and typed: identity, title, timestamps, tags, aliases and document layout. Reserve a versioned extension area for citations, equations, figure references and other scientific structures. Preserve unknown extension fields during import/export even before Ivo can render them.

## 7. Search

**Documented — [S08](sources.md#s08).** Search combines independent terms, quoted phrases, `OR`, negation and grouping. Operators address filenames, paths, content, tags, lines, blocks, sections and tasks. Property expressions can test presence or values. Case sensitivity and result ordering are configurable. Default content search concerns notes and canvases; attachment text search should not be assumed from filename search.

**Ivo design decision.** The MVP needs fast title/body/tag search with direct navigation to results. Unsupported advanced syntax should not pretend to succeed. Keep search indexing separate from rendering so document edits and image loading remain responsive. Later PDF text indexing needs its own extraction and provenance contract.

## 8. Media, embeds and PDF sources

**Documented — [S09](sources.md#s09), [S10](sources.md#s10), [S11](sources.md#s11).** Embeds display a source inline and can follow later source changes. Notes, headings and blocks can be embedded. Image dimensions may be specified, with width-only sizing preserving proportions. PDF embeds can address a page and viewer height. Attachments are ordinary files; pasting or dragging supported files into a note creates/copies an attachment and inserts a reference. Supported families include images, audio, video and PDF, with codec availability affecting playback.

**Ivo design decision.** Model an original asset separately from its placement. A placement owns crop, sizing, caption, alt text and layout. Editing a crop should not overwrite the original. A PDF excerpt should retain document identity and page/region coordinates. Local uploads and portable exports must preserve the underlying bytes, not only temporary browser URLs.

**Unverified.** Native PDF selection-link syntax, annotation persistence, scanned-PDF text extraction, cross-page selections and arbitrary PDF content editing. The retrieved sources establish viewing/embedding, not an Acrobat-like editing system.

## 9. Automatic global and local graphs

**Documented — [S12](sources.md#s12).** Global Graph shows note relationships derived from internal links. Nodes can be opened; hovering highlights connections. The graph offers pan/zoom, search filtering, optional tag and attachment nodes, unresolved-target and orphan controls, colored query groups, display options and force parameters. The local graph restricts the network around the active note, with configurable connection depth.

**Ivo design decision.** This is core navigation. Derive it from the same semantic index as backlinks. Provide global and focused views, tag filtering, readable labels, selected-node context and a path back into documents. Keep node identity stable during filtering. Camera state and drag position are view state; they must not change the meaning of links. Label tag/document nodes distinctly.

**Unverified.** Exact force equations, sorting of competing color groups, duplicate-link weighting, direction treatment during local-depth expansion and large-vault performance. Do not infer these from visible controls alone.

## 10. Canvas is a separate spatial document

**Documented — [S13](sources.md#s13).** Canvas is a manually composed board with text cards, note/file cards, links and groups. Cards can reference headings/blocks, and connections can have labels, colors and direction. The documentation says standalone text cards do not appear in backlinks until converted to files; this must not be read as excluding their outgoing links from indexing. A card is not an independent note target. Moving or connecting cards is a different operation from adding note links.

**Observed runtime — [R01](sources.md#r01), parent investigation.** In installed Obsidian 1.15.0, the fixture `Reference.canvas` contains a text card with `Canvas-only card linking [[Atlas]]`. Atlas's Backlinks panel includes that text grouped under `Reference.canvas`, alongside the Markdown source `Material`. Therefore outgoing wiki links in standalone Canvas text cards can contribute backlinks attributed to the Canvas file. The panel's heading and status-bar counts differed; no aggregate-count rule is inferred from this observation.

**Documented — [S14](sources.md#s14).** JSON Canvas 1.0 stores node and edge arrays. Nodes carry IDs, type, position and size; array order controls stacking. File cards have a file reference and optional subpath. Edges reference endpoint IDs, with optional sides, endpoint shapes, color and label.

**Ivo design decision.** Keep a future board schema independent of the automatic graph. Editorial document placement also needs its own layout state. A line drawn on a board should become a semantic knowledge relation only through an explicit, documented rule.

## 11. Rename, deletion and recovery

**Documented — [S15](sources.md#s15), [S16](sources.md#s16).** Rename operations can update internal links automatically or ask first, according to settings. Deletion behavior is configurable: system trash, vault trash or permanent deletion. File recovery periodically stores whole-note snapshots, with configurable interval and retention. Those snapshots are device-local, outside the vault, and cover Markdown and Canvas files rather than every asset.

**Ivo design decision.** Stable IDs protect links when titles change. Favor recoverable document deletion, with undo or restore. Keep snapshot history and cloud synchronization as separate mechanisms. Failed storage writes must produce a visible failure state rather than a false “saved” indication. A delete must never silently remove a shared image still used by another document.

**Unverified.** How inbound link text, unresolved graph nodes and cached previews react after deletion/restoration in the installed version. Recovery behavior across moves and synchronization also needs runtime verification.

## 12. Persistence and portable ownership

**Documented — [S17](sources.md#s17).** A vault is a local directory containing Markdown files and other assets. Obsidian watches external changes. Vault configuration is distinct from global application settings. IndexedDB preserves some application state and a metadata cache; this cache supports features such as the graph and outline and can be rebuilt. Workspace layout files change frequently and can be excluded from Git.

**Ivo design decision.** Treat user documents/assets as primary data and indexes as rebuildable. Version the complete interchange format. Export original assets and structured documents together, plus readable text where useful. Keep API credentials and ephemeral UI state outside exported knowledge. Browser storage alone is not cross-device synchronization; a future Dropbox/Drive adapter must explicitly handle delivery, conflict recovery and deletion.

## Proposed acceptance fixtures

These are test specifications, not a pass report. **MVP** marks the suggested first implementation target; **Later** marks valuable compatibility or scientific follow-up. The implementation may document narrower coverage explicitly.

| ID | Stage | Action and expected result |
|---|---|---|
| EDIT-01 | MVP | Create a page, add formatted paragraphs and images, switch read/edit, reload; content and composition persist. |
| EDIT-02 | MVP | Type while graph/index work is pending; input remains responsive and the last keystroke survives navigation. |
| EDIT-03 | MVP | Paste untrusted formatted content; retain supported formatting without executing scripts or event handlers. |
| LINK-01 | MVP | Link A to B; B's backlinks and the graph both show the same relation. |
| LINK-02 | MVP | Rename B; the existing reference still opens B. Custom display text remains intentional. |
| LINK-03 | MVP | Remove A's link; its outgoing relation, B's backlink and the graph edge disappear together. |
| LINK-04 | Later | Address a heading and a stable block; opening each reaches the correct location. |
| LINK-05 | Later | Two notes share an alias or title; suggestions expose context and do not pick silently. |
| LINK-06 | Later | Link to an absent target, then create it; the unresolved relation resolves without duplication. |
| TAG-01 | MVP | Tag a page `research/type`; a parent `research` filter includes it. Case variants share identity. |
| TAG-02 | MVP | Add/remove a tag; document listings and graph filters reflect the same saved value. |
| SEARCH-01 | MVP | Find content in title, body and tags, then open the selected result. |
| SEARCH-02 | Later | Verify phrase/OR/negation/property queries against a fixture with known matches. |
| MEDIA-01 | MVP | Upload one image twice with different crops; placements remain independent and source bytes survive export. |
| MEDIA-02 | MVP | Replace an image; caption and layout remain editable. Missing media gets a clear repair state. |
| MEDIA-03 | Later | Link a PDF excerpt to a page/region and reopen it after export/import. |
| GRAPH-01 | MVP | Pan, zoom, select, drag and open a document through the graph; labels and hit targets remain usable. |
| GRAPH-02 | MVP | Filter by a tag, clear it and return to the document; selected identity remains coherent. |
| GRAPH-03 | Later | Expand local depth in a directed chain and cycle; record the traversal rule and avoid duplicate nodes. |
| GRAPH-04 | Later | Stress a large synthetic graph, including orphans and repeated references; record timing and frame behavior. |
| DATA-01 | MVP | Export, clear a separate test store, import and compare document IDs, content, assets and relationships. |
| DATA-02 | MVP | Simulate a failed save; show failure and retain the unsaved content for recovery. |
| DATA-03 | Later | Delete and restore a linked page; verify links, assets, history and graph state. |
| DATA-04 | Later | Concurrent offline edits on two devices preserve both changes or expose a resolvable conflict. |

## Explicit gaps

This pass does not establish behavior of proprietary sync servers, plugin compatibility, mobile-native integrations, arbitrary PDF editing, exact search parsing, or every application command. Current web documentation may describe behavior newer than the installed build. Runtime evidence should supersede assumptions only for the tested version, fixture and settings. An Obsidian feature appearing here does not imply that the Ivo MVP already implements it.
