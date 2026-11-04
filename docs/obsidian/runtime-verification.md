# Runtime verification and investigation limits

Date: 2026-11-04. Installed desktop reference: Obsidian 1.15.0 on macOS. Tests used the isolated [fixture vault](../../tests/fixtures/obsidian-vault/), not the user's notes.

## Observed in the app

| Action | Observed result |
| --- | --- |
| Open Atlas in Live Preview | Properties/tags, aliased `Fabric` link, heading link, block embed, and unresolved `Unwritten` link were visible. The embed displayed Material's referenced text. |
| Switch Atlas to Reading view | Rendered content and embed appeared with editing syntax hidden. |
| Inspect Atlas backlinks | Material and Reference.canvas appeared. The latter contained the matching wiki link from a standalone Canvas text card. This is a backlink attributed to the Canvas file, not a standalone card node. |
| Inspect Material backlinks | Atlas's three references, including the embed, appeared; Reference.canvas's file card also appeared. The status bar reported four backlinks. |
| Rename Material to Material renamed | Obsidian asked to update four links in two files. Chose **Just once**, leaving the global preference unchanged. Atlas links retained the display alias, heading, and block suffix while changing the target. The Canvas file reference also changed. |
| Rename back to Material | Repeated **Just once**, restoring the fixture's canonical names. |
| Expand Material's unlinked mentions | Observer appeared with the plain-text mention of Material. |

Panel counts and status-bar counts must not be generalized from this small fixture. The acceptance matrix in the behavior reference is a future regression checklist, not a claim that all cases were run.

## REA route

REA 6.7.0 was available in a local npm cache and invoked through its public `scripts/rea.mjs analyze-javascript-application` command. Two ASAR boundaries were examined: the bootstrap `app.asar` and application `obsidian.asar`. Selected application sources were package.json, app.js, sim.js, worker.js, and main.js. Source bytes were treated as inert text.

REA produced archive identities and inventories but failed before semantic JavaScript parsing: its macOS ownership helper could not compile because the compiler cache directory was not writable in the execution sandbox. Retrying with cache environment paths did not resolve that restriction. The [retained summary](rea-evidence-summary.json) records evidence IDs, selected scope, errors, and limitations. Zero reported semantic findings must **not** be interpreted as absence of features.

Bootstrap integrity metadata also contradicted observed bytes for two unpacked native bindings. A record-and-continue static attempt retained those contradictions; no package trust or runtime equivalence claim is made. The local code-signature verification also failed for the installed arm64 bundle. This study does not establish the cause of either result.

The companion manual static inspection recovered the documented metadata/graph/Canvas structures and their locations. [The evidence ledger](evidence-ledger.json) contains archive/source hashes and bounded lookup anchors. It is an original reference, not a redistribution of the application. No Obsidian source, native module, font, icon, or photograph was copied into Ivo.

## Open questions

Not established: all editor transactions, all plugin APIs, every link ambiguity rule, delete/restore edge cases, sync internals or conflict semantics, physical-phone behavior, large-vault performance, complete PDF functionality, and the complete application's call graph. These remain explicit gaps. Future investigations should extend the fixture and evidence ledger rather than replace uncertainty with guessed parity.
