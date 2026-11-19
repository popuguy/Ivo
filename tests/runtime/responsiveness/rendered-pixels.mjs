// Read only the test control or text region and discard the frame immediately.
// Scale from CSS coordinates to the capture surface, including Retina displays.
function crop(image, region, viewport) {
  const size = image.getSize();
  const xScale = size.width / viewport.width,
    yScale = size.height / viewport.height;
  const rect = {
    x: Math.floor(region.x * xScale),
    y: Math.floor(region.y * yScale),
    width: Math.max(1, Math.round(region.width * xScale)),
    height: Math.max(1, Math.round(region.height * yScale)),
  };
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > size.width ||
    rect.y + rect.height > size.height
  )
    throw Error('Measured ink is outside the window');
  const data = image.crop(rect).toBitmap();
  return Uint8Array.from({ length: data.length / 4 }, (_, i) => data[i * 4]);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Record the arrival of a compositor frame before doing any pixel processing.
// Count an action when at least 80% of its high-contrast changed pixels match
// the settled frame. Capture on independent frames, outside the input handler.
export function observeRenderedActions(contents, viewport) {
  let active;
  contents.beginFrameSubscription(false, (image) => {
    if (!active) return;
    const now = performance.now(),
      bytes = crop(image, active.region, viewport);
    active.frames.push({ elapsed: now - active.start, bytes });
  });
  async function measure(region, dispatch) {
    const sample = { region, frames: [] };
    try {
      const baseline = crop(await contents.capturePage(), region, viewport);
      sample.start = performance.now();
      active = sample;
      await dispatch();
      await pause(260);
      // Idle or occluded windows can stop delivering callbacks between changes.
      // Independently read the settled surface rather than trusting the last callback.
      const image = await contents.capturePage();
      const elapsed = performance.now() - sample.start;
      const final = crop(image, region, viewport);
      if (final.length !== baseline.length) throw Error('Window scale changed during sampling');
      const changed = [];
      for (let i = 0; i < final.length; i++)
        if (Math.abs(final[i] - baseline[i]) > 64) changed.push(i);
      if (changed.length < 3) throw Error('Measured action produced no distinct glyph or icon');
      const first = sample.frames.find(
        (frame) =>
          changed.filter((i) => Math.abs(frame.bytes[i] - final[i]) < 25).length >=
          0.8 * changed.length,
      );
      return {
        ms: first?.elapsed ?? elapsed,
        pixels: changed.length,
        ...(first ? {} : { upperBoundOnly: true }),
      };
    } finally {
      active = null;
    }
  }
  return { measure, close: () => contents.endFrameSubscription() };
}
