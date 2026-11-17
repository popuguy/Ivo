# Marquee, text and native pinch reference

Read-only follow-up on 6 November 2026, using the installed Illustrator 30.8.2 artifacts and version-pinned Chromium sources. Raw native transcripts, hashes and full evidence are private in parent `work/interaction-reference/`. This report contains behavioral conclusions rather than proprietary implementation code.

## Selection and text evidence

Adobe documents partial marquee selection as the default and E as the enclosed-only toggle during dragging. Its group-selection guidance treats a group as one selection unit and Shift-click as adding/removing that group. These establish Ivo's baseline policy; they do not establish the exact hit geometry for every filled/unfilled path, clipped item or nested group. [Adobe enclosed selection](https://helpx.adobe.com/illustrator/desktop/manage-objects/select-objects/select-objects-completely-inside-the-marquee.html), [group selection](https://helpx.adobe.com/illustrator/desktop/manage-objects/select-objects/select-object-groups-and-nested-object-groups.html).

The indexed official Illustrator reference PDF describes double-click word and triple-click paragraph selection. The direct PDF fetch was unavailable in this study, so that is indexed-documentation evidence, not a measured native click trace. Current release notes identify failure of Escape to leave editing as a fixed issue. The requested click-away cancellation sequence is also an explicit Ivo product requirement. Full native text focus/tool transitions still need controlled runtime fixtures. [Adobe reference PDF](https://helpx.adobe.com/content/dam/help/en/pdf/illustrator_reference.pdf), [release notes](https://helpx.adobe.com/illustrator/desktop/new-features/release-notes.html).

Reuse the existing [text-control study](text-controls.md) for measured area/point conversion and glyph scaling. A caret/selection correction should not be represented as a reconstruction of Illustrator's text engine.

## Ordinary pinch scale recovered

The local build uses Electron **45.2.2**, whose official DEPS pins Chromium **156.0.8078.80**. That Chromium's Mac event builder sets gesture scale to native magnification plus one. Its pinch queue maps scale to a logarithmic wheel delta; the source explicitly describes the JavaScript inverse `exp(-deltaY/100)`. [Electron DEPS](https://github.com/electron/electron/blob/v45.2.2/DEPS#L3-L4), [Mac event builder](https://github.com/chromium/chromium/blob/156.0.8078.80/components/input/web_input_event_builders_mac.mm#L639), [pinch queue](https://github.com/chromium/chromium/blob/156.0.8078.80/components/input/touchpad_pinch_event_queue.cc#L40-L44).

Successful scoped REA Mach-O metadata of the shipped dvaui framework produced Evidence `ev_6c3b732e2c71dfe18a3d597dbf7fdf95d6ffbfc176e9998e32b7cf55324eeeeb`. Exact named ARM64 disassembly establishes the platform magnification amount entering a float payload and `GestureEvent::GetMagnificationAmount()` returning it. A format-aware scan of the main executable finds one direct call to its import stub. The downstream consumer accumulates the pending amount, computes candidate scale `z + m*z`, passes the scale delta to an application helper, and resets the pending amount after applying. A corroborating helper reads and updates the same view-scale field. Main executable SHA-256: `8436271e53fe7778dab0eeeea5d8cb6c4b87d0ff28cce77857a534b4fc5fe1ad`.

Thus, for ordinary separately applied platform updates, the native ratio is `1+m`; Chromium's versioned inverse recovers that delivered ratio. Ivo's old `exp(-deltaY*.005)` applied its square root. Using `.01` fixes that proven half-gain error. This inference links two established value flows; it is not a physical trackpad calibration or an exhaustive audit of Electron's compiled patches.

## Remaining differences

The same bounded disassembly identifies fresh gesture capture, a first amount retained before applying scale, later anchor capture, gesture end/cancel paths and a gated quantization branch. The anchor is stored rather than proved to follow a continuous midpoint. Optional quantization uses unresolved runtime fields. Native pending amounts can add before application, while Chromium can multiply/coalesce gesture factors. The native scale helper has runtime-factor bounds; the universal effective UI range was not measured.

Do not blindly copy a dropped first event, quantization or static bounds into Ivo from incomplete state. Gesture phases exposed through DOM, final-event ordering, preference variants, anchor expectations, coalescing, device/display scaling and physical Ctrl+wheel versus pinch remain controlled-runtime work. The current correction establishes ordinary gain only.

The first unapproved REA metadata attempt hit process-inspection EPERM after its exact helper exited; a scoped approved check found that PID absent and the retry succeeded. No active target session was opened, no broad process cleanup was performed, and no installed binary, personal document, preference or global permission setting changed.
