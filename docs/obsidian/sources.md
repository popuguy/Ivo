# Obsidian reference sources

Retrieved 4 November 2026. Official product documentation and the official JSON Canvas specification provide documented behavior; explicitly labeled local runtime evidence supplements them. These are living pages; the installed app is pinned separately. Research prose is paraphrased. No Obsidian implementation code or personal vault data is reproduced here.

## Installed reference

Artifact metadata was read directly from `/Applications/Obsidian.app/Contents/Info.plist`.

| Field | Observed value |
|---|---|
| Version / build | `1.15.0` / `1.15.0` |
| Bundle identifier | `md.obsidian` |
| `app.asar` bytes | `73,419` |
| `app.asar` SHA-256 | `9bc94d3b6b9e9579941bb7d20628aa5331f46ee508b270e9123e629f388df207` |
| `obsidian.asar` bytes | `24,553,884` |
| `obsidian.asar` SHA-256 | `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248` |

Hash values identify the inspected local bytes; they are not independently verified vendor authenticity signatures.

## S01

[Views and editing mode](https://obsidian.md/help/edit-and-read). Reading/editing distinction, Live Preview, Source mode and configurable defaults.

## S02

[Internal links](https://obsidian.md/help/links). Wiki/Markdown links, paths, heading and block references, custom labels, unresolved targets and rename updates.

## S03

[Aliases](https://obsidian.md/help/aliases). Alias metadata, canonical-target link generation and unlinked alias discovery.

## S04

[Backlinks](https://obsidian.md/help/plugins/backlinks). Incoming references, context, filtering and unlinked mentions.

## S05

[Outgoing links](https://obsidian.md/help/plugins/outgoing-links). Outgoing references and potential links identified in the active note.

## S06

[Tags](https://obsidian.md/help/tags). Inline/property tags, hierarchy, case handling and parent searches.

## S07

[Properties](https://obsidian.md/help/properties). Types, frontmatter representation, shared property typing, links and editor limitations.

## S08

[Search](https://obsidian.md/help/plugins/search). Query operators, property search, case sensitivity, ordering and content-search boundaries.

## S09

[Embed files](https://obsidian.md/help/embeds). Referenced notes/blocks, image sizing, PDF page/height parameters and Canvas embedding limitations.

## S10

[Attachments](https://obsidian.md/help/attachments). Original files, paste/drop behavior and attachment location.

## S11

[Accepted file formats](https://obsidian.md/help/file-formats). Supported document/media families and platform codec caveat.

## S12

[Graph view](https://obsidian.md/help/plugins/graph). Automatic link graph, filters, groups, rendering controls, force controls and local depth.

## S13

[Canvas](https://obsidian.md/help/plugins/canvas). Manual spatial boards, card types, labeled connections and standalone cards as note targets. Outgoing links in those cards require the distinction established by R01.

## S14

[JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/). Published 11 March 2024. Node/edge interchange schema, positions, references and stacking order.

## S15

[Manage notes](https://obsidian.md/help/manage-notes) and [Settings: Files and links](https://obsidian.md/help/settings). Rename/link maintenance, deletion destinations, exclusions and configuration-dependent behavior.

## S16

[File recovery](https://obsidian.md/help/plugins/file-recovery). Local snapshots, retention, covered file types and restoration boundaries.

## S17

[How Obsidian stores data](https://obsidian.md/help/data-storage). Vault files, external changes, settings, metadata cache and IndexedDB.

## R01

Local runtime observation supplied by the parent investigator on 4 November 2026, through Obsidian 1.15.0's accessibility UI. Vault: repository `tests/fixtures/obsidian-vault`. Atlas's Backlinks panel displayed the `Reference.canvas` text card containing `Canvas-only card linking [[Atlas]]`, grouped under the Canvas file, alongside the `Material` Markdown source. The status bar showed two backlinks while the Linked mentions heading showed one; counts remain unresolved. No personal vault was used.

## Retrieval limits

The guessed `/pdfs` help URL did not resolve in the retrieval tool. PDF statements in the reference are limited to the successfully retrieved embed/file-format documentation. A search also found third-party PDF plugins, but their capabilities were not treated as built-in Obsidian behavior. Search results indicated platform-specific deletion changes in changelogs; the installed version's configured behavior remains a runtime test, not a universal assumption.
