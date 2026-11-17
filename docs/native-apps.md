# Native apps

## macOS

```sh
npm ci
npm run desktop
IVO_PACKAGE_OUT=release/my-build npm run desktop:package
```

The app opens a vault manager/recent-vault menu. Choose or create a folder vault; forgetting a recent entry removes the reference, not its files. Different vaults are isolated. Windows of one vault share a native storage actor and acknowledged editor lease, with device-local per-window workspaces. Preserve separate release directories so a running build is not replaced.

The folder format and its guarantees are in [data-format.md](data-format.md). Native menus, trusted path actions, PDF export and tab tear-off run in the main process; the renderer uses a narrow preload bridge. The renderer cannot request arbitrary byte paths or write from a passive lease. Signing/notarization and distribution remain pending.

## iPhone and iPad

```sh
npm run ios:prepare
npm run ios:open
```

The Capacitor/Swift project shares the document engine, file-vault validation and web editor. `AtlasFiles.swift` handles confined bytes, hashes and atomic replacement; `IvoAtlasPlugin.swift` supplies the bridge and suspension coordination. The current Foundation interoperability test runs on macOS against this actual byte adapter. Full Xcode is required for a simulator/device build.

Current environment limitation: only Command Line Tools are installed; `xcodebuild` is unavailable. Simulator/device input, rendering, native folder picking, iPad scenes, signing and release validation remain pending. Synchronization through Google Drive or another provider is also pending. Do not infer cross-device synchronization from shared data formats or copied web assets.
