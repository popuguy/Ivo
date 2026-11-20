# Demonstration photographs

Earlier demonstration documents used remotely hosted Unsplash photographs. Production demonstration seeding has been removed; these credits remain for existing imported examples. These are placeholders for an editable personal collection, not images from the supplied magazine screenshot. No private user photographs are included in the public repository.

| Use                             | Photographer    | Source                                                                                                       |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| Black-and-white city photograph | Tim Hüfner      | https://unsplash.com/photos/grayscale-photo-of-people-walking-on-street-near-high-rise-buildings-dqB4c6AX5qE |
| Blue architectural photograph   | Ananth Pai      | https://unsplash.com/photos/architectural-photography-of-building-EPD9KPAEwsk                                |
| Street crossing                 | Y M             | https://unsplash.com/fr/photos/une-photo-en-noir-et-blanc-de-personnes-traversant-la-rue-MhPknNEwxRo         |
| Curved facade                   | Alexander Tsang | https://unsplash.com/photos/white-and-black-striped-building-eOTwsgf9uok                                     |

The URLs and credited names were checked during creation. Images load from `images.unsplash.com`; availability and offline persistence are not guaranteed. Replace sample images with uploads for self-contained archive backups. Current reference interface artwork follows the source and licensing policy below.

# Bundled typeface

CMU Serif (Computer Modern Unicode), version 0.7.0, converted by Andrey V. Panov from TeX fonts. The unmodified Roman, Italic, Bold, and BoldItalic TrueType files come from the [official release archive](https://sourceforge.net/projects/cm-unicode/files/cm-unicode/0.7.0/cm-unicode-0.7.0-ttf.tar.xz/download).

The fonts and their complete SIL Open Font License 1.1 notice are bundled in [public/fonts/cmu-serif](../public/fonts/cmu-serif/OFL.txt). They load locally in the static, macOS, and iOS builds; the standalone HTML embeds the same bytes. No font service or system-font installation is required.

## Provisional reference interface art

Paul explicitly requested Illustrator icons/cursors first and Obsidian icons as fallback for the current review cycle. Local reference artwork is compiled into an ignored module and is not committed here. Source identities, exact-byte hashes, XML cursor hotspots and native mapping evidence are retained privately. See [viewport response and artwork](viewport-response.md).

The public `public/icons/obsidian/` SVG fallback preserves geometry from the installed Obsidian Lucide registry, not its application code. ISC and Feather-derived MIT notices are retained in `public/icons/obsidian/LICENSE.txt` and embedded in the standalone HTML. The installed registry's Lucide version is unspecified; do not label all icons MIT-only.

The 15 November continuation adds exact Illustrator Move Copy/Direct Move Copy artwork and XML hotspots (22 staged cursors total), plus the exact Obsidian/Lucide `pin` registry geometry for tab pinning. No replacement icon paths were drawn. The bounded installed Illustrator SVG-name search did not establish an appropriate pin icon; the licensed Obsidian fallback supplies it.

The workspace-shell continuation adds exact installed Obsidian/Lucide `folder`, `folder-open`, `folder-plus`, `bookmark`, `settings`, `sort-asc`, `panel-left` and `panel-right` registry geometry. Numeric shape arrays were decoded as data, preserving paths and SVG attributes without executing the proprietary application code. Each fallback manifest entry retains the matching application source hash and emitted SVG hash; existing ISC/MIT notices apply. No new icon geometry was drawn.

The 16 November private review pipeline adds Obsidian’s custom `sidebar-toggle-button-icon`, with literal registry fragment/wrapper and original CSS pill widths retained privately. It is separate from the Lucide-licensed fallback and is not added to `public/icons/obsidian/`. Only its pinned exact SVG hash can enter inline chrome markup. Existing Illustrator/Lucide assets and CMU font bytes are unchanged. Graphik and other installed UI typefaces appear only in private comparison renders; they are not bundled in Ivo.

## Selected interface typeface

Geist variable Sans, version 1.401, is now bundled locally in `public/fonts/geist/`. These are the exact installed font bytes approved in the UI comparison; their embedded copyright is 2024 The Geist Project Authors. The full SIL Open Font License 1.1 notice accompanies the file and is embedded in standalone output. Official project/license source: [vercel/geist-font](https://github.com/vercel/geist-font/blob/main/OFL.txt). The interface variable is separate from document font presets. No font installation or hosted font service is required. Other comparison faces remain private review assets.

The 18 November publishing foundation adds unchanged Obsidian/Lucide registry geometry for layer visibility/locking, layers, text highlighting, text alignment, decorations, superscript/subscript and front/back arrangement. The same ISC/MIT notices apply; source and SVG SHA-256 identities are retained in the public fallback manifest. No proprietary InDesign artwork or font bytes are added to the public repository. User-imported fonts are original vault assets, not bundled application assets.

The 18 November text-control correction maps the exact locally installed InDesign OpenType frame adornment through the ignored private reference-art pipeline. The public `opentype` alias uses the existing licensed text icon. No extracted native SVG is committed, and public builds remain reproducible without it.

## American English hyphenation

Ivo ships the patterns and exceptions from `hyph-en-us.tex` with their original copyright and redistribution notice in `src/domain/text/dictionaries/en-us.js`. The data works offline. [TeX hyphenation project](https://github.com/hyphenation/tex-hyphen/blob/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-en-us.tex)

## Additional offline hyphenation dictionaries

British English, Spanish, Italian and monotonic Modern Greek use patterns and exceptions from [tex-hyphen revision 5684c0f](https://github.com/hyphenation/tex-hyphen/tree/5684c0f51c0b81133db2efbe60a408b4155a3ff5/hyph-utf8/tex/generic/hyph-utf8/patterns/tex). Each generated data module in `src/domain/text/dictionaries` retains its authors’ copyright and MIT permission notice. The editor uses its own matching and source-position logic.
