# Verification record

## Automated

`npm test` passes 20 meaningful tests covering canonical and aliased links, ambiguous targets, duplicate edge counts, rename-safe IDs, self references, nested tags, body search, bounded local graph traversal, import round trips and hostile/invalid archives, original asset preservation, Markdown interchange, graph node limits, finite/settling physics, and drag constraints.

`npm run build` creates the static distribution and portable HTML. Source modules are syntax-checked with Node. The sample archive validates against schema version 1.

## Reference application

See [runtime verification](obsidian/runtime-verification.md) for the controlled Obsidian checks and [evidence ledger](obsidian/evidence-ledger.json) for the static reference. REA semantic analysis was blocked; its partial evidence is preserved.

## Prototype browser checks

Hosted preview and browser verification are incomplete. The laptop execution environment and browser connection became unavailable while opening GitHub Pages settings; no successful Pages configuration or deployment was observed. A local server could not bind a port in the current shell sandbox (`listen EPERM`). The in-app browser also blocks local `file:` navigation. Neither restriction was bypassed. Browser tests, physical-phone testing, accessibility audit, cross-browser editing, offline restart, and performance budgets must not be reported as passed without direct evidence.

After the connection loss, a repository-only follow-up fixed sidebar navigation during editing, cancellation of an empty new-document dialog, preservation of newer pending edits after a save failure, and consistent full-text graph filtering. All JavaScript modules were syntax-checked in the available JavaScript runtime. The 20-test result above predates this UI-only follow-up; the committed CI workflow reruns tests/builds and saves a downloadable static preview artifact. No browser pass is claimed.
