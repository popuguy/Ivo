# Workspace shell and context-menu reference

15 November 2026. A bounded follow-up for Ivo's shell, file/tab context menus and detached views. This reuses matching retained REA evidence and adds actual installed-app menu observation; it is not a new whole-application analysis or a reconstruction of all Obsidian behavior.

## Artifact identity and method

Installed Obsidian reports **1.15.0**. `obsidian.asar` SHA-256 remains `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248`; its bootstrap `app.asar` is `9bc94d3b6b9e9579941bb7d20628aa5331f46ee508b270e9123e629f388df207`. Exact installed ASAR member bytes were compared against the retained extracted sources:

| Member | SHA-256 |
|---|---|
| app.js | `12194d5ec11152b78a7532a521ac9fdc88be0ab4768ddedb7fd238d0d8c6031a` |
| app.css | `dabc7a75001af0cf898501d570e110d86f269496789942fbb3370bba47a3db07` |
| main.js | `5a742d9439e50822b06f5560b4fdbd2a4563f36bbb8dd445aa19d62ba34865d9` |

Retained REA core Evidence `ev_6a3f18deceb876b5ce3f0320a1e75af5577e9bc75cf79981c87088439ccb8e90` and entrypoint Evidence `ev_060fedf12cfe5ca330bfd0fcc60e5f2407a81f7b8a8976a92e4143788a5e02a2` remain applicable to these identities. Semantic retention has the previously documented limits. The focused source flows below are manual static observations, rather than a new automatic feature trace. No REA/native target session was opened. Original conclusions and exact character/byte/line anchors are retained privately under parent `work/obsidian-shell/`.

Native computer-control observation used the already registered owned `obsidian-vault` fixture. It inspected menus and created/closed one empty tab without creating a note. A generic Open in new window action displayed the fixture's existing Untitled.base, then that window was closed without edits; this establishes general popout creation, not note-specific synchronization or tear-off animation. The fixture window was closed and the original personal New tab window restored. All four original fixture source hashes still match the prior recovery ledger. No note text or application/global permission settings were changed.

## Shell organization

The key distinction is between a global document toolbar and the header of each view. Obsidian has a narrow tab row integrated with the desktop window frame and sidebar tab controls. Its left ribbon and sidebars sit alongside the central workspace. **Each leaf still has a view header** below its tab row: navigation buttons, a title/breadcrumb, a view-mode action and More options. Header visibility is separately configurable. Side-panel leaves suppress that header. This was established in the shipped DOM construction/CSS and confirmed in the visible fixture; removing all per-view navigation would not match the observed arrangement.

The shipped desktop CSS defaults provide a useful dimensional baseline: ribbon44px, header/tab row40px, small interface/tab text13px, nominal tab width200px with maximum320px, active tab upper corners10px. These are resource defaults, not physical-pixel measurements or a promise that every theme, display scale or platform uses the same dimensions. Ivo's original `workspace-shell.css` follows this organization while retaining its page editor as the note content.

## File context menu

The native fixture file menu matches the supplied screenshot. Sections include:

- Open in new tab, Open to the right, Open in new window.
- Duplicate, Move file to…, Bookmark….
- Copy path submenu: application URL, path relative to the vault folder, full system path.
- Open version history.
- Open in default app, Reveal in Finder.
- Rename…, Delete.

The file explorer contributes creation/open/duplicate/rename/delete actions, while common workspace and enabled plugins contribute paths, move, bookmark, history and system actions. Consequently the exact list is context/platform/plugin dependent. An application using a structured document store must supply truthful equivalent operations rather than treat an internal revision JSON path as a normal user-facing note file.

## Tab context menu

Common tab actions are Close, Close others, Close tabs after, Close all, Pin/Unpin, Link with tab/Unlink and Move to new window. Bulk-close lists exclude pinned tabs in the inspected implementation. Conditions suppress meaningless bulk actions. Closing tabs removes views, not files. The separate Cmd-W route can unpin a pinned tab before closing; this should not be conflated with every explicit Close action.

An active visible Markdown note additionally contributes Backlinks in document, Reading view, Source mode, Split right/down, Open in new window, Rename/Move/Bookmark, Merge file, Add property, PDF export, Find/Replace, path/history actions, linked views (local graph, backlinks, outgoing links, properties, outline), system opening/reveal and Delete file. Background-tab right-click does **not** activate the tab; native observation showed only its common tab actions when that view was not currently visible. Ivo can reuse actions appropriate to its rich page view without displaying unsupported Markdown-source commands.

The tab-group dropdown lists open tabs, marks the active tab and offers group-level actions such as Close all and stacked tabs. Pointer reorder uses an insertion location; dropping over the tab bar may insert a tab or navigate an eligible existing tab depending on the dragged payload. These paths are statically established; exact hover timing and animation remain unmeasured.

## Detached views

Open in new window creates a new leaf for a file. Move to new window takes the existing leaf out of its prior parent and inserts it into a floating split, preserving its view/ephemeral state. The ordinary drag handler has a separate outside-window detection path that moves the same leaf to a popout at release. Width/height and UI zoom are passed into the popout route. Static flow supports this distinction; it does not measure native event delivery or visual continuity.

No Firefox reference artifact or native tear-off trace was acquired in this follow-up. A Firefox-like preview and drop presentation is therefore an explicit Ivo design preference until directly measured. Shared-vault detached Ivo windows also require one coordinated source/storage owner; merely loading a second independent writable renderer would not reproduce safe view movement.

## Coverage and remaining questions

The file menu, active/background tab menu and shell organization are answered by matching static plus native evidence. Basic generic popout creation is observed. Actual tab tear-off motion/timing, cross-window drop/cancel behavior, linked-tab navigation, stacked tabs, every plugin/platform variant, physical touch/accessibility and Firefox animation remain partial or unmeasured. No exact native fidelity claim should cover those gaps.
