# Reference evidence

The implementation is guided by observed behavior, shipped-artifact analysis and primary documentation. It is not a claim of complete Illustrator, InDesign or Obsidian parity.

- [Obsidian investigation](obsidian/investigation.md), [application analysis](obsidian/application-investigation.md), [native analysis](obsidian/native-decompilation.md) and [workspace reference](obsidian/workspace-shell-reference.md) retain artifact identities, evidence anchors and limits.
- [Illustrator investigation](illustrator/) records selection/transforms, masks/snapping, typography, viewport and cursor/icon evidence. A failed runtime trace remains a gap; static evidence is not converted into a timing measurement.
- [Architecture decision](decisions/0001-shared-document-engine.md) records the bounded use of the official Logseq source overview. [esbuild API](https://esbuild.github.io/api/), [Prettier installation](https://prettier.io/docs/install) and [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files) informed the standard build/check tooling.

Raw extracted proprietary artifacts and old chronological development journals remain outside the repository in the parent `work/` area. The architecture pass checkpoint is `work/architecture-refactor/before.tar.gz`; original hashes and archived guides are alongside it. Do not rewrite target symbols or evidence hashes to match Ivo terminology. Current product language, source names and guides use document/text-flow terminology.

Full Xcode, physical iPhone/iPad lifecycle/input/performance testing and remaining exact native gesture/text traces are separate outstanding validation work. Source architecture changes do not resolve those gaps.
