# Quiet startup

Ivo opens directly into its restored workspace. The branded loading message is removed. Native windows begin hidden, using the existing shell background; documents, tabs, panels, fonts and camera restoration prepare before presentation. Scheduled canvas work receives two animation-frame opportunities and a paint turn. There is no added splash, fade, progress animation or minimum-duration timer.

The normal writer lease is acknowledged before showing an editable window. First activation can reapply canonical source/caret state; that initial grant also gets a paint turn. Silent restored windows appear without taking focus. An additional open request during initialization records the intent to focus, rather than exposing unfinished content. The vault manager uses the same readiness boundary. Existing open-window switching keeps its normal behavior.

A startup read failure shows a compact, escaped error with Retry. Initialization/visibility changes do not persist an empty workspace before the actual vault is available, and native document commands cannot write while initialization is incomplete. Retrying reads the existing vault/layout again. This changes view presentation, not document format, cloud authority or storage permissions.

## Reference and limits

The installed Obsidian1.15.0 package was inspected through the existing REA6.7.0 CLI without executing vendor code or changing client configuration. MCP tools were not connected in this chat. Evidence `ev_49a9b74bc53a47faa9d87eb63986444541f67b1b84ffffed4c830695e7ed235f` identifies `obsidian.asar` SHA-256 `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248` and analyzes only `package.json`/`main.js`; 36 inventoried files remain outside this focused selection. The inspected window constructor starts hidden and its guarded reveal is reached by `ready-to-show` and the `loadURL` completion path. This is static control flow, not a measured vendor launch trace or a claim of identical timing.

Ivo's restored-content/paint acknowledgement is an implementation choice to avoid revealing its asynchronously prepared page editor early. Private package observations, REA evidence, the checkpoint and frame captures are under parent `work/quiet-startup/`. No vendor implementation was copied into Ivo. First-start package acquisition, OS process launch latency, physical-device/mobile startup and large/cloud-backed vault timings remain outside this measurement.

## Verification

`npm run test:startup` uses actual Electron main/preload with temporary native vaults. It delays document and manager reads, repeats an open request while loading, checks that windows stay hidden, inspects/captures the first presented content, simulates a read failure, checks escaped/readable error and Retry, closes the manager through its native command, and confirms unchanged authored documents with no authored-data writes. Existing native-window tests retain silent restore, writer leases, passive views, tab transfers and source closure. The full runtime suite includes this startup regression.

The Geist correction adds one shared mounted-font readiness boundary before the existing paint/reveal handshake. Local interface metrics settle while the native window is still hidden; the first interaction does not race a font swap. See [UI corrections](ui-corrections.md). Failure and Retry use the same readiness boundary.
