# Saved workspaces and navigation

The named **Workspaces…** feature is paused at Paul's request on 18 November 2026. Its manager and restore commands are absent from the Mac and pane menus, and stale commands cannot invoke them. Existing profile-local catalogs are neither deleted nor rewritten. Ordinary automatic restoration of open tabs/windows and sidebar state, plus independent contextual panel presets, remain active. `WORKSPACE_FEATURES.savedLayouts` in `src/domain/workspace/features.js` retains a single route for reconsidering the implementation; explicit legacy fixtures continue to exercise it.

The following saved-layout behavior describes the retained, inactive implementation: save a named layout, load it, rename it, update it from the current layout or delete the saved entry. Restore Previous Workspace returns to the view arrangement before the last successful load. Deleting a saved layout never deletes a document.

A saved layout includes tab/pin order, splits and ratios, active panes, document/graph cameras, sidebar width/collapse/mode, folder disclosure state, sorting, search/tag filters graph display preferences, stacked/linked view relationships and contextual panel layouts. It excludes authored HTML, original assets, live text bookmarks, navigation trails and undo snapshots. Up to 16 named layouts fit in a bounded profile-local catalog. Missing documents are removed from a loaded view without changing the catalog or other notes.

Named layouts stay local to the current device/profile and vault. Different native windows remember their own sidebar preferences. They are not part of document JSON exports or a cloud-sync implementation. Independent named panel presets are delivered in [workspace-panels.md](workspace-panels.md); multiwindow named-layout restoration remains an extension; this increment restores the current window’s tab/pane workspace.

Loading waits for pending text, media, document and workspace writes. A failed flush leaves the existing view intact. The new window workspace is persisted before rebuilding its views; a failed workspace commit also leaves the old view in place. Dismissing a pending request prevents a late flush from applying it or reopening its dialog. Local document undo remains available across a successful view replacement.

## Sidebar and focus

Drag the sidebar edge, double-click to reset, or focus its divider with Tab and use Left/Right. Shift adjusts in larger steps; Home resets and End expands within the available width. Escape, pointer cancellation and window blur restore an unfinished drag. Resizing changes one CSS grid track and retains the live editor DOM. It does not create a document/history write. The divider starts below the Mac window-button corner.

The sidebar adapts to desktop width and remains a usable overlay on a small window. Mobile touch/device behavior still needs physical validation; synchronized assets alone do not establish iPhone/iPad readiness.

**Window → Focus Pane Left/Right/Up/Down**, also Command/Ctrl+Option/Alt+Arrow, follows split geometry. It does not wrap at an outer edge or move a document object. Existing F6 cycling, per-tab history and tab navigation remain. Composition and modal ownership guards apply.

## Library operations

Right-click a folder for New document, New folder, Rename or Move. New items retain that folder as their destination. Drag documents into folder headers or folders into another folder; drop on empty file-list space to move to the root. File-tree drag targets reject another vault, nonexistent paths, cycles and name collisions, then clear their visual highlight. Bookmark mode now has its own search field and query state; filtering it does not narrow or rebuild an independent graph pane.

Folder rename/reparent remaps nested paths and empty folders in one storage transaction with the affected document metadata. Stable document/page/object/vertex IDs, rich text, frame geometry, links, masks, originals, unrelated extensions and existing history are retained. Trash records keep their recovery semantics while their containing logical folder is renamed. Paths are logical vault organization, not operating-system byte paths.

The narrow optional `changeLibrary` store capability is implemented in both native and browser adapters. Native commits use the same expected-manifest guard and atomic replacement as other writes; IndexedDB uses one read/write transaction. A failure publishes neither half of a rename. Passive native windows receive the resulting library update, and a passive renderer cannot invoke this mutation. Individual moved documents enter their local document undo timeline. A single multi-document folder-undo transaction and cross-vault moves are not supplied by this increment.

## Verification

`tests/unit/workspace-layouts.test.js` covers snapshots, device/vault/window separation, failures, cancellation and spatial focus. Library domain/storage tests cover source preservation, cycles/collisions, stale versions, atomic failure and reopening. `npm run test:workspace-features` exercises the real application, failed document/workspace/library saves, named layout operations, pointer/keyboard sidebar behavior, folder/document drag, bookmark search, creation inside folders and reload through actual IndexedDB. Real native-window tests cover the new IPC mutation’s lease guard and peer metadata refresh. Swift Foundation interoperability now includes a folder rename with original source/media/history retained.

No new disassembly was needed for these Ivo workspace/storage commands. Existing reference evidence remains in the [workspace shell reference](obsidian/workspace-shell-reference.md); remaining exact native fidelity is tracked in the [backlog](backlog.md).
