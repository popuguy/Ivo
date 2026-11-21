# Document and vault formats

Custom baseline grids on native text frames use **archive 17 / canvas 16**. When present, `frameOptions.baselineGrid` stores `relativeTo` (`page`, `frame`, or `inset`), `start` in points from 0 to 14,400 and `increment` in points from 1 to 2,000. Omitting the field uses the document grid. The archive reader checks the version, grid values and owning native flow. Opening an archive 16 document preserves its existing grid and format. Find/Change queries are local application preferences outside the document data.

Authored **Justification** settings with letter-spacing or glyph-scaling limits use **archive 16 / canvas 15**. The paragraph, named style, direct override or inline `data-ivo-wordspace` value stores three triples as `wordMin:desired:max|letterMin:desired:max|glyphMin:desired:max` in percent. An existing word-only triple retains its original format and behavior. A document that has used the new capability keeps its version after removing the setting. Derived line breaks, actual per-line percentages and glyph positions stay out of the document.

The same archive 16 / canvas 15 capability permits native text frames to store `frameOptions.verticalAlign = "justify"` and an optional `frameOptions.paragraphSpacingLimit` from 0 through 2,000 pt. A missing limit means zero. Each column distributes its extra vertical space at composition time. The limit can stay with a frame when its alignment changes. Import rejects active vertical Justify on a legacy flow or an unthreaded object. Existing Top, Center and Bottom documents retain their original format.

Archive 16 / canvas 15 also supports a page-relative baseline grid. The optional `publishing.baselineGrid` object stores `start` (0–14,400 pt from the page top) and `increment` (1–2,000 pt). A paragraph can opt in through `baselineAlignment` or `data-ivo-gridalign` using `all`, `first` or the explicit reset `none`. A paragraph without this setting inherits its style, defaulting to no alignment. When an aligned paragraph has no authored grid settings, its grid starts at 36 pt and increments by 12 pt. The visible guide switch is local to the editor. Baseline positions do not enter the vault.

Authored paragraph hyphenation preferences use **archive 15 / canvas 14**. Each setting is optional and can be inherited from a paragraph style. The existing Hyphenate switch alone retains its previous format. Generated hyphens and line-ending counts are derived during composition.

Character **No Break** (`noBreak`, markup `data-ivo-nobreak`) uses **archive 14 / canvas 13**, including named styles and explicit resets. Its selected spaces remain ordinary source characters. Split-line activation (`keepBoundaryLines`, markup `data-ivo-keepedges`) uses **archive 13 / canvas 12**, including an explicit off value. Existing `orphans` and `widows` counts alone retain their earlier format. Paragraph starts use **archive 12 / canvas 11**. Extended paragraph keeps use **archive 11 / canvas 10**. Authored paragraph word spacing uses **archive 10 / canvas 9**. Authored object text wrap uses **archive 9 / canvas 8**. Explicit native text composition uses **archive 8 / canvas 7**. Authored first-baseline policies use **archive 7 / canvas 6**. Other publishing documents remain **archive 6 / canvas 5**; canonical linked-text documents without the newer capabilities remain **archive 5 / canvas 4**. Older representations remain readable. The native folder manifest is **version 1**; browser IndexedDB is **version 4**. These versions describe different boundaries and must not be advanced together without a reason.

| Archive | Document capability                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| 1       | Legacy grid document, no canvas version                                                                            |
| 2       | Fixed pages and objects, canvas 1                                                                                  |
| 3       | Rich typography, canvas 2                                                                                          |
| 4       | Previous linked-text representation, canvas 3; read through the compatibility decoder                              |
| 5       | Canonical `textFlows` with frame `textFlowId`, canvas 4                                                            |
| 6       | Publishing layers, parent definitions/overrides, sparse text styles, frame options and vault font assets, canvas 5 |
| 7       | Explicit font-metric/fixed first-baseline policies and minimum offsets, canvas 6                                   |
| 8       | Explicit native flow composition authority/policy, canvas 7                                                        |
| 9       | Object text wrap, frame ignore-wrap and document/layer wrap policy, canvas 8                                       |
| 10      | Atomic paragraph word-spacing preferences, including explicit normal/reset, canvas 9                               |
| 11      | Extended paragraph keeps, canvas 10                                                                                |
| 12      | Paragraph starts, canvas 11                                                                                        |
| 13      | Split-line keep controls, canvas 12                                                                                |
| 14      | Character No Break, canvas 13                                                                                      |
| 15      | Paragraph hyphenation preferences, canvas 14                                                                       |
| 16      | Paragraph letter spacing, glyph scaling, vertical frame justification and baseline grids, canvas 15                |

A document has a stable ID and version, editable title, timestamps, tags/aliases, objects and (for current scenes) pages. A text flow has its own stable ID, rich HTML, ordered frame IDs, style, continuation policy and ownership of automatically generated pages. Frames hold geometry and a reference to their text flow; they do not duplicate its source. Images reference original assets. Polygon masks form a validated, bounded parent tree. Application extension data is namespaced and bounded; unknown extension namespaces survive validation.

`domain/documents/schema.js` validates and normalizes import/storage input. `capabilities.js` derives the required archive capability. The compatibility decoder in `migrations.js` is the only production location retaining the old field names. Frozen legacy fixtures intentionally retain their original bytes and spelling. Existing opaque IDs, authored text, Unicode, blank paragraphs, pages, geometry, extensions and original assets are preserved; new IDs use current terminology.

The decoder reads old fields into the current representation without mutating its input. Mixed old/current representations in one document reject rather than silently choosing a source. Unsupported versions, duplicate/invalid references, unsafe URLs/markup, excessive data and invalid clipping ownership fail before a commit. Normalizing a native vault on open performs **no disk write**. A subsequent user edit writes a new immutable current revision while the previous file remains intact. Stored history is decoded through the same boundary.

The folder contains `atlas.json`, content-digested document JSON objects and original asset byte objects. The manifest points to complete validated objects. Object writes precede the atomic manifest replacement; a failed/interrupted manifest commit leaves the previous manifest authoritative. An expected-manifest hash rejects a stale writer. Native IO accepts only confined relative object paths and rejects symbolic-link escapes. Existing assets are not recompressed during migration.

IndexedDB 4 preserves the documents/assets/meta stores. The version change closes stale connections; older database clients cannot reopen a newer database. Reading compatibility data does not rewrite its source; normal edited writes use current keys. Browser history is validated/decoded when read. Per-window workspace metadata and local history are not the future cloud synchronization authority.

Format regressions live in `tests/unit/migrations.test.js`, `tests/unit/vault.test.js`, the browser-storage runtime and the native Foundation interoperability test. See [verification](verification.md) and the [sync boundary](decisions/0002-sync-boundary.md).

Logical library organization still uses the existing `ivo.library` document extension and `library:1` folder metadata. Folder changes alter only that semantic metadata plus revision/timestamp, preserving document identities and authored content. `changeLibrary` commits the affected revisions and folder tree together; it adds no new document/archive/manifest version. Named workspace catalogs and window chrome use bounded profile-local preference keys, excluded from document exports and future authored-replica authority.

Workspace1 view metadata now admits bounded `stacked` groups, graph/backlinks `linkedTo` references and per-graph local scope. Named workspaces include a normalized context-panel layout; named panel presets remain a bounded profile-local catalog scoped to a vault. New view fields carry no authored source, assets, undo or live caret data. Incoming native-window views receive new local tab identities; existing in-memory caret/closed-tab bookmarks are preserved.

Publishing capability details and limits are in [publishing-foundation.md](publishing-foundation.md). `publishing.version` is 1. Parent definitions own stable object/vertex IDs; pages reference them, and inherited instances are disposable. Layer visibility/locking and scene ownership participate in validation, painting and editing. Named style IDs and based-on links are validated independently of direct overrides. Run/paragraph attributes are typed and allowlisted. TrueType/OpenType asset metadata is decoded from saved bytes; fonts retain original data and use the existing hashed `.bin` objects. Font data does not require a new native manifest or database store. Old source/asset originals remain unchanged on read.

The 18 November system-font increment keeps archive 6 / canvas 5. System picker identities (`system:`) are transient and never valid document font references. External faces become validated `font-<SHA-256>` assets before use; bundled Geist is an additional publishing-gated preset. Existing Georgia/Helvetica names remain valid and can be satisfied by vault-contained family faces without source rewriting. Archives containing font resources require schema 6 even when their document sources predate publishing. Native manifest 1 and immutable asset paths remain unchanged.

The frame-composition increment adds optional `frameOptions.firstBaseline` (`ascent`, `cap-height`, `x-height`, `leading`, `fixed`) and `minimumFirstBaseline` (0–2000 document points). These fields require at least archive 7 / canvas 6 and are retained by archive 8 / canvas 7; selecting them is an authored capability upgrade. No first-baseline fields are injected when reading archive 6 / canvas 5. Removing a policy does not downgrade a document that already required the newer format. Earlier readers reject the archive/canvas version rather than silently stripping layout semantics. Frozen archive 6 and first-baseline round-trip fixtures cover the boundary, including parent objects, clipboard and PDF snapshots. Native manifest 1 and IndexedDB 4 are unchanged: their existing validated document revisions carry the new capability. Derived column offsets and measured metrics remain disposable and never enter source.

## Native flow composition capability

Archive 8 / canvas 7 adds one optional authored field to a canonical text flow:

```json
"composition": { "version": 1, "composer": "paragraph" }
```

The only accepted composers are `paragraph` and `single-line`. Version and composer are explicit; missing/unknown composers, a version other than 1, or extra fields in this object reject. Supplying the field under archive 7 or earlier, or a canvas version other than 7 or 8, rejects before any storage write. This is a persisted choice of composition authority/policy, not a claim that every typography capability is supported by the selected native implementation. Unsupported source/features must produce an explicit composition error while retaining the complete canonical HTML.

`enableNativeComposition` opts a member flow into the capability. Opening archive 6 or 7 adds no `composition` field, does not change its canvas version and performs no disk write. The current decoder may also read older document capabilities inside an archive 8 container; that does not opt those documents into native composition. Publishing, first-baseline edits, copying and object paste retain an already higher canvas capability. Removing the composition field does not implicitly downgrade canvas 7. Sharing derives the minimum required archive version from the actual document capabilities and resources.

The derived native bridge now uses internal protocol 2 for paragraph alignment, spacing and indents. Its paragraph ranges and aligned origins are not persisted; existing typography fields and the version-1 composition choice remain unchanged. An older native worker rejects protocol 2 rather than silently ignoring paragraph layout.

Internal protocol 3 retains planned frame/baseline/line-area placements. Protocol 4 adds sparse baseline shift, character scaling and exact-face OpenType switches, while retaining separate line struts and signed ink metrics. Default runs retain their earlier protocol identity. These are helper transport versions; archive/canvas versions and the version-1 saved composition choice remain unchanged. No native positions or feature metadata cache is written into document source.

Native All/Next1 scheduling uses the existing paragraph `keepTogether` / `keepWithNext` booleans. Its local policy array, source ranges, retries and keep-violation diagnostics are disposable planner state and never enter helper shaping requests or saved content. Default widow/orphan counts do not activate partial keeps. No archive/canvas/manifest/IndexedDB upgrade is introduced by this scheduling increment.

The flow still owns a single rich HTML source, sparse style and ordered frame IDs. Native attributed strings, logical/native position maps, selected line breaks, glyph paths, measured carets, cache tokens and PDF bytes are derived data. They are never serialized as a second editable source. Font resources retain their existing immutable vault asset identities and byte-validation rules.

Automatically generated pages continue to use `autoPages: [{ "pageId": "…", "frameId": "…" }]`, with the existing maximum of 128 entries and exclusive page ownership across flows. References must resolve to a page and a member frame on that page. Newly appended native continuations use deterministic, collision-checked stable page/frame IDs; ordinary legacy-flow append retains its existing identities. Full generated pages, frames and ownership records remain in saved revisions and undo snapshots.

History equality separately projects away only a native flow's exclusively owned continuation page whose sole physical object is that empty-source, root area-text frame. Legacy flows, mixed-content pages, malformed ownership and duplicate source are retained in the comparison. Intentional geometry, page metadata/order, frame threading, parent/layer/appearance edits or added objects release the affected native ownership before recording the command. Source/typography changes alone do not; an asynchronous grow/shrink arriving during that command is also excluded from authored equality. Explicit frame/page deletion disables native automatic continuation and, while other member frames remain, retains the complete canonical source as potentially overset text. Deleting every member frame removes the flow through the existing document command; undo retains its complete prior snapshot. Derived shrink uses a separate command and preserves the continuation policy. See [native composition ownership](native-composition-ownership.md).

The new frozen `tests/fixtures/legacy/archive-v7.json` retains its original linked source and first-baseline geometry without native opt-in. `tests/unit/derived-text-layout.test.js` covers old/new gates, repeated normalization, copies/paste, stable continuation identities, source/style edits with asynchronous layout, promotion, deletion and strict history checks. No manifest, IndexedDB or cloud-provider format is advanced by this capability.

## Object text wrap capability

Archive 9 / canvas 8 adds optional source-owned object options:

```json
"textWrap": {
  "mode": "bounds",
  "offsets": { "top": 8, "right": 8, "bottom": 8, "left": 8 },
  "side": "both",
  "invert": false,
  "contour": { "source": "frame" }
}
```

Modes are `none`, `bounds`, `contour`, `jump` and `next-column`. Sides are `both`, `left`, `right`, `largest`, `inside` and `outside`. Offsets are signed distances in document points from −2000 to 2000. The editor reverses their direction when Invert changes, preserving the displayed numbers. Jump and Next continue to exclude full lines. Rectangular frames support four contour offsets. Other object contours use one uniform offset. The default contour source `frame` uses the object geometry and clips placed images to their visible area. A placed graphic can also select `bounding-box` for its image rectangle or `graphic-frame` for its container. Unknown fields, contour sources, enums, unsafe records and nonfinite values reject.

The optional document extension `ivoTextWrapDefaults` holds normalized settings for subsequent object creation. Existing objects own independent settings. These defaults require the same archive and canvas capabilities as an authored wrap.

`ignoreTextWrap` is an optional Boolean on actual text/quote frames. `textWrapPreferences` optionally stores `{ "onlyBelow": false, "facingPages": false, "firstPageSide": "right" }` on the document. `onlyBelow` limits exclusions to wrapping objects above the target in stacking order. `firstPageSide` accepts `left`/`right`; facing pages alternate that side in physical page order for toward/away-spine choices. A layer's optional Boolean `ignoreWrap` suppresses its wrapping only while the layer is hidden. These fields, including explicit disabled values and parent-template fields, require archive 9 / canvas 8. Removing options does not downgrade an already upgraded document.

Authoring wrap adopts independent area text/quote on the affected pages into canonical text flows in the same undo transaction. Frame IDs, complete source HTML and effective quote typography remain intact; newly adopted flows disable automatic continuation until the user enables it. Point text is unchanged. The idempotent `ensureTextWrapFlows` command also adopts area frames added or moved onto wrapped pages. It never runs during reading, selection or rendering. New archives containing active-wrap pages and unthreaded actual area frames reject before writes instead of permitting a display/input mismatch. Parent definitions retain direct template source under a private recursive validation context; an archive field cannot opt out of the actual-page flow rule. Inherited parent text remains a separate readonly template-display case until overridden.

Wrap geometry, transformed contours, triangulation, available line bands and source fragments are derived and never serialized as another text authority. The current polygon offset implementation supports convex straight contours (positive/negative offsets) and zero-offset unstroked concave contours. Nonzero concave offsets/stroke expansion, rounded-frame contours and self-intersecting contours produce explicit unsupported errors. Frame contour geometry is not image-alpha detection. Largest-side selection and transformed offset joins remain Ivo policies pending complete native reference qualification. Empty contracted inverse contours admit no text rather than silently disabling the wrap.

Commands, archive validation and layout share one pure contour authority. It checks every nonadjacent segment pair before offset or triangulation, with exact binary-coordinate orientation when floating arithmetic is ambiguous; local turns or successful ear clipping cannot certify a pentagram. The same cross-field proof rejects unsupported contour/object combinations before storage, including inside parent templates. Object paste adopts newly affected destination area frames before assigning the replacement document; callers do not need a later repair to make pasted wrap data valid.

The frozen inline archive-8 fixture in `tests/unit/text-wrap.test.js` verifies unchanged input, IDs, source and canvas capability with no wrap opt-in on read. Tests cover malformed/old gates, exact complete-band exclusions, stroke/offset semantics, hierarchy transforms, hidden-layer/stack/spine policies, source adoption/idempotence, parents, native-flow coexistence, copying/paste and continuation-frame options. Native manifest 1 and IndexedDB 4 are unchanged.

## Paragraph word-spacing capability

Archive 10 / canvas 9 adds the atomic paragraph field `wordSpacing`, stored as a normalized `minimum:desired:maximum` string or `normal`, and source attribute `data-ivo-wordspace`. Percentages are finite, ordered and within 0…1000; fractional values survive normalization. Explicit values in flow/block settings, overrides, paragraph source, named styles and parent definitions require this gate, even when the value is `normal` or a named definition is not currently used. Reset retains canvas 9, preventing an old writer from silently dropping the field. Native manifest 1 and browser IndexedDB 4 are unchanged.

Frozen `tests/fixtures/legacy/archive-v9.json` was normalized with the preceding implementation. Reads keep its prior source, IDs, geometry and version; no word-spacing value or native composer is introduced. New writes preserve immutable prior object bytes and use the existing atomic manifest transaction. Copy/paste retains separate flow IDs and the explicit capability. Invalid/crossed triples reject before replacing stored content.

This persisted capability is separate from internal native protocol 5 and its disposable measured word-spacing plans. UI authoring currently requires an explicitly native flow; the first admission is simple LTR ordinary spaces without effective wraps, tabs, special/nonbreaking spaces or negative tracking. No browser CSS approximation or automatic native opt-in is added. See [native paragraph word spacing](native-word-spacing.md) for layout rules and open qualification.

## Counted and backward paragraph keeps

Archive 11 / canvas 10 adds `keepNextLines` (integer 1–5, default 1) and `keepWithPrevious` (boolean, default false). The corresponding rich paragraph attributes are `data-ivo-nextlines` and `data-ivo-previous`. The existing `keepWithNext` flag enables the following-line count. Explicit settings and resets in paragraph source, frames, flows, named styles and parent pages require the new format. Older one-line joins retain their original format. Clearing these fields after saving retains the new format. Undoing the original edit can restore the previous document version.

The frozen archive 10 fixture contains a legacy one-line join and word-spacing policy. It must open without any source or version change. Physical rows, candidate placements and violated joins remain derived data.

## Paragraph starts

Archive 12 / canvas 11 adds the paragraph field `paragraphStart`, encoded in rich source as `data-ivo-pstart`. Allowed values are `anywhere`, `column`, `frame`, `page`, `odd` and `even`. An explicit setting or reset requires the new format. Opening existing documents without a setting keeps their original version. Page numbers, continuation slots and resolved line destinations are derived. The frozen archive 11 fixture preserves its counted keep and its existing composer choice.
