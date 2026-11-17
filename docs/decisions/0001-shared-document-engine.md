# Decision: shared document engine and platform hosts

Accepted 15 November 2026.

Keep readable ESM JavaScript with pure domain commands and explicit storage/native ports. Mac Electron and iPhone/iPad Capacitor/Swift share validation, migration, document geometry, text-flow semantics and knowledge indexing. Avoid a simultaneous framework/language rewrite while behavior is still being established.

Domain modules cannot depend on UI, application, IO or platform modules. Authored data, original media and local view state have different authorities. The application composes features and lifecycle services; pure markup stays outside command orchestration. The live editor controller retains transaction/composition state rather than recreating it during view updates. Standard formatting/lint, executable dependency checks and runtime tests enforce the boundaries.

A normal bundler replaces the old ordered registry/import-rewriting build. Served ESM stays debuggable. This makes adding an imported module ordinary work and avoids a custom build language. Large input/coordinator modules remain candidates for responsibility-based extraction; splitting them through a giant mutable context object would conceal coupling rather than remove it.

The official [Logseq codebase overview](https://github.com/logseq/logseq/blob/master/CODEBASE_OVERVIEW.md) was consulted for separation of document state, UI state and platform responsibilities. Ivo keeps its own page/text model and existing native adapters; no Logseq implementation is imported.
