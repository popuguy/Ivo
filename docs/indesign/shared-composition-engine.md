# Shared native composition engine

The original geometry proof now calls the same `TextCompositionEngine` used by the persistent desktop worker. The Swift module accepts bounded source maps, explicit font bytes and frame geometry; it cannot open files or write a vault. Native input remains a separate application responsibility. This is an implementation milestone toward the text programme, not a claim of InDesign parity.

`desktop/text-composition.mjs` owns one byte-only JSONL worker, registration of immutable font resources, deadlines, shutdown, and recovery. Subsequent calls may omit already registered font bytes. A cached composition token identifies retained immutable lines; a lost worker can rehydrate a retained request and must verify its geometry before exporting the token again. Caches and transport envelopes have explicit budgets.

`src/platform/apple/TextComposition.swift` supplies native glyph outlines, run advances, caret primary/secondary positions, source aliases, first-baseline policies, vertical alignment and optional same-line PDF output. Baseline-to-baseline leading uses the current line's effective leading, including explicit values smaller than glyph ink bounds. It does not substitute a font line box for authored leading. All five first-baseline policies and the minimum offset are measured independently from the glyph ink. PDF frames have exact, zero-origin boxes.

The renderer's `composition-source.js` projects canonical HTML without changing it. Structural marks, empty paragraph placeholders, generated paragraph separators and collapsed formatting whitespace retain distinct source intervals. `composed-svg.js` draws the supplied native glyph paths rather than asking the browser to shape or wrap a second copy of the string. It validates vector budgets, finite geometry and source ranges. Source-owned highlights, decorations and explicit links use the native geometry.

The independent same-line PDF check retains original font resources and invisible native text beneath the rendered outline ink; see [the PDF layer evidence](composed-pdf-layer.md). The source proof still provides its historical visible comparison PDF. Neither outlining alone nor an unrelated hidden browser text copy is sufficient for selectable publication output.

## Verification and limits

Focused native/client tests cover real font registration, pipe framing, cache/restart recovery, failure deadlines, first-baseline placement, line leading and PDF tokens. Controlled native PDF checks cover all 15 first-baseline/vertical-alignment combinations, exact frame sizes, extraction, embedded faces and baselines. Private generated evidence remains outside Git.

Fresh composition of a controlled 10k UTF-16 source measured roughly 313–317 ms on the development Mac, versus approximately 17 ms for a warm retained result. Those historical whole-result numbers do not establish instant editing performance. [Incremental paragraph reflow](../incremental-paragraph-reflow.md) now reuses unchanged paragraph measurements and exact-width decisions, while final geometry still returns a complete flow. Smaller payloads and incremental final layout remain required. A persistent background worker keeps shaping off the interface thread, but large responses, scheduling, source projection and vector display still need their own performance budgets. Physical iPhone/iPad input, complex-script affinity and accessible publication order remain separate gates.

## A usable standalone explanation

The former `tests/prototypes/text-composition/fixture.html` is a module-based automated fixture with console output. It is not a user-facing preview, and opening it through `file://` can fail its imports.

Run `node scripts/build-composition-preview.mjs` to produce `release/composition-preview/IvoComposition.html`. This single HTML contains the interface font, original CMU glyph paths and 22 precomputed layouts across 11 widths. It has visible pages, line/caret overlays, glyph inspection and a view-size control, with no external script, stylesheet, module import, fetch or running server requirement. These are saved measured examples, not an editable demonstration of the full engine. The generated JSON and bundled JavaScript parse successfully; automated browser opening of its local URL was blocked by the browser tool's URL policy, so that exact opening path is not claimed as visually verified.
