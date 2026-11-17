# Storage and application backend

The shared backend is described by [architecture](architecture.md), [data formats](data-format.md) and the [synchronization boundary](decisions/0002-sync-boundary.md). This guide records its operational contract.

- `src/storage/file-vault.js` owns validated portable revisions, immutable media, serialized writes, expected-manifest guards and atomic commits. Native adapters provide only bytes and hashes.
- `src/storage/contracts.js` defines `VaultStore` and `VaultIO`. `desktop/vault.mjs` and `ios/App/App/AtlasFiles.swift` implement confined native paths and atomic byte replacement.
- `src/storage/indexeddb.js` owns browser transactions and database-version coordination. `store.js` selects the initialized adapter and handles local revision snapshots.
- `src/storage/save-queue.js` coalesces document writes with sequence IDs, retains failed edits for retry and reports pending/error/saved accurately. Completion means the underlying transaction/manifest commit completed.
- `src/app/document-session.js` joins document history, pre-upgrade revision preservation and save lifecycle across panes. `passive-refresh.js` prevents a delayed passive read from replacing data after a writer handoff.
- `desktop/workspace-windows.mjs` and the native main process own the acknowledged window lease, trusted menu actions and separate per-window workspace metadata. A passive renderer cannot write authored data through IPC.

Native startup must finish before the store is used. Failure leaves the vault in place and reports the error; it does not silently create another collection. Navigation, window handoff and suspension flush pending text/media/autosave work. A failure keeps the source session available. OS termination can still interrupt uncommitted work; physical lifecycle checks remain necessary.

The current local writer/manifest design is a useful base for cloud transport, but putting a vault in a synced folder does not establish conflict-safe multi-device editing. Google Drive remains queued. Preserve the storage port and add a synchronization owner with explicit base revisions, immutable object transfer and recoverable conflicts before introducing account/upload UI.

`npm test` exercises domain, queues and filesystem behavior. `npm run test:windows` exercises actual Electron main/preload and isolated windows. `npm run test:native` compiles/runs the actual Swift Foundation byte adapter against the same JavaScript vault engine. It does not exercise UIKit or certify an iOS build.
