# Quick switching and document navigation

Command-O and Command-K open a quick switcher for document titles/aliases. Matching supports fuzzy input and recent-document ordering. Blank results favor the active/recent collection; Enter opens a result, Command/Ctrl-Enter opens a tab, Command/Ctrl+Option/Alt-Enter opens to the right, and Shift-Enter or Enter without matches creates a document. Sidebar search also covers content and tags. Exact Obsidian ranking/exclusions remain reference work.

The pure ranking/MRU helpers live in `src/domain/knowledge/navigation.js`; accessible dialog behavior lives in `features/workspace/quick-switcher.js`. Creation and opening are application commands. Whole-document templates preserve mixed pages, rich text, masks and immutable media; text snippets/variables remain queued.

Nested Split Right/Down, cross-pane tab movement, per-tab visit history and Command/Ctrl-[ / ] work. F6/Shift-F6 cycle panes; Ctrl-Tab stays within its pane. Modified document/link opening and the reading/editing control can open another view to the right. Command/Ctrl-Shift-N creates a document there. Real native window opening/tear-off and contextual document/tab menus are described in [workspace-shell.md](workspace-shell.md).

Named layouts, sidebar sizing and spatial focus are described in [workspace-layouts.md](workspace-layouts.md). Linked/stacked tabs, existing-window drops and full native interaction parity remain in the [backlog](backlog.md). [Workspace navigation](workspace-navigation.md) records the bounded restore/ownership behavior; [verification](verification.md) owns current test status.
