# Graph motion and rendering

The graph is a derived view of the document index. Its positions remain session state. The graph modules do not save documents, modify authored page geometry, or depend on the current editor layout.

## Reference behavior

The pinned Obsidian 1.15.0 investigation established a Pixi GPU renderer, a separate nominal 60 Hz simulation worker, packed position transport, pointer-owned fixed node positions, and independent label visibility. The follow-up source inspection found drag alpha/alpha-target 0.3, release target 0, zoom easing with 0.85 of the old value retained per frame, and pan velocity retaining 0.9 per frame. See [reference architecture](obsidian/architecture.md) and [decoded force engine](obsidian/wasm-investigation.md).

Ivo implements those mechanisms with original code:

| Path      | Ivo behavior                                                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drawing   | WebGL batches for edges and circular nodes; antialiased node shader; viewport culling. Canvas fallback when WebGL is unavailable or lost, with GPU restoration support.                                                     |
| Labels    | Cached text sprites, up to 50 new sprites per frame; zoom/focus fades. No per-frame greedy overlap selection or text measurement.                                                                                           |
| Worker    | Publishes a transferable float32 position buffer every physics tick, rather than every second tick. The animation frame consumes the latest snapshot.                                                                       |
| Node drag | Pointer updates the displayed node directly. Multiple pointer events coalesce into one latest worker command per node per animation frame.                                                                                  |
| Release   | Sends the final pointer location and a revision. Older worker snapshots cannot overwrite that node until the revision is acknowledged. Cancellation and capture loss release constraints too.                               |
| Camera    | Cursor-anchored zoom easing and background-pan inertia. Time-based equivalents preserve the curve at 60/120 Hz; reduced-motion preference disables inertia and zoom easing.                                                 |
| Physics   | Center strength 0.1, degree-biased predicted-position links of length 250 and strength 1, charge magnitude 1,000, collision radius 60, damping 0.6, cooling toward 0.001 over 300 steps. Drag target 0.3; release target 0. |
| Idle      | Physics stops after cooling. Drawing stops once new snapshots, camera motion, and label fades stop. Hidden views pause the worker.                                                                                          |

The rendering and force implementations are deliberately distinct from the reference: Ivo uses its own small WebGL batch renderer and Canvas text sprites, rather than Pixi, and exact pairwise forces within the 500-node budget, rather than Obsidian's hierarchical WASM approximation. Label styling/thresholds, zoom bounds, colors, and existing navigation remain Ivo choices. Numerical, pixel, and end-to-end latency parity with Obsidian are not established. No proprietary source or bytecode is included.

## Verification

`npm test` includes regression cases for stale snapshots during/after release, rapid pointer-event coalescing, immediate re-drag, final release coordinates, drag temperature/cooling, and camera consistency at 60/120 Hz.

`npm run test:graph` runs an isolated hidden Electron window with generated data and a temporary profile. It measures a 500-node / 998-edge drawing workload, tests real GPU pixels and context loss/restoration when WebGL is available, and checks the real module worker's finite position buffers and release acknowledgement. It does not open an atlas. It reports timings rather than enforcing machine-dependent frame-time limits.

On the development Mac on 4 November 2026, an additional controlled moving-position fixture compared the previous and new view with the same 500-node / 998-edge input. Main-thread drawing callback p95 was approximately **0.6 ms before / 0.4 ms after** (medians 0.4 / 0.2 ms). A separate exact-force run measured approximately **1.95 ms p95 per tick**. The actual worker publication median was approximately 16.4 ms in the first runtime check. GPU pixel readback, zero WebGL errors, Canvas fallback, GPU restoration, and release acknowledgement passed. These are local callback/worker measurements; they exclude GPU presentation latency and do not measure Obsidian's frame rate.

The separate packaged macOS test app was exercised through native computer control: node drag/release, background drag, wheel zoom, keyboard zoom, and fit. Shared assets are synced into the iOS project. Physical iPhone/iPad gestures, display latency, GPU power consumption, long-running memory behavior, and large-vault performance remain unmeasured.

The final reusable `test:graph` run additionally exercised a denser visible-label workload at device-pixel ratio 2: 180 drawing samples, median **1.0 ms**, p95 **1.5 ms**, maximum **4.8 ms**. Actual 500-node worker publication median was **16.8 ms**, p95 **20.8 ms**. GPU pixel, Canvas pixel, context restoration, and release acknowledgement assertions passed. The earlier before/after fixture has different label visibility, so its absolute frame times should not be compared with this denser workload.
