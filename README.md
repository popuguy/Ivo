# Ivo

A local-first document editor for precise page composition and connected notes. Mac, iPhone and iPad share the document engine. An interactive knowledge graph is a core part of the application.

```sh
npm ci                 # Node.js 22.13 or newer
npm run desktop        # macOS application with folder vaults
npm run dev            # browser development at http://127.0.0.1:4173
```

The workspace follows Obsidian’s compact navigation model around a page editor informed by Illustrator and InDesign. The interface is still evolving. Current foundations include mixed-size pages, fractional placement, polygons and masks, linked text frames with automatic continuation, original image paste, document links, tabs/splits/windows, sidebar sizing, folder drag/rename, local history and Mac PDF export.

```sh
npm run check          # formatting, lint, architecture, unit tests and builds
npm run test:runtime   # sequential Electron interaction and native-window regressions
npm run test:native    # actual Swift Foundation storage interoperability
npm run ios:prepare   # build and sync web assets into the iPhone/iPad project
```

`dist/` contains the served static application. `dist/Ivo.html` is a standalone preview with bundled fonts and graph worker; native folder storage is the primary daily-use path. Browser data belongs to its exact origin. Full Xcode is required for simulator/device builds.

Start with [Contributing](CONTRIBUTING.md), [architecture](docs/architecture.md), [data formats](docs/data-format.md), [current state](docs/development/STATE.md), [verification](docs/verification.md) and the [feature backlog](docs/backlog.md). [Reference investigations](docs/research.md) distinguish measured behavior from intended fidelity.

Google Drive and other cloud synchronization, OCR with region links, richer curves and final visual polish remain planned. A folder inside a cloud drive is not a substitute for a tested synchronization protocol. Local vaults and JSON exports remain portable; original media and recoverable legacy records are retained.
