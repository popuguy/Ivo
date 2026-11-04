# Verification record

## Automated

`npm test` passes 20 meaningful tests covering canonical and aliased links, ambiguous targets, duplicate edge counts, rename-safe IDs, self references, nested tags, body search, bounded local graph traversal, import round trips and hostile/invalid archives, original asset preservation, Markdown interchange, graph node limits, finite/settling physics, and drag constraints.

`npm run build` creates the static distribution and portable HTML. Source modules are syntax-checked with Node. The sample archive validates against schema version 1.

## Reference application

See [runtime verification](obsidian/runtime-verification.md) for the controlled Obsidian checks and [evidence ledger](obsidian/evidence-ledger.json) for the static reference. REA semantic analysis was blocked; its partial evidence is preserved.

## Prototype browser checks

Pending hosted preview verification. A local server could not bind a port in the current shell sandbox (`listen EPERM`). The in-app browser also blocks local `file:` navigation. Neither restriction was bypassed. Browser tests, physical-phone testing, accessibility audit, cross-browser editing, offline restart, and performance budgets must not be reported as passed without direct evidence.
