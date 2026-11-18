# Native text command contracts

Native commands must preserve the same source, selection and document ownership as the editor controls. Tests that replace a native API must validate its real argument and completion contract; a permissive mock does not establish desktop interoperability.

## Force Click lookup

Ivo disables pressure-triggered macOS Look Up throughout its desktop app, as permitted by Paul's 18 November request. `desktop/text-input-policy.mjs` sets `com.apple.trackpad.forceClick` to integer zero through Electron's application-domain `setUserDefault` before creating windows. It does not write `NSGlobalDomain`, change system trackpad preferences or change ChatGPT/Codex permissions. Ordinary clicks, word/paragraph selection, dragging, keyboard input and explicit dictionary commands retain their own paths.

This follows Chromium's actual Cocoa [force-touch responder](https://github.com/chromium/chromium/blob/main/content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm) and [preference lookup](https://github.com/chromium/chromium/blob/main/ui/base/cocoa/appkit_utils.mm), via Electron's [NSUserDefaults API](https://www.electronjs.org/docs/latest/api/system-preferences). DOM pressure/click cancellation alone cannot establish that native policy. The production-main runtime test checks the effective application value and unchanged global preference; the portable unit checks the macOS-only API contract. Physical pressure hardware cannot be synthesized by `sendInputEvent`, so a physical Force Click remains a manual qualification check. Development Electron launches use their host application's preference domain; packaged Ivo uses `com.paulcantrell.ivo`.

## Document clipboard

The pinned Electron runtime uses asynchronous `clipboard.write(ClipboardItem[])` and `clipboard.writeText(...)`. `desktop/document-clipboard.mjs` constructs one real item containing `text/plain` and `text/html` for document links and awaits the native write. Path copy also awaits completion. The production `ivo:document-file` IPC returns success only afterward; failed native writes reject through the existing UI error path. Stable document IDs remain in rich links and titles are escaped. Trusted file lookup and window/frame/origin validation remain in the main process.

`tests/runtime/document-clipboard/runner.mjs` uses a temporary vault and the actual production main/preload route. It checks the installed native clipboard's plain/HTML representations, waits behind deliberately delayed real writes, verifies rejected writes and invalid document lookup, restores all initial clipboard representations, and verifies the source document is unchanged. The workspace-window fixture now constructs/reads real `ClipboardItem` MIME payloads in its test port rather than accepting the removed `{text, html}` API shape. It also targets the retained on-page `.canvas-flow-input` instead of the removed bottom editor. Its two native stages pass with writer leases, transfers, passive refresh and close/reopen behavior.

## Native Type-menu ownership

Type → Bold, Italic and Underline use native Command/Control-B/I/U accelerators. The renderer publishes a bounded opaque formatting capability only for the current editable text target. It covers document revision, object/flow identity and logical selection/affinity; title/search/inspector/select/button focus, modal/composition/busy state and passive writers have no capability. The main process validates the pair and enables the native items only for a valid target. The existing preload transports structured IPC without exposing any new method.

A menu action sends its command and the captured target back to the owning renderer. `runAction` rechecks writer/editing/modal/busy/composition state and the current token before dispatch. A stale menu state cannot format another range, frame or document. The formatting command bypasses the navigation transition queue, whose busy state would deliberately invalidate the text input. Existing string/native-field commands retain their route. Selection changes publish updated capabilities, so native menus follow the actual logical range.

Pure protocol tests cover malformed/unbounded state, unsupported actions and absent/stale targets. The isolated native menu fixture exercises the production menu and IPC, partial ranges, same-revision selection changes, title/numeric field rejection, whole-frame formatting, undo/redo and trusted shortcut input without double dispatch. This establishes the tested command paths; full native keyboard/IME and cross-platform parity remain a broader input gate.

## Remaining object-context clipboard target

The native canvas context menu currently exposes Cut/Copy/Paste for active text editing. Selected objects use the delivered keyboard/Edit-menu clipboard path, but those roles are not yet offered for an object-only context. Right-click selection does not by itself focus the viewport; an inspector input can retain focus. Adding these items belongs with an explicit clipboard target/focus contract, including tests that begin with an inspector field focused and verify which clipboard/source receives the action. Native shortcut intent handling and browser `beforeinput` formatting normalization remain separate routes in the text-input suite.
