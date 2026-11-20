# Working on Ivo

Use Node.js 22.13 or newer and the pinned `package-lock.json`. Run `npm ci`; source is ordinary ESM JavaScript. No framework, global tool installation, account, or native SDK is needed for the shared-engine unit tests. Electron runtime checks require a desktop session. Full iOS builds require Xcode.

## Find the owner first

| Change                                                                            | Location                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Document data, page/object commands, masks, text flow                             | `src/domain/documents/`                                             |
| Links, search, backlinks, graph projection                                        | `src/domain/knowledge/`                                             |
| Geometry, snapping, selection and camera math                                     | `src/domain/geometry/`                                              |
| Tabs, pane layout, navigation snapshots                                           | `src/domain/workspace/`                                             |
| Application startup, document save/history lifecycle, window refresh coordination | `src/app/`                                                          |
| Pointer/text interaction and inspector controls                                   | `src/features/editor/`                                              |
| Workspace views, tabs, quick switcher and menus                                   | `src/features/workspace/`                                           |
| GPU graph and worker                                                              | `src/features/graph/`                                               |
| Page/text rendering and derived pagination                                        | `src/rendering/`                                                    |
| Vault transactions, browser storage and autosave                                  | `src/storage/`                                                      |
| Native startup; host adapters                                                     | `src/platform/`, `desktop/`, `ios/`                                 |
| Local test data and regressions                                                   | `tests/unit/`, `tests/runtime/`, `tests/native/`, `tests/fixtures/` |

A domain module must run in Node without a DOM, renderer, platform SDK, storage connection, or application singleton. Storage interprets validated data and uses an injected byte IO port. Features never import the application. `npm run check:architecture` checks these boundaries, imports and cycles. Keep exported APIs small and descriptive; add JSDoc where data/ownership is not obvious.

## Make a change

1. Read `docs/development/STATE.md` and the relevant backlog item. Preserve authored IDs, source HTML, original assets and fractional geometry.
2. Add behavior at its owner. A UI command should call a document command; it should not interpret provider responses or perform native file IO. Keep authored source separate from derived fragments and view state.
3. For format changes, add a capability gate and a frozen old-format fixture. Reject ambiguous/newer data before writing. Read migrations do not rewrite a vault; new edits use the current representation. Update `docs/data-format.md`.
4. Test the behavior that could fail: a domain regression for semantics, a runtime regression for selection/IME/DOM/gesture behavior, a native test for byte IO or window ownership. Pure selections and camera movement must not dirty a document.
5. Run the checks appropriate to the change, then update the current state and backlog with evidence and remaining limits. Keep screenshots/profiling traces in private work artifacts, not source modules or giant chronological handoffs.

## Version control

Use Git throughout the remainder of the project, as requested on 17 November 2026. The accumulated development is recorded as a present-day baseline; subsequent work should use small, coherent commits.

Inspect the working tree and branch before starting. Use feature branches for substantial work, preserve unrelated edits, and commit completed, verified milestones during each implementation pass. Review the staged diff and run the relevant checks. Keep the existing GitHub origin in sync with ordinary pushes, preserving remote changes and published history. Report the commit, validation and any remaining local work at handoff. An explicit request to leave work uncommitted takes precedence.

GitHub checks Markdown formatting and patch whitespace for changes confined to the three root guides and Markdown under `docs/`. Feature branches are compared with their common ancestor on the default branch. Other changes run the shared engine, native storage, iOS build and desktop editor checks. A push of the same commit can reuse a successful run with all four jobs. Its check summary links to the evidence. If verification history is unavailable, GitHub runs all four. Use **Run workflow** on Check Ivo to request a fresh full run.

File archives are supplemental recovery checkpoints. Keep extracted proprietary artifacts, personal vault data, credentials, dependencies and generated release trees outside Git. Include licensed public assets and their notices. [AGENTS.md](AGENTS.md) carries this workflow into future coding sessions.

## Commands

```sh
npm run format
npm run check
npm run test:text       # focused runtime example
npm run test:text-flows
npm run test:windows
npm run test:runtime    # all runtime groups, sequentially
npm run test:background # qualified hidden/offscreen component subset
npm run test:native
IVO_PACKAGE_OUT=release/my-pass npm run desktop:package
npm run ios:prepare
```

Runtime runners create temporary vaults/profiles and never use a personal vault. Do not run GUI groups concurrently: native focus and menu ownership are part of their contract. Use a fresh release directory instead of replacing a running app. A missing full Xcode installation does not make Foundation tests equivalent to an iOS device test.

Keep the user's laptop usable while developing. Prefer command-line workers and `test:background`, which runs seventeen selected component groups sequentially with hidden offscreen windows, no native window focus, and macOS activation prohibited for those test processes. The helper fails the run if a test window becomes visible or focused. Renderer-directed input still exercises the real editor/bridge/worker. The ordinary runtime commands retain their foreground behavior; this subset does not qualify physical input, native menus, the system clipboard, production-window activation or devices. Give a heads-up before necessary foreground checks, and do not launch review apps merely to show progress. Global settings and personal app sessions remain untouched.

### Measure desktop interaction latency

Run `npm run test:responsiveness` in an idle Mac desktop session. It opens a normal Ivo window with a temporary vault, measures submitted input through the first matching window frame, and checks that rapid edits reach disk. The default is Paragraph Composer. Set `IVO_RESPONSIVENESS_COMPOSER=single-line` or `browser` to exercise the other modes. Set `IVO_LATENCY_BUDGET=1` for reference-Mac median limits of 25 ms for Layers locks, 80 ms for fresh middle-of-paragraph edits and 65 ms for the repeated last-page edit. Review the full distribution for slow inputs. Run the modes sequentially with other suites idle.

## Build and artwork

Served builds retain debuggable ESM files. esbuild produces the standalone app and its worker; do not add a hand-maintained module list or rewrite import syntax. The offline cache is generated from the shipped source/assets with a content digest. Add normal imports and assets; no manual cache list update is needed.

For Illustrator and InDesign controls, use the installed English label verbatim and the original vector or raster when available in a local review build. Keep the source and public fallback identifiable so visual comparisons test the intended control.

`src/shared/ui/reference-art-data.js` is generated and ignored. `scripts/reference-art.mjs` uses licensed Obsidian/Lucide assets for reproducible public builds and can use locally retained Illustrator artwork. Keep license notices and do not commit proprietary extracted code/artwork. See `docs/asset-attribution.md`.

## Keep the project pleasant to change

Use **document** in user-facing language. A text flow is the canonical rich-text source threaded through frames. View state is a different concept from document content. Use stable IDs for references; titles are editable labels. Avoid broad catch-all context objects, data duplicated between panels, speculative provider frameworks and UI-driven schema changes. Keep formatting/lint checks enabled, and refactor a concrete responsibility when a coordinator becomes difficult to navigate.

Mac desktop builds compile the shared Core Text font and composition helpers using Apple Command Line Tools (`xcrun swiftc`). Generated executables/compiler caches under `desktop/native/bin/` are ignored; desktop packaging unpacks and verifies both executables. Ordinary browser/unit builds do not require Swift. `npm run test:fonts` verifies a temporary font-bearing vault and the installed-font picker; native checks include collection-face/checksum export and real composition/PDF output. `test:native-editor-composition` exercises the actual opted-in canvas and source/history boundary with trusted input; `test:text-composition-bridge` checks both native preloads. Both Apple source modules are referenced by the iOS project; full Xcode/device tests remain separate. `npm run preview:composition` builds the self-contained illustrated composition explanation; automated fixtures under tests are not user-facing preview links.
