# Native artifact inventory — Obsidian 1.15.0

Captured 4 November 2026 from the locally installed macOS application. This report covers native identity, Mach-O structure, linkage, signature metadata, and Electron fuses. Native function disassembly/decompilation is a separate companion investigation. The complete private evidence and reproducible scripts are under the parent workspace's `work/obsidian-deep/inventory/`; they are deliberately outside the Ivo repository. No installed files were changed and no selected native artifact was executed.

## Coverage and method

A recursive regular-file magic scan, without following symlinks, found **20 unique Mach-O containers totaling 455,818,896 bytes**. All 20 contain **x86_64 and arm64** slices. Fourteen bundle symlinks were separately inventoried; all resolve inside the application. This avoids counting `Versions/Current` aliases as extra binaries. No filename-extension assumption was used to select native files.

REA 6.7.0 `inspect-macho` completed for **all 40 architecture slices**. On the Apple Silicon host it selected arm64 from the original universal files; exact x86_64 byte ranges were extracted to private files and inspected separately, preserving original container hash, byte offset, length, and derived slice hash. The three helper filenames ending in `(Renderer)`, `(Plugin)`, and `(GPU)` triggered an `otool` path-parsing error through REA. Their arm64 metadata was obtained from byte-identical copies with simple private filenames. Hashes confirmed identity with the installed originals. Initial sandbox cleanup failures were resolved through scoped process-inspection approval after verifying the reported helper processes were absent; no stale PID was killed, no cleanup validation disabled, and no global settings changed.

`inspect-signature` produced metadata for all 20 original containers. System `codesign --verify --all-architectures --strict` was recorded separately: displaying a signature is not verifying it. REA `inspect-plist` parsed the main, Electron, Quick Look, and link-XPC bundle plists. REA `inspect-electron-fuses` decoded both framework slices. REA `trace-dylib-resolution` traced all 10 executable roots in each architecture without a native disassembler session.

The Mach-O parser reports entrypoints, architectures, load commands, build metadata, and direct dependencies with their own collection coverage. Its import/export lists explicitly have `exhaustive:false`; counts below mean retained symbol rows, not guaranteed complete dynamic symbols or reachable functions. In particular, imports alone do not prove an API was called in a run.

## Native images

Paths in the table are relative to `/Applications/Obsidian.app/Contents/`. `A/X symbols` gives retained imports/exports for arm64 and x86_64 respectively. Each `Nxx` maps to exact evidence identities below.

| Ref | Artifact | Bytes | A symbols | X symbols | Relative path |
|---|---|---:|---:|---:|---|
| N00 | CLI client | 135,824 | 22/2 | 22/2 | `MacOS/obsidian-cli` |
| N01 | Electron launcher | 102,400 | 10/1 | 10/1 | `MacOS/Obsidian` |
| N02 | Quick Look preview extension | 427,376 | 294/1 | 311/1 | `PlugIns/ObsidianQuickLook.appex/Contents/MacOS/ObsidianQuickLook` |
| N03 | Quick Look link-opening XPC | 205,808 | 94/2 | 109/2 | `PlugIns/ObsidianQuickLook.appex/Contents/XPCServices/ObsidianQuickLookLinks.xpc/Contents/MacOS/ObsidianQuickLookLinks` |
| N04 | Birth-time N-API binding | 144,912 | 57/7 | 57/19 | `Resources/app.asar.unpacked/node_modules/btime/binding.node` |
| N05 | Font N-API binding | 184,928 | 74/9 | 74/25 | `Resources/app.asar.unpacked/node_modules/get-fonts/binding.node` |
| N06 | Electron helper | 468,640 | 93/1 | 93/1 | `Frameworks/Obsidian Helper.app/Contents/MacOS/Obsidian Helper` |
| N07 | Electron framework | 409,137,776 | 5145/11352 | 5158/11348 | `Frameworks/Electron Framework.framework/Versions/A/Electron Framework` |
| N08 | EGL/ANGLE library | 208,512 | 36/115 | 36/115 | `Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib` |
| N09 | SwiftShader Vulkan library | 21,245,584 | 240/4 | 158/4 | `Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib` |
| N10 | GLES/ANGLE library | 13,145,184 | 261/1773 | 262/1773 | `Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib` |
| N11 | FFmpeg library | 4,804,960 | 104/1587 | 103/1631 | `Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib` |
| N12 | Crashpad helper | 2,524,336 | 342/7 | 344/7 | `Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler` |
| N13 | ReactiveObjC framework | 764,400 | 189/123 | 189/123 | `Frameworks/ReactiveObjC.framework/Versions/A/ReactiveObjC` |
| N14 | Squirrel updater framework | 327,568 | 135/44 | 135/44 | `Frameworks/Squirrel.framework/Versions/A/Squirrel` |
| N15 | Squirrel ShipIt helper | 292,416 | 140/1 | 140/1 | `Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt` |
| N16 | Mantle model framework | 292,320 | 110/42 | 110/42 | `Frameworks/Mantle.framework/Versions/A/Mantle` |
| N17 | Electron renderer helper | 468,656 | 93/1 | 93/1 | `Frameworks/Obsidian Helper (Renderer).app/Contents/MacOS/Obsidian Helper (Renderer)` |
| N18 | Electron plugin helper | 468,656 | 93/1 | 93/1 | `Frameworks/Obsidian Helper (Plugin).app/Contents/MacOS/Obsidian Helper (Plugin)` |
| N19 | Electron GPU helper | 468,640 | 93/1 | 93/1 | `Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU)` |

The CLI, Quick Look extension, and Quick Look XPC were absent from the earlier two-binding discussion. They are important application-specific native surfaces. The main executable and four Electron helpers are small process entry shells in front of the much larger runtime framework. The native bindings bridge file birth-time changes and available font-family enumeration into the JavaScript application. Root-level function analysis must establish exact behavior beyond these symbols and imports.

## Application-specific boundaries

**Launcher.** The arm64 `Obsidian` entrypoint is LC_MAIN slice file offset `0x460`, which maps through its file-backed `__TEXT` segment to virtual address `0x100000460`. Its universal-container offset is `0xc460` (50,272 decimal). Its direct dependencies are the Electron framework and libSystem; its `__TEXT,__text` section is 348 bytes. A small launcher does not imply the application has no native logic: most runtime implementation resides in the framework, and Quick Look and CLI are separate processes.

**CLI.** `obsidian-cli` has arm64 `_main` at `0x100000598`, with imports for sockets, connect/read/write, environment/current-directory lookup, terminal raw mode, signal handling, and pthreads. This is a static boundary consistent with a terminal client communicating with an already running app. Its control flow and protocol are covered by function disassembly rather than inferred solely from import names. Its arm64 build metadata declares macOS **15.0**, whereas the main launcher and app plist declare **12.0**. The overall app's minimum OS therefore must not be applied blindly to the optional CLI binary.

**Quick Look.** The extension plist declares `com.apple.quicklook.preview`, principal class `PreviewViewController`, and Markdown content types `net.daringfireball.markdown`, `public.markdown`, and `net.ia.markdown`; searchable items are disabled in that declaration. Its direct imports include WebKit, AppKit, Foundation, and Swift libraries. Swift symbols expose resource loading, a custom URL-scheme handler, script-message bridges, preview preparation, navigation-policy decisions, a timeout, and renderer-process termination handling. The native workflow is a WebKit preview subsystem in addition to the Electron app UI.

High-value arm64 locations handed to the function-analysis track: resource loading `0x100003580`, rooted directory traversal `0x100003684`, specialized scheme-task handler `0x1000052e8`, web-view creation `0x100007d18`, preview preparation `0x10000869c`, renderer message handling `0x10000a064`, preview dispatch `0x10000a2e0`, navigation policy `0x10000ad74` / specialized `0x10000c744`, and external-URL opening `0x10000b090`. Symbol identities and code addresses are observations; the exact effects require the companion decompilation.

**Link XPC.** The nested `md.obsidian.quicklook.links` plist declares an application-type XPC service. Symbols name an `ObsidianQuickLookLinkOpening` protocol and a `LinkOpener`; `_main` is at `0x1000033a0`, the listener acceptance thunk at `0x100003264`, and specialized open-with-reply code at `0x1000034f0`. This is a separate process boundary for opening links. No client authorization guarantee follows from those names.

**Bindings.** Both `.node` images export `napi_register_module_v1` and a Node-API-version function. `btime` also exports `set_btime` and imports `setattrlist`. `get-fonts` exposes N-API worker callbacks and imports CoreText's font-collection/descriptor APIs plus `kCTFontFamilyNameAttribute`. Those static facts identify the OS bridge surfaces; the decompilation track establishes argument conversions, flags, callback/error handling, and return behavior.

## Runtime and upstream component families

The Electron framework plist reports version **43.8.4** and identifier `com.github.Electron.framework`. Its exported names include `ElectronMain`, `ElectronInitializeICUandStartNode`, and V8 symbols. The graphics libraries expose EGL/ANGLE, GLES, and Vulkan ICD APIs; FFmpeg exports the `av_*` family. Crashpad has its own executable. Squirrel exposes updater and ShipIt classes; ReactiveObjC exposes RAC signal/sequence classes; Mantle exposes model/JSON-adapter utilities.

These are component-family identifications supported by package metadata and API names. This investigation has not byte-compared them with authenticated upstream release binaries and does not call them unmodified stock builds. Their function bodies are runtime implementation, not evidence of how Obsidian derives semantic note links, composes its Canvas, or resolves vault-specific file paths. Those behaviors still require the application-layer evidence.

## Static linkage

REA dyld tracing used 10 executable process roots and reached 15 unique Mach-O images in each selected architecture. arm64 produced 563 root-specific dependency edges: **37 resolved within the bundle** and **526 undetermined outside the modeled root**. x86_64 produced 563 edges: 37 resolved within the bundle and 526 undetermined outside it. No unresolved external system install-name is being labeled a missing dependency: `/System` and `/usr/lib` are outside this bundle, and macOS commonly supplies them through the shared cache.

For the main app, the modeled loader resolves its Electron framework through `@executable_path/../Frameworks`; the framework's `@loader_path/Libraries` search resolves FFmpeg, with the bundled Squirrel/ReactiveObjC/Mantle frameworks reached through fallback rpaths. Five images from the complete native scan are not reached by this static executable-root traversal: the two Node-API bindings and three graphics/Vulkan libraries. Their presence is still established by the separate inventory. Dynamic `dlopen`/Node addon loads and actual runtime selection require separate evidence.

The resolver reports earlier absent rpath candidates before later successful framework matches. These are modeled search-order observations, not an established exploit. Code-signing enforcement, environment-dependent lookup, runtime conditional loads, and compatibility-version rejection are outside that model.

## Signatures, permissions, and integrity

Signature-display metadata for the main launcher identifies `md.obsidian`, team `6JSW4SJWN9`, and a Dynalist Developer ID certificate chain. It declares the hardened runtime and JIT/unsigned-executable-memory/library-validation exceptions, audio input, and calendar entitlements. The Quick Look extension declares app sandbox, user-selected read-only access, network client access, and read-only access to `Library/Application Support/obsidian/quicklook/`. The link XPC declares app sandbox. No account data or contents of the user's support directory were read.

These are signed-data declarations, not evidence that the OS granted TCC access or that an operation occurred. `get-task-allow` was not reported for the main app. The inspected Electron fuses disable `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, and `EnableNodeCliInspectArguments` in **both slices**. Runtime observation must respect that configuration; a `--inspect` launch cannot be assumed to enable Node inspection. Cookie encryption, file-protocol extra privileges, and WASM trap handlers are enabled; embedded ASAR integrity validation and ASAR-only loading are disabled in the observed fuse bytes. Fuse state is packaged policy data, not a complete security assessment.

**Verification limit:** direct system codesign verification failed for all 20 native containers and the bundle, each reporting an invalid signature in arm64. Merely reading a Developer ID identity does not override this result. This investigation identifies the exact installed bytes; it does not authenticate them as an unaltered vendor release. The cause of the common verification failure is unestablished, and no compromise or tampering diagnosis is made.

**ASAR header versus file hashes:** the `ElectronAsarIntegrity` values in Info.plist match the SHA-256 of the raw JSON header bytes for both `app.asar` and `obsidian.asar`. They are not whole-archive hashes. The mismatches previously recorded for `app.asar.unpacked` concern the two native binding entries, not these matching header hashes:

| Binding | Header-declared bytes | Installed universal bytes | Header-declared SHA-256 | Installed SHA-256 |
|---|---:|---:|---|---|
| btime | 93,424 | 144,912 | `fce3459c2ba17f9cd145ecfad5f1ec7e2ada54f556a9a3c07da08135ea382fcd` | `d9f0f03114af22f98384c09d2df0aef7bd69900194eaa0c7d7af21c080da4842` |
| get-fonts | 133,312 | 184,928 | `d9070a13559a45ff7087bf18f5cd18363c1597ae4c54a292f16462a98cec5b30` | `02040d4641231a862b89ddade42d697aaed69e2c64dc396cbbeaa4aebb7c38ab` |

Neither declared native-binding hash matches either currently installed thin architecture slice. Thus these are not resolved by simply comparing the declaration with the arm64-only slice. Signing/universal-packaging transformations might be relevant, but no causal claim is made without the corresponding original build artifacts. All native conclusions bind to the observed hashes above.

## Evidence identities and residual limits

The full private `native-summary.json` includes original paths, complete SHA-256 values, slice provenance, UUIDs, dependencies, collection coverage, entrypoints, signature metadata, and all evidence files. For reproducibility, each native metadata pair is listed here; x86_64 evidence is for an exact extracted thin slice, whose source byte ranges are retained in `x86-slice-provenance.json`.

- **N00** `CLI client`: arm64 `ev_bc54aa9261e0e661b184960921119308c1275550706a163cf111a2bc5b4df1df`; x86_64 `ev_5bde6c0f6e77dbc14dd57efa849dd06342d11464da779c3fbd486eaa6696c903`.
- **N01** `Electron launcher`: arm64 `ev_c3e8162dbfd7d186a05f7d7c2faa3fd4895b4a3bd6c2d94709ea0b94891b2e96`; x86_64 `ev_6e91f4e970666f212b87c41cf64ff563cf2b6efa15e0577131ed898ca423356e`.
- **N02** `Quick Look preview extension`: arm64 `ev_ebe31548e8d9ca6d9afb3e21bb498b6e3bd80b936a808811d9490867d00a86bf`; x86_64 `ev_abb4cb10aecafe898cfb4594f5be6f63e3c87f40bb910e18489088f8a6d997d8`.
- **N03** `Quick Look link-opening XPC`: arm64 `ev_09322df06616d117380a15d53a5f8a1fc51f737ba69529f8dc46e29efad396ad`; x86_64 `ev_f5b8285c8858353e09a4740d43ac1c70e463ebf10c54af135087db2108d47054`.
- **N04** `Birth-time N-API binding`: arm64 `ev_e9aa3d77e422e9bde49bb2ef402e6bb9a350367387a0fc81f0c2e3522c810f2b`; x86_64 `ev_8635a4a6cf49a751da067a082122ec13d30547a14520ed23550ad9659a331d4a`.
- **N05** `Font N-API binding`: arm64 `ev_146ab5049b1ff020ffc57400f74a4f2f06d770740fbec328cf1ff480d257b29c`; x86_64 `ev_7c49a6dd678710a25bc6e0ae99c4f423269a8ac69f43695559d969161d6453d2`.
- **N06** `Electron helper`: arm64 `ev_391cc8469c250c2eea1053f1b90a47bacb71163feb6cadc6aa8e6b63a2e173d8`; x86_64 `ev_6886085e8b2ef6c8fe439b372e8a6ef9e8695ae0c0b72eee49d82c676cf94e44`.
- **N07** `Electron framework`: arm64 `ev_c17d7319eb2e7024e163eb840630a1c10ba079a3796573f233f362b4030fab28`; x86_64 `ev_a66391c5e1fc588bc47496db7f48782691c30476e62b55e4dcd9a8ea3e9b0490`.
- **N08** `EGL/ANGLE library`: arm64 `ev_95358bc905462e695d9677267df8a31c0a58d78fe1520aebc6c0e66df20fb586`; x86_64 `ev_5c4f4c55141f11b8dfa05dde92d477c9ec610a03345f8d94de7f307b1e9ba27a`.
- **N09** `SwiftShader Vulkan library`: arm64 `ev_3ae7c5d113ad936acddc846e84472826430781f96ada8c8a3a1868cb51c56962`; x86_64 `ev_70170d618ca2feca7b81c6f8b28534ac3dc888d3ba93fb646219ff828353364c`.
- **N10** `GLES/ANGLE library`: arm64 `ev_ce471ea75c64d7a8c7504265346dee5a597e1fabfc459c727445c3544ea14248`; x86_64 `ev_545c78c1263a29d513d4df163f66dfe755673687726e43b34e435cc63d607059`.
- **N11** `FFmpeg library`: arm64 `ev_2e95c61d7d95b3ba23767f94f7a7c1b9727fc9d42b43c03a3c30b4dd2ebe4fd5`; x86_64 `ev_463529a7cc194fb56650ce67e0cd7401b85599d67e91c5395d63bb7a483b8d89`.
- **N12** `Crashpad helper`: arm64 `ev_272ec389028a2d40f65eb398fe333dd0a57d318f45ad5aa279cfec8c182b59ab`; x86_64 `ev_00a289d16a0d97488f5714363171d26e918c1e8c9dabead0e5a22dea916445d1`.
- **N13** `ReactiveObjC framework`: arm64 `ev_fb56cee761207ddfb762308d7fde90979ec054362242a4fe95e662f81e8bdcd8`; x86_64 `ev_80b64d4e218e1001a4bae6ab028b0106be7462f1c8dd371f9582c4fe38aeb01f`.
- **N14** `Squirrel updater framework`: arm64 `ev_46da9c28cc858c6014232cb79d43d30e09c8c6307048660749b11ac268cbcec3`; x86_64 `ev_d9d232d95312886793c9cb4e1143e718ca2cbe25a73c5bbcbdaa04a6ba140b35`.
- **N15** `Squirrel ShipIt helper`: arm64 `ev_325633171f21ea5b1c643b439a755fe5e917b329edada6a733c71c840ea37c0d`; x86_64 `ev_0f2be76737abbc6b47e5e918602596517da8f7b003f2528ec822f24b09a6239f`.
- **N16** `Mantle model framework`: arm64 `ev_d520f08aa6243d357eab9968cebe4fb76011d601b86cf24177b6ae5aec3128c0`; x86_64 `ev_930acd3e320d5920e22fc4af615b285c8ab8f3fbbe589a260fc5f8eb91959d21`.
- **N17** `Electron renderer helper`: arm64 `ev_763b0073f6bd029fd3ae3774db7a5770ab0b98a8645c1e522f699514accc1881`; x86_64 `ev_4a7e34d1d2879d97c75c77493328aebe67447109301c77e9ce9d0a9dc7b6e085`.
- **N18** `Electron plugin helper`: arm64 `ev_06a80b8ad194096a08339fb59d09997bf8d0cd5fe6163f455f3d73b50e007b0c`; x86_64 `ev_56a418b3ed879f4837735db0eff966af2c1eecb9f31bb2276851da0cd408f1cc`.
- **N19** `Electron GPU helper`: arm64 `ev_9278c6d16b1fd8283e0db62382ded64a5a54139915aeb0fda891c58a48d77210`; x86_64 `ev_12434a35dbdde44f2d2de315a95d787a4eacf66f013e7d29eb3c3c3c516263cd`.

- Dyld arm64: `ev_9ef2860c6a81b1da3a83da2d3c020d2b63e195b08cee5f0bc8cb4bd31f082db8` — 10 roots, 15 images, 563 edges, {"undetermined": 526, "resolved": 37}.
- Dyld x86_64: `ev_12b7bf087ce3e7a72d3d759c794c6cc98dcc611f702a08cc30d13145af0fb222` — 10 roots, 15 images, 563 edges, {"undetermined": 526, "resolved": 37}.
- Electron fuses: `ev_0002d73c2f6be7e3ac3c863efd1093ae0b84e6318bea3ad09709d5fe47c4f023`.
- Main plist: `ev_bf85b07fd3e1279ccfefc8baa3a18c73480432bffb7b1742e528fc5d05a998ba`.

All 20 files and 40 slice metadata routes are accounted for. This is complete **native artifact inventory for the installed bundle**, not instruction-by-instruction proof of every routine. Focused arm64 function reconstruction belongs to the companion native report. x86_64 behavioral equivalence, every dynamically loaded runtime implementation, system-library internals, plugin binaries outside this application, mobile packages, sync-server behavior, and arbitrary-vault runtime behavior are not established by this inventory.
