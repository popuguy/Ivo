# Obsidian-style shell and detached note views

15 November 2026. Paul requested Obsidian's workspace organization and useful document/tab menus around Ivo's Illustrator/InDesign-style note view, plus a Firefox-like tab tear-off presentation. This pass implements those core interactions with original Ivo code. It does not reproduce every Obsidian plugin, Markdown command or Firefox animation.

The 16 November [visual continuation](obsidian/chrome-reference.md) adds the precise active-tab outline and reverse corners, native system interface font, subdued sourced controls, and coordinated sidebar animation. It preserves the workspace/menu/window ownership below.

The later [Geist/correctness continuation](ui-corrections.md) replaces the old corner overlay with a shared header row, centralizes tab styling, fixes hover/control hit areas and animation completion, and supplies sidebar-independent prompts plus guarded backdrop dismissal.

## Reference and shell

The [reference follow-up](obsidian/workspace-shell-reference.md) verifies the installed Obsidian artifact against retained REA evidence, then records actual file and active/background tab menus and the visible shell. Obsidian has a compact header for each view beneath its tabs; the mismatch was Ivo's additional shared document header and native title row.

Ivo now has a 44pt ribbon, compact Documents/Search/Bookmarks file panel, integrated 40pt tab row and 40pt pane-local view controls. Native Mac vault windows use hidden-inset title bars, with traffic-light clearance in the sidebar/tab row. The shared global document toolbar is removed. Back/Forward, title, reading/editing and More belong to each pane; save feedback sits in the bottom status area. Pane headers retain their DOM during activation, so clicking an inactive pane's controls does not destroy the click target. The note view is still Ivo's fixed-page/object/text-flow editor. Graph, split panes and the existing inspector micro-bars remain.

The sidebar can be hidden with the ribbon control; at narrow widths it uses the existing overlay behavior. File search includes content/tags, the quick switcher still uses names/aliases, and the file list has name/recent sorting and folder collapse/expand. This is a functional reference baseline for later visual refinement. Sidebar resizing, named layouts, spatial focus and richer library operations are delivered in [workspace-layouts.md](workspace-layouts.md). Independent panel regrouping remains an extension.

Eight additional icons are exact licensed Obsidian/Lucide registry resources, with hashes/provenance. Existing Illustrator assignments and cursors remain preferred where available. No new icon geometry was drawn.

## Document and tab menus

Right-click a document or use Shift-F10/Context Menu on its focused row. Actions retain that document's ID without activating a different note:

- Open in a new tab, to the right, or in a native window.
- Duplicate the document with independent object/text flow IDs and shared immutable original media.
- Move to a logical folder, bookmark/unbookmark, or rename.
- Copy a rich stable-ID document link or a native vault-relative/absolute revision path.
- Inspect/restore local version history while retaining current folder/bookmark placement.
- Reveal the current revision in Finder; open a rendered PDF in the default application.
- Move to recoverable Trash; restore from the Trash view.

Unsupported platform actions are disabled or omitted. Mac file and tab menus use the native menu API, with keyboard-accessible browser fallbacks. The native default-app action opens a generated readable PDF rather than an editable internal content-addressed JSON file. Native path/reveal operations accept a document ID and resolve its current manifest entry; the renderer cannot supply a filesystem path. Native rich copied links preserve `data-doc-id` and escaped titles; plain text falls back to a wiki link. No external Ivo URL protocol registration or application-wide OS setting is introduced.

Tab options include new/duplicate views, open/move to a native window, pin/unpin, split right/down, reorder, close and bulk closing to either side/others/all, plus appropriate document actions. A background tab's menu retains its owner. Bulk closing excludes pinned tabs; explicit Close still closes the selected tab. Closing views never deletes notes. Browser fallback menus support keyboard navigation, Escape, cancellation and constrained screen placement.

## Library data and recovery

`src/domain/documents/library.js` validates logical folder paths and library metadata. Folder/bookmark/Trash flags live under the existing `extensions['ivo.library']` document namespace, preserving unrelated extensions, text flows, object identities, source and original assets. Empty folders use bounded `library:1` metadata. Moving a note changes its logical location, not its internal hashed revision filename.

Trash is reversible and does not unlink revision or asset files. Trashed notes are excluded from ordinary navigation, the switcher, links index and graph, but remain in complete document backups. Their original source/history/assets are retained. Restore keeps their ID, source, folder and bookmark. Empty folders, local history and workspaces remain local vault metadata; the current JSON archive carries document library flags and media, not those local metadata records. Older development builds may display trashed records because they do not understand the flag.

Document formats remain canvas4/archive5/IndexedDB4; native manifest schema1 is unchanged. Metadata reads now return normalized view/library values in memory without rewriting disk at open. A later authorized save uses the original manifest hash guard to commit them. Unknown or damaged metadata still rejects without replacing the manifest.

## Tear-off and native ownership

Drag a tab beyond its window and release to move the view into a new native window. The drag preview follows vertically outside the strip; outside the window, a nonactivating native thumbnail shows the title and actual captured Ivo view. Escape, cancellation and focus loss cancel the gesture. The source tab is removed only after the destination renderer has loaded and acknowledged its state. Moving the final tab closes the empty origin after that acknowledgement. Open in new window creates another view and keeps the source. The original document is not duplicated.

Windows share one native vault actor and storage partition per vault. `desktop/workspace-windows.mjs` coordinates a single focused-window writer lease. Before another window becomes writable, the old renderer must finish composition, flush text/media/workspace state, then acknowledge release. The target applies canonical documents/assets and acknowledges activation. Failure retains or restores the previous owner; native IO rejects stale source/history/library writes. View metadata is scoped to each window. Closing one window keeps the vault registered as open while another survives; concurrent close intent is guarded. A timed-out late release acknowledgement resumes the still-owned source instead of forcing a takeover or leaving it inert.

Passive views update text, titles, relationships and original media. Their document array retains identity so existing controllers see new/renamed link targets. Asset notifications survive an asset→document burst. Refresh generations prevent a delayed passive read from replacing edits made after ownership returns. An external document change invalidates that window's stale undo timeline; an unchanged document retains its controller, selection and undo. Live undo stacks are not transferred wholesale between native windows. Canonical source and visit-specific cameras/navigation do transfer; exact live DOM/caret state is bounded by the existing persisted view model.

Primary `workspace:1`, native-owned `workspace-window:<id>` values and bounded `workspace-windows:1` descriptors preserve window layouts and reopen references. The renderer cannot read another window's private workspace key. Up to eight windows per vault and eight panes per window are supported. Closing the old main after tear-off does not resurrect it on restart when only its satellite remains open.

Dropping into an existing different native window, linked/stacked tabs, full plugin commands/settings, exact Firefox motion/OS pointer-capture behavior, accessibility breadth and native iPad multiwindow scenes remain outside this increment. Physical iPhone/iPad and trackpad/optical performance remain unverified.

## Checks

The lingering inspector-edge highlight was programmatic separator focus inheriting keyboard-visible modality. Pointer-origin separators retain actual keyboard ownership and source selection but suppress the stale outline; real keyboard use restores it. The hidden panel fixture checks computed styles using trusted keyboard delivery, including pointer use after keyboard resizing.

Pure tests cover library/portable preservation, bounded metadata and lease failure/close cases. Full-application shell, tab/menu, navigation and refresh fixtures cover background action ownership, retained source/cameras, folder/bookmark/history/Trash workflows, pinned bulk closing, late read races, dynamic link targets and passive media. The two-stage actual main/preload/native-window fixture checks native menus/paths/PDF, rejected stale writes, real app tear-off into a third window, last-tab source close, passive text/images, undo invalidation and satellite-only restart. Screenshots of the shell and tear-off thumbnail were inspected. An early uninstrumented native focus timeout did not recur in the subsequent diagnostic/integration runs; no unsupported OS focus patch or physical timing claim was made.

Private logs, captures and build ledgers are under parent `work/obsidian-shell/`. Tests use generated documents and isolated profiles/vaults. Personal Obsidian fixture originals match their hashes; normal Ivo data and global permission settings were untouched.
