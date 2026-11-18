# Nonmodal workspace panels

Properties, Pages, Layers and Links can be independent groups, tabbed together, stacked in the right dock or floated within the document view. Narrow micro-bars, compact rectangular tabs and sourced artwork follow the desktop publishing reference. The [publishing foundation](publishing-foundation.md) records the current InDesign-inspired controls and remaining visual/interaction parity work.

## Organize panels

Drag an individual panel tab onto another group's tab strip to join/reorder it, out into the document view to float it, or onto the right-edge target to dock it separately. After the four-pixel movement threshold a retained tab preview follows the pointer immediately, without a hold timer. Drag the narrow **Panels** bar to move the whole group. A group's bar can also be dropped onto another group's tabs to combine their panels. Double-click the bar or use its menu button to toggle floating/docked. Right-click a tab/bar for explicit floating, separate docking, grouping and close commands.

The dock stacks its groups vertically. Resize its inner-left edge, a floating group's lower-right corner, or Document text's divider. Arrow keys resize a focused control one screen pixel; Shift-arrow ten. Context tabs support Left/Right/Home/End; keyboard Context Menu/Shift-F10 exposes tab organization. Escape cancels a drag, as do pointer cancellation and window blur. Pointer resizing does not retain the keyboard focus highlight. Floating bounds remain reachable after a smaller window; narrow views expose dock groups as an overlay through **Properties**.

Collapse hides the selected group. Its X closes the group; a tab context menu can close only that panel. The status-area Properties control restores hidden groups, and native Window menu entries restore individual panels. A remaining panel's context menu also offers closed panels. Closed groups and tabs are removed from painting and pointer/accessibility targets. The default dock is 296 CSS pixels; existing saved widths remain respected and narrow tab strips scroll. The right dock and floating groups stay inside the same document view; left/bottom docks, separately adjustable dock-stack proportions, external panel windows and native multi-monitor behavior remain extensions.

## Presets and saved workspaces

The context menu supplies **Compact**, **Layout** and **Links** presets. **Save panel preset…** stores the current groups, active context tabs, floating bounds, dock width and Document text height under a name. Reusing the same name updates it. Saved entries can be loaded or deleted from the menu; deleting a preset leaves the live view unchanged. Up to 16 presets are kept per vault in the local device/profile. Names are plain text, normalized and bounded. Save errors stay in the naming popover rather than discarding the layout.

Context layouts also belong to named [workspaces](workspace-layouts.md). Changing a context layout updates retained document views in the current window. It does not dirty documents, change authored geometry, enter undo, copy media, or create cloud replicas. Different windows retain their own chrome preferences; named panel catalogs are shared for that vault/profile. The earlier single-group preference key migrates into the current bounded representation.

## Ownership and evidence

`domain/workspace/panels.js` normalizes a unique partition of four context panels, a separate closed-panel list (view version 3), and regrouping/presets. Older view layouts gain Layers without dropping their previous organization. `panel-presets.js` owns named catalog semantics. Profile persistence belongs to `storage/workspace-preferences.js`. `features/editor/ui/panels.js` retains/moves panel containers; the page canvas and live Document text input nodes stay connected. Source, selection/camera and document history have separate owners. These view changes do not require a document/archive migration.

The interaction follows Adobe's documented [panel/group moving, docking and workspace workflow](https://helpx.adobe.com/illustrator/using/customizing-workspace.html). No new icon/cursor artwork was drawn. Exact vendor timing, complete Illustrator docking and final styling are not claimed.

`npm run test:workspace` covers pointer/keyboard resizing, focus, float/move/dock, Escape rollback, live source/caret retention, Document text sizing, context-tab navigation, identical authored content/camera and remount persistence. `npm run test:workspace-views` covers independent tab tear-off/regrouping, dock-stack presets, named preset save/load, retained neighbor/source DOM, cancellation, and failure-safe view persistence. Domain tests cover malformed layouts, unique panel ownership, legacy migration, scoped catalogs and source-free snapshots. All runtime profiles/vaults are temporary.

Shared iPhone/iPad assets include this code. Physical touch/Pencil, accessibility, IME and device performance still require full Xcode/device testing.
