# Reusable layout templates

Document options → Save as template… creates an editable copy of the document's pages, objects, typography and masking structure. New document (also File → New Document…, ⌘N) can instantiate one of these templates. Its page sizes remain those of the template. The original working document and template remain independent.

Templates are ordinary atlas documents marked by a versioned `extensions.ivoTemplate` record, so existing validation, immutable revisions, original assets, backup/import and native storage carry them without a second template database. Older clients preserve this extension. A small Template label identifies them in navigation; they can be edited as normal documents.

`src/domain/documents/copy.js` remaps all owned document/page/block/vertex IDs and canonical self-links. Asset references reuse original immutable media; crop/geometry edits in an instance do not affect the source. Copies start their own revision counter and clear copied aliases to avoid making the original aliases ambiguous. Unknown extension data is retained. Source data is never used as a mutable template object.

Tests cover archive round-trip, independent instances, rich source, masks, mixed-size pages, self-links, alias isolation and original-media references. The isolated full-application fixture saves a template without replacing the live editor, then uses the native New Document route to instantiate it; original source remains unchanged. `npm run test:templates` runs that fixture.

This is whole-document layout reuse. Rich-text snippets, date/title variables, parent-page systems and dedicated template libraries remain extensions; this is not full Obsidian templating parity.

Daily-use Cmd-N now creates a note immediately. Use File → New Layout… or the empty-tab New layout/template action for the explicit template and page-size chooser. Template capture/instantiation semantics are unchanged; see daily-use.md.
