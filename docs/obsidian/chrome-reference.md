# Obsidian tab and sidebar appearance

16 November 2026. A bounded visual follow-up to [workspace-shell-reference.md](workspace-shell-reference.md). The user's screenshots and the installed Obsidian window establish the requested appearance. Matching shipped CSS/renderer JavaScript establish dimensions and declared animation timing; they do not measure physical frame pacing.

## Reference evidence

The installed `obsidian.asar` still hashes to `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248`. Matching `app.css` is `dabc7a75001af0cf898501d570e110d86f269496789942fbb3370bba47a3db07`; `app.js` is `12194d5ec11152b78a7532a521ac9fdc88be0ab4768ddedb7fd238d0d8c6031a`. Existing REA Evidence `ev_6a3f18deceb876b5ce3f0320a1e75af5577e9bc75cf79981c87088439ccb8e90` and `ev_060fedf12cfe5ca330bfd0fcc60e5f2407a81f7b8a8976a92e4143788a5e02a2` remain applicable. This pass reuses those identities and adds focused manual member inspection rather than repeating whole-application analysis or native disassembly.

Exact source offsets, narrowed CSS/JavaScript excerpts, hashes and the custom toggle's provenance are retained privately in parent `work/obsidian-chrome-2026-11-16/`. CUA confirmed the installed window's active-tab contour and placement. Live reference animation cadence was not sampled.

## Observed resource rules and Ivo implementation

| Detail | Shipped reference | Ivo |
| --- | --- | --- |
| Active seam | 1px outline, 10px upper corners and 10px reverse lower corners, white fill crossing the row baseline | Original CSS uses the same dimensions and clipped lower-corner construction; no border crosses the white active tab |
| Surface colors | `#f6f6f6` row/sidebar, white active view, `#e4e4e4` outline, `#dadada` short inactive divider | Shared chrome tokens and short inactive dividers |
| Tab content | 40px row, 13px normal-weight text, ordinary Markdown/empty tab file glyph hidden | Ordinary document tab glyph hidden; active/hover Close and existing pins retained |
| Sidebar motion | 140ms, `cubic-bezier(0,.55,.45,1)`; hold child width while clipping the shrinking outer sidebar | Stable three-track grid interpolates the sidebar track, holds inner widths, and retains editors; interrupted CSS transitions reverse from their current position |
| Header spacing | 75ms tab-strip padding transition | Same declared timing for the leading control clearance |
| Sidebar control | Same element relocates into first central tab row on collapse; custom rounded frame/filled pill | One retained control moves with the panel. Private review build uses the exact sourced custom glyph and original open/closed pill widths; public build retains licensed Lucide fallback |
| Native corner | State-dependent Mac reservation around 80px plus normal header padding | Keep existing native-button corner clear; collapsed toggle at 84px and first tab at 124px; ribbon starts below header |
| Interface font | Native system sans precedes optional font fallbacks on Mac | Separate `--interface-font` uses system sans. Authored document sans/serif choices remain separate |

Ivo uses a retained fixed-position toggle and a CSS grid transition; Obsidian reparents its retained toggle with a transient departing clone and uses Web Animations on sidebar width. The measured resource geometry/timing are matched through Ivo's own implementation. Exact native scheduling, every theme, fullscreen-specific clearance and physical trackpad/display cadence remain outside this bounded comparison.

Collapsed controls become inert immediately. Focus returns to the toggle if a hidden sidebar owned it. Resizing remains immediate; restoring preferences does not animate the first painted workspace. Reduced-motion preference disables the transition. Narrow views retain the existing overlay and reserve a reachable leading toggle.

## Typeface review

Private mock-ups render the real Ivo application with identical isolated documents and UI geometry in Graphik, SF Pro/system, Neue Haas Grotesk Text, Geist, IBM Plex Sans and CMU Serif. Font loading is verified, and the document frame remains in CMU Serif for every option. Installed font paths/digests and a selectable image comparison live in parent `work/ui-chrome-2026-11-16/mockups/`. These are review artifacts, not additional bundled fonts or a selected final interface typeface. Current sources: [Geist](https://vercel.com/font), [IBM Plex](https://www.ibm.com/plex/).

## Validation

The existing native workspace fixture now samples actual intermediate sidebar widths, reverses an interrupted transition, checks the toggle's pointer hit area and window-button/tab clearance, verifies hidden controls are inert, and then exercises pointer/keyboard resize, persistence and live-editor retention. The shell/menu, text, navigation, startup and native-window suites retain their existing coverage. A final packaged native review checked expanded/collapsed controls, restoration and tab activation in a separate sample vault; both original sample documents remain byte-equivalent at the source-model boundary after closing. A nested three-pane regression confirms only the top-left tab bar reserves native-control space. Review captures and build logs are under parent `work/ui-chrome-2026-11-16/`. Personal document bytes and global permission settings are untouched.
