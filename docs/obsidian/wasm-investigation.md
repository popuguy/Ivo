# Obsidian WebAssembly investigation

Inspected 4 November 2026, installed Obsidian 1.15.0. This pass decoded every instruction of the three WebAssembly modules identified in `app.asar` and `obsidian.asar`: two standalone PDF modules and one Base64-embedded graph module. Their type, section, import/export, memory, and complete WAT representations were produced by actual REA/WABT runs. The graph module was also translated mechanically to C and all seven function bodies followed. The PDF investigation focused on the decoded public boundaries and their JavaScript callers; it is not a correctness or security audit of every codec routine.

The inspected `obsidian.asar` SHA-256 remains `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248`. Extraction and analysis did not instantiate or execute these modules. Private original bytes, WAT, C translation, disassembly, tool hashes, glue offsets, and REA JSON remain in the parent workspace under `work/obsidian-deep/wasm/`. No proprietary module or decoded implementation is included in Ivo.

## Identity and actual tool results

| Module/carrier | Bytes | SHA-256 | REA evidence |
|---|---:|---|---|
| Graph, decoded from `sim.js` | 3,322 | `b01b7421301b6d70e16319f367863c623a8336b250868a048935800cc8bf575d` | `ev_0226a86f3b4dba37bf56f36dcef57a0ea27e04d7dad7c8fe1acbdb54a972a43a` |
| `lib/pdfjs/wasm/openjpeg.wasm` | 257,382 | `cb031f36245b389e1f5bffc59d10eed35bb0f85d7368b46c3f0b462042ec8e9e` | `ev_e257e99efbe0eaa3f4a2dbba4162b9c7937d14cff2ce4811c6d2a9a77fd68861` |
| `lib/pdfjs/wasm/qcms_bg.wasm` | 94,519 | `6017eca5939cde1836e88e6d8cd27ae039246f206515ea4487bdfd0e3fb16e26` | `ev_991e3bebec87d21d7c2212a57ffed92aa06b39bb43e29dae508d5cd33f77a2c5` |

All three passed validation and REA reported complete interface reconstruction with no interface issues. All three approved commands exited successfully, including process-ownership cleanup. A prior sandboxed attempt could not inspect its helper process table; its helper was subsequently absent and its empty temporary directory was verified before rerunning with command-specific approval. No cleanup checks or global permission settings were changed.

WABT 1.0.42 came from the [official WebAssembly/wabt release](https://github.com/WebAssembly/wabt/releases/tag/1.0.42). The portable macOS ARM64 archive SHA-256 was `3f654779b436c628db3ca4323c51538815f5fbc887a6d5f3bb1c18d36281e240`, matching upstream release metadata. REA retains the individual tool executable hashes and arguments. WAT is decoded bytecode; the supplementary `wasm2c` output is a mechanical translation, not recovered original C source.

## Graph engine: complete decoded surface

The Base64 literal begins at zero-based byte 10,918 of `sim.js` and occupies 4,432 ASCII bytes. The carrier SHA-256 is `9d1768d7d4950fca768c11d5c0ac1fee4f033bee9cf6d7bb004bddf10f369734`; its archive offset is recorded in the private extraction ledger. Decoding gives a WASM version-1 module with seven defined functions, one unshared memory, an empty function table, zero imports, and no start function. Initial memory is one 64-KiB page, with no declared maximum. The absence of imports is established by the complete decoded interface, rather than a string search.

| Export | Function body byte offset in decoded module | Static responsibility |
|---|---:|---|
| `memset` | `0xe8` | Writes a byte value over a selected memory span. |
| `init` | `0x11f` | Clears and counts node degree, then derives each link's endpoint bias. |
| `complete` | `0x205` | Damps velocities and integrates positions. |
| `visitCharge` | `0x274` | Traverses aggregated spatial cells and applies charge contributions. |
| `visitCollide` | `0x4d6` | Prunes spatial cells and resolves candidate overlapping pairs. |
| `manyBody` | `0x709` | Builds the spatial hierarchy and dispatches charge/collision passes. |
| `simulate` | `0xb63` | Applies centering and link forces, then invokes the many-body pass. |

These offsets are from `wasm-objdump -d`, relative to the decoded 3,322-byte module. WAT and C provide the same function indices. Export names are literal facts; the responsibility column is static inference from their instructions and the glue.

### Data layout and force calculations

The JavaScript glue and decoded loads/stores agree on a 20-byte node record: four float32 fields for x, y, x-velocity, and y-velocity, followed by float32 degree. Links immediately follow the node records as 12-byte records: two int32 node indices and one float32 bias. Host memory sizing reserves additional scratch space using a node-proportional term, a link-proportional term, and a 1,024-byte reserve. The host grows WASM memory in 64-KiB pages when needed. This is simulation state; no document text, tags, or authored page coordinates enter this interface.

`init` increments the degree of both endpoints for every link. It stores source degree divided by the sum of endpoint degrees as the bias. `simulate` first subtracts position multiplied by alpha and center strength from each velocity component. Its spring calculation uses predicted positions (position plus current velocity), the requested link distance, alpha, and link strength, and divides the force by the smaller endpoint degree. Bias distributes that adjustment between source and target. Exact zero components in the link vector receive a small fixed value before normalization. This establishes degree-dependent springs, not an all-pairs layout or a persisted graph arrangement.

The many-body implementation uses a power-of-two spatial grid with linked lists in leaf cells and successively aggregated 2×2 cells. Each aggregate retains coordinate sums and a count. `visitCharge` compares cell scale, a theta-like parameter, and squared distance to decide whether to use an aggregate or descend; leaves traverse individual nodes. `visitCollide` prunes cell bounds and compares predicted positions for pairs. The decoded radius is 60, giving a pair separation threshold of 120. Pair collision adjustments split between both velocities and use the collision-strength parameter. This is a hierarchical approximation, but exact equivalence to an upstream d3 algorithm/version is not established.

`complete` implements velocity damping followed by position integration. The supplied host damping multiplier is 0.6. After that call, the host reapplies fixed x/y coordinates for dragged nodes and zeros the corresponding velocity components. WASM computes layout; the renderer and the graph's semantic selection remain outside the module.

### Selection, cooling, and communication

The host attempts synchronous module construction and instance creation inside a try/catch after checking the WebAssembly APIs. If that returns no simulator, it selects a JavaScript force implementation. The fallback initializes centering, links, charge, and collision with a deterministic pseudo-random generator. Its presence is direct code evidence; which route a particular Obsidian session actually takes remains a runtime question.

The WASM call receives node/link counts, alpha, center strength, link strength, desired link distance, signed repulsion, the host value 0.9, and collision strength. Default host values include center strength 0.1, link distance 250, repulsion −1,000, collision strength 0.5, and alpha 1. The worker cools alpha toward its target using a decay derived from a 0.001 threshold over 300 steps, and schedules work using a nominal 1,000/60-ms timer. These are static constants, not measured frame rate or performance guarantees.

Messages reconcile stable node IDs, replace links using indexable endpoints, update drag constraints and forces, and raise alpha. The inspected `run` field schedules work when present; the worker does not implement a boolean pause branch at that point. Positions are returned as packed float32 x/y pairs with a parallel ID list. The worker probes SharedArrayBuffer transport and otherwise transfers an ArrayBuffer. Shared transport has an additional version word. This transport buffer is separate from the module's unshared WASM memory.

### Static edge cases retained for later testing

In the individual-node charge path, distinct nodes at exactly identical coordinates reach a zero-distance branch that appears to re-evaluate without changing either node. That is a static liveness concern in the decoded branch, not a reproduced hang; normal renderer seeding may prevent the input. The JavaScript fallback has separate perturbation behavior, so numerical/edge-case parity should not be assumed. Empty-graph scheduling, forced-node release, extreme force values, and cooling/restart behavior also require controlled runtime tests before a compatibility claim.

For Ivo, the reusable findings are the separation of physics from semantic selection/rendering, stable-ID reconciliation, packed position transport, and explicit force/cooling contracts. The original implementation should also test coincident nodes and empty views, preserve positions across topology changes, and stop idle work. No Obsidian bytecode needs to be copied to obtain those properties.

## PDF modules: decoded boundaries and callers

### OpenJPEG

The complete module has 203 defined functions, 18 function imports, six exports, and a single unshared memory with a declared initial size of 256 pages (16 MiB) and maximum of 32,768 pages (2 GiB). These are declarations, not observed allocations. Export names are minified, but the selected PDF worker glue maps them explicitly: `s` is memory, `u` is the allocation entrypoint, `v` frees an allocation, and `w` is the JPEG2000 decode entrypoint (function 166). The remaining exported functions serve initialization and runtime support. All 203 bodies were decoded; the large decoder body was not reconstructed into a complete codec specification.

At byte offsets 152,262–152,300 and 154,267 onward in `lib/pdfjs/pdf.worker.min.mjs`, glue assigns the exported functions, allocates an input span, copies compressed bytes, calls the JPEG2000 decode operation, retrieves image data, and frees the input allocation in a finally path. The import object contains pixel-copy callbacks that reconstruct one-, three-, or four-component output, plus runtime support functions. A separate literal `openjpeg.wasm` is at byte 155,238. Its load failure path requests the bundled JavaScript fallback. That fallback's presence and selection logic are established; decoding success on any given PDF is untested here.

This is a PDF image decoding component. Its decoded presence does not establish PDF editing or annotation authoring.

### QCMS

The complete module has 138 defined functions, five function imports, 23 exports, one unshared memory initially declared at 17 pages, and no declared memory maximum. The exports include transformer creation/release, single/three/four-component and array conversion, ICC-profile checks, lookup-table transforms, interpolation helpers, and wasm-bindgen support. The five imports supply result/RGB/CSS-color callbacks, error throwing, and reference-table initialization. They do not themselves expose filesystem or network APIs.

The PDF worker glue selects Gray, RGB, or CMYK input handling for one, three, or four components; constructs a transformer from profile bytes with perceptual rendering intent; uses the scalar or array conversion entrypoint; and registers transformer cleanup. Decoded wrapper bodies agree with dispatch through the result callbacks. The transformer-creation body includes profile/lookup-table handling and conversion preparation, but a complete reconstruction of its color-science behavior is outside this application-architecture investigation.

The `qcms_bg.wasm` template-string reference is at byte 105,076 of the PDF worker. REA's automatic glue finder reported that template association unresolved; the byte anchor, export names, explicit host initialization, and call sites establish the manual association. Similarly, REA did not automatically associate the graph's embedded Base64 with a candidate path. Neither missing automated association was treated as absence.

QCMS is part of rendering ICC-based PDF colors. It is independent of note indexing, native vault persistence, and the graph force engine.

## Coverage boundary

The search examined the named installed application's two ASAR inventories, standalone `.wasm` members, and WebAssembly/Base64-header references in JavaScript, module, HTML, and JSON members. It identified these three modules and decoded all 348 defined function bodies. This does not prove there are no dynamically fetched modules, optional plugin modules, encrypted/compressed carriers outside those formats, or runtime-generated WASM. App updates and personal plugins were not folded into the pinned target.

Completed: artifact identity, extraction provenance, complete static decoding and interface reconstruction for all three identified modules; full function-level investigation of the small graph module; PDF boundary/glue mapping; fallback and memory/transport contracts. Remaining: actual runtime selection/performance, numerical parity across engines, all codec input edge cases, the static liveness concern, and physical-device behavior. These distinctions should remain intact when citing this report alongside the native and JavaScript investigations.
