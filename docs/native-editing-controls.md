# Native editing controls

The daily-use command and input baseline follows Adobe's [InDesign shortcuts](https://helpx.adobe.com/indesign/desktop/get-started/settings-and-preferences/keyboard-shortcuts.html), [panel behavior](https://helpx.adobe.com/indesign/desktop/get-started/settings-and-preferences/customize-panels.html), [tab controls](https://helpx.adobe.com/indesign/desktop/format-and-style-text/tabs-indents-and-spacing/set-and-repeat-tabs.html), [default half-inch tabs](https://cdn.edex.adobe.com/v3/uploads/resourceFile/2016/c7421bbc-8888-486f-b02f-cacf6fb406a9.ef1f5338-5180-4ee2-b273-11cf69340835.pdf) and [Illustrator arrangement shortcuts](https://helpx.adobe.com/illustrator/desktop/get-started/preferences-and-settings/default-keyboard-shortcuts-for-illustrator.html). These are documented behavior references; this pass does not establish pixel/timing equivalence to a live Adobe session.

## Type shortcuts

| Action                                      | Mac         | Windows                     |
| ------------------------------------------- | ----------- | --------------------------- |
| Decrease / increase type size by 2 pt       | ⌘⇧, / ⌘⇧.   | Ctrl+Shift+, / Ctrl+Shift+. |
| Decrease / increase type size by 10 pt      | Add Option  | Add Alt                     |
| Auto leading                                | ⌘⌥⇧A        | Ctrl+Alt+Shift+A            |
| Small Caps / All Caps                       | ⌘⇧H / ⌘⇧K   | Ctrl+Shift+H / Ctrl+Shift+K |
| Align left / center / right                 | ⌘⇧L / C / R | Ctrl+Shift+L / C / R        |
| Justify, last line left / justify all lines | ⌘⇧J / ⌘⇧F   | Ctrl+Shift+J / Ctrl+Shift+F |

Size shortcuts adjust each selected run by the increment. At an insertion point they set the size for subsequent typing. With one text frame selected, formatting follows its text flow. Arrow-key navigation retains the platform behavior described in [text navigation](text-interaction-core.md).

## Tab and application chrome

Tab at an active text insertion point inserts literal U+0009, retaining nearby formatting, selection ownership and text undo. Ordinary tabs advance to default 36-point stops in the native Core Text plan; browser layouts receive a disposable paragraph whitespace/tab projection. Canonical HTML retains the original tab character. The projection does not introduce a new saved tag, spacing override or format migration. A tab-containing paragraph preserves its literal whitespace for layout instead of collapsing it as browser HTML did. The later [clipboard correction](text-interaction-core.md#clipboard-whitespace) extends this projection to significant leading/trailing and repeated spaces; ordinary paragraphs retain their prior rules.

Outside text and property fields, Tab stashes/restores the editor's tool rail, contextual controls and panel containers; Shift-Tab leaves the tool rail visible. This changes view state only and retains saved panel arrangements and input DOM. Opening a panel explicitly restores the view. Application chrome no longer uses ordinary Tab to visit arbitrary buttons/links/objects. Inspector/dialog fields retain a bounded field-to-field route rather than traversing the whole page. Ctrl-Tab document switching, arrow-driven menus/tabs, native fields and accessibility labels remain available. The Obsidian-style library/sidebar is still a separate workspace surface.

UI text is unselectable by ordinary pointer dragging. Authored reading/editing content and input fields retain their selection rules. The final native appearance requirement is broader: remove remaining browser-looking controls, hover/focus/cursor differences, default interactions and layout inconsistencies throughout Mac, browser and iPhone/iPad builds. That final styling/interaction audit remains on the backlog.

Shift-Tab's special right-indent tab inside text, custom tab stops/alignment/decimal characters, tab leaders and table-cell navigation belong to the paragraph/structured-text engine work. They are not implemented by inserting arbitrary spaces; the current Shift-Tab text route explains the unavailable operation without moving browser focus or altering source.

## Arrangement and guide menus

**Object → Arrange** exposes Bring to Front (⇧⌘]), Bring Forward (⌘]), Send Backward (⌘[) and Send to Back (⇧⌘[). One domain command preserves selection order and operates within each page, layer and clipping-parent sibling set. Moving a parent retains its descendants; selecting both does not reorder a child separately. Locked/hidden selected objects are excluded. Commands share normal document undo/redo, and native menu enablement follows the current editable object selection. Text entry and field shortcuts do not reorder objects. Document-history Back/Forward moves to ⌥⌘[ / ⌥⌘] to avoid the former collision.

**View → Smart Guides** (⌘U) owns the existing edge/center alignment-snapping preference. Its native checkbox reflects renderer state; split panes share changes. The removed bottom Snap checkbox no longer owns this preference. Underline uses ⇧⌘U so the two commands do not collide. Bold and italic retain Ivo's established ⌘B / ⌘I aliases. True point/grid/ruler-guide snapping and complete Illustrator spacing/angle/guide feedback remain separate geometry work; a menu label does not certify those algorithms.

The existing top pane-options menu supplies View/Arrange submenus in the browser as well as the native Mac application menu. The canvas status strip is 22 CSS pixels high and contains only page navigation and zoom/fit controls, including the two-decimal zoom value. Save state and tool/snap labels are removed from that strip; save failures remain application notices. Panel controls remain in their own tool/panel/menu surfaces.

## Qualification

Domain regressions exercise stable selected runs, boundaries, clipping parents, locked/hidden objects and native menu state/shortcut declarations. A hidden actual-editor fixture drives trusted Tab, Smart Guides and arrangement keys; it checks text formatting/undo, view/source separation, panel visibility, page navigation (including exit from an off-page editable owner) and the narrow status contents. The application fixture covers reading/editing Tab routing and whole-frame formatting-target refresh. The retained caret fixture now uses the production 2D camera rather than the retired CSS-layout-zoom simulation. Native text tests verify exact tab caret positions and same-plan PDF output. The production Mac menu fixture additionally passes trusted bracket ordering, arrangement undo, Smart Guides checked state, Tab panel routing, the updated underline shortcut, whole-frame formatting and native continuation. Selection/tool changes explicitly schedule a coalesced menu refresh after focus settles; leaving text publishes the new target. Earlier multi-object runs exposed stale menu state, and the dedicated application/production regressions now pass. The broader foreground desktop suite remains separate from offscreen component checks. Physical IME/touch, custom tab composition, complete native appearance and exact reference timings remain open.
