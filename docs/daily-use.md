# Daily use and workspace ownership

Command-N creates a document immediately, reusing an empty tab and focusing its editable title. Enter/Tab proceeds to document text; composition is guarded. A blank long-form document has one canonical text flow and an area frame. Layout/templates remain a separate creation command. Command-O (also Command-K) opens the quick switcher; see [navigation](navigation.md).

Tabs can be pinned, reordered, closed/reopened, moved across splits and detached into real Mac windows. Command/Ctrl opening modifiers select new-tab/right-pane behavior. Reading/editing is a per-view choice. The compact workspace has no separate global document header; pane-local history/title/view controls remain. Document/tab context menus act on their captured target and do not activate a background item as a side effect.

`domain/workspace/state.js` owns bounded view-state commands. `features/workspace/` owns tab gestures, pure markup, menus, layout and the quick switcher. Application lifecycle services own flushing and writer handoffs. Tabs, cameras and window geometry remain separate from rich source and assets. Live undo is per document within a window; cross-window history transfer remains a separate problem.

Native vaults have independent storage actors/partitions. A recent-vault manager can create/open/reopen/forget references while leaving forgotten folders intact. Windows within one vault use an acknowledged focused-window writer lease; passive views update canonical text/media and fence stale reads. Native mobile vault picking and iPad scenes remain pending.

The daily-use, tab, shell, navigation, vault and real-window fixtures exercise these behaviors using temporary data. Current totals and validation limits are in [verification](verification.md). Named layouts, sidebar sizing/state, spatial focus and richer library operations now work; see [workspace-layouts.md](workspace-layouts.md). Panel grouping, linked/stacked tabs, drops into existing native windows, physical input/performance and final visual polish remain in the [backlog](backlog.md).
