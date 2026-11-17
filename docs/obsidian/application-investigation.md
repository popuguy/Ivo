# Obsidian application-layer investigation

Inspected 4 November 2026. Target: the installed macOS Obsidian **1.15.0** package. This extends the earlier architecture reference with complete bootstrap parsing, the remaining application entrypoints, feature traces, native handoff correlation, and a deeper read of persistence, rename, recovery, editor, plugin, and sync client paths.

The conclusions below are **static observations and inferences**, unless explicitly attributed to the earlier controlled UI fixture. No code extracted from Obsidian was executed, no account was contacted, and no personal vault or credentials were read. Native decompiler findings are documented separately; these are original descriptions, not redistributed vendor code.

## Identity, coverage, and reusable evidence

| Artifact | SHA-256 |
|---|---|
| Installed `obsidian.asar` | `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248` |
| Bootstrap `app.asar` | `9bc94d3b6b9e9579941bb7d20628aa5331f46ee508b270e9123e629f388df207` |
| Code update `obsidian-1.15.0.asar` found in the application support directory | Same bytes and SHA-256 as installed `obsidian.asar`; embedded package version is 1.15.0. |

The bootstrap can select a newer versioned ASAR from application support at launch, so inspecting only the installed archive would not always identify the executing application code. In this session, the only matching versioned code package found there was byte-identical to the installed application archive. This check inspected code artifacts only. [J03]

Complete private evidence and the byte/line locator ledger are retained outside the repository under the parent workspace's `work/obsidian-deep/application/`. `application-ledger.json` records 40 findings, per-source SHA-256, zero-based UTF-8 byte offsets, archive offsets where applicable, line/column positions, bounded inspection windows, and short lookup anchors. J01–J40 below refer to that ledger. Complete ASAR inventory includes assets, fonts, translations, and sandbox material; an inventory entry does not imply semantic analysis.

| REA operation | Evidence ID | Result |
|---|---|---|
| Full bootstrap analysis, no source selection | `ev_4e8360a6197eefe438de44f723fd1f378edd123b66d0a19f483e9ca1067bbcbe` | All 15 JavaScript files parsed; 8,040 AST nodes visited; 135 findings; both native addon bindings resolved. |
| Remaining application entrypoints | `ev_060fedf12cfe5ca330bfd0fcc60e5f2407a81f7b8a8976a92e4143788a5e02a2` | `enhance.js`, `help.js`, `i18n.js`, `quicklook.js`, and `starter.js` parsed; 265,174 AST nodes visited; 20 findings. |
| Prior application core | `ev_6a3f18deceb876b5ce3f0320a1e75af5577e9bc75cf79981c87088439ccb8e90` | `main.js`, `worker.js`, and `app.js` parsed; 1,057,330 AST nodes visited. |
| Prior graph simulation | `ev_4ce3e3241f6a2632e16e8e2877acc09660179e5242fafcd71a70bd221389a9a9` | `sim.js` parsed; 6,190 AST nodes visited. |
| Native timestamp handoff, now linked to native analysis | `ev_0635df6ebf29b8e02fe0ca790ef0ae84525cdb78816a5ff37066725b19c86522` | Seven traced nodes, eight edges, one evidence-linked native handoff. |
| Font enumeration handoff, now linked to native analysis | `ev_ddc8ec8ea5a160326fb77e963c11a7f7fc3e4304ae8d0644167dcb77045622c1` | Five traced nodes, six edges, one evidence-linked native handoff. |

The source pass ended with **15/15 bootstrap JS files and 29/31 application JS/MJS files processed by REA**, totaling 3,188,581 visited AST nodes across the nonoverlapping processed source groups. Independent Node.js 24.20.0 `--check` validated all **46/46** JavaScript/MJS members with zero syntax errors and without executing target code. The [machine-readable analysis summary](application-analysis-summary.json) records exact runs, per-source status counts, timeouts, and limits.

The 22 dependency files required continuation after resource limits:

| Dependency pass | Evidence ID | Result |
|---|---|---|
| Initial dependency selection | `ev_72b3068a5317f6dc8c9493813dbe6bd61df8582c763e00efdee1e2e7285b50cb` | Complete partial evidence retained: 14 libraries processed, 1,403,817 AST nodes visited; timeout at generated OpenJPEG fallback. |
| Unreached dependency continuation | `ev_486a9bd00f6511d60cb5af185a9a04e67b853802475872f68dcca7a57bdd3b90` | Two more libraries processed, 410,536 AST nodes; timeout at Prism. |
| Isolated OpenJPEG fallback with reduced semantic retention | `ev_6a0a335d8d2301630048bae272286513296f3e6855367bf1d8c12039ecc68187` | Timed out again; no successful REA source parse claimed. |
| Final four small dependencies | `ev_2f2a5b2665ddc9250777905c8f784222a1c7c0df0d325c5d5e9d2aa312cad868` | Readability, Reveal, scrypt, and Turndown completed. |

`lib/pdfjs/wasm/openjpeg_nowasm_fallback.js` and `lib/prism.min.js` therefore retain a **REA analysis gap** after their 180-second limits. Both pass independent syntax validation. The matching PDF image-codec WASM is analyzed separately, but that does not establish semantic equivalence with its JavaScript fallback. These resource bounds were preserved rather than bypassed or described as successful full analysis.

The nine top-level JS entrypoints in the application archive have therefore all been parsed across the current and prior runs. The archive also contains 22 dependency JS/MJS files; their separate coverage is recorded in the final investigation summary. Source-file coverage does not establish a complete call graph: minified dynamic property access, aliases, calls, and semantic retention limits remain explicit unknowns. The earlier core run reached its 24,000-node retention ceiling. The remaining-entrypoint run also uses explicit per-file and total retention limits. The full bootstrap completed without node truncation, but its semantic coverage is reported unknown rather than exhaustive.

The bootstrap run used **record-and-continue** for the two previously recorded native-addon integrity contradictions. Their observed hashes are the identities used for subsequent native analysis; the original ASAR declarations do not authenticate those unpacked bytes. The cause of the mismatch remains unknown.

## 1. Native executable, bootstrap, and application responsibilities

The installed executable and native bindings are only one part of the application. The bootstrap initializes Electron remote support and a privileged custom application protocol, manages the ASAR updater, and selects application code. The main application archive supplies window management and the substantial editor, vault, metadata, graph, Canvas, and sync client implementation.

The updater reads release metadata, checks minimum supported installer version, downloads compressed bytes, verifies both SHA-256 and RSA-SHA256 against its embedded certificate, decompresses to a temporary ASAR, then renames it into a versioned application-support filename. The startup selector scans matching versioned filenames, compares versions, attempts the newer package, and falls back to the built-in archive if loading fails. These are control-flow observations, not a verification of any downloaded update or server. [J01–J03]

The primary window construction in application `main.js` explicitly configures **Node integration on**, **context isolation off**, Node integration in workers on, and webview support on. Popups use related settings. This corrects a limitation of the prior automatic summary, which detected two BrowserWindow constructions but reported zero explicit web preferences: the options are assembled through local objects and spreads. [J32]

Embedded webviews have a distinct boundary. The attachment hook removes supplied preload paths and sets sandboxing and web security on, while turning Node integration, nested webviews, plugins, and experimental features off. This is evidence of intended separation between privileged application UI and embedded remote content. It is not a security audit or proof that every runtime path enforces the intended policy. [J33]

## 2. Files are authoritative; the metadata database is rebuildable

The desktop filesystem adapter maintains the vault base path, an operation queue, known files, and watchers. Ordinary text saves call `fs.promises.writeFile`; binary saves call the corresponding binary route. The read-transform-write `process` operation executes in the same adapter queue, skips an unchanged transform, applies write options, and reconciles filesystem state afterward. The inspected route is a direct write, rather than evidence of a temporary-file/rename transaction around every note save. No blanket fsync or power-loss guarantee follows from it. [J05–J07]

Vault-level `modify` counts in-flight saving activity, uses an immediate callback to update its text cache, and invalidates that cache on failed writes. The adapter's write queue and filesystem reconciliation are separate from view-specific save coalescing. This distinction matters when translating the behavior into Ivo: an editor transaction, a queued save, a successful filesystem write, and a rebuilt link index are different events.

File information uses integer **milliseconds**: the stat conversion reads rounded `birthtimeMs` and `mtimeMs`. Applying write options passes creation time directly into the native `btime` wrapper, while dividing modification time by 1,000 for Node's `utimes` call. The wrapper validates an integer from zero through `2^48−1`, builds a NUL-terminated UTF-8 path buffer, invokes the native method on macOS/Windows, and throws on a nonzero return. This matches the native millisecond-to-timespec analysis; it is not a seconds-valued creation-time API despite misleading native diagnostic wording. [J04, J07, J39]

`fs.watch` initiates reconciliation, not blind acceptance of a single event. The desktop path uses real paths, `lstat`/`stat`, size and modification-time comparison, and known-file maps. A disappearance first observed through a watch event schedules a 100 ms follow-up before removing known state. Directory renames update descendant paths. Symlink reconciliation checks resolved paths against existing watchers to avoid overlapping or cyclic watched trees. These mechanisms improve tolerance of external filesystem activity; they do not establish an atomic cross-process transaction model. [J09–J10]

The metadata cache stores file records and parsed metadata separately in IndexedDB. File records refer to content hashes; parsed Markdown can be reused by hash. Startup checks the current file set, modification time, size, and availability of parsed metadata. Vault create/modify/delete/rename events schedule parsing or link-resolution work. Metadata cleanup is separate from canonical note storage. [J13–J14]

## 3. Link ambiguity and rename are deliberate policies

Resolution is more specific than case-insensitive title matching. The inspected resolver handles an empty target as the source file, external paths, exact extension-bearing names, Markdown-extension fallback, relative `./` and `../` paths, and leading-slash absolute vault paths. It maintains a case-normalized filename lookup. Exact full-path matches win. For suffix matches, candidates beneath the source parent are ranked before candidates elsewhere; each group is sorted by path length. `getFirstLinkpathDest` selects the first candidate. Equal-length ties are not given an independent deterministic ordering by the inspected comparator, so the complete tie behavior remains a runtime/ordering question. [J11–J12]

This is different from Ivo's stable-ID relationship design. In Obsidian, a textual path can resolve according to file location and the candidate set; a graph edge derives from that resolution. The index retains resolved source→destination reference counts and unresolved normalized targets separately. A creation or deletion can change the meaning of existing textual links even without editing their source text.

Rename is not just changing the filename. The file manager waits until metadata work and link resolution are clean, records references together with their resolved file objects and prior candidate paths, performs the rename under an update queue, then compares post-rename resolution. References whose meaning changed are rewritten using the new link-format policy and preserved heading/block suffixes. Registered extension-specific link updaters can apply changes for formats such as Canvas. [J15–J16]

Automatic updating is controlled by the `alwaysUpdateLinks` setting. Otherwise the code presents Always update, Just once, and Do not update choices. The earlier fixture test directly observed Just once preserving alias text and heading/block suffixes while updating Markdown and Canvas references; this corroborates the inspected path for that fixture only.

## 4. Deletion, orphan attachments, and recovery are separate systems

Desktop deletion can invoke system trash, move into a vault-local `.trash` directory with collision-aware names, or permanently remove a file/folder according to configuration. If the system-trash route reports failure, the vault-level logic can fall back to local trash. The deletion prompt can warn about backlinks and nonempty folders. Following deletion, attachment cleanup builds a candidate set from the deleted note's outgoing relationships and removes candidates still referenced elsewhere; settings control whether remaining orphan attachments are retained, deleted automatically, or offered for selection. [J08, J17]

Local file recovery is a separate built-in plugin. Packaged defaults are a five-minute snapshot interval and seven-day retention. It observes Markdown, Canvas, and Base files; snapshots store path, timestamp, and text in an app-specific IndexedDB backup store. A pending-file set and one-minute rescan cover changes that occur before the snapshot interval expires. Identical latest text is not stored again. Cleanup runs against timestamp-indexed records; recovery history is not the same thing as filesystem trash, and it does not back up arbitrary binary attachments. [J20]

The Markdown save path serializes its own active save promises and reports a persistent visible error on failed writes. It also attempts to store the unsaved text through file recovery. The file manager has a force-add recovery path used before selected sync replacement/merge operations. These are useful recovery layers, but a disabled/unavailable recovery database can leave that fallback unavailable. [J19–J20]

## 5. Editor, Canvas, graph, and media have different data contracts

The Markdown component keeps source text, preview rendering, an optional CodeMirror-backed editing mode, fold state, and dirty state. Ordinary saves are coalesced with a two-second request timer. Forced saves can occur during editor destruction or specific transactions. An embedded heading/block edit reconstructs the surrounding document before writing, rather than replacing the file with only the visible excerpt. Save failures restore the last-saved bookkeeping and preserve attempted text through the recovery hook. [J18–J19]

Canvas serializes authored node and edge arrays, recognizing file, text, link, and group nodes. It reconciles IDs on import and persists the arrangement as JSON through its view. Readonly and viewport/workspace state have a separate local-data route. The earlier graph study still applies: graph topology derives from metadata and optional filters; its layout is not Canvas's authored geometry. Canvas text references can contribute backlinks under the Canvas file without making each card a standalone note identity. [J21–J22 and prior A08–A21/R01]

The application loads PDF.js and its worker, Pixi, syntax highlighting, diagram support, and MathJax as distinct components. MathJax is configured for controlled explicit typesetting, with local font/chemistry assets, supported packages, and unsafe URL schemes restricted in its configured safe options. This is mathematical rendering, not a full LaTeX document compiler. [J23]

The PDF integration loads vault resource URLs, applies page/subpath destinations, highlights selected text, and can focus an existing annotation's rectangle. That establishes navigation and viewing behavior. Neither the inspected integration nor the absence of specific save symbols establishes a complete general-purpose PDF editing product. PDF.js's own capabilities must be distinguished from features exposed and persisted by Obsidian. The WASM study separately covers its image/color engines. [J24–J25]

## 6. Sync client: revision state, encrypted transport, and conflicts

The installed JavaScript exposes substantial client implementation; no account connection or server testing was performed. The sync controller retains local file state, server file state, a pending server-change list, a remote version cursor, previous paths, hashes, synchronized hashes, and timestamps. It persists this coordination state separately in an IndexedDB sync database. Loading detects an unexpectedly empty vault and pauses with a warning about possible remote deletion. This is a client-side guard, not a proof against every deletion scenario. [J28]

The encryption code normalizes passphrase/salt with NFKC and derives a 32-byte key using scrypt parameters `N=32768, r=8, p=1`. Packaged provider versions 2/3 use HKDF-derived material, deterministic AES-SIV encoding for path-like strings, and AES-GCM for content. Payload encryption prefixes a random 12-byte IV to ciphertext. These are code observations, not an independent cryptographic assessment or a claim that a particular user's vault uses a specific provider version. [J26]

The protocol sends commands such as pull/push/history/restore with encoded paths and selected metadata. A push can split encrypted content into **2 MiB** binary pieces, waiting for responses. Deleted/folder entries travel as explicit state. Local and remote hashes are used to avoid unnecessary content transfers. Reconnect behavior uses bounded exponential backoff with jitter. [J27]

When local and remote Markdown both diverge, the client can retain a named conflicted copy or merge. In the merge route, it obtains base, local, and remote text, creates cleaned diff patches from base→local, and applies those patches to remote text. That is a patch-based three-version strategy, not evidence of character-operation CRDT synchronization. The inspected helper takes the returned patched text without exposing per-patch success flags to this call site. [J29, J31]

When the base is unavailable, the code has timestamp/creation-time-dependent replacement behavior and stores a local text backup through file recovery. Some configuration JSON files use a separate shallow property merge. Nonempty file/folder collisions can trigger conflicted-name moves. Immediately before applying a downloaded file, the code checks whether local mtime/size changed while the download was in progress and cancels for retry when they did. These are specific defenses and policies; arbitrary concurrent-edit correctness, server retention, server-side ordering, mobile background behavior, and cross-version interoperability remain unverified. [J29–J30]

## 7. Plugin and command-line boundaries

Community plugins are loaded from the configured plugin folder through an application-provided script route or by reading source text. The fallback wraps source in `require/module/exports` and evaluates it, then instantiates a Plugin with application and manifest access. The require facade supplies Obsidian/CodeMirror exports and can delegate to Node modules in the desktop route. Restricted mode gates enabling; it is not a per-plugin process-isolation model. This describes the inspected architecture without assessing a particular plugin or current user setting. [J34–J35]

The native CLI findings connect to a JavaScript server. On Unix/macOS, application `main.js` constructs a per-user `.obsidian-cli.sock` location. A secondary process connects and writes a newline-delimited JSON header containing `argv`, `tty`, and `cwd`; TTY mode changes stdin handling and pipes the stream. The primary process reads a header with a five-second timeout, then routes URIs, existing paths, or commands. Command execution checks the CLI-enable setting, chooses a vault through an explicit selector or working directory/current selection, and dispatches into the renderer's `handleCli` function or a pending queue. [J36–J38]

This corroborates the native CLI client's socket/argument/terminal behavior. It does not mean every native helper command is implemented in the executable itself, and it does not establish authenticated access control beyond the inspected local transport and settings checks.

## 8. Cross-layer proof and remaining uncertainty

The btime and get-fonts module traces now incorporate the exact matching Hopper function evidence and report `native_handoffs.status=evidence-linked`. The linkage preserves the **observed unpacked Mach-O hash**, provider identity, native evidence IDs, and original module graph; it does not silently substitute the ASAR's conflicting declared hash. The native timestamps and font-family semantics are therefore connected to their JavaScript wrappers using actual REA output.

By comparison, outgoing traces seeded at `vault-open` and the metadata-worker construction yielded one node and no outgoing graph edges each: `ev_3fba9686f67aefb4250bae9d718d00ab4f9dc36f0a6e3fcd9c1cbe92d80f261a` and `ev_0ac662974db4dde98b1626e70b8f31d032542ba889115fc05df0a0784e8deac2`. Their partial source-graph coverage is an extraction limit. The detailed flows above were established by following the actual code and are labeled static inference; those traces cannot be presented as complete automatic call chains.

The application-layer pass answers how the inspected installed build separates canonical files, view saves, metadata, graph/Canvas, local recovery, native services, plugin loading, and sync client state. It does **not** establish server implementation, private protocol compatibility, full plugin API behavior, every link tie case, physical-phone behavior, every PDF operation, performance limits, or exhaustive runtime reachability. The earlier controlled fixture provides only its documented runtime cases. Those boundaries should remain explicit when using this investigation to guide Ivo.
