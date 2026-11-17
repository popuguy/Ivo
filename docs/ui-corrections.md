# Geist and workspace interaction corrections

16 November 2026. This pass addresses the reported newline font fallback, header seam/hit area, sidebar stutter paths, disconnected tab Close, collapsed quick switcher and modal dismissal. It changes no document/archive/native storage format and makes no direct edit to a personal note.

## Text insertion comes first

A text flow can have a Serif frame default while its actual text uses CMU Serif character overrides. An existing bare newline (`P`/`DIV` with only `BR`) contains no character override, so re-entering editing and typing there inherited the unrelated frame default. The affected document's formatting structure confirmed this distinction; private diagnosis used a redacted copy, not a writable personal vault.

`rendering/text/insertion.js` resolves a bare blank paragraph's insertion typography from the preceding nonempty run (or the following run at the beginning). Explicit empty-paragraph/run attributes and pending user formatting remain authoritative. Only style attributes on the existing empty paragraph change, as part of the input/history action; caret and IME nodes are retained. Enter and composition entry use the same rule. Nonempty paragraphs are not restyled. This is a bounded insertion correction, not the queued full InDesign paragraph/character style engine or a claim about every soft-break/bidi/native affinity case.

The full text-flow application fixture now enters reading/editing again, inserts on a bare newline under a different frame default, verifies CMU Serif 12px and canonical attributes, and undoes/redoes text plus formatting together. The metric fixture preserves intentionally styled empty paragraphs. Existing text, IME, source, flow pagination and export regressions remain.

## One header geometry and one tab style owner

The prior implementation combined an 88px corner overlay, sidebar border and separate nav baseline. A legacy rule in the general stylesheet also overrode the active tab's border color. A real 40px root header row now owns the shared background/baseline; native safe space, sidebar controls and tab rows use that coordinate system. The fixed ribbon toggle and overlapping pseudo-element are removed. Tab presentation lives in `features/workspace/shell.css`; obsolete duplicate rules in the general stylesheet are removed.

The title and Close are separate semantic buttons inside one common rounded visual wrapper. Hover fill encompasses both; a background Close does not activate its document. The retained sidebar control sits in an actual header slot, with the reference's small inner hover area and default arrow cursor. Native window space remains clear. Lower split rows keep their own local tab baseline.

## Motion and first-use loading

Two avoidable motion hazards were removed:

- The old 140ms/200ms cleanup removed a ribbon color transition that required 345ms, causing a premature color jump. Color transition lifetime is now independent.
- A reversed CSS width transition can finish before the independently restarted 140ms control animation. Cleanup now waits for the actual grid/control Animation.finished promises, with generations rejecting stale completions. No arbitrary completion timeout cuts off a pending control animation.

Guarded sidebar controls bypass document busy transitions, so they do not trigger editor replay/flow refresh merely by opening navigation. Existing pages and text DOM are retained; the fixture observes zero scene-node rewrites during close/open/reversal and Search/quick-switcher actions. Sidebar children hold their expanded width while the outer track clips them. Resize, cancellation, reduced motion and lifecycle cleanup settle correctly.

Geist is bundled locally, using the exact version 1.401 variable-font bytes selected in the mock-up. The shared quiet-opening boundary waits for mounted font metrics before native reveal, avoiding a first-use font swap. A component performance fixture also waits after mounting its newly used interface font before measuring camera work. The 500-object viewport check retains immediate input, no overlay-node rebuilding and zero text-overflow layout reads during panning; one observed run measured p95 event dispatch 0.2ms and p95 RAF interval 9.3ms. Those observations are local measurements, not a promise against OS/GPU/system-load stalls or physical InDesign/Obsidian frame parity.

## Quick switcher and modals

The first document-like ribbon button opens the global quick switcher, as in the Obsidian reference. Folder controls still select the file panel. Search/bookmark panel actions explicitly open hidden navigation. The quick switcher is a viewport-level prompt at 15vh, 700px/max 80vw, independent of sidebar state. Reopening it preserves the current instance/query. Its X clears a nonempty query with input focus retained, and closes an empty query.

General modal Close is a 24px contained hover control, 16px sourced X and default cursor. Ordinary outside clicks dismiss. A primary gesture must begin and end outside with less than 5px displacement; both viewport and screen displacement are checked. Inside clicks and drag-out selections do not dismiss. Existing native dialog Escape/focus behavior remains. Dismissal is held during an active submitted operation rather than losing that operation's UI halfway through its commit.

## Evidence and verification

The bounded [Obsidian reference](obsidian/chrome-reference.md) reuses matching installed-artifact hashes and retained REA identities. New exact source anchors/rules and implementation notes are retained privately in parent `work/ui-fixes-2026-11-16/reference/`. Resource observations are static; no native disassembly is warranted for shipped renderer CSS/JavaScript. The user's screenshots supply direct visual evidence of the earlier seam and disconnected hover.

The workspace fixture uses real host hover/click/drag and UI zoom 1/1.1/1.25 to verify shared baselines, native-safe hit areas, tab-close containment/ownership, motion reversal, hidden focus isolation, global prompt placement/clear/reopen, and modal inside/outside/drag distinctions. The tab-interaction fixture now renders the production tab view rather than obsolete hand-built markup, preserving its reorder/tear-off/cancel assertions. All existing domain/storage, text, window/lease, startup and build checks remain required. Private logs/captures/checkpoint are in parent `work/ui-fixes-2026-11-16/`.

The packaged Mac visual check passed in an isolated vault, preserved both document models and closed normally. All 138 shared web files match across the build, iOS assets and Mac package; all 81 runtime sources match the package. All five standard checks and all 26 runtime groups pass across the retained logs. See [verification](verification.md) for the initial stale-fixture failure and successful continuation. Native fullscreen-specific spacing, long-running load/frame pacing across hardware and iPhone/iPad native-device validation remain bounded follow-up work. Global permission settings, accounts, original assets and remote commits are unchanged.

## Hover follow-up

The first correction still attached the sidebar hover fill to the entire button wrapper. Obsidian attaches it only to the inner clickable icon; the outer padding remains clickable without painting the icon's hover. A general `button:hover` rule also overrode the muted sidebar ink, and native inspection exposed the same blue leak on tab titles after the toggle moved away. Both controls now own their neutral color. Sidebar opacity follows the inner icon's 140ms reference transition; padding entry and leaving the control clear its fill correctly in expanded and collapsed positions.

Tab Close previously used the preferred Illustrator X asset and its embedded 0.65 alpha, further multiplied by generic icon hover opacity. Its viewport was 16px, but its path geometry/ink differed from Obsidian. The new `tab-close` reference alias retains the exact already-attributed Obsidian/Lucide X, independent of other icons' Illustrator preference. A CSS alpha mask renders those unchanged paths with the control's actual ink: 16px glyph, 2px padding/20px target, muted #5c5c5c at rest and #222 on direct hover, with no extra opacity fade. Only the active tab Close gets its own 6.7% black hover fill; a background Close shares its tab's rounded hover. Root inner padding is 6px at the start and 3px at the end, with a 2px gap. Existing artwork is preserved; the alias adds no hand-drawn path or inline SVG.

Matching installed artifact identity and focused source rules are retained in parent `work/hover-controls-2026-11-16/reference.json`, alongside the checkpoint and test logs. This is manual shipped-resource inspection reusing the earlier matching REA Evidence, plus native UI observation, not a new REA runtime trace. The source cascade confirms `--icon-s` resolves to 16px; an intermediate 18px estimate was corrected before implementation.

The workspace regression now uses a real hidden-inset Mac titlebar and checks actual pointer entry into wrapper padding, inner icon and outside in both sidebar positions, exact Close source/geometry/ink/opacity, active/background hover distinctions and neutral tab-title hover. Workspace, tab-drag/menu and shell regressions pass. Native inspection independently checked expanded/collapsed sidebar hover and clicking, both Close states, and unchanged isolated sample document models. Standard checks pass with 171 unit tests. The review app is `release/2026-11-16-hover-controls/Ivo-darwin-arm64/Ivo.app`; shared web/iOS/package comparison retains 138 matching files and 81 matching runtime sources. Fullscreen and physical-device coverage retain their earlier limits.

## Native hit-area correction after physical reproduction

The phone photos exposed a failure the prior hover verification did not establish: the center of the sidebar button was inside an Electron window-drag region. A normal coordinate click at local (14,20) did nothing, while (31,20) in its narrow right strip reached the button. Electron's `ELECTRON_DEBUG_DRAGGABLE_REGIONS` overlay confirmed that the native draggable rectangle covered the center. This was reproduced against the shipped layout in an isolated native diagnostic, without loading personal documents.

Electron consumes an ordered rectangle list; later overlapping drag rectangles can add back area excluded earlier. See the [pinned 45.2.2 region implementation](https://github.com/electron/electron/blob/v45.2.2/shell/browser/ui/drag_util.cc#L25) and [custom-window interaction contract](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions). A high visual z-index and successful `elementFromPoint`/renderer hover do not prove the native region excludes a control.

The control slot is now a root grid peer, appended after sidebar and pane drag surfaces, and its entire 36×40 allocation is explicitly non-draggable. The 36×39 button and 28×24 visual hover target stay distinct. The existing retained identity, common header baseline and animation geometry remain. The narrow open-sidebar slot stays only 36px wide, so its input layer cannot cover neighboring navigation buttons.

Earlier tests injected mouse input into `webContents`; this bypasses macOS non-client hit testing. Earlier accessibility presses and a drag ending over a control were also insufficient evidence of ordinary pointer reachability. The corrected physical check used fresh ordinary coordinate clicks, with each motion settled before the next click: all 26 trusted clicks passed across 13 positions, each tested in both expanded and collapsed locations. This includes the icon's center, edges and surrounding padding. The top native resize edge is outside the visible target and remains an OS frame hit. Logs and `native-hit-verification.json` are retained under parent `work/native-hit-2026-11-16/`.

The workspace fixture now samples ordered drag/exclusion coverage and DOM reachability across the button, after collapse, split-pane changes and narrow navigation. This is an explicit renderer geometry model, not a claim of automated native input. It also now fails on uncaught errors/rejections. That exposed an existing canvas global-key handler assuming every event target was an Element; it now ignores non-element targets before calling `closest`. Standard checks (171 unit tests), workspace, shell, tabs and editor interaction regressions pass. The initial viewport timeout and diagnostic logs are retained with successful reruns.
