# Working on Ivo

Read [the current state](docs/development/STATE.md) and [Contributing](CONTRIBUTING.md) before making changes. Preserve personal vaults, authored content, original media and unrelated working-tree changes.

## Keep the laptop usable during development

User preference, 18 November 2026: run development and app checks in the background whenever possible. Prefer command-line/native workers and qualified hidden/offscreen editor tests. Do not launch review builds or bring apps/browser tabs forward merely to show progress. Give a heads-up before necessary foreground checks that use native window focus, the pointer, menus or the system clipboard; those remain authorized when required. Background component checks are not equivalent to physical input, native window/clipboard or device qualification. Preserve global settings and personal app sessions.

## Report text parity progress

After each completed text milestone, report a small **Ivo release text parity** progress bar. Use the [release estimate and scope history](docs/indesign/progress.md) and distinguish engineering progress from verified reference and device behavior. Count the release capabilities and their scoped acceptance criteria. Consult the broader-edition wishlist only when the user asks to revisit an exemption. Record any future scope change separately from features delivered.

## Git throughout the project

User direction, 17 November 2026: keep Ivo under active Git version control for the remainder of the project.

- Inspect Git status and the current branch before starting. Use a feature branch for substantial new work; preserve unrelated edits and existing history.
- Commit completed, verified work in coherent milestones during each implementation pass. Do not let completed features accumulate uncommitted between chats. Honor an explicit request to leave work uncommitted.
- Review the staged diff and run checks appropriate to the change before committing. Stage only the intended files, including required source, tests, configuration and documentation.
- Keep the existing GitHub origin in sync at completed milestones using ordinary pushes. Preserve remote work; never force-push or rewrite published history without an explicit request.
- Before integrating completed features, check the GitHub results for the exact commit, including the full desktop runtime suite. Bring the verified commit into `main` and confirm the checks on `main`.
- Keep personal vaults, credentials, extracted proprietary reference assets/code, generated artwork, dependencies and release/build output outside Git. The licensed public reference assets and their notices belong in the repository.
- Report the commit and validation at handoff, including any remaining uncommitted or unpushed work. Recovery archives supplement Git; they do not replace commits.

The November 2026 catch-up is a single present-day baseline of accumulated work, not a reconstructed sequence of historical feature commits. Subsequent work should use small, reviewable commits.
