# Stable text during page zoom

The page camera preserves authored text layout while changing its view transform. Character advances, baselines, line breaks, text-frame geometry and logical selection must not change because a user pinches. Zoom/pan remain view state and cannot create document/history writes. This contract covers independent text, linked-frame previews and the retained canonical input; native-composed glyphs retain their existing vector plan.

## Cause and correction

The previous camera changed CSS `zoom` on every display frame. That changes the browser's layout/font scale, allowing fractional font metrics and line boxes to round differently. A new character-rectangle regression reproduced a 0.5 document-unit change at 25% zoom before the fix. The earlier tests checked frame bounds and raster sharpness, but did not assert character geometry through the gesture.

`src/rendering/page-camera.js` now keeps layout zoom at one and applies a plain 2D affine matrix to both page ink and input. Text is laid out in document coordinates and painted at the current view scale. It does not use `will-change: transform`, a 3D promotion or a transform animation that would encourage reuse of a fixed-resolution page bitmap. Direct camera assignment, focal-point math, coalesced animation-frame painting, native pinch gain and two-decimal zoom status remain unchanged.

This follows Chromium's documented [script-driven transform re-rasterization policy](https://developer.chrome.com/blog/re-rastering-composite), with actual raster checks on the pinned Electron build. A transform matrix alone cannot establish sharpness; the tests inspect submitted frames. No native typography choice, authored font size, leading, source format or archive capability is changed.

## Verification

- The rendering fixture compares character rectangles at 12 scales, including 24%, 33.333%, 99.99%, 100.01%, 137.25%, 400% and 775%. Rich text includes fractional font sizes/frame widths, tracking, emphasis, explicit breaks, wrapped paragraphs and different fonts.
- The actual editor fixture runs 90 pinch-wheel frames while editing a linked flow. It measures independent text, both physical frame previews and the retained input, checks the same caret/node/source/fragment identities, and rejects source/history changes. Maximum measured character-rectangle deviation is approximately 0.000305 document units, below the 0.002 measurement tolerance.
- Rendering tests at 2× and 1.25× pixel density capture the first submitted requested-scale frame and its settled result: zero changed channels. Six consecutive zoom frames also match independently created cold paint of the same authored content, including regular/italic text, vector paths, clipping and an image. The synthetic magenta geometry marker has a separate assertion and its top band is excluded from the live/cold ink comparison; a few subpixel marker-edge damage fringes are not counted as document ink.
- Newly sized font text remains an informational diagnostic. Its line-box/font hinting can round differently at fractional display density; cold paint of the unchanged authored layout is the sharpness authority for this contract.
- The 500-object viewport case retains immediate application-state response, anchored pinch, stable selection controls and zero camera-triggered text-overflow reads. Native caret-query anchoring exercises the production 2D camera. All 36 desktop groups and the standard 273 unit checks pass.

Evidence is retained outside Git under parent `work/stable-text-zoom-2026-11-18/`. The separate native reference probe and its raw observations remain local. Automatic review rejected optional clearing of that analysis session; its evidence was retained rather than discarded.

## Limits

Synthetic wheel/touch events and captured compositor frames do not measure physical trackpad-to-display latency, establish identical InDesign gesture phases or certify every document workload. Safari/Firefox and physical iPhone/iPad qualification remain separate. This correction preserves layout within each host scale; it does not claim that browser font layout is identical across different devices or replace the native composition programme. Personal vaults and global settings are untouched.
