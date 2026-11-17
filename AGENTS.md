# Working on Ivo

Read [the current state](docs/development/STATE.md) and [Contributing](CONTRIBUTING.md) before making changes. Preserve personal vaults, authored content, original media and unrelated working-tree changes.

## Git throughout the project

User direction, 17 November 2026: keep Ivo under active Git version control for the remainder of the project.

- Inspect Git status and the current branch before starting. Use a feature branch for substantial new work; preserve unrelated edits and existing history.
- Commit completed, verified work in coherent milestones during each implementation pass. Do not let completed features accumulate uncommitted between chats. Honor an explicit request to leave work uncommitted.
- Review the staged diff and run checks appropriate to the change before committing. Stage only the intended files, including required source, tests, configuration and documentation.
- Keep the existing GitHub origin in sync at completed milestones using ordinary pushes. Preserve remote work; never force-push or rewrite published history without an explicit request.
- Keep personal vaults, credentials, extracted proprietary reference assets/code, generated artwork, dependencies and release/build output outside Git. The licensed public reference assets and their notices belong in the repository.
- Report the commit and validation at handoff, including any remaining uncommitted or unpushed work. Recovery archives supplement Git; they do not replace commits.

The November 2026 catch-up is a single present-day baseline of accumulated work, not a reconstructed sequence of historical feature commits. Subsequent work should use small, reviewable commits.
