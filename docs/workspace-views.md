# Stacked views, linked views and window transfers

The workspace extends the existing Obsidian-style shell while keeping Ivo's page editor inside each document tab. Reference behavior comes from Obsidian's official [tabs and linked views documentation](https://obsidian.md/help/tabs). This increment does not claim exact native motion, hardware timing or every Obsidian view/plugin.

## Stacked tabs

Right-click a tab or open its view-options menu and choose **Stack tabs**. The group's documents become horizontally sliding, retained views. Vertical document spines identify the compressed views and activate/reveal them. Normal tab selection reveals the chosen view; horizontal scrolling lets several documents remain visible. **Unstack tabs** restores the ordinary single-view group. Splits and stacked groups can coexist. Mode, tab/pin order, active views and individual document/graph cameras persist and belong to saved workspaces.

A visible tab owns its editor/graph controller. Changing the selected card does not rebuild its neighbor. Only the active tab accepts text, clipboard and document commands. Composition defers activation until the original input commits. Canonical document source and undo are shared between views of the same document; cameras and live caret bookmarks belong to each view. Closing a view never deletes its document. Large stacks still need representative memory/frame-pacing measurements; all 100 permitted open tabs are not a claimed smooth simultaneous editing workload.

## Linked views

A document tab's context/options menu offers **Open linked local graph** and **Open linked backlinks**. Each opens to the right and follows the stable source tab's document, including Back/Forward. Navigating an unrelated tab does not retarget it. A local graph keeps its own graph camera. Backlink results refresh after canonical link edits and undo. Opening a result creates a document tab without replacing the auxiliary view.

**Unlink view** fixes it to its current document. Closing the source tab also unlinks it; a graph retains local scope. When the source tab shows a non-document view, its linked view has no current document. Invalid/cyclic link references are discarded during workspace normalization. A linked Outline view remains queued.

## Existing native windows

Drag a tab onto a visible tab strip in another open Ivo window of the **same vault**. Its insertion position determines where the view arrives. Its camera, editing/reading mode and pin travel with it. The destination allocates a fresh local tab ID, so copied views cannot collide. Existing views, caret bookmarks and closed-tab recovery remain owned by that destination.

The native main process identifies an eligible window and asks its renderer whether the tab strip is available. It then transfers the acknowledged writer lease and asks the destination to persist the new layout. Only an acknowledged acceptance releases the original tab; moving its last tab closes the old window afterward. A failed save/receive preserves the original view and attempts to restore its writer lease. Unsupported/cross-vault targets do not receive authored data. Menu **Open in new window** still creates a separate window; a tear-off outside an eligible tab strip retains the existing new-window behavior.

This is a view transfer within one canonical vault. Live document undo/caret sessions do not migrate between OS processes. Exact Firefox drag motion, third-party-window occlusion, full multi-monitor gesture fidelity and iPad scene transfers remain validation/extensions. No cloud synchronization is implied.

## Owners and verification

`domain/workspace/state.js` owns tab relationships and stack mode; `transfer.js` prepares a bounded incoming view without altering the existing workspace. The application retains group containers separately from per-tab controllers. Desktop main/preload coordinate native drops and the writer lease. Authored archive5/canvas4, IndexedDB4 and native manifest1 remain unchanged; optional bounded fields extend workspace1 metadata. Older builds may omit unfamiliar auxiliary views while retaining authored documents.

`npm run test:workspace-views` exercises retained stacks, source navigation/backlinks, independent context groups/presets, failed and successful incoming views, ID/camera retention, real rich-text input/undo, composition deferral and current-group link ownership after a retained view moves. Existing navigation tests cover per-document source/undo, passive events, paste and pending media. `npm run test:windows` moves a real native window's last tab into an existing window through actual main/preload IPC and verifies acknowledgement, camera, canonical source, tab identity and origin closure. All test data is isolated from personal vaults.
