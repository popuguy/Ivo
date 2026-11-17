# Architecture pass review

15 November 2026. This records engineering findings, not a change to the requested product vision.

## What was making development harder

| Previous condition                                                                                                 | Effect                                                                                         | Change                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flat source directory; document construction, validation, links/search and Markdown export shared one model module | A change had unclear ownership and encouraged renderer/storage coupling                        | Domain/application/features/rendering/storage/platform owners; separate construction, schema/migration, queries, export and pure typography                       |
| Much of the source was compressed into very long lines                                                             | Input state, error handling and interactions were difficult to review                          | Standard formatting, lint and focused responsibility extraction; separate workspace/quick-switcher/inspector views and document/refresh services                  |
| Portable build used a manually ordered module registry and import/export replacement expressions                   | Normal ESM changes required special build maintenance and could fail only in standalone output | esbuild follows real imports; the module worker has an explicit standalone boundary; both built versions now boot and exchange real worker messages in tests      |
| Offline cache listed files manually                                                                                | A source addition could be missing offline                                                     | Generate cache paths and version from shipped file bytes                                                                                                          |
| Chronological handoff mixed obsolete setup/status claims with current facts; guides repeated old feature status    | A later pass could restart completed work or plan from stale assumptions                       | Current state, architecture, formats, decisions, verification and one backlog; original journals/evidence preserved privately; outdated feature guides reconciled |
| Linked-text names came from a publishing vocabulary that did not match Ivo                                         | Product language and source names drifted from the intended document model                     | Document language in UI; canonical text-flow names in APIs/files/schema; isolated lossless read compatibility for existing files/history                          |
| Formatting/lint/dependency rules were not routine checks; two CI jobs omitted dependency installation              | Architectural drift and setup failures had weak early feedback                                 | Pinned tooling, one check command, explicit install steps, cycle/layer/import checks and a sequential runtime command                                             |

The existing storage transaction engine, native byte adapters, acknowledged window lease, original-media retention and GPU/worker graph were preserved. The current architecture builds on those working boundaries.

## Habits that will help

Keep one current backlog with stable IDs; adding review observations there is useful. For a new feature, identify the data owner and acceptance behavior before changing several views. Separate exact observed vendor behavior, chosen Ivo policy and remaining reference gaps. Require frozen fixtures/migrations when data meaning changes. Keep user data out of automated tests. Update current state/evidence rather than appending another long handoff narrative.

The application coordinator and live editor controller remain the largest files. Further extraction should follow concrete command/input responsibilities and retain the existing runtime fences, IME state and gesture ownership. The CSS cascade and deeper renderer/input decomposition are still suitable targets when the major UI pass arrives. This pass does not claim the codebase is finished or fully equivalent to the reference applications.

## Results and limits

154 unit tests, 22 Electron runtime groups, actual Swift Foundation interoperability, source/format/lint/architecture checks and served/standalone worker startup passed. Mac runtime sources and 118 shared web files match the packaged app; iOS assets match the build byte-for-byte. Original font/icon bytes are unchanged. See [verification](../verification.md).

Current Mac build: `release/2026-11-15-architecture/Ivo-darwin-arm64/Ivo.app`. Source checkpoint, original hashes, historical guides and detailed logs remain in parent `work/architecture-refactor/`.

Full Xcode/device builds, physical input/performance, Google Drive synchronization, OCR/regions, richer drawing and final styling remain pending as recorded in the backlog. No personal vault or global permission setting was changed, and no remote commit/upload was performed.
